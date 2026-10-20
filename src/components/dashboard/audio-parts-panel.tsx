"use client";

import {
    AlertCircle,
    CheckCircle2,
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
    const [openPart, setOpenPart] = useState<string | null>(null);
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
                        Up to 20 minutes per part. Hover or select for details.
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
                <ol
                    aria-label="Saved audio parts"
                    className="flex flex-wrap gap-1 rounded-md bg-muted p-1"
                >
                    {job.parts.map((part) => {
                        const Icon =
                            part.status === "completed"
                                ? CheckCircle2
                                : part.status === "failed"
                                  ? AlertCircle
                                  : part.status === "transcribing"
                                    ? Loader2
                                    : null;
                        const partKey = `${recordingId}:${part.index}`;
                        return (
                            <li
                                key={part.index}
                                aria-current={
                                    part.status === "transcribing"
                                        ? "step"
                                        : undefined
                                }
                                className="relative min-w-24"
                                style={{
                                    flexGrow: Math.max(
                                        1,
                                        part.endSeconds - part.startSeconds,
                                    ),
                                    flexBasis: "6rem",
                                }}
                            >
                                <details
                                    className="group"
                                    open={openPart === partKey}
                                    onClick={(event) => {
                                        if (
                                            event.target instanceof Element &&
                                            event.target.closest("summary") ===
                                                event.currentTarget
                                                    .firstElementChild
                                        ) {
                                            event.preventDefault();
                                            setOpenPart(
                                                openPart === partKey
                                                    ? null
                                                    : partKey,
                                            );
                                        }
                                    }}
                                    onMouseEnter={() => setOpenPart(partKey)}
                                    onMouseLeave={() => setOpenPart(null)}
                                    onBlur={(event) => {
                                        if (
                                            !event.currentTarget.contains(
                                                event.relatedTarget,
                                            )
                                        )
                                            setOpenPart(null);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Escape")
                                            setOpenPart(null);
                                    }}
                                >
                                    <summary
                                        aria-label={`Part ${part.index + 1} · ${time(part.startSeconds)}–${time(part.endSeconds)} · ${partLabels[part.status]}`}
                                        className={`flex h-14 cursor-pointer list-none items-center justify-center gap-2 rounded px-2 text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden ${part.status === "failed" ? "bg-destructive text-white" : part.status === "completed" ? "bg-emerald-800 text-white dark:bg-emerald-900" : part.status === "transcribing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border"}`}
                                    >
                                        {Icon && (
                                            <Icon
                                                aria-hidden="true"
                                                className={`size-4 shrink-0 ${part.status === "transcribing" ? "animate-spin motion-reduce:animate-none" : ""}`}
                                            />
                                        )}
                                        <span className="truncate">
                                            {part.index + 1}
                                            <span className="hidden sm:inline">
                                                {" "}
                                                · {time(part.startSeconds)}–
                                                {time(part.endSeconds)}
                                            </span>
                                        </span>
                                    </summary>
                                    <div
                                        className="absolute top-full left-0 z-20 w-72 max-w-[75vw] rounded-md border bg-popover p-3 text-popover-foreground shadow-md space-y-2"
                                        style={{
                                            left:
                                                part.index ===
                                                job.parts.length - 1
                                                    ? "auto"
                                                    : 0,
                                            right:
                                                part.index ===
                                                job.parts.length - 1
                                                    ? 0
                                                    : "auto",
                                        }}
                                    >
                                        <p className="text-sm font-medium">
                                            Part {part.index + 1} ·{" "}
                                            {time(part.startSeconds)}–
                                            {time(part.endSeconds)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {partLabels[part.status]} ·{" "}
                                            {(part.bytes / 1024 / 1024).toFixed(
                                                2,
                                            )}{" "}
                                            MB
                                            {part.attempts
                                                ? ` · attempt ${part.attempts}`
                                                : ""}
                                        </p>
                                        {part.startedAt && (
                                            <p className="text-xs text-muted-foreground">
                                                Started at{" "}
                                                {new Date(
                                                    part.startedAt,
                                                ).toLocaleTimeString()}
                                                {part.completedAt
                                                    ? ` · completed at ${new Date(part.completedAt).toLocaleTimeString()}`
                                                    : ""}
                                            </p>
                                        )}
                                        {part.error && (
                                            <p className="text-sm text-destructive break-words">
                                                {part.error}
                                            </p>
                                        )}
                                        <a
                                            className="inline-flex min-h-9 items-center gap-2 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                                            href={`/api/recordings/${recordingId}/audio-parts/${part.index}?download=1`}
                                        >
                                            <Download className="size-4" />
                                            Download part {part.index + 1}
                                        </a>
                                        {part.text && (
                                            <details>
                                                <summary className="cursor-pointer text-sm">
                                                    View saved transcript
                                                </summary>
                                                <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm mt-2">
                                                    {part.text}
                                                </p>
                                            </details>
                                        )}
                                    </div>
                                </details>
                            </li>
                        );
                    })}
                </ol>
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
