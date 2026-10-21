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
import { geminiTranscribe } from "@/lib/transcription/gemini-transcribe";

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
