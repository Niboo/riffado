import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import type { AudioJob } from "@/db/queries/audio-jobs";
import {
    apiCredentials,
    audioJobs,
    recordings,
    userSettings,
} from "@/db/schema";
import { findPreset } from "@/lib/ai/provider-presets";
import { decryptText } from "@/lib/encryption/fields";
import { isHostedLockedOut } from "@/lib/entitlements";
import { AppError, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    type AudioJobView,
    isAudioJobActive,
    isUsableAudioPart,
} from "@/types/audio-processing";

export async function getAudioJob(
    userId: string,
    recordingId: string,
): Promise<AudioJob | null> {
    const [row] = await db
        .select()
        .from(audioJobs)
        .where(
            and(
                eq(audioJobs.userId, userId),
                eq(audioJobs.recordingId, recordingId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export function audioJobView(job: AudioJob): AudioJobView {
    return {
        id: job.id,
        action: job.action,
        status: job.status,
        error: job.error,
        updatedAt: job.updatedAt.toISOString(),
        parts: job.parts
            .filter(isUsableAudioPart)
            .map(({ encryptedText, storageKey: _key, ...part }) => ({
                ...part,
                status:
                    job.status === "failed" && part.status === "transcribing"
                        ? "failed"
                        : part.status,
                error:
                    job.status === "failed" && part.status === "transcribing"
                        ? (job.error ?? undefined)
                        : part.error,
                text:
                    encryptedText === undefined
                        ? undefined
                        : decryptText(encryptedText),
            })),
    };
}

export async function enqueueAudioJob(
    userId: string,
    recordingId: string,
    action: "split" | "transcribe",
    options: { providerId?: string; model?: string } = {},
): Promise<AudioJob> {
    if (await isHostedLockedOut(userId))
        throw new AppError(
            ErrorCode.ACCOUNT_LOCKED,
            "Your account is read-only.",
            403,
        );
    return db.transaction(async (tx) => {
        const [recording] = await tx
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.userId, userId),
                    eq(recordings.id, recordingId),
                    isNull(recordings.deletedAt),
                ),
            )
            .for("update")
            .limit(1);
        if (!recording)
            throw new AppError(
                ErrorCode.RECORDING_NOT_FOUND,
                "Recording not found",
                404,
            );
        if (!Number.isFinite(recording.duration) || recording.duration <= 0)
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Recording duration is unavailable.",
                400,
            );
        const [existing] = await tx
            .select()
            .from(audioJobs)
            .where(
                and(
                    eq(audioJobs.userId, userId),
                    eq(audioJobs.recordingId, recordingId),
                ),
            )
            .for("update")
            .limit(1);
        if (existing && isAudioJobActive(existing.status)) {
            if (existing.action !== action)
                throw new AppError(
                    ErrorCode.INVALID_INPUT,
                    "Audio processing is already running. Wait for it to finish before starting another action.",
                    409,
                );
            return existing;
        }
        const sourceVersion = `${recording.fileMd5}:${recording.filesize}:${recording.storagePath}:${recording.duration}`;
        if (existing && existing.sourceVersion !== sourceVersion)
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "The original audio has changed since splitting. Remove its saved parts before preparing it again.",
                409,
            );
        if (existing && action === "split" && existing.splitComplete)
            return existing;
        const resume =
            action === "transcribe" &&
            existing?.action === "transcribe" &&
            existing.status === "failed" &&
            !options.providerId &&
            !options.model;
        let providerId =
            options.providerId ??
            (resume ? (existing?.providerId ?? undefined) : undefined);
        let model =
            options.model ??
            (resume ? (existing?.model ?? undefined) : undefined);
        if (action === "transcribe") {
            const [settings] = providerId
                ? []
                : await tx
                      .select()
                      .from(userSettings)
                      .where(eq(userSettings.userId, userId))
                      .limit(1);
            const pointer =
                providerId ?? settings?.defaultTranscriptionProviderId;
            const [credential] = await tx
                .select()
                .from(apiCredentials)
                .where(
                    and(
                        eq(apiCredentials.userId, userId),
                        pointer
                            ? eq(apiCredentials.id, pointer)
                            : eq(apiCredentials.isDefaultTranscription, true),
                    ),
                )
                .limit(1);
            providerId = pointer ?? credential?.id;
            model =
                model ??
                credential?.defaultModel ??
                (credential
                    ? findPreset(credential.provider)?.defaultModel
                    : undefined);
        }
        if (existing) {
            const reset =
                existing.status === "completed" && action === "transcribe";
            const [job] = await tx
                .update(audioJobs)
                .set({
                    action,
                    status: "queued",
                    error: null,
                    claimToken: null,
                    leaseUntil: null,
                    providerId: providerId ?? null,
                    model: model ?? null,
                    parts: reset
                        ? existing.parts.map(
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
                          )
                        : existing.parts,
                    transcriptFingerprint: reset
                        ? null
                        : existing.transcriptFingerprint,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(audioJobs.id, existing.id),
                        eq(audioJobs.userId, userId),
                    ),
                )
                .returning();
            return job;
        }
        const [job] = await tx
            .insert(audioJobs)
            .values({
                userId,
                recordingId,
                action,
                sourceVersion,
                providerId,
                model,
            })
            .returning();
        return job;
    });
}

export async function deleteSavedAudioParts(
    userId: string,
    recordingId: string,
): Promise<void> {
    await db.transaction(async (tx) => {
        const [recording] = await tx
            .select({ id: recordings.id })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                    isNull(recordings.deletedAt),
                ),
            )
            .for("update")
            .limit(1);
        if (!recording)
            throw new AppError(
                ErrorCode.RECORDING_NOT_FOUND,
                "Recording not found",
                404,
            );
        const [job] = await tx
            .select()
            .from(audioJobs)
            .where(
                and(
                    eq(audioJobs.userId, userId),
                    eq(audioJobs.recordingId, recordingId),
                ),
            )
            .for("update")
            .limit(1);
        if (!job) return;
        if (isAudioJobActive(job.status))
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Wait for audio processing to finish before deleting saved parts.",
                409,
            );
        const storage = await createUserStorageProvider(userId);
        for (const part of job.parts) {
            if (await storage.exists(part.storageKey))
                await storage.deleteFile(part.storageKey);
        }
        await tx
            .delete(audioJobs)
            .where(and(eq(audioJobs.id, job.id), eq(audioJobs.userId, userId)));
    });
}
