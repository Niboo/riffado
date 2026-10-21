// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingLanguageControl } from "@/components/dashboard/meeting-language-control";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
describe("meeting language selection", () => {
    it("loads the configured language and saves French before another transcription can start", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ defaultTranscriptionLanguage: "en" }),
            })
            .mockResolvedValueOnce({ ok: true });
        vi.stubGlobal("fetch", fetcher);
        const pending = vi.fn();
        render(
            <MeetingLanguageControl
                disabled={false}
                onPendingChange={pending}
            />,
        );
        const select = screen.getByRole("combobox") as HTMLSelectElement;
        await waitFor(() => expect(select.value).toBe("en"));
        fireEvent.change(select, { target: { value: "fr" } });
        await waitFor(() => expect(select.value).toBe("fr"));
        expect(fetcher.mock.calls[1][1].body).toBe(
            JSON.stringify({ defaultTranscriptionLanguage: "fr" }),
        );
        expect(pending.mock.calls.at(-1)).toEqual([false]);
    });
    it("keeps the last saved language and reports an unsuccessful save", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ defaultTranscriptionLanguage: "fr" }),
                })
                .mockResolvedValueOnce({ ok: false }),
        );
        const pending = vi.fn();
        render(
            <MeetingLanguageControl
                disabled={false}
                onPendingChange={pending}
            />,
        );
        const select = screen.getByRole("combobox") as HTMLSelectElement;
        await waitFor(() => expect(select.value).toBe("fr"));
        fireEvent.change(select, { target: { value: "en" } });
        await screen.findByRole("alert");
        expect(select.value).toBe("fr");
    });
});
