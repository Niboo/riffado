import { expect, it } from "vitest";
import {
    renameTranscriptSpeakers,
    transcriptSpeakers,
} from "@/lib/transcription/speaker-names";

it("renames only speaker headers across parts, preserving spoken words and stable IDs", () => {
    const text =
        "Part 1\nSpeaker 1: Speaker 2 told me.\nSpeaker 2: Hello\nPart 2\nSpeaker 1: Again";
    const renamed = renameTranscriptSpeakers(text, {
        "Speaker 1": "Sam",
        "Speaker 2": "Léa",
    });
    expect(renamed).toBe(
        "Part 1\nSpeaker 1 (Sam): Speaker 2 told me.\nSpeaker 2 (Léa): Hello\nPart 2\nSpeaker 1 (Sam): Again",
    );
    expect(transcriptSpeakers(renamed)).toEqual({
        "Speaker 1": "Sam",
        "Speaker 2": "Léa",
    });
    expect(renameTranscriptSpeakers(renamed, { "Speaker 1": "" })).toContain(
        "Speaker 1: Again",
    );
});
it("preserves timestamps and part labels when changing a saved name", () => {
    const text =
        "[00:05] Speaker 1 · Part 2\nBonjour\n[00:08] Speaker 2 (Léa)\nSalut";
    expect(
        renameTranscriptSpeakers(text, {
            "Speaker 1": "Sam",
            "Speaker 2": "Marie",
        }),
    ).toBe(
        "[00:05] Speaker 1 (Sam) · Part 2\nBonjour\n[00:08] Speaker 2 (Marie)\nSalut",
    );
});
