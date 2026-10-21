export const SPEAKER_HEADER =
    /^(\[\d{2}(?::\d{2}){1,2}\]\s+)?(Speaker\s+\w+|SPEAKER_\w+|UNKNOWN)(?: \(([^)\r\n]*)\))?(?=\s*:|\s+·\s+Part\s+\d+\s*$|\s*$)/gm;

export function transcriptSpeakers(text: string): Record<string, string> {
    const speakers: Record<string, string> = {};
    for (const match of text.matchAll(SPEAKER_HEADER))
        speakers[match[2]] = match[3] ?? "";
    return speakers;
}

export function renameTranscriptSpeakers(
    text: string,
    names: Record<string, string>,
): string {
    return text.replace(
        SPEAKER_HEADER,
        (header, timestamp: string | undefined, speaker: string) => {
            if (!Object.hasOwn(names, speaker)) return header;
            const name = names[speaker].trim();
            return `${timestamp ?? ""}${speaker}${name ? ` (${name})` : ""}`;
        },
    );
}
