import { parseBuffer } from "music-metadata";
import { describe, expect, it } from "vitest";
import { runFfmpeg, splitOpusSegments } from "@/lib/transcription/ffmpeg";

function packets(ogg: Buffer): Buffer[] {
    const result: Buffer[] = [];
    let fragments: Buffer[] = [];
    let offset = 0;
    while (offset < ogg.length) {
        expect(ogg.subarray(offset, offset + 4).toString()).toBe("OggS");
        const count = ogg[offset + 26];
        const lengths = ogg.subarray(offset + 27, offset + 27 + count);
        let body = offset + 27 + count;
        for (const length of lengths) {
            fragments.push(ogg.subarray(body, body + length));
            body += length;
            if (length < 255) {
                result.push(Buffer.concat(fragments));
                fragments = [];
            }
        }
        offset = body;
    }
    return result.slice(2);
}

describe.runIf(process.env.RIFFADO_TEST_FFMPEG === "1")(
    "Opus packet-preserving split",
    () => {
        it("preserves every encoded packet and produces independently readable stereo parts", async () => {
            const original = await runFfmpeg(Buffer.alloc(0), [
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "30",
                "-ac",
                "2",
                "-c:a",
                "libopus",
                "-b:a",
                "24k",
                "-f",
                "ogg",
                "pipe:1",
            ]);
            const parts = [];
            for await (const part of splitOpusSegments(original, 10))
                parts.push(part);
            expect(parts).toHaveLength(3);
            expect(parts.flatMap((part) => packets(part.buffer))).toEqual(
                packets(original),
            );
            const source = await parseBuffer(original, "audio/ogg", {
                duration: true,
            });
            let total = 0;
            for (const part of parts) {
                const metadata = await parseBuffer(part.buffer, "audio/ogg", {
                    duration: true,
                });
                expect(metadata.format.codec).toBe("Opus");
                expect(metadata.format.numberOfChannels).toBe(2);
                expect(metadata.format.sampleRate).toBe(48000);
                expect(part.startSeconds).toBeCloseTo(total, 5);
                total += part.durationSeconds;
                await runFfmpeg(part.buffer, [
                    "-v",
                    "error",
                    "-i",
                    "pipe:0",
                    "-f",
                    "null",
                    "-",
                ]);
            }
            expect(
                Math.abs(total - (source.format.duration ?? 0)),
            ).toBeLessThan(0.05);
            expect(
                parts.reduce((sum, part) => sum + part.buffer.length, 0),
            ).toBeLessThan(original.length * 1.2);
        }, 30000);
        it("drops a final Opus fragment under five seconds without re-encoding the remaining packets", async () => {
            const original = await runFfmpeg(Buffer.alloc(0), [
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "16",
                "-c:a",
                "libopus",
                "-f",
                "ogg",
                "pipe:1",
            ]);
            const parts = [];
            for await (const part of splitOpusSegments(original, 6))
                parts.push(part);
            expect(parts).toHaveLength(2);
            expect(parts.every((part) => part.durationSeconds >= 5)).toBe(true);
            expect(parts.map((part) => part.count)).toEqual([2, 2]);
            const kept = parts.flatMap((part) => packets(part.buffer));
            expect(kept).toEqual(packets(original).slice(0, kept.length));
            expect(kept.length).toBeLessThan(packets(original).length);
        }, 30000);
    },
);
