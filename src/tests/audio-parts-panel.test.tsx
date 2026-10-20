// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPartsPanel } from "@/components/dashboard/audio-parts-panel";
import type { AudioJobView } from "@/types/audio-processing";

const props = {
    recordingId: "recording",
    busy: false,
    error: null,
    onSplit: vi.fn(),
    onRetry: vi.fn(),
    onRemove: vi.fn(),
};
const job: AudioJobView = {
    id: "job",
    action: "transcribe",
    status: "failed",
    error: "The provider timed out. Saved parts are preserved.",
    updatedAt: new Date().toISOString(),
    parts: [
        {
            index: 0,
            startSeconds: 0,
            endSeconds: 1199,
            bytes: 100,
            status: "completed",
            text: "Saved words",
        },
        {
            index: 1,
            startSeconds: 1199,
            endSeconds: 2398,
            bytes: 100,
            status: "failed",
            error: "OpenAI timed out on this part.",
        },
    ],
};
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("audio parts controls", () => {
    it("offers a separate split action before any paid transcription", () => {
        render(<AudioPartsPanel {...props} job={null} />);
        fireEvent.click(screen.getByRole("button", { name: "Split audio" }));
        expect(props.onSplit).toHaveBeenCalledOnce();
        expect(screen.getByText(/does not call your AI provider/)).toBeTruthy();
    });
    it("shows saved intervals, partial results and a resume action after failure", () => {
        render(<AudioPartsPanel {...props} job={job} />);
        expect(screen.getByText("Part 1 · 0:00–19:59")).toBeTruthy();
        expect(screen.getByText("Saved words")).toBeTruthy();
        expect(screen.getByText("OpenAI timed out on this part.")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "Resume transcription" }),
        );
        expect(props.onRetry).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByLabelText(/Part 1 .*Transcribed/));
        expect(
            screen.getByRole("link", { name: "Download part 1" }),
        ).toBeTruthy();
        expect(document.querySelector("audio")).toBeNull();
    });
    it("opens part details on hover with its error and download action", () => {
        render(<AudioPartsPanel {...props} job={job} />);
        const trigger = screen.getByLabelText(/Part 2 .*Failed/);
        const details = trigger.closest("details");
        expect(details?.open).toBe(false);
        fireEvent.mouseEnter(details as HTMLElement);
        expect(details?.open).toBe(true);
        expect(
            screen.getByRole("link", { name: "Download part 2" }),
        ).toBeTruthy();
        fireEvent.keyDown(details as HTMLElement, { key: "Escape" });
        expect(details?.open).toBe(false);
    });
    it("keeps destructive cleanup behind an explicit confirmation", () => {
        render(<AudioPartsPanel {...props} job={job} />);
        fireEvent.click(
            screen.getByRole("button", { name: "Remove saved parts" }),
        );
        expect(props.onRemove).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole("button", { name: "Remove saved parts" }),
        );
        expect(props.onRemove).toHaveBeenCalledOnce();
    });
    it("shows progress when reopened during a running job", () => {
        render(
            <AudioPartsPanel
                {...props}
                busy
                job={{
                    ...job,
                    status: "transcribing",
                    error: null,
                    parts: [
                        job.parts[0],
                        {
                            ...job.parts[1],
                            status: "transcribing",
                            error: undefined,
                        },
                    ],
                }}
            />,
        );
        expect(
            screen.getByText(/1 of 2 complete · working on part 2/),
        ).toBeTruthy();
        expect(
            screen
                .getByLabelText(/Part 2 .*Transcribing/)
                .closest("li")
                ?.getAttribute("aria-current"),
        ).toBe("step");
        expect(
            screen.queryByRole("button", { name: "Remove saved parts" }),
        ).toBeNull();
    });
});
