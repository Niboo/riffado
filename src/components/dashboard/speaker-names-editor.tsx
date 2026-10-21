"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { transcriptSpeakers } from "@/lib/transcription/speaker-names";

export function SpeakerNamesEditor({
    recordingId,
    source,
    text,
    disabled,
    onSaved,
}: {
    recordingId: string;
    source: string;
    text: string;
    disabled: boolean;
    onSaved: (text: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [names, setNames] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const speakers = transcriptSpeakers(text);
    if (!Object.keys(speakers).length) return null;
    const save = async () => {
        setSaving(true);
        setError("");
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/speakers`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ source, names, expectedText: text }),
                },
            );
            const data = await response.json();
            if (!response.ok)
                throw new Error(data.error || "Could not save speaker names");
            onSaved(data.text);
            setOpen(false);
        } catch (error) {
            setError(
                error instanceof Error
                    ? error.message
                    : "Could not save speaker names",
            );
        } finally {
            setSaving(false);
        }
    };
    return (
        <>
            <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                    setNames(speakers);
                    setError("");
                    setOpen(true);
                }}
            >
                <Users className="size-4 mr-2" />
                Name speakers
            </Button>
            <Dialog
                open={open}
                onOpenChange={(value) => {
                    if (!saving) setOpen(value);
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Name speakers</DialogTitle>
                        <DialogDescription>
                            Replace each speaker label throughout this
                            transcript and its saved parts. Matching labels
                            across parts may refer to different people; verify
                            them before assigning names.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[50vh] overflow-y-auto space-y-3">
                        {Object.keys(speakers).map((speaker) => (
                            <label
                                key={speaker}
                                className="grid grid-cols-[7rem_1fr] items-center gap-3 text-sm"
                            >
                                <span>{speaker}</span>
                                <input
                                    aria-label={`Name for ${speaker}`}
                                    value={names[speaker] ?? ""}
                                    onChange={(event) =>
                                        setNames({
                                            ...names,
                                            [speaker]: event.target.value,
                                        })
                                    }
                                    placeholder="Name"
                                    maxLength={80}
                                    disabled={saving}
                                    className="h-10 min-w-0 rounded-md border bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring"
                                />
                            </label>
                        ))}
                    </div>
                    {error && (
                        <p
                            role="alert"
                            className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200"
                        >
                            {error}
                        </p>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            disabled={saving}
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button disabled={saving} onClick={save}>
                            {saving ? "Saving…" : "Save names"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
