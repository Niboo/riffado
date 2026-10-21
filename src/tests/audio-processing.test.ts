import { parseBuffer } from "music-metadata";
import type { OpenAI } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioJob } from "@/db/queries/audio-jobs";
import type { StorageProvider } from "@/lib/storage/types";
import type { DiarizationPersistence } from "@/lib/transcription/openai-diarized-transcribe";

const mock = vi.hoisted(() => ({
    update: vi.fn(),
    segments: vi.fn(),
    opusSegments: vi.fn(),
    create: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    select: vi.fn(),
    transcribe: vi.fn(),
    exists: vi.fn(),
    deleteFile: vi.fn(),
}));
vi.mock("music-metadata", () => ({
    parseBuffer: vi.fn().mockResolvedValue({ format: { duration: 900 } }),
}));
vi.mock("@/db", () => ({ db: { select: mock.select } }));
vi.mock("@/db/queries/audio-jobs", () => ({
    AUDIO_LEASE_MS: 120000,
    updateAudioJob: mock.update,
    claimAudioJob: vi.fn(),
    expireAudioJobs: vi.fn(),
}));
vi.mock("@/lib/transcription/ffmpeg", () => ({
    transcodeToMp3Segments: mock.segments,
    splitOpusSegments: mock.opusSegments,
    isOggOpus: (input: Buffer) =>
        input.subarray(0, 4).toString() === "OggS" &&
        input.includes(Buffer.from("OpusHead")),
    transcodeToMp3: vi.fn(),
}));
vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: mock.transcribe,
}));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockImplementation(async () => ({
        uploadFile: mock.upload,
        downloadFile: mock.download,
    })),
}));
vi.mock("@/lib/encryption/fields", () => ({
    encryptText: (text: string) => `encrypted:${text}`,
    decryptText: (text: string) => text.replace(/^encrypted:/, ""),
}));

import {
    audioFailureMessage,
    persistentDiarization,
    prepareAudioParts,
    processAudioJob,
} from "@/lib/transcription/audio-worker";
import { transcribeOpenAIDiarized } from "@/lib/transcription/openai-diarized-transcribe";

function job(): AudioJob {
    return {
        id: "j1",
        userId: "u1",
        recordingId: "r1",
        action: "transcribe",
        status: "queued",
        parts: [],
        splitComplete: false,
        sourceVersion: "1",
        providerId: null,
        model: null,
        transcriptFingerprint: null,
        error: null,
        claimToken: "claim",
        leaseUntil: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}
const storage = {
    uploadFile: mock.upload,
    downloadFile: mock.download,
    exists: mock.exists,
    deleteFile: mock.deleteFile,
} as unknown as StorageProvider;
const client = {
    audio: { transcriptions: { create: mock.create } },
} as unknown as OpenAI;
const options = {
    client,
    audioBuffer: Buffer.from("source"),
    durationMs: 1800000,
    model: "gpt-4o-transcribe-diarize",
    filename: "meeting.ogg",
    timeoutMs: 10000,
    fingerprint: "provider-model-language",
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseBuffer).mockResolvedValue({
        format: { duration: 900 },
    } as Awaited<ReturnType<typeof parseBuffer>>);
    mock.exists.mockResolvedValue(true);
    mock.deleteFile.mockResolvedValue(undefined);
    mock.select.mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [
                    {
                        fileMd5: "hash",
                        filesize: 10,
                        storagePath: "source.mp3",
                        duration: 1800000,
                    },
                ],
            }),
        }),
    });
    mock.update.mockImplementation(
        async (j: AudioJob, patch: Partial<AudioJob>) => {
            Object.assign(j, patch);
        },
    );
    mock.upload.mockResolvedValue("stored");
    mock.download.mockResolvedValue(Buffer.from("part"));
    mock.segments.mockImplementation(() =>
        (async function* () {
            yield { index: 0, count: 2, buffer: Buffer.from("first") };
            yield { index: 1, count: 2, buffer: Buffer.from("second") };
        })(),
    );
});

describe("persistent audio preparation and transcription", () => {
    it("discards newly generated parts below five seconds and keeps exactly five seconds", async () => {
        const j = job();
        vi.mocked(parseBuffer)
            .mockResolvedValueOnce({ format: { duration: 5 } } as Awaited<
                ReturnType<typeof parseBuffer>
            >)
            .mockResolvedValueOnce({ format: { duration: 4.999 } } as Awaited<
                ReturnType<typeof parseBuffer>
            >);
        await prepareAudioParts(j, storage, options.audioBuffer, 10000);
        expect(j.parts).toHaveLength(1);
        expect(j.parts[0].endSeconds).toBe(5);
        expect(mock.upload).toHaveBeenCalledTimes(1);
    });
    it("physically deletes short saved fragments before reusing a completed split", async () => {
        const j = job();
        j.parts = [
            {
                index: 0,
                startSeconds: 0,
                endSeconds: 900,
                storageKey: "full.mp3",
                bytes: 100,
                status: "ready",
            },
            {
                index: 1,
                startSeconds: 900,
                endSeconds: 900.1,
                storageKey: "tail.mp3",
                bytes: 5,
                status: "ready",
            },
        ];
        j.splitComplete = true;
        await prepareAudioParts(j, storage, options.audioBuffer, 900100);
        expect(mock.deleteFile).toHaveBeenCalledWith("tail.mp3");
        expect(j.parts.map((part) => part.storageKey)).toEqual(["full.mp3"]);
        expect(mock.segments).not.toHaveBeenCalled();
    });
    it("does not finish an empty split when all fragments are under five seconds", async () => {
        vi.mocked(parseBuffer).mockResolvedValue({
            format: { duration: 4.9 },
        } as Awaited<ReturnType<typeof parseBuffer>>);
        const j = job();
        await expect(
            prepareAudioParts(j, storage, options.audioBuffer, 9800),
        ).rejects.toThrow("minimum duration of 5 seconds");
        expect(mock.upload).not.toHaveBeenCalled();
        expect(j.splitComplete).toBe(false);
    });
    it("saves generated parts to durable storage before marking the split ready", async () => {
        const j = job();
        await prepareAudioParts(
            j,
            storage,
            options.audioBuffer,
            options.durationMs,
        );
        expect(j.splitComplete).toBe(true);
        expect(j.parts).toHaveLength(2);
        expect(j.parts[1]).toMatchObject({
            startSeconds: 900,
            endSeconds: 1800,
            status: "ready",
        });
        expect(mock.upload).toHaveBeenCalledTimes(2);
        expect(mock.segments.mock.calls[0][1]).toBe(900);
    });
    it("retains already saved parts when a later upload fails, and retries only missing uploads", async () => {
        const j = job();
        mock.upload
            .mockResolvedValueOnce("saved")
            .mockRejectedValueOnce(new Error("storage unavailable"));
        await expect(
            prepareAudioParts(
                j,
                storage,
                options.audioBuffer,
                options.durationMs,
            ),
        ).rejects.toThrow("storage unavailable");
        expect(j.parts).toHaveLength(1);
        expect(j.splitComplete).toBe(false);
        mock.upload.mockResolvedValue("saved");
        await prepareAudioParts(
            j,
            storage,
            options.audioBuffer,
            options.durationMs,
        );
        expect(j.parts).toHaveLength(2);
        expect(mock.upload).toHaveBeenCalledTimes(3);
    });
    it("reuses durable audio without rerunning the split", async () => {
        const j = job();
        j.splitComplete = true;
        await prepareAudioParts(
            j,
            storage,
            options.audioBuffer,
            options.durationMs,
        );
        expect(mock.segments).not.toHaveBeenCalled();
        expect(mock.upload).not.toHaveBeenCalled();
    });
    it("does not call the provider again for completed parts after a timeout", async () => {
        const j = job();
        await prepareAudioParts(
            j,
            storage,
            options.audioBuffer,
            options.durationMs,
        );
        mock.create
            .mockResolvedValueOnce({
                segments: [{ speaker: "A", start: 0, text: "First" }],
            })
            .mockRejectedValueOnce(new Error("Request timed out"));
        await expect(
            transcribeOpenAIDiarized({
                ...options,
                persistence: persistentDiarization(j, storage),
            }),
        ).rejects.toThrow("timed out");
        expect(j.parts[0].encryptedText).toContain("encrypted:");
        expect(j.parts[0].status).toBe("completed");
        mock.create.mockResolvedValueOnce({
            segments: [{ speaker: "B", start: 2, text: "Second" }],
        });
        const result = await transcribeOpenAIDiarized({
            ...options,
            persistence: persistentDiarization(j, storage),
        });
        expect(mock.create).toHaveBeenCalledTimes(3);
        expect(result.text).toContain("First");
        expect(result.text).toContain("[15:02]");
        expect(result.text).toContain("Second");
        expect(j.parts.every((p) => p.status === "completed")).toBe(true);
    });
    it("invalidates saved transcripts if the provider, model or language changes", async () => {
        const j = job();
        await prepareAudioParts(
            j,
            storage,
            options.audioBuffer,
            options.durationMs,
        );
        j.transcriptFingerprint = "different-model";
        j.parts[0].status = "completed";
        j.parts[0].encryptedText = "encrypted:Old transcript";
        mock.create.mockResolvedValue({
            segments: [{ speaker: "A", start: 0, text: "New words" }],
        });
        const result = await transcribeOpenAIDiarized({
            ...options,
            persistence: persistentDiarization(j, storage),
        });
        expect(mock.create).toHaveBeenCalledTimes(2);
        expect(result.text).not.toContain("Old transcript");
    });
    it("does not send the next part if saving the previous result fails", async () => {
        const persistence: DiarizationPersistence = {
            async *segments() {
                yield {
                    buffer: Buffer.from("first"),
                    index: 0,
                    count: 2,
                    startSeconds: 0,
                };
                yield {
                    buffer: Buffer.from("second"),
                    index: 1,
                    count: 2,
                    startSeconds: 900,
                };
            },
            save: vi.fn().mockRejectedValue(new Error("claim lost")),
        };
        mock.create.mockResolvedValue({
            segments: [{ speaker: "A", start: 0, text: "Words" }],
        });
        await expect(
            transcribeOpenAIDiarized({ ...options, persistence }),
        ).rejects.toThrow("claim lost");
        expect(mock.create).toHaveBeenCalledTimes(1);
    });
    it("accepts a silent audio part and saves its empty result", async () => {
        const save = vi.fn();
        const persistence: DiarizationPersistence = {
            async *segments() {
                yield {
                    buffer: Buffer.from("silence"),
                    index: 0,
                    count: 1,
                    startSeconds: 0,
                };
            },
            save,
        };
        mock.create.mockResolvedValue({ segments: [] });
        await transcribeOpenAIDiarized({ ...options, persistence });
        expect(save).toHaveBeenCalledWith(0, "");
    });
    it("stores and sends original Opus parts without creating MP3 files", async () => {
        const j = job();
        const opus = Buffer.from("OggS-OpusHead-data");
        mock.opusSegments.mockReturnValue(
            (async function* () {
                yield {
                    buffer: opus,
                    index: 0,
                    count: 1,
                    startSeconds: 0,
                    durationSeconds: 900,
                };
            })(),
        );
        await prepareAudioParts(j, storage, opus, 900000);
        expect(mock.segments).not.toHaveBeenCalled();
        expect(mock.upload).toHaveBeenCalledWith(
            expect.stringMatching(/\.ogg$/),
            opus,
            "audio/ogg",
        );
        expect(j.parts[0].contentType).toBe("audio/ogg");
        mock.create.mockResolvedValueOnce({
            segments: [{ speaker: "A", start: 0, text: "Opus words" }],
        });
        await transcribeOpenAIDiarized({
            ...options,
            audioBuffer: opus,
            durationMs: 900000,
            persistence: persistentDiarization(j, storage),
        });
        expect(mock.create.mock.calls[0][0].file).toMatchObject({
            name: "meeting.ogg",
            type: "audio/ogg",
        });
    });

    it("records a timeout on the failed part, preserves successful parts, and clears the error after a successful retry", async () => {
        const j = job();
        j.sourceVersion = "hash:10:source.mp3:1800000";
        mock.transcribe.mockImplementation(async (_user, _recording, opts) => {
            try {
                await transcribeOpenAIDiarized({
                    ...options,
                    persistence: opts.diarizationPersistence,
                });
                return { success: true };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : "failure",
                };
            }
        });
        mock.create
            .mockResolvedValueOnce({
                segments: [{ speaker: "A", start: 0, text: "Saved" }],
            })
            .mockRejectedValueOnce(
                new Error("Request timed out. api_key=never-expose"),
            );
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        await processAudioJob(j);
        expect(j.status).toBe("failed");
        expect(j.parts[0].status).toBe("completed");
        expect(j.parts[0].completedAt).toBeDefined();
        expect(j.parts[1]).toMatchObject({
            status: "failed",
            attempts: 1,
            error: expect.stringContaining("timed out"),
        });
        expect(j.parts[1].error).not.toContain("never-expose");
        j.claimToken = "retry-claim";
        mock.create.mockResolvedValueOnce({
            segments: [{ speaker: "B", start: 0, text: "Resumed" }],
        });
        await processAudioJob(j);
        expect(j.status).toBe("completed");
        expect(j.parts[1]).toMatchObject({ status: "completed", attempts: 2 });
        expect(j.parts[1].error).toBeUndefined();
        expect(mock.create).toHaveBeenCalledTimes(3);
        log.mockRestore();
    });
});

describe("audio failure diagnostics", () => {
    it("retains actionable provider validation details", () => {
        expect(
            audioFailureMessage(
                new Error(
                    "400 audio duration 1483 seconds exceeds maximum 1400",
                ),
            ),
        ).toContain("400 audio duration 1483 seconds exceeds maximum 1400");
    });
    it("redacts credentials and signed URLs from unknown errors", () => {
        const message = audioFailureMessage(
            new Error(
                "400 invalid request api_key=never-expose token=private-token https://storage.example/audio?signature=secret sk-veryprivatecredential",
            ),
        );
        for (const secret of [
            "never-expose",
            "private-token",
            "storage.example",
            "veryprivatecredential",
        ])
            expect(message).not.toContain(secret);
        expect(message).toContain("400 invalid request");
    });
});
