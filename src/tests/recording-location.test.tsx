// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRecordingLocation } from "@/hooks/use-recording-location";
import type { Recording } from "@/types/recording";

const recordings = [{ id: "first" }, { id: "older" }] as Recording[];
afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
});
describe("recording URL selection", () => {
    it("restores an older recording from a copied URL or refresh", () => {
        window.history.replaceState(
            null,
            "",
            "/dashboard?recording=older#providers",
        );
        const { result } = renderHook(() => useRecordingLocation(recordings));
        expect(result.current.currentRecording?.id).toBe("older");
    });
    it("writes selections to the URL and supports browser history", () => {
        window.history.replaceState(
            null,
            "",
            "/dashboard?filter=keep#providers",
        );
        const { result } = renderHook(() => useRecordingLocation(recordings));
        act(() => result.current.selectRecording(recordings[1]));
        expect(window.location.search).toBe("?filter=keep&recording=older");
        expect(window.location.hash).toBe("#providers");
        act(() => {
            window.history.replaceState(null, "", "/dashboard?recording=first");
            window.dispatchEvent(new PopStateEvent("popstate"));
        });
        expect(result.current.currentRecording?.id).toBe("first");
    });
    it("does not silently replace an unavailable recording with a different meeting", () => {
        window.history.replaceState(null, "", "/dashboard?recording=missing");
        const { result } = renderHook(() => useRecordingLocation(recordings));
        expect(result.current.currentRecording).toBeNull();
    });
});
