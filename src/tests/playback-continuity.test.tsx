// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaybackEngine } from "@/hooks/use-playback-engine";
import type { Recording } from "@/types/recording";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});
function Player({ onEnded }: { onEnded: () => void }) {
    const engine = usePlaybackEngine({
        recording: { id: "rec" } as Recording,
        onEnded,
    });
    return (
        <>
            <audio ref={engine.audioRef}>
                <track kind="captions" />
            </audio>
            <button type="button" onClick={engine.togglePlayPause}>
                {engine.isPlaying ? "Pause" : "Play"}
            </button>
        </>
    );
}
it("does not reload or rewind playback when the parent's callbacks change", () => {
    const load = vi
        .spyOn(HTMLMediaElement.prototype, "load")
        .mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const view = render(<Player onEnded={() => {}} />);
    const audio = view.container.querySelector("audio") as HTMLAudioElement;
    audio.currentTime = 12;
    const calls = load.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    view.rerender(<Player onEnded={() => {}} />);
    expect(load).toHaveBeenCalledTimes(calls);
    expect(audio.currentTime).toBe(12);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.pause(audio);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
});
