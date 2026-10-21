// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkstationDetailPane } from "@/components/dashboard/workstation-detail-pane";
import type { Recording } from "@/types/recording";

vi.mock("@/hooks/use-audio-job", () => ({
    useAudioJob: () => ({
        job: null,
        busy: false,
        error: null,
        split: vi.fn(),
        remove: vi.fn(),
    }),
}));
vi.mock("@/components/dashboard/recording-player", () => ({
    RecordingPlayer: ({ children }: { children: ReactNode }) => (
        <section aria-label="Recording player">{children}</section>
    ),
}));
vi.mock("@/components/dashboard/transcription-panel", () => ({
    TranscriptionPanel: () => (
        <section aria-label="Full transcript">Transcript</section>
    ),
}));
afterEach(cleanup);
describe("audio processing placement", () => {
    it("keeps processing inside the player and allows it to remain collapsed", async () => {
        const props = {
            currentRecording: { id: "rec" } as Recording,
            currentTranscription: undefined,
            isCurrentTranscribing: false,
            visibleRecordings: [],
            onTranscribe: vi.fn(),
            onSelectRecording: vi.fn(),
            onBackToList: vi.fn(),
            hiddenOnMobile: false,
            initialPlaybackSpeed: 1,
            initialVolume: 75,
            initialAutoPlayNext: false,
            scrubberStyle: "slider" as const,
        };
        const view = render(<WorkstationDetailPane {...props} />);
        const player = screen.getByRole("region", { name: "Recording player" });
        expect(
            player.querySelector('[aria-label="Audio preparation"]'),
        ).toBeTruthy();
        expect(
            screen
                .getByRole("region", { name: "Full transcript" })
                .querySelector('[aria-label="Audio preparation"]'),
        ).toBeNull();
        const summary = screen.getByText("Audio processing");
        const details = summary.closest("details") as HTMLDetailsElement;
        expect(details.open).toBe(true);
        fireEvent.click(summary);
        await waitFor(() => expect(details.open).toBe(false));
        view.rerender(
            <WorkstationDetailPane {...props} isCurrentTranscribing />,
        );
        expect(details.open).toBe(false);
    });
});
