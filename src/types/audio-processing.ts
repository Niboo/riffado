export type AudioJobStatus =
    | "queued"
    | "splitting"
    | "transcribing"
    | "ready"
    | "completed"
    | "failed";

export interface AudioPart {
    index: number;
    startSeconds: number;
    endSeconds: number;
    storageKey: string;
    bytes: number;
    contentType?: "audio/ogg" | "audio/mpeg";
    status: "ready" | "transcribing" | "completed" | "failed";
    encryptedText?: string;
    error?: string;
    attempts?: number;
    startedAt?: string;
    completedAt?: string;
}

export interface AudioJobView {
    id: string;
    action: "split" | "transcribe";
    status: AudioJobStatus;
    error: string | null;
    updatedAt: string;
    parts: Array<
        Omit<AudioPart, "encryptedText" | "storageKey"> & { text?: string }
    >;
}

export function isAudioJobActive(status: AudioJobStatus): boolean {
    return (
        status === "queued" ||
        status === "splitting" ||
        status === "transcribing"
    );
}

export function audioPartFormat(
    part: Pick<AudioPart, "storageKey" | "contentType">,
): { contentType: "audio/ogg" | "audio/mpeg"; extension: "ogg" | "mp3" } {
    const opus =
        part.contentType === "audio/ogg" ||
        (!part.contentType && part.storageKey.endsWith(".ogg"));
    return opus
        ? { contentType: "audio/ogg", extension: "ogg" }
        : { contentType: "audio/mpeg", extension: "mp3" };
}
