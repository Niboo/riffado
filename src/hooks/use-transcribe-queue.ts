"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type AudioJobView, isAudioJobActive } from "@/types/audio-processing";

type ActionKind = "transcribing" | "summarizing";

interface Options {
    /** Called after a successful transcribe so the parent can refresh data. */
    onTranscribeComplete: () => void;
}

/**
 * Per-recording action state for transcription and summarization.
 *
 * A standalone "isTranscribing" boolean races when two transcribes run
 * concurrently -- each request's `finally` would flip it back to false
 * while another was still pending. The per-id map below is the source
 * of truth; callers derive `anyTranscribing` / `isCurrentTranscribing`
 * etc. from `inFlightActions`.
 *
 * `markAction` is exposed so future summarize handlers can use the
 * same map without duplicating the Map-update plumbing.
 */
export function useTranscribeQueue({ onTranscribeComplete }: Options) {
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [inFlightActions, setInFlightActions] = useState<
        Map<string, ActionKind>
    >(new Map());

    const markAction = useCallback((id: string, kind: ActionKind | null) => {
        setInFlightActions((prev) => {
            const next = new Map(prev);
            if (kind === null) next.delete(id);
            else next.set(id, kind);
            return next;
        });
    }, []);

    /**
     * Trigger transcription for a specific recording id. Used by:
     *   - the per-recording "Transcribe" button in TranscriptionPanel
     *     (via a wrapper that targets the currently selected recording
     *     for backwards compatibility), and
     *   - the command palette's per-row "Transcribe X" quick actions,
     *     which need to dispatch against an arbitrary recording without
     *     having to first change the selection.
     */
    const transcribeById = useCallback(
        async (id: string) => {
            markAction(id, "transcribing");
            try {
                const response = await fetch(
                    `/api/recordings/${id}/transcribe`,
                    { method: "POST" },
                );
                if (response.status === 202) {
                    let { job }: { job: AudioJobView } = await response.json();
                    while (mounted.current && isAudioJobActive(job.status)) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, 3000),
                        );
                        if (!mounted.current) return;
                        const poll = await fetch(
                            `/api/recordings/${id}/audio-parts`,
                            { cache: "no-store" },
                        );
                        if (!poll.ok)
                            throw new Error(
                                "Could not check transcription progress",
                            );
                        const data: { job: AudioJobView | null } =
                            await poll.json();
                        if (!data.job)
                            throw new Error("Transcription job not found");
                        job = data.job;
                    }
                    if (!mounted.current) return;
                    if (job.status === "failed") {
                        toast.error(
                            job.error ??
                                "Transcription failed. Saved parts are preserved.",
                        );
                        return;
                    }
                    toast.success("Transcription complete");
                    onTranscribeComplete();
                } else if (response.ok) {
                    toast.success("Transcription complete");
                    onTranscribeComplete();
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Transcription failed");
                }
            } catch {
                toast.error("Failed to transcribe recording");
            } finally {
                // Per-id clear only -- don't touch any global "is
                // transcribing" flag (there isn't one), so a concurrent
                // transcribe on a different recording keeps its own
                // marker intact.
                markAction(id, null);
            }
        },
        [markAction, onTranscribeComplete],
    );

    return {
        inFlightActions,
        markAction,
        transcribeById,
    };
}
