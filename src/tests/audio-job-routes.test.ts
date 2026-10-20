import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/auth-server", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/transcription/audio-jobs", () => ({
    enqueueAudioJob: mocks.enqueue,
    audioJobView: (job: unknown) => job,
}));

import { POST } from "@/app/api/recordings/[id]/transcribe/route";

beforeEach(() => {
    mocks.session.mockResolvedValue({ user: { id: "user-one" } });
    mocks.enqueue.mockResolvedValue({
        id: "job-one",
        status: "queued",
        action: "transcribe",
        parts: [],
    });
});

describe("manual transcription queue endpoint", () => {
    it("returns 202 as soon as work is durably queued instead of waiting for the provider", async () => {
        const request = new Request(
            "http://localhost/api/recordings/rec-one/transcribe",
            {
                method: "POST",
                body: JSON.stringify({
                    providerId: "provider-one",
                    model: "gpt-4o-transcribe-diarize",
                }),
            },
        );
        const response = await POST(request, {
            params: Promise.resolve({ id: "rec-one" }),
        });
        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
            job: { status: "queued" },
        });
        expect(mocks.enqueue).toHaveBeenCalledWith(
            "user-one",
            "rec-one",
            "transcribe",
            { providerId: "provider-one", model: "gpt-4o-transcribe-diarize" },
        );
    });
    it("accepts the existing empty-body Transcribe button", async () => {
        const response = await POST(
            new Request("http://localhost/api/recordings/rec-one/transcribe", {
                method: "POST",
            }),
            { params: Promise.resolve({ id: "rec-one" }) },
        );
        expect(response.status).toBe(202);
    });
});
