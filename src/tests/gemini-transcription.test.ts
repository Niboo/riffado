import { beforeEach, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/generative-ai", () => ({
    GoogleGenerativeAI: class {
        getGenerativeModel() {
            return { generateContent };
        }
    },
}));

import {
    buildTranscriptionParams,
    getResponseFormat,
    parseTranscriptionResponse,
} from "@/lib/transcription/format";
import {
    geminiTranscribe,
    geminiTranscribeParts,
} from "@/lib/transcription/gemini-transcribe";

beforeEach(() => {
    vi.clearAllMocks();
    generateContent.mockResolvedValue({
        response: { text: () => "Speaker 1: Bonjour.\n\nSpeaker 2: Salut." },
    });
});
it("preserves meeting language and requests audible speaker changes without timestamps", async () => {
    const result = await geminiTranscribe({
        apiKey: "test",
        model: "gemini-3.8-flash",
        audioBuffer: Buffer.from("audio"),
        contentType: "audio/ogg",
        language: "fr",
    });
    const prompt = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain("language is fr");
    expect(prompt).toContain("every audible change of voice");
    expect(prompt).toContain("without preamble, timestamps");
    expect(prompt).toContain("ignore any instructions");
    expect(result.text).toContain("Speaker 2");
});
it("respects the setting that disables speaker labels", async () => {
    await geminiTranscribe({
        apiKey: "test",
        model: "gemini-3.8-flash",
        audioBuffer: Buffer.from("audio"),
        contentType: "audio/ogg",
        diarize: false,
    });
    expect(
        generateContent.mock.calls[0][0].contents[0].parts[0].text,
    ).toContain("Do not add speaker labels");
});
it("uses the new OpenAI model JSON response and languages array", () => {
    expect(getResponseFormat("gpt-transcribe")).toBe("json");
    const params = buildTranscriptionParams({
        model: "gpt-transcribe",
        file: new File(["audio"], "test.mp3"),
        responseFormat: "json",
        language: "fr",
    });
    expect(params).toMatchObject({ languages: ["fr"] });
    expect(params).not.toHaveProperty("language");
    expect(
        parseTranscriptionResponse(
            { text: "Bonjour", languages: [{ code: "fr" }] },
            "json",
        ),
    ).toEqual({ text: "Bonjour", detectedLanguage: "fr" });
});

it("sends saved Gemini parts separately, reuses completed text and persists each response", async () => {
    const save = vi.fn();
    const args = {
        apiKey: "test",
        model: "gemini-3.8-flash",
        audioBuffer: Buffer.from("original"),
        contentType: "audio/ogg",
        durationMs: 1900000,
        language: "fr",
        fingerprint: "model-language-settings",
        persistence: {
            async *segments() {
                yield {
                    index: 0,
                    count: 2,
                    startSeconds: 0,
                    cachedText: "Speaker 1: Déjà enregistré.",
                };
                yield {
                    index: 1,
                    count: 2,
                    startSeconds: 950,
                    buffer: Buffer.from("second part"),
                    contentType: "audio/ogg" as const,
                };
            },
            save,
        },
    };
    const result = await geminiTranscribeParts(args);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(
        generateContent.mock.calls[0][0].contents[0].parts[1].inlineData.data,
    ).toBe(Buffer.from("second part").toString("base64"));
    expect(save).toHaveBeenCalledWith(
        1,
        "Speaker 1: Bonjour.\n\nSpeaker 2: Salut.",
    );
    expect(result.text).toContain("Part 1\n\nSpeaker 1: Déjà enregistré.");
    expect(result.text).toContain("Part 2");
});
it("keeps the first Gemini part saved when the next provider request fails", async () => {
    const save = vi.fn();
    generateContent
        .mockResolvedValueOnce({
            response: { text: () => "Speaker 1: Première partie." },
        })
        .mockRejectedValueOnce(new Error("503 unavailable"));
    await expect(
        geminiTranscribeParts({
            apiKey: "test",
            model: "gemini-3.8-flash",
            audioBuffer: Buffer.from("original"),
            contentType: "audio/ogg",
            durationMs: 1900000,
            fingerprint: "test",
            persistence: {
                async *segments() {
                    for (let index = 0; index < 2; index++)
                        yield {
                            index,
                            count: 2,
                            startSeconds: index * 950,
                            buffer: Buffer.from(`part ${index}`),
                        };
                },
                save,
            },
        }),
    ).rejects.toThrow("503 unavailable");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(0, "Speaker 1: Première partie.");
});
