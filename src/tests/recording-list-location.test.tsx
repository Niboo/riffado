// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingList } from "@/components/dashboard/recording-list";
import type { Recording } from "@/types/recording";

vi.mock("@/components/confirm-dialog", () => ({ useConfirm: () => vi.fn() }));
const recordings: Recording[] = Array.from({ length: 60 }, (_, index) => ({
    id: `rec-${index}`,
    filename: `Meeting ${index}`,
    duration: 60000,
    startTime: "2026-10-21T08:00:00Z",
    filesize: 100,
    deviceSn: "test-device",
}));
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
});
describe("recording list location", () => {
    it("reveals a selected recording beyond the initial page and restores its viewport position", async () => {
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                observe() {}
                disconnect() {}
            },
        );
        const scroll = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
            configurable: true,
            value: scroll,
        });
        vi.spyOn(window, "scrollBy").mockImplementation(() => {});
        vi.spyOn(
            HTMLElement.prototype,
            "getBoundingClientRect",
        ).mockReturnValue({ top: 300 } as DOMRect);
        sessionStorage.setItem("riffado:recording-scroll:rec-59", "120");
        const select = vi.fn();
        render(
            <RecordingList
                recordings={recordings}
                currentRecording={recordings[59]}
                transcriptions={new Map()}
                pendingUploads={[]}
                inFlightActions={new Map()}
                onSelect={select}
                onDelete={vi.fn()}
                initialDateTimeFormat="iso"
                initialSortOrder="newest"
                initialDensity="comfortable"
                initialChunkSize={10}
            />,
        );
        const link = screen.getByRole("link", { name: /Meeting 59/ });
        expect(link.getAttribute("href")).toBe("?recording=rec-59");
        expect(link.getAttribute("aria-current")).toBe("page");
        await waitFor(() =>
            expect(window.scrollBy).toHaveBeenCalledWith(0, 180),
        );
        fireEvent.click(link);
        expect(select).toHaveBeenCalledWith(recordings[59]);
        link.addEventListener("click", (event) => event.preventDefault(), {
            once: true,
        });
        fireEvent.click(link, { ctrlKey: true });
        expect(select).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event("pagehide"));
        expect(sessionStorage.getItem("riffado:recording-scroll:rec-59")).toBe(
            "300",
        );
    });
});
