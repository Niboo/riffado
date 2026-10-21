"use client";

import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    Download,
    Loader2,
    Scissors,
    Trash2,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { SpeakerTranscript } from "@/components/recordings/rich-content";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/info-hint";
import {
    audioProcessingSeconds,
    estimatedAudioCost,
} from "@/lib/transcription/audio-metrics";
import { type AudioJobView, isUsableAudioPart } from "@/types/audio-processing";

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
    durationMs = Number.POSITIVE_INFINITY,
    job: incomingJob,
    busy,
    error,
    onSplit,
    onRetry,
    onRemove,
}: {
    recordingId: string;
    durationMs?: number;
    job: AudioJobView | null;
    busy: boolean;
    error: string | null;
    onSplit: () => void;
    onRetry: () => void;
    onRemove: () => void;
}) {
    const job = incomingJob
        ? { ...incomingJob, parts: incomingJob.parts.filter(isUsableAudioPart) }
        : null;
    const rateId = useId();
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    useEffect(() => () => clearTimeout(closeTimer.current), []);
    const cancelClose = () => clearTimeout(closeTimer.current);
    const closeSoon = () => {
        cancelClose();
        closeTimer.current = setTimeout(() => setOpenPart(null), 150);
    };
    const [rate, setRate] = useState("0.006");
    const [transcriptPart, setTranscriptPart] = useState<number | null>(null);
    const activePart = job?.parts.find((part) => part.index === transcriptPart);
    const numericRate =
        rate.trim() && Number.isFinite(Number(rate)) && Number(rate) >= 0
            ? Number(rate)
            : null;
    const totalSeconds =
        job?.parts.reduce(
            (total, part) => total + (audioProcessingSeconds(part) ?? 0),
            0,
        ) ?? 0;
    const audioSeconds =
        job?.parts.reduce(
            (total, part) => total + part.endSeconds - part.startSeconds,
            0,
        ) ?? 0;
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [openPart, setOpenPart] = useState<string | null>(null);
    const completed =
        job?.parts.filter((p) => p.status === "completed").length ?? 0;
    const current = job?.parts.find((p) => p.status === "transcribing");
    if (durationMs <= 20 * 60 * 1000) {
        return (
            <section
                aria-label="Audio preparation"
                className="space-y-3 text-sm"
            >
                <p>
                    {job
                        ? labels[job.status]
                        : "The original audio is transcribed directly. No splitting needed."}
                </p>
                {(error || job?.error) && (
                    <p
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                    >
                        {error || job?.error}
                    </p>
                )}
                {job?.status === "failed" && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onRetry}
                        disabled={busy}
                    >
                        Retry transcription
                    </Button>
                )}
            </section>
        );
    }
    return (
        <section aria-label="Audio preparation" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1">
                        <h3 className="text-sm font-medium">Audio parts</h3>
                        <InfoHint label="About audio splitting">
                            Minimum part length: 5 seconds. Shorter fragments
                            are discarded. Previously saved short fragments are
                            deleted on the next processing run. The original
                            audio and full transcript are kept.
                        </InfoHint>
                    </div>
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
                <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-200 break-words"
                >
                    {error}
                </p>
            )}
            {job?.error && (
                <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3">
                    <p
                        role="alert"
                        className="text-sm text-red-800 dark:text-red-200 break-words"
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
                                <Popover.Root
                                    open={openPart === partKey}
                                    onOpenChange={(open) => {
                                        cancelClose();
                                        setOpenPart(open ? partKey : null);
                                    }}
                                >
                                    <Popover.Trigger asChild>
                                        <button
                                            type="button"
                                            onMouseEnter={() => {
                                                cancelClose();
                                                setOpenPart(partKey);
                                            }}
                                            onMouseLeave={closeSoon}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                cancelClose();
                                                setOpenPart(partKey);
                                            }}
                                            aria-label={`Part ${part.index + 1} · ${time(part.startSeconds)}–${time(part.endSeconds)} · ${partLabels[part.status]}`}
                                            className={`flex w-full h-14 cursor-pointer list-none items-center justify-center gap-2 rounded px-2 text-xs font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden ${part.status === "failed" ? "bg-destructive text-white" : part.status === "completed" ? "bg-[#e3eddf] text-[#354b32] dark:bg-[#344630] dark:text-[#dfecd9] border border-[#c8d8c2] dark:border-[#52694a]" : part.status === "transcribing" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border"}`}
                                        >
                                            {Icon && (
                                                <Icon
                                                    aria-hidden="true"
                                                    className={`size-4 shrink-0 ${part.status === "transcribing" ? "animate-spin motion-reduce:animate-none" : ""}`}
                                                />
                                            )}
                                            <span className="flex min-w-0 flex-col items-start gap-0.5">
                                                <span>
                                                    Part {part.index + 1}
                                                </span>
                                                <span className="truncate text-[11px] font-normal">
                                                    {time(
                                                        part.endSeconds -
                                                            part.startSeconds,
                                                    )}
                                                </span>
                                            </span>
                                        </button>
                                    </Popover.Trigger>
                                    <Popover.Portal>
                                        <Popover.Content
                                            side="bottom"
                                            align="start"
                                            sideOffset={6}
                                            collisionPadding={12}
                                            onOpenAutoFocus={(event) =>
                                                event.preventDefault()
                                            }
                                            onCloseAutoFocus={(event) =>
                                                event.preventDefault()
                                            }
                                            onMouseEnter={cancelClose}
                                            onMouseLeave={closeSoon}
                                            aria-label={`Details for part ${part.index + 1}`}
                                            className="z-40 w-72 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md space-y-2"
                                        >
                                            <p className="text-sm font-medium">
                                                Part {part.index + 1} ·{" "}
                                                {time(part.startSeconds)}–
                                                {time(part.endSeconds)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {partLabels[part.status]} ·{" "}
                                                {(
                                                    part.bytes /
                                                    1024 /
                                                    1024
                                                ).toFixed(2)}{" "}
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
                                            {audioProcessingSeconds(part) !==
                                                null && (
                                                <p className="text-xs text-muted-foreground">
                                                    Processing time:{" "}
                                                    {time(
                                                        audioProcessingSeconds(
                                                            part,
                                                        ) ?? 0,
                                                    )}
                                                </p>
                                            )}
                                            {numericRate !== null && (
                                                <p className="text-xs text-muted-foreground">
                                                    Estimated cost (one pass): $
                                                    {estimatedAudioCost(
                                                        part.endSeconds -
                                                            part.startSeconds,
                                                        numericRate,
                                                    ).toFixed(4)}
                                                </p>
                                            )}
                                            {part.error && (
                                                <p className="text-sm text-red-800 dark:text-red-200 break-words">
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
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setTranscriptPart(
                                                            part.index,
                                                        );
                                                        setOpenPart(null);
                                                    }}
                                                >
                                                    Open transcript for part{" "}
                                                    {part.index + 1}
                                                </Button>
                                            )}
                                        </Popover.Content>
                                    </Popover.Portal>
                                </Popover.Root>
                            </li>
                        );
                    })}
                </ol>
            )}
            {job && job.parts.length > 0 && (
                <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-1">
                        <p>
                            {totalSeconds > 0
                                ? `Saved processing time: ${time(totalSeconds)} · `
                                : ""}
                            {numericRate !== null
                                ? `Estimated total (one pass): $${estimatedAudioCost(audioSeconds, numericRate).toFixed(3)} USD`
                                : "Enter a rate to estimate cost"}
                        </p>
                        <InfoHint label="About cost estimates">
                            Indicative calculation using the editable reference
                            rate, not your provider bill. Excludes retries,
                            failed requests, storage and summaries. Applies to
                            one pass over all saved parts.
                        </InfoHint>
                    </div>
                    <details className="group/cost">
                        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                            Cost estimate settings
                            <ChevronDown
                                aria-hidden="true"
                                className="size-4 transition-transform group-open/cost:rotate-180 motion-reduce:transition-none"
                            />
                        </summary>
                        <div className="mt-2 space-y-2">
                            <label
                                htmlFor={rateId}
                                className="flex items-center gap-2"
                            >
                                Reference rate (USD / audio minute)
                                <input
                                    id={rateId}
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={rate}
                                    onChange={(event) =>
                                        setRate(event.target.value)
                                    }
                                    className="w-24 rounded border bg-background px-2 py-1 text-foreground"
                                />
                            </label>
                        </div>
                    </details>
                </div>
            )}
            <Dialog
                open={Boolean(activePart?.text)}
                onOpenChange={(open) => {
                    if (!open) setTranscriptPart(null);
                }}
            >
                <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            Transcript · Part {(activePart?.index ?? 0) + 1}
                        </DialogTitle>
                        <DialogDescription>
                            {activePart
                                ? `${time(activePart.startSeconds)}–${time(activePart.endSeconds)}`
                                : ""}{" "}
                            · Speaker labels apply to this part only.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 overflow-y-auto pr-2 text-sm leading-relaxed">
                        <SpeakerTranscript text={activePart?.text ?? ""} />
                    </div>
                </DialogContent>
            </Dialog>
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
