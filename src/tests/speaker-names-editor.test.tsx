// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpeakerNamesEditor } from "@/components/dashboard/speaker-names-editor";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
it("edits names together and saves the selected source with its original text", async () => {
    const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "Speaker 1 (Sam): Bonjour." }),
    });
    vi.stubGlobal("fetch", fetch);
    const saved = vi.fn();
    render(
        <SpeakerNamesEditor
            recordingId="rec"
            source="riffado"
            text="Speaker 1: Bonjour."
            disabled={false}
            onSaved={saved}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Name speakers" }));
    fireEvent.change(
        screen.getByRole("textbox", { name: "Name for Speaker 1" }),
        { target: { value: "Sam" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save names" }));
    await waitFor(() =>
        expect(saved).toHaveBeenCalledWith("Speaker 1 (Sam): Bonjour."),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        source: "riffado",
        expectedText: "Speaker 1: Bonjour.",
        names: { "Speaker 1": "Sam" },
    });
});
