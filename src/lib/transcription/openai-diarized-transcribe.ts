import type { OpenAI } from "openai";
import type { TranscriptionDiarized } from "openai/resources/audio/transcriptions";
import { buildAudioFile } from "@/lib/transcription/audio-file";
import {
    isOggOpus,
    splitOpusSegments,
    transcodeToMp3,
    transcodeToMp3Segments,
} from "@/lib/transcription/ffmpeg";
import { buildTranscriptionParams } from "@/lib/transcription/format";
import { MIN_AUDIO_PART_SECONDS } from "@/types/audio-processing";

// OpenAI currently rejects diarization chunks over 1,400 seconds. Leave a
// margin for container timestamps and provider-side chunk boundary changes.
const MAX_CHUNK_SECONDS = 20 * 60 - 1;

export interface PreparedAudioSegment {
    buffer?: Buffer;
    index: number;
    count: number;
    startSeconds: number;
    cachedText?: string;
    contentType?: "audio/ogg" | "audio/mpeg";
}

export interface DiarizationPersistence {
    segments(
        audio: Buffer,
        durationMs: number,
        fingerprint: string,
    ): AsyncIterable<PreparedAudioSegment>;
    save(index: number, text: string): Promise<void>;
}

interface DiarizedTranscriptionOptions {
    client: OpenAI;
    model: string;
    audioBuffer: Buffer;
    durationMs: number;
    filename: string;
    language?: string;
    timeoutMs: number;
    persistence?: DiarizationPersistence;
    fingerprint?: string;
}

/** Prepare local chunks, preserving Opus, before OpenAI diarization. */
export async function transcribeOpenAIDiarized(
    options: DiarizedTranscriptionOptions,
): Promise<{ text: string; detectedLanguage: null }> {
    const {
        client,
        model,
        audioBuffer,
        durationMs,
        filename,
        language,
        timeoutMs,
    } = options;
    const durationSeconds = durationMs / 1000;
    if (durationSeconds < MIN_AUDIO_PART_SECONDS)
        throw new Error("Audio must be at least 5 seconds long");
    const chunkCount = Math.max(
        1,
        Math.ceil(durationSeconds / MAX_CHUNK_SECONDS),
    );
    const chunkDuration = durationSeconds / chunkCount;
    const formattedTurns: string[] = [];

    const transcribeChunk = async (
        buffer: Buffer,
        index: number,
        count: number,
        offset = index * chunkDuration,
        contentType: "audio/ogg" | "audio/mpeg" = "audio/mpeg",
    ) => {
        const file = buildPartFile(buffer, filename, index, count, contentType);
        console.info(
            `[audio-transcription] requesting part ${index + 1}/${count}; model=${model}; language=${language ?? "auto"}; format=${contentType}; bytes=${buffer.length}`,
        );
        const response = await client.audio.transcriptions.create(
            buildTranscriptionParams({
                file,
                model,
                responseFormat: "diarized_json",
                language,
            }),
            { timeout: timeoutMs },
        );
        const diarized = response as TranscriptionDiarized;
        if (!Array.isArray(diarized.segments))
            throw new Error("OpenAI returned an invalid diarized response");
        const text = formatDiarizedResponse(
            diarized,
            index,
            count,
            offset,
        ).join("\n\n");
        await options.persistence?.save(index, text);
        formattedTurns.push(text);
    };

    if (options.persistence) {
        for await (const part of options.persistence.segments(
            audioBuffer,
            durationMs,
            options.fingerprint ?? model,
        )) {
            if (part.cachedText !== undefined) {
                formattedTurns.push(part.cachedText);
            } else if (part.buffer) {
                await transcribeChunk(
                    part.buffer,
                    part.index,
                    part.count,
                    part.startSeconds,
                    part.contentType,
                );
            } else {
                throw new Error("Prepared audio part is missing");
            }
        }
    } else if (isOggOpus(audioBuffer)) {
        if (chunkCount === 1) {
            await transcribeChunk(audioBuffer, 0, 1, 0, "audio/ogg");
        } else {
            for await (const segment of splitOpusSegments(
                audioBuffer,
                chunkDuration,
            )) {
                await transcribeChunk(
                    segment.buffer,
                    segment.index,
                    segment.count,
                    segment.startSeconds,
                    "audio/ogg",
                );
            }
        }
    } else if (chunkCount === 1) {
        await transcribeChunk(await transcodeToMp3(audioBuffer), 0, 1);
    } else {
        for await (const segment of transcodeToMp3Segments(
            audioBuffer,
            chunkDuration,
        )) {
            await transcribeChunk(
                segment.buffer,
                segment.index,
                segment.count,
                segment.startSeconds,
            );
        }
    }

    return {
        text: formattedTurns.join("\n\n"),
        detectedLanguage: null,
    };
}

function buildPartFile(
    buffer: Buffer,
    filename: string,
    index: number,
    chunkCount: number,
    contentType: "audio/ogg" | "audio/mpeg",
): File {
    const stem = filename.replace(/\.[^.]+$/, "");
    const suffix = chunkCount > 1 ? `-part-${index + 1}` : "";
    const extension = contentType === "audio/ogg" ? "ogg" : "mp3";
    return buildAudioFile(
        buffer,
        `part.${extension}`,
        `${stem}${suffix}.${extension}`,
    ).file;
}

function formatDiarizedResponse(
    response: TranscriptionDiarized,
    partIndex: number,
    partCount: number,
    timeOffsetSeconds: number,
): string[] {
    const formattedTurns: string[] = [];
    const speakerNumbers = new Map<string, number>();
    const turns: Array<{
        speaker: string;
        start: number;
        text: string;
    }> = [];

    for (const segment of response.segments ?? []) {
        const previous = turns.at(-1);
        if (previous?.speaker === segment.speaker) {
            previous.text = `${previous.text} ${segment.text.trim()}`;
        } else {
            turns.push({
                speaker: segment.speaker,
                start: segment.start,
                text: segment.text.trim(),
            });
        }
    }

    for (const turn of turns) {
        let speakerNumber = speakerNumbers.get(turn.speaker);
        if (speakerNumber === undefined) {
            speakerNumber = speakerNumbers.size + 1;
            speakerNumbers.set(turn.speaker, speakerNumber);
        }
        const partLabel = partCount > 1 ? ` · Part ${partIndex + 1}` : "";
        formattedTurns.push(
            `[${formatTimestamp(timeOffsetSeconds + turn.start)}] Speaker ${speakerNumber}${partLabel}\n${turn.text}`,
        );
    }

    return formattedTurns;
}

function formatTimestamp(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;
    const minuteText = String(minutes).padStart(2, "0");
    const secondText = String(remainingSeconds).padStart(2, "0");

    return hours > 0
        ? `${String(hours).padStart(2, "0")}:${minuteText}:${secondText}`
        : `${minuteText}:${secondText}`;
}
