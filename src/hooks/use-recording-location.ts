"use client";

import { useCallback, useEffect, useState } from "react";
import type { Recording } from "@/types/recording";

export function useRecordingLocation(recordings: Recording[]) {
    const [id, setId] = useState<string | null>(recordings[0]?.id ?? null);
    const [restored, setRestored] = useState(false);
    useEffect(() => {
        const restore = () => {
            const requested = new URL(window.location.href).searchParams.get(
                "recording",
            );
            setId(requested ?? recordings[0]?.id ?? null);
            setRestored(true);
        };
        restore();
        window.addEventListener("popstate", restore);
        return () => window.removeEventListener("popstate", restore);
    }, [recordings]);
    const select = useCallback((recording: Recording | null) => {
        const url = new URL(window.location.href);
        if (recording) url.searchParams.set("recording", recording.id);
        else url.searchParams.delete("recording");
        if (url.href !== window.location.href)
            window.history.pushState(null, "", url);
        setId(recording?.id ?? null);
    }, []);
    return {
        currentRecording:
            recordings.find((recording) => recording.id === id) ?? null,
        selectRecording: select,
        restored,
    };
}
