// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTranscript } from "@/lib/transcription/download-transcript";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
describe("full transcript download", () => {
    it("downloads the complete UTF-8 text in one file and releases its object URL", async () => {
        const create = vi.fn().mockReturnValue("blob:transcript");
        const revoke = vi.fn();
        vi.stubGlobal("URL", {
            createObjectURL: create,
            revokeObjectURL: revoke,
        });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
            function (this: HTMLAnchorElement) {
                expect(this.download).toBe("Réunion-client-transcript.txt");
                expect(this.href).toBe("blob:transcript");
            },
        );
        const transcript =
            "[00:00] Speaker 1 · Part 1\nÉquipe française\n[20:00] Speaker 2 · Part 2\nLa suite";
        downloadTranscript(transcript, "Réunion/client");
        const blob = create.mock.calls[0][0] as Blob;
        expect(blob.type).toBe("text/plain;charset=utf-8");
        const reader = new FileReader();
        const read = new Promise((resolve) => {
            reader.onload = () => resolve(reader.result);
        });
        reader.readAsText(blob);
        expect(await read).toBe(transcript);
        await waitFor(() =>
            expect(revoke).toHaveBeenCalledWith("blob:transcript"),
        );
        expect(document.querySelector("a[download]")).toBeNull();
    });
});
