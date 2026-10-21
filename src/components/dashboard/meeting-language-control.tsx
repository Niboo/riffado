"use client";

import { useEffect, useId, useState } from "react";
import { AI_OUTPUT_LANGUAGES } from "@/lib/ai/summary-presets";

export function MeetingLanguageControl({
    disabled,
    onPendingChange,
}: {
    disabled: boolean;
    onPendingChange: (pending: boolean) => void;
}) {
    const id = useId();
    const [language, setLanguage] = useState("");
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        onPendingChange(true);
        fetch("/api/settings/user", { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok)
                    throw new Error("Could not load meeting language");
                const data = await response.json();
                if (!controller.signal.aborted) {
                    setLanguage(data.defaultTranscriptionLanguage ?? "");
                    setLoaded(true);
                }
            })
            .catch(() => {
                if (!controller.signal.aborted)
                    setError(
                        "Language unavailable. Check transcription settings.",
                    );
            })
            .finally(() => {
                if (!controller.signal.aborted) onPendingChange(false);
            });
        return () => controller.abort();
    }, [onPendingChange]);
    return (
        <div className="flex flex-col gap-1">
            <label className="sr-only" htmlFor={id}>
                Meeting language (default)
            </label>
            <select
                id={id}
                title="Default meeting language for future transcriptions. Select the original language to improve accuracy."
                value={language}
                disabled={disabled || !loaded || saving}
                className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                onChange={async (event) => {
                    const next = event.target.value;
                    onPendingChange(true);
                    setSaving(true);
                    setError(null);
                    try {
                        const response = await fetch("/api/settings/user", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                defaultTranscriptionLanguage: next || null,
                            }),
                        });
                        if (!response.ok)
                            throw new Error("Could not save meeting language");
                        setLanguage(next);
                    } catch {
                        setError("Language was not saved. Try again.");
                    } finally {
                        setSaving(false);
                        onPendingChange(false);
                    }
                }}
            >
                <option value="">Auto-detect language</option>
                {AI_OUTPUT_LANGUAGES.filter((option) => option.code).map(
                    (option) => (
                        <option key={option.code} value={option.code}>
                            {option.label}
                        </option>
                    ),
                )}
            </select>
            {error && (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
