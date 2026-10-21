import { describe, expect, it } from "vitest";
import {
    audioProcessingSeconds,
    estimatedAudioCost,
} from "@/lib/transcription/audio-metrics";
import type { AudioJobView } from "@/types/audio-processing";

const part: AudioJobView["parts"][number] = {
    index: 0,
    startSeconds: 0,
    endSeconds: 60,
    bytes: 100,
    status: "completed",
};
describe("audio metrics", () => {
    it("uses elapsed processing time instead of audio duration", () => {
        expect(
            audioProcessingSeconds({
                ...part,
                startedAt: "2026-10-21T08:00:00Z",
                completedAt: "2026-10-21T08:02:30Z",
            }),
        ).toBe(150);
        expect(audioProcessingSeconds(part)).toBeNull();
        expect(
            audioProcessingSeconds({
                ...part,
                startedAt: "invalid",
                completedAt: "invalid",
            }),
        ).toBeNull();
    });
    it("calculates a one-pass estimate from audio duration and an explicit rate", () => {
        expect(estimatedAudioCost(3600, 0.006)).toBeCloseTo(0.36);
    });
});
