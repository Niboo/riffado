// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
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
        fireEvent.click(screen.getByLabelText(/Part 2 .*Failed/));
        expect(screen.getByText("OpenAI timed out on this part.")).toBeTruthy();
        expect(screen.queryByText("Saved words")).toBeNull();
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
    it("opens a readable transcript dialog and shows processing time and an editable cost estimate", () => {
        render(
            <AudioPartsPanel
                {...props}
                job={{
                    ...job,
                    parts: [
                        {
                            ...job.parts[0],
                            startedAt: "2026-10-21T08:00:00Z",
                            completedAt: "2026-10-21T08:02:30Z",
                        },
                    ],
                }}
            />,
        );
        fireEvent.click(screen.getByLabelText(/Part 1 .*Transcribed/));
        expect(screen.getByText("Processing time: 2:30")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "Open transcript for part 1" }),
        );
        expect(screen.getByRole("dialog").textContent).toContain("Saved words");
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        const settings = screen.getByText("Cost estimate settings");
        fireEvent.click(settings);
        fireEvent.change(screen.getByLabelText(/Reference rate/), {
            target: { value: "0.01" },
        });
        expect(screen.getByText(/Estimated total .*0.200 USD/)).toBeTruthy();
    });
    it("renders hover details outside the clipping card and closes on Escape", () => {
        const { container } = render(
            <div className="overflow-hidden">
                <AudioPartsPanel {...props} job={job} />
            </div>,
        );
        const trigger = screen.getByLabelText(/Part 2 .*Failed/);
        fireEvent.mouseEnter(trigger);
        const popover = screen.getByRole("dialog", {
            name: "Details for part 2",
        });
        expect(container.contains(popover)).toBe(false);
        expect(
            screen.getByRole("link", { name: "Download part 2" }),
        ).toBeTruthy();
        fireEvent.keyDown(popover, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
    });
    it("closes hovered details after mouse leave even if the trigger was focused", async () => {
        render(<AudioPartsPanel {...props} job={job} />);
        const trigger = screen.getByLabelText(/Part 2 .*Failed/);
        trigger.focus();
        fireEvent.mouseEnter(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        fireEvent.mouseLeave(trigger);
        await waitFor(() =>
            expect(trigger.getAttribute("aria-expanded")).toBe("false"),
        );
    });
    it("keeps details open while moving from the trigger into the portal, with only one part open", async () => {
        render(<AudioPartsPanel {...props} job={job} />);
        const first = screen.getByLabelText(/Part 1 .*Transcribed/);
        const second = screen.getByLabelText(/Part 2 .*Failed/);
        fireEvent.mouseEnter(first);
        fireEvent.mouseLeave(first);
        fireEvent.mouseEnter(
            screen.getByRole("dialog", { name: "Details for part 1" }),
        );
        expect(first.getAttribute("aria-expanded")).toBe("true");
        fireEvent.mouseEnter(second);
        expect(first.getAttribute("aria-expanded")).toBe("false");
        expect(second.getAttribute("aria-expanded")).toBe("true");
        fireEvent.mouseLeave(
            screen.getByRole("dialog", { name: "Details for part 2" }),
        );
        await waitFor(() =>
            expect(second.getAttribute("aria-expanded")).toBe("false"),
        );
    });
    it("omits saved fragments below five seconds from the blocks and progress count", () => {
        render(
            <AudioPartsPanel
                {...props}
                job={{
                    ...job,
                    parts: [
                        ...job.parts,
                        {
                            index: 2,
                            startSeconds: 2398,
                            endSeconds: 2402.999,
                            bytes: 20,
                            status: "ready",
                        },
                    ],
                }}
            />,
        );
        expect(screen.queryByLabelText(/Part 3/)).toBeNull();
        expect(screen.getByText(/1 of 2 complete/)).toBeTruthy();
        const trigger = screen.getByLabelText(/Part 1 .*Transcribed/);
        expect(trigger.closest("li")?.className).toContain("min-w-24");
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

it("keeps explanations in dismissible information bubbles", async () => {
    render(<AudioPartsPanel {...props} job={job} />);
    expect(screen.queryByText(/Indicative calculation/)).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "About cost estimates" }),
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Excludes retries");
    fireEvent.keyDown(tooltip, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    fireEvent.click(
        screen.getByRole("button", { name: "About audio splitting" }),
    );
    expect((await screen.findByRole("tooltip")).textContent).toContain(
        "5 seconds",
    );
});
