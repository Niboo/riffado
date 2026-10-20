import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBuffer } from "music-metadata";

export function runFfmpeg(
    input: Buffer,
    args: readonly string[],
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", [...args], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;

        const settleReject = (err: Error) => {
            if (settled) return;
            settled = true;
            reject(err);
        };

        ff.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
        ff.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

        ff.on("error", (err) => {
            settleReject(
                new Error(
                    `ffmpeg spawn failed (binary missing from runtime image?): ${err.message}`,
                ),
            );
        });

        ff.on("close", (code) => {
            if (settled) return;
            if (code !== 0) {
                const stderr = Buffer.concat(stderrChunks).toString("utf8");
                settleReject(
                    new Error(
                        `ffmpeg exited with code ${code}: ${stderr.trim() || "(no stderr)"}`,
                    ),
                );
                return;
            }
            settled = true;
            resolve(Buffer.concat(stdoutChunks));
        });

        ff.stdin.on("error", (err) => {
            settleReject(
                new Error(`ffmpeg stdin write failed: ${err.message}`),
            );
        });

        ff.stdin.end(input);
    });
}

export function ffmpegToOpus(
    input: Buffer,
    bitrateKbps: number,
): Promise<Buffer> {
    return runFfmpeg(input, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        `${bitrateKbps}k`,
        "-application",
        "voip",
        "-f",
        "ogg",
        "pipe:1",
    ]);
}

/** Mono 16 kHz MP3 for chat-style providers that reject Ogg/Opus. */
export function transcodeToMp3(input: Buffer): Promise<Buffer> {
    return runFfmpeg(input, mp3Args());
}

/** Encode and yield mono 16 kHz MP3 segments from one ffmpeg pass. */
export async function* transcodeToMp3Segments(
    input: Buffer,
    segmentSeconds: number,
): AsyncGenerator<{ buffer: Buffer; index: number; count: number }> {
    const workDir = await mkdtemp(join(tmpdir(), "riffado-diarize-"));
    try {
        const outputPattern = join(workDir, "part-%06d.mp3");
        await runFfmpeg(input, [
            ...ffmpegInputArgs(),
            ...mp3EncodingArgs(),
            "-f",
            "segment",
            "-segment_time",
            segmentSeconds.toFixed(3),
            "-reset_timestamps",
            "1",
            outputPattern,
        ]);
        const filenames = (await readdir(workDir))
            .filter((name) => name.endsWith(".mp3"))
            .sort();
        if (filenames.length === 0) {
            throw new Error("ffmpeg produced no MP3 segments");
        }
        for (const [index, name] of filenames.entries()) {
            yield {
                buffer: await readFile(join(workDir, name)),
                index,
                count: filenames.length,
            };
        }
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

function mp3Args(): string[] {
    return [...ffmpegInputArgs(), ...mp3EncodingArgs(), "-f", "mp3", "pipe:1"];
}

function ffmpegInputArgs(): string[] {
    return ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"];
}

function mp3EncodingArgs(): string[] {
    return [
        "-map",
        "0:a:0",
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
    ];
}

export interface OpusAudioSegment {
    buffer: Buffer;
    index: number;
    count: number;
    startSeconds: number;
    durationSeconds: number;
}

/** Detect Ogg/Opus by its identification packet, regardless of filename. */
export function isOggOpus(input: Buffer): boolean {
    return (
        input.subarray(0, 4).toString("ascii") === "OggS" &&
        input.subarray(0, 4096).includes(Buffer.from("OpusHead"))
    );
}

/** Split Ogg/Opus by copying its encoded packets without changing codec or channels. */
export async function* splitOpusSegments(
    input: Buffer,
    segmentSeconds: number,
): AsyncGenerator<OpusAudioSegment> {
    if (!isOggOpus(input)) throw new Error("Expected an Ogg/Opus recording");
    if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0)
        throw new Error("Invalid audio split interval");
    const workDir = await mkdtemp(join(tmpdir(), "riffado-opus-"));
    try {
        await runFfmpeg(input, [
            ...ffmpegInputArgs(),
            "-map",
            "0:a:0",
            "-vn",
            "-map_metadata",
            "-1",
            "-c:a",
            "copy",
            "-f",
            "segment",
            "-segment_format",
            "ogg",
            "-segment_time",
            segmentSeconds.toFixed(3),
            "-reset_timestamps",
            "1",
            join(workDir, "part-%06d.ogg"),
        ]);
        const names = (await readdir(workDir))
            .filter((name) => name.endsWith(".ogg"))
            .sort();
        if (!names.length) throw new Error("ffmpeg produced no Opus segments");
        let startSeconds = 0;
        for (const [index, name] of names.entries()) {
            const buffer = await readFile(join(workDir, name));
            const metadata = await parseBuffer(buffer, "audio/ogg", {
                duration: true,
            });
            const durationSeconds = metadata.format.duration;
            if (
                !isOggOpus(buffer) ||
                !durationSeconds ||
                !Number.isFinite(durationSeconds)
            )
                throw new Error("Generated Opus part is invalid");
            yield {
                buffer,
                index,
                count: names.length,
                startSeconds,
                durationSeconds,
            };
            startSeconds += durationSeconds;
        }
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}
