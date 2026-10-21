import type {
    TranscriptionCreateParamsNonStreaming,
    TranscriptionDiarized,
    TranscriptionVerbose,
} from "openai/resources/audio/transcriptions";

export type ResponseFormat = "diarized_json" | "json" | "verbose_json";

export function getResponseFormat(model: string): ResponseFormat {
    if (model.includes("diarize")) return "diarized_json";
    if (
        model.startsWith("gpt-4o") ||
        model === "gpt-transcribe" ||
        model.startsWith("gpt-transcribe-")
    )
        return "json";
    return "verbose_json";
}

export function parseTranscriptionResponse(
    transcription: unknown,
    responseFormat: ResponseFormat,
): { text: string; detectedLanguage: string | null } {
    if (responseFormat === "diarized_json") {
        const diarized = transcription as TranscriptionDiarized;
        const text = (diarized.segments ?? [])
            .map((seg) => `${seg.speaker}: ${seg.text}`)
            .join("\n");
        return { text, detectedLanguage: null };
    }

    if (responseFormat === "verbose_json") {
        const verbose = transcription as TranscriptionVerbose;
        return {
            text: verbose.text,
            detectedLanguage: verbose.language ?? null,
        };
    }

    const plain = transcription as {
        text?: string;
        languages?: Array<{ code?: string }>;
    };
    const text =
        typeof transcription === "string" ? transcription : (plain.text ?? "");
    return {
        text,
        detectedLanguage:
            typeof plain.languages?.[0]?.code === "string"
                ? plain.languages[0].code
                : null,
    };
}

export function buildTranscriptionParams(args: {
    file: File;
    model: string;
    responseFormat: ResponseFormat;
    language?: string;
}): TranscriptionCreateParamsNonStreaming {
    const { file, model, responseFormat, language } = args;
    return {
        file,
        model,
        response_format: responseFormat,
        ...(responseFormat === "diarized_json"
            ? { chunking_strategy: "auto" as const }
            : {}),
        ...(language
            ? model === "gpt-transcribe" || model.startsWith("gpt-transcribe-")
                ? { languages: [language] }
                : { language }
            : {}),
    };
}
