"use client";

import { ArrowLeft } from "lucide-react";
import { AudioPartsPanel } from "@/components/dashboard/audio-parts-panel";
import { AudioProcessingSection } from "@/components/dashboard/audio-processing-section";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAudioJob } from "@/hooks/use-audio-job";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface Props {
    currentRecording: Recording | null;
    currentTranscription: TranscriptionData | undefined;
    isCurrentTranscribing: boolean;
    visibleRecordings: Recording[];
    onTranscribe: () => void;
    /** Called after a browser-side transcription completes (refresh data). */
    onTranscribeComplete?: () => void;
    onSelectRecording: (r: Recording) => void;
    onRenamed?: (filename: string) => void;
    onBackToList: () => void;
    /** When true, the pane is hidden (mobile list view active). */
    hiddenOnMobile: boolean;
    initialPlaybackSpeed: number | undefined;
    initialVolume: number | undefined;
    initialAutoPlayNext: boolean | undefined;
    scrubberStyle: "waveform" | "slider" | undefined;
}

/**
 * Right-hand detail pane: player + transcription. On lg+ this is a
 * sticky column next to the recording list; on <lg the list and
 * detail toggle via `mobileView` -- both stay mounted so scroll
 * position / search query / selection survive a back-navigation.
 *
 * Auto-advance on player ended (when `autoPlayNext` is on) moves to
 * the next recording in `visibleRecordings`; the back-affordance is
 * mobile-only because desktop has both panes visible at once.
 */
export function WorkstationDetailPane({
    currentRecording,
    currentTranscription,
    isCurrentTranscribing,
    visibleRecordings,
    onTranscribe,
    onTranscribeComplete,
    onSelectRecording,
    onRenamed,
    onBackToList,
    hiddenOnMobile,
    initialPlaybackSpeed,
    initialVolume,
    initialAutoPlayNext,
    scrubberStyle,
}: Props) {
    const audioJob = useAudioJob(
        currentRecording?.id ?? "",
        onTranscribeComplete,
    );
    return (
        <div
            className={cn(
                "space-y-6 lg:sticky lg:top-[4.5rem] lg:col-span-2 lg:block lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto lg:pr-1",
                hiddenOnMobile && "hidden",
            )}
        >
            {/*
              Mobile back affordance. Returns to the list view without
              dropping the selected recording -- reopening shows the
              same detail. Hidden on lg+ where both panes are visible
              at once.
            */}
            <Button
                variant="ghost"
                size="sm"
                onClick={onBackToList}
                className="-ml-2 h-9 gap-1 px-2 lg:hidden"
            >
                <ArrowLeft className="size-4" />
                Back to recordings
            </Button>
            {currentRecording ? (
                <>
                    <RecordingPlayer
                        recording={currentRecording}
                        initialPlaybackSpeed={initialPlaybackSpeed}
                        initialVolume={initialVolume}
                        initialAutoPlayNext={initialAutoPlayNext}
                        scrubberStyle={scrubberStyle}
                        onRenamed={onRenamed}
                        onEnded={() => {
                            const currentIndex = visibleRecordings.findIndex(
                                (r) => r.id === currentRecording.id,
                            );
                            if (
                                currentIndex >= 0 &&
                                currentIndex < visibleRecordings.length - 1
                            ) {
                                onSelectRecording(
                                    visibleRecordings[currentIndex + 1],
                                );
                            }
                        }}
                    >
                        <AudioProcessingSection
                            key={currentRecording.id}
                            summary={
                                <>
                                    Audio processing
                                    {audioJob.job &&
                                    audioJob.job.parts.length > 0 &&
                                    currentRecording.duration > 10 * 60 * 1000
                                        ? ` · ${audioJob.job.parts.filter((part) => part.status === "completed").length}/${audioJob.job.parts.length} transcribed${audioJob.job.status === "failed" ? " · Failed" : audioJob.busy ? " · In progress" : ""}`
                                        : ""}
                                </>
                            }
                        >
                            <AudioPartsPanel
                                key={currentRecording.id}
                                recordingId={currentRecording.id}
                                durationMs={currentRecording.duration}
                                job={audioJob.job}
                                busy={audioJob.busy || isCurrentTranscribing}
                                error={audioJob.error}
                                onSplit={audioJob.split}
                                onRetry={onTranscribe}
                                onRemove={audioJob.remove}
                            />
                        </AudioProcessingSection>
                    </RecordingPlayer>
                    <TranscriptionPanel
                        processingBusy={audioJob.busy}
                        processingTranscribing={
                            audioJob.busy &&
                            audioJob.job?.action === "transcribe"
                        }
                        recording={currentRecording}
                        transcription={currentTranscription}
                        isTranscribing={isCurrentTranscribing}
                        onTranscribe={onTranscribe}
                        onTranscribeComplete={onTranscribeComplete}
                    />
                </>
            ) : (
                <Card>
                    <CardContent className="py-16 text-center">
                        <p className="text-muted-foreground">
                            Select a recording to view details and transcription
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
