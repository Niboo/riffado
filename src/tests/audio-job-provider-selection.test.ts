import { beforeEach, expect, it, vi } from "vitest";

const { transaction, select, update } = vi.hoisted(() => ({
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { ENCRYPTION_KEY: "ab".repeat(32) } }));
vi.mock("@/db", () => ({ db: { transaction } }));
vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn(),
}));
vi.mock("@/lib/encryption/fields", () => ({ decryptText: vi.fn((v) => v) }));

import { enqueueAudioJob } from "@/lib/transcription/audio-jobs";

const recording = {
    id: "r",
    userId: "u",
    fileMd5: "md5",
    filesize: 100,
    storagePath: "audio",
    duration: 60000,
};
const previous = {
    id: "job",
    action: "transcribe",
    status: "completed",
    sourceVersion: "md5:100:audio:60000",
    providerId: "openai",
    model: "gpt-4o-transcribe-diarize",
    parts: [
        {
            index: 0,
            storageKey: "part.ogg",
            status: "completed",
            encryptedText: "old",
        },
    ],
    transcriptFingerprint: "old",
};
function rows(value: unknown[]) {
    select.mockImplementationOnce(() => {
        const chain = {
            from: vi.fn(),
            where: vi.fn(),
            for: vi.fn(),
            limit: vi.fn().mockResolvedValue(value),
        };
        chain.from.mockReturnValue(chain);
        chain.where.mockReturnValue(chain);
        chain.for.mockReturnValue(chain);
        return chain;
    });
}
beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn) => fn({ select, update }));
    update.mockImplementation(() => ({
        set: (value: unknown) => ({
            where: () => ({ returning: async () => [value] }),
        }),
    }));
});
it("retranscribes a completed OpenAI job with the current Gemini default and keeps its prepared audio", async () => {
    rows([recording]);
    rows([previous]);
    rows([{ defaultTranscriptionProviderId: "gemini" }]);
    rows([
        {
            id: "gemini",
            provider: "Google Gemini",
            defaultModel: "gemini-3.8-flash",
        },
    ]);
    const next = await enqueueAudioJob("u", "r", "transcribe");
    expect(next).toMatchObject({
        providerId: "gemini",
        model: "gemini-3.8-flash",
        transcriptFingerprint: null,
    });
    expect(next.parts[0]).toMatchObject({
        storageKey: "part.ogg",
        status: "ready",
    });
    expect(next.parts[0].encryptedText).toBeUndefined();
});
it("resumes a failed transcription with its original provider and cached text", async () => {
    rows([recording]);
    rows([{ ...previous, status: "failed" }]);
    rows([{ id: "openai", provider: "OpenAI", defaultModel: "whisper-1" }]);
    const next = await enqueueAudioJob("u", "r", "transcribe");
    expect(next).toMatchObject({
        providerId: "openai",
        model: "gpt-4o-transcribe-diarize",
        parts: previous.parts,
        transcriptFingerprint: "old",
    });
});
it("uses an explicit provider's default model rather than inheriting the old OpenAI model", async () => {
    rows([recording]);
    rows([previous]);
    rows([
        {
            id: "gemini",
            provider: "Google Gemini",
            defaultModel: "gemini-3.8-flash",
        },
    ]);
    const next = await enqueueAudioJob("u", "r", "transcribe", {
        providerId: "gemini",
    });
    expect(next).toMatchObject({
        providerId: "gemini",
        model: "gemini-3.8-flash",
    });
});
