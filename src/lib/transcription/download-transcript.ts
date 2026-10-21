export function downloadTranscript(text: string, recordingName: string): void {
    const name =
        recordingName
            .replace(/[\\/:*?"<>|]/g, "-")
            .replace(/\p{Cc}/gu, "-")
            .trim()
            .slice(0, 150) || "recording";
    const url = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-transcript.txt`;
    document.body.append(link);
    try {
        link.click();
    } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
