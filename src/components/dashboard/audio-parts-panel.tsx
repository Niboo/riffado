"use client";

import {
    AlertCircle,
    CheckCircle2,
    Circle,
    Download,
    Loader2,
    Scissors,
    Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AudioJobView } from "@/types/audio-processing";

function time(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const labels = {
    queued: "Waiting to start",
    splitting: "Preparing audio parts",
    transcribing: "Transcribing",
    ready: "Audio parts saved",
    completed: "Transcription complete",
    failed: "Processing stopped",
};
const partLabels = {
    ready: "Ready to transcribe",
    transcribing: "Transcribing",
    completed: "Transcribed",
    failed: "Failed",
};

export function AudioPartsPanel({
    recordingId,
    job,
    busy,
    error,
    onSplit,
    onRetry,
    onRemove,
}: {
    recordingId: string;
    job: AudioJobView | null;
    busy: boolean;
    error: string | null;
    onSplit: () => void;
    onRetry: () => void;
    onRemove: () => void;
}) {
    const [confirmRemove, setConfirmRemove] = useState(false);
    const completed =
        job?.parts.filter((p) => p.status === "completed").length ?? 0;
    const current = job?.parts.find((p) => p.status === "transcribing");
    return (
        <section
            aria-label="Audio preparation"
            className="space-y-3 border-b pb-4 mb-4"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-medium">Audio parts</h3>
                    <p className="text-sm text-muted-foreground">
                        Split into parts of up to 20 minutes. Saved separately
                        from the original.
                    </p>
                </div>
                {(!job ||
                    !job.parts.length ||
                    (job.status === "failed" && job.action === "split")) && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onSplit}
                        disabled={busy}
                    >
                        {busy ? (
                            <Loader2 className="size-4 mr-2 animate-spin motion-reduce:animate-none" />
                        ) : (
                            <Scissors className="size-4 mr-2" />
                        )}
                        {job?.status === "failed"
                            ? "Resume splitting"
                            : "Split audio"}
                    </Button>
                )}
            </div>
            <div aria-live="polite" className="text-sm">
                {job ? (
                    <p>
                        {labels[job.status]}
                        {job.action === "transcribe" && job.parts.length > 0
                            ? ` · ${completed} of ${job.parts.length} complete${current ? ` · working on part ${current.index + 1}` : ""}`
                            : ""}
                    </p>
                ) : (
                    <p className="text-muted-foreground">
                        Splitting runs on the server and does not call your AI
                        provider.
                    </p>
                )}
                {job &&
                    (job.status === "queued" ||
                        job.status === "splitting" ||
                        job.status === "transcribing") && (
                        <p className="text-muted-foreground mt-1">
                            You can leave this page. Progress and completed
                            parts are saved.
                        </p>
                    )}
            </div>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            {job?.error && (
                <div className="space-y-2">
                    <p
                        role="alert"
                        className="text-sm text-destructive break-words"
                    >
                        {job.error}
                    </p>
                    {job.action === "transcribe" && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onRetry}
                            disabled={busy}
                        >
                            Resume transcription
                        </Button>
                    )}
                </div>
            )}
            {job && job.parts.length > 0 && (
                <details open>
                    <summary className="cursor-pointer text-sm font-medium py-1 focus-visible:outline-2 focus-visible:outline-ring">
                        {job.parts.length} saved audio parts · view and listen
                    </summary>
                    <ol className="divide-y mt-2">
                        {job.parts.map((part) => (
                            <li
                                key={part.index}
                                aria-current={
                                    part.status === "transcribing"
                                        ? "step"
                                        : undefined
                                }
                                className={`py-3 space-y-2 ${part.status === "transcribing" ? "bg-primary/5" : ""}`}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <span className="tabular-nums">
                                        Part {part.index + 1} ·{" "}
                                        {time(part.startSeconds)}–
                                        {time(part.endSeconds)}
                                    </span>
                                    <span
                                        className={`inline-flex items-center gap-1.5 ${part.status === "failed" ? "text-destructive" : part.status === "transcribing" ? "text-primary font-medium" : "text-muted-foreground"}`}
                                    >
                                        {part.status === "transcribing" ? (
                                            <Loader2
                                                aria-hidden="true"
                                                className="size-4 animate-spin motion-reduce:animate-none"
                                            />
                                        ) : part.status === "completed" ? (
                                            <CheckCircle2
                                                aria-hidden="true"
                                                className="size-4"
                                            />
                                        ) : part.status === "failed" ? (
                                            <AlertCircle
                                                aria-hidden="true"
                                                className="size-4"
                                            />
                                        ) : (
                                            <Circle
                                                aria-hidden="true"
                                                className="size-4"
                                            />
                                        )}
                                        {partLabels[part.status]}
                                    </span>
                                </div>
                                {(part.startedAt || part.completedAt) && (
                                    <p className="text-xs text-muted-foreground tabular-nums">
                                        {part.status === "completed" &&
                                        part.completedAt
                                            ? `Completed at ${new Date(part.completedAt).toLocaleTimeString()}`
                                            : part.startedAt
                                              ? `Started at ${new Date(part.startedAt).toLocaleTimeString()}`
                                              : ""}
                                        {(part.attempts ?? 0) > 1
                                            ? ` · attempt ${part.attempts}`
                                            : ""}
                                    </p>
                                )}
                                {part.error && (
                                    <p className="text-sm text-destructive break-words">
                                        {part.error}
                                    </p>
                                )}
                                <div className="flex items-center gap-3 min-w-0">
                                    <audio
                                        controls
                                        preload="none"
                                        className="h-9 min-w-0 w-full"
                                        aria-label={`Listen to part ${part.index + 1}`}
                                        src={`/api/recordings/${recordingId}/audio-parts/${part.index}`}
                                    >
                                        <track kind="captions" />
                                    </audio>
                                    <a
                                        className="shrink-0 rounded p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                                        href={`/api/recordings/${recordingId}/audio-parts/${part.index}?download=1`}
                                        aria-label={`Download part ${part.index + 1}`}
                                    >
                                        <Download className="size-4" />
                                    </a>
                                </div>
                                {part.text && (
                                    <details>
                                        <summary className="cursor-pointer text-sm text-muted-foreground">
                                            View saved transcript
                                        </summary>
                                        <p className="text-sm whitespace-pre-wrap mt-2">
                                            {part.text}
                                        </p>
                                    </details>
                                )}
                            </li>
                        ))}
                    </ol>
                </details>
            )}
            {job &&
                job.parts.length > 0 &&
                !busy &&
                (confirmRemove ? (
                    <div className="space-y-2 text-sm">
                        <p>
                            Remove saved parts and their partial transcripts?
                            The original audio and full transcript will stay
                            available.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                    onRemove();
                                    setConfirmRemove(false);
                                }}
                            >
                                Remove saved parts
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmRemove(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmRemove(true)}
                    >
                        <Trash2 className="size-4 mr-2" />
                        Remove saved parts
                    </Button>
                ))}
        </section>
    );
}
