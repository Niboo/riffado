import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { parseBuffer } from "music-metadata";
import { db } from "@/db";
import {
    AUDIO_LEASE_MS,
    type AudioJob,
    claimAudioJob,
    deleteAudioJobRow,
    expireAudioJobs,
    selectDeletedAudioJobs,
    updateAudioJob,
} from "@/db/queries/audio-jobs";
import { recordings } from "@/db/schema";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { createUserStorageProvider } from "@/lib/storage/factory";
import type { StorageProvider } from "@/lib/storage/types";
import {
    isOggOpus,
    splitOpusSegments,
    transcodeToMp3Segments,
} from "@/lib/transcription/ffmpeg";
import type {
    DiarizationPersistence,
    PreparedAudioSegment,
} from "@/lib/transcription/openai-diarized-transcribe";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
import { isBuild } from "@/lib/utils";

import {
    audioPartFormat,
    isUsableAudioPart,
    MIN_AUDIO_PART_SECONDS,
} from "@/types/audio-processing";

export const AUDIO_PART_SECONDS = 1199;

export async function prepareAudioParts(
    job: AudioJob,
    storage: StorageProvider,
    audio: Buffer,
    durationMs: number,
): Promise<void> {
    await removeShortAudioParts(job, storage);
    const opus = isOggOpus(audio);
    if (
        opus &&
        job.parts.some(
            (part) => audioPartFormat(part).contentType !== "audio/ogg",
        )
    )
        throw new Error("Remove saved MP3 parts before splitting Opus again");
    if (job.splitComplete) return;
    const seconds = durationMs / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0)
        throw new Error("Invalid recording duration");
    const partSeconds =
        seconds / Math.max(1, Math.ceil(seconds / AUDIO_PART_SECONDS));
    await updateAudioJob(job, { status: "splitting" });
    const contentType: "audio/ogg" | "audio/mpeg" = opus
        ? "audio/ogg"
        : "audio/mpeg";
    const extension = opus ? "ogg" : "mp3";
    const segments = opus
        ? splitOpusSegments(audio, partSeconds)
        : transcodeToMp3Segments(audio, partSeconds);
    let sourceOffset = 0;
    for await (const segment of segments) {
        const metadata = await parseBuffer(segment.buffer, contentType, {
            duration: true,
        });
        const duration = metadata.format.duration;
        if (!duration || !Number.isFinite(duration) || duration > 1200)
            throw new Error("Generated audio part has an invalid duration");
        const startSeconds = segment.startSeconds ?? sourceOffset;
        sourceOffset = startSeconds + duration;
        if (
            duration < MIN_AUDIO_PART_SECONDS ||
            job.parts.some((part) => part.index === segment.index)
        )
            continue;
        const storageKey = `audio-parts/${job.userId}/${job.recordingId}/${job.id}/part-${segment.index}.${extension}`;
        await updateAudioJob(job, {
            leaseUntil: new Date(Date.now() + AUDIO_LEASE_MS),
        });
        await storage.uploadFile(storageKey, segment.buffer, contentType);
        const part = {
            index: segment.index,
            startSeconds,
            endSeconds: startSeconds + duration,
            storageKey,
            bytes: segment.buffer.length,
            contentType,
            status: "ready" as const,
        };
        await updateAudioJob(job, { parts: [...job.parts, part] });
        console.info(
            `[audio-job] ${job.id} saved part ${segment.index + 1}/${segment.count}`,
        );
    }
    if (!job.parts.length)
        throw new Error(
            "No audio part meets the minimum duration of 5 seconds",
        );
    await updateAudioJob(job, { splitComplete: true });
}

async function removeShortAudioParts(
    job: AudioJob,
    storage: StorageProvider,
): Promise<void> {
    const shortParts = job.parts.filter((part) => !isUsableAudioPart(part));
    for (const part of shortParts) {
        await updateAudioJob(job, {
            leaseUntil: new Date(Date.now() + AUDIO_LEASE_MS),
        });
        if (await storage.exists(part.storageKey))
            await storage.deleteFile(part.storageKey);
    }
    if (shortParts.length)
        await updateAudioJob(job, {
            parts: job.parts.filter(isUsableAudioPart),
            splitComplete:
                job.splitComplete && job.parts.some(isUsableAudioPart),
        });
}

export function persistentDiarization(
    job: AudioJob,
    storage: StorageProvider,
): DiarizationPersistence {
    return {
        async *segments(
            audio,
            durationMs,
            fingerprint,
        ): AsyncGenerator<PreparedAudioSegment> {
            await prepareAudioParts(job, storage, audio, durationMs);
            const signature = createHash("sha256")
                .update(fingerprint)
                .digest("hex");
            if (job.transcriptFingerprint !== signature) {
                await updateAudioJob(job, {
                    transcriptFingerprint: signature,
                    parts: job.parts.map(
                        ({
                            encryptedText: _text,
                            error: _error,
                            startedAt: _started,
                            completedAt: _completed,
                            ...p
                        }) => ({
                            ...p,
                            status: "ready" as const,
                            attempts: 0,
                        }),
                    ),
                });
            }
            await updateAudioJob(job, { status: "transcribing" });
            for (const part of job.parts) {
                if (
                    part.encryptedText !== undefined &&
                    part.status === "completed"
                ) {
                    yield {
                        index: part.index,
                        count: job.parts.length,
                        startSeconds: part.startSeconds,
                        cachedText: decryptText(part.encryptedText),
                    };
                    continue;
                }
                await updateAudioJob(job, {
                    parts: job.parts.map((p) =>
                        p.index === part.index
                            ? {
                                  ...p,
                                  status: "transcribing" as const,
                                  error: undefined,
                                  attempts: (p.attempts ?? 0) + 1,
                                  startedAt: new Date().toISOString(),
                                  completedAt: undefined,
                              }
                            : p,
                    ),
                });
                console.info(
                    `[audio-job] ${job.id} requesting part ${part.index + 1}/${job.parts.length}`,
                );
                yield {
                    buffer: await storage.downloadFile(part.storageKey),
                    contentType: audioPartFormat(part).contentType,
                    index: part.index,
                    count: job.parts.length,
                    startSeconds: part.startSeconds,
                };
            }
        },
        async save(index, text) {
            await updateAudioJob(job, {
                parts: job.parts.map((p) =>
                    p.index === index
                        ? {
                              ...p,
                              status: "completed" as const,
                              encryptedText: encryptText(text),
                              error: undefined,
                              completedAt: new Date().toISOString(),
                          }
                        : p,
                ),
            });
            console.info(
                `[audio-job] ${job.id} completed part ${index + 1}/${job.parts.length}`,
            );
        },
    };
}

export async function processAudioJob(job: AudioJob): Promise<void> {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
        updateAudioJob(job, {
            leaseUntil: new Date(Date.now() + AUDIO_LEASE_MS),
        }).catch(() => {
            leaseLost = true;
        });
    }, 15_000);
    try {
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, job.recordingId),
                    eq(recordings.userId, job.userId),
                    isNull(recordings.deletedAt),
                ),
            )
            .limit(1);
        if (!recording) throw new Error("Recording was deleted");
        if (
            `${recording.fileMd5}:${recording.filesize}:${recording.storagePath}:${recording.duration}` !==
            job.sourceVersion
        )
            throw new Error("Source audio changed");
        const storage = await createUserStorageProvider(job.userId);
        await removeShortAudioParts(job, storage);
        if (job.action === "split") {
            await prepareAudioParts(
                job,
                storage,
                await storage.downloadFile(recording.storagePath),
                recording.duration,
            );
        } else {
            await updateAudioJob(job, { status: "transcribing" });
            const result = await transcribeRecording(
                job.userId,
                job.recordingId,
                {
                    force: true,
                    trigger: "manual",
                    providerId: job.providerId ?? undefined,
                    model: job.model ?? undefined,
                    diarizationPersistence:
                        recording.duration > 20 * 60 * 1000
                            ? persistentDiarization(job, storage)
                            : undefined,
                    assertActive: async () => {
                        if (leaseLost) throw new Error("Audio job interrupted");
                        await updateAudioJob(job, {
                            leaseUntil: new Date(Date.now() + AUDIO_LEASE_MS),
                        });
                    },
                },
            );
            if (!result.success)
                throw new Error(result.error ?? "Transcription failed");
        }
        await updateAudioJob(job, {
            status: job.action === "split" ? "ready" : "completed",
            claimToken: null,
            leaseUntil: null,
        });
    } catch (error) {
        console.error(
            `[audio-job] ${job.id} failed: ${audioFailureMessage(error)}`,
        );
        await updateAudioJob(job, {
            status: "failed",
            error: audioFailureMessage(error),
            parts: job.parts.map((p) =>
                p.status === "transcribing"
                    ? {
                          ...p,
                          status: "failed" as const,
                          error: audioFailureMessage(error),
                      }
                    : p,
            ),
            claimToken: null,
            leaseUntil: null,
        }).catch(() => {});
        if (!(error instanceof Error)) throw error;
    } finally {
        clearInterval(heartbeat);
    }
}

let running = false;
let started = false;
export async function audioWorkerTick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        await expireAudioJobs();
        for (const deleted of await selectDeletedAudioJobs()) {
            const storage = await createUserStorageProvider(deleted.userId);
            for (const part of deleted.parts) {
                if (await storage.exists(part.storageKey))
                    await storage.deleteFile(part.storageKey);
            }
            await deleteAudioJobRow(deleted);
        }
        const job = await claimAudioJob();
        if (job) await processAudioJob(job);
    } catch {
        console.error("[audio-worker] Could not process queued audio job");
    } finally {
        running = false;
    }
}

export function startAudioWorker(): void {
    if (started || isBuild) return;
    started = true;
    setInterval(() => {
        void audioWorkerTick();
    }, 5000).unref();
    void audioWorkerTick();
}

export function audioFailureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "";
    if (/Remove saved MP3/i.test(message))
        return "Saved parts use MP3. Remove saved parts, then split the original Opus recording again.";
    if (/timed? out|timeout/i.test(message))
        return "The transcription provider timed out. Completed parts are saved. Retry to resume from the first unfinished part.";
    if (
        /invalid[ _-]+api[ _-]?key|incorrect[ _-]+api[ _-]?key|authentication|unauthori[sz]ed|\b401\b/i.test(
            message,
        )
    )
        return "The provider rejected the credentials. Check your provider settings, then resume.";
    if (/quota|billing|429|rate.limit/i.test(message))
        return "The provider quota or rate limit was reached. Check your provider account, then resume.";
    const detail = message
        .replace(/https?:\/\/[^\s]+/gi, "[URL removed]")
        .replace(/(?:Bearer\s+|sk-)[a-zA-Z0-9_.-]+/gi, "[credential removed]")
        .replace(
            /((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/gi,
            "$1[redacted]",
        )
        .replace(/[a-zA-Z0-9_+/=-]{40,}/g, "[redacted]")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 600);
    return detail
        ? `Processing failed: ${detail}. Saved parts are preserved.`
        : "Processing failed without an error message. Saved parts are preserved.";
}
