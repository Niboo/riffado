"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type AudioJobView, isAudioJobActive } from "@/types/audio-processing";

export function useAudioJob(recordingId: string, onComplete?: () => void) {
    const [snapshot, setSnapshot] = useState<{
        recordingId: string;
        job: AudioJobView | null;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [launching, setLaunching] = useState(false);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const previous = useRef<AudioJobView | null>(null);
    const job = snapshot?.recordingId === recordingId ? snapshot.job : null;

    useEffect(() => {
        if (!recordingId) return;
        const controller = new AbortController();
        previous.current = null;
        setError(null);
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const response = await fetch(
                    `/api/recordings/${recordingId}/audio-parts`,
                    { signal: controller.signal, cache: "no-store" },
                );
                if (!response.ok)
                    throw new Error(
                        "Could not refresh audio progress. Retrying…",
                    );
                const data: { job: AudioJobView | null } =
                    await response.json();
                if (controller.signal.aborted) return;
                if (
                    data.job?.status === "completed" &&
                    previous.current?.status !== "completed"
                )
                    onCompleteRef.current?.();
                previous.current = data.job;
                setSnapshot({ recordingId, job: data.job });
                setError(null);
            } catch (err) {
                if (!controller.signal.aborted)
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Could not refresh audio progress.",
                    );
            } finally {
                if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
            }
        };
        void poll();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [recordingId]);

    const changeParts = useCallback(
        async (method: "POST" | "DELETE") => {
            setLaunching(true);
            setError(null);
            try {
                const response = await fetch(
                    `/api/recordings/${recordingId}/audio-parts`,
                    { method },
                );
                const data = await response.json();
                if (!response.ok)
                    throw new Error(
                        data.error ?? "Could not queue audio splitting.",
                    );
                setSnapshot({ recordingId, job: data.job ?? null });
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not queue audio splitting.",
                );
            } finally {
                setLaunching(false);
            }
        },
        [recordingId],
    );

    return {
        job,
        error,
        split: () => changeParts("POST"),
        remove: () => changeParts("DELETE"),
        launching,
        busy: launching || (job !== null && isAudioJobActive(job.status)),
    };
}
