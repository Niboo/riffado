import { expect, it } from "vitest";
import { pauseCutTimes } from "@/lib/transcription/ffmpeg";

it("cuts near ten minutes at the closest available pause", () => {
    expect(pauseCutTimes(1969, [590, 605, 1210, 1812])).toEqual([
        605, 1210, 1812,
    ]);
});
it("falls back to ten minutes without pauses and preserves the final five seconds", () => {
    expect(pauseCutTimes(1800, [])).toEqual([600, 1200]);
    expect(pauseCutTimes(601, [])).toEqual([596]);
    expect(pauseCutTimes(600, [])).toEqual([]);
});
it("ignores distant pauses and does not make a tiny trailing fragment", () => {
    expect(pauseCutTimes(1231, [500, 1229])).toEqual([600, 1200]);
    expect(() => pauseCutTimes(Number.NaN, [])).toThrow();
});
