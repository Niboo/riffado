import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBuffer } from "music-metadata";
import { MIN_AUDIO_PART_SECONDS } from "@/types/audio-processing";

export function runFfmpeg(
    input: Buffer,
    args: readonly string[],
    captureStderr = false,
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
            resolve(Buffer.concat(captureStderr ? stderrChunks : stdoutChunks));
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
    cutTimes?: number[],
): AsyncGenerator<OpusAudioSegment> {
    const workDir = await mkdtemp(join(tmpdir(), "riffado-diarize-"));
    try {
        const outputPattern = join(workDir, "part-%06d.mp3");
        await runFfmpeg(input, [
            ...ffmpegInputArgs(),
            ...mp3EncodingArgs(),
            "-f",
            "segment",
            ...segmentTimingArgs(segmentSeconds, cutTimes),
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
        const parts = await eligibleSegments(workDir, filenames, "audio/mpeg");
        for (const [index, part] of parts.entries()) {
            yield {
                buffer: await readFile(join(workDir, part.name)),
                index,
                count: parts.length,
                startSeconds: part.startSeconds,
                durationSeconds: part.durationSeconds,
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
    cutTimes?: number[],
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
            ...segmentTimingArgs(segmentSeconds + 0.05, cutTimes),
            "-reset_timestamps",
            "1",
            join(workDir, "part-%06d.ogg"),
        ]);
        const names = (await readdir(workDir))
            .filter((name) => name.endsWith(".ogg"))
            .sort();
        if (!names.length) throw new Error("ffmpeg produced no Opus segments");
        const parts = await eligibleSegments(workDir, names, "audio/ogg");
        for (const [index, part] of parts.entries()) {
            const buffer = await readFile(join(workDir, part.name));
            if (!isOggOpus(buffer))
                throw new Error("Generated Opus part is invalid");
            yield {
                buffer,
                index,
                count: parts.length,
                startSeconds: part.startSeconds,
                durationSeconds: part.durationSeconds,
            };
        }
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

async function eligibleSegments(
    directory: string,
    names: string[],
    contentType: string,
) {
    const parts: Array<{
        name: string;
        startSeconds: number;
        durationSeconds: number;
    }> = [];
    let startSeconds = 0;
    for (const name of names) {
        const metadata = await parseBuffer(
            await readFile(join(directory, name)),
            contentType,
            { duration: true },
        );
        const durationSeconds = metadata.format.duration;
        if (
            durationSeconds === undefined ||
            !Number.isFinite(durationSeconds) ||
            durationSeconds < 0
        )
            throw new Error("Generated audio part has an invalid duration");
        if (durationSeconds >= MIN_AUDIO_PART_SECONDS)
            parts.push({ name, startSeconds, durationSeconds });
        startSeconds += durationSeconds;
    }
    if (!parts.length)
        throw new Error(
            "No audio part meets the minimum duration of 5 seconds",
        );
    return parts;
}

function segmentTimingArgs(seconds: number, cutTimes?: number[]): string[] {
    return cutTimes?.length
        ? ["-segment_times", cutTimes.map((time) => time.toFixed(3)).join(",")]
        : ["-segment_time", seconds.toFixed(3)];
}

export function pauseCutTimes(
    duration: number,
    pauses: number[],
    target = 600,
): number[] {
    if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(target) ||
        target <= MIN_AUDIO_PART_SECONDS
    )
        throw new Error("Invalid recording duration");
    const cuts: number[] = [];
    let start = 0;
    while (duration - start > target) {
        const ideal = start + target;
        const candidates = pauses.filter(
            (pause) =>
                Number.isFinite(pause) &&
                pause - start >= MIN_AUDIO_PART_SECONDS &&
                Math.abs(pause - ideal) <= 30 &&
                duration - pause >= MIN_AUDIO_PART_SECONDS,
        );
        const cut =
            candidates.sort(
                (a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b,
            )[0] ?? Math.min(ideal, duration - MIN_AUDIO_PART_SECONDS);
        cuts.push(cut);
        start = cut;
    }
    return cuts;
}

export async function detectPauseCuts(
    input: Buffer,
    duration: number,
): Promise<number[]> {
    if (duration <= 600) return [];
    const log = (
        await runFfmpeg(
            input,
            [
                "-hide_banner",
                "-nostats",
                "-i",
                "pipe:0",
                "-map",
                "0:a:0",
                "-af",
                "silencedetect=noise=-35dB:d=0.4",
                "-f",
                "null",
                "-",
            ],
            true,
        )
    ).toString("utf8");
    const pauses: number[] = [];
    let start: number | undefined;
    for (const match of log.matchAll(/silence_(start|end): ([0-9.]+)/g)) {
        if (match[1] === "start") start = Number(match[2]);
        else if (start !== undefined) {
            pauses.push((start + Number(match[2])) / 2);
            start = undefined;
        }
    }
    return pauseCutTimes(duration, pauses);
}
