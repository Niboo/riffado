import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { audioJobs, recordings, transcriptions } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decryptText, encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    renameTranscriptSpeakers,
    transcriptSpeakers,
} from "@/lib/transcription/speaker-names";
import { isAudioJobActive } from "@/types/audio-processing";

type Context = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Context>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as Context).params;
    const body = await request.json().catch(() => null);
    if (
        !body ||
        !["riffado", "plaud", "mixed"].includes(body.source) ||
        typeof body.expectedText !== "string" ||
        !body.names ||
        typeof body.names !== "object" ||
        Array.isArray(body.names) ||
        Object.keys(body.names).length > 32 ||
        Object.entries(body.names).some(
            ([key, name]) =>
                !/^(Speaker\s+\w+|SPEAKER_\w+|UNKNOWN)$/.test(key) ||
                typeof name !== "string" ||
                name.length > 80 ||
                /[()\r\n]/.test(name) ||
                [...name].some((char) => char.charCodeAt(0) < 32),
        )
    ) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Invalid speaker names",
            400,
        );
    }
    const names = body.names as Record<string, string>;
    const text = await db.transaction(async (tx) => {
        const [recording] = await tx
            .select({ id: recordings.id })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .for("update")
            .limit(1);
        if (!recording)
            throw new AppError(
                ErrorCode.RECORDING_NOT_FOUND,
                "Recording not found",
                404,
            );
        const [job] = await tx
            .select()
            .from(audioJobs)
            .where(
                and(
                    eq(audioJobs.recordingId, id),
                    eq(audioJobs.userId, session.user.id),
                ),
            )
            .for("update")
            .limit(1);
        if (job && isAudioJobActive(job.status))
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Wait for transcription to finish before renaming speakers",
                409,
            );
        const [transcript] = await tx
            .select()
            .from(transcriptions)
            .where(
                and(
                    eq(transcriptions.recordingId, id),
                    eq(transcriptions.userId, session.user.id),
                    eq(transcriptions.source, body.source),
                ),
            )
            .for("update")
            .limit(1);
        if (!transcript)
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Transcript not found",
                404,
            );
        const previous = decryptText(transcript.text);
        if (previous !== body.expectedText)
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "The transcript changed. Refresh before renaming speakers.",
                409,
            );
        const speakers = transcriptSpeakers(previous);
        if (Object.keys(names).some((key) => !Object.hasOwn(speakers, key)))
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "Unknown speaker label",
                400,
            );
        const renamed = renameTranscriptSpeakers(previous, names);
        await tx
            .update(transcriptions)
            .set({ text: encryptText(renamed) })
            .where(
                and(
                    eq(transcriptions.id, transcript.id),
                    eq(transcriptions.userId, session.user.id),
                ),
            );
        if (job && body.source === "riffado") {
            const parts = job.parts.map((part) =>
                part.encryptedText === undefined
                    ? part
                    : {
                          ...part,
                          encryptedText: encryptText(
                              renameTranscriptSpeakers(
                                  decryptText(part.encryptedText),
                                  names,
                              ),
                          ),
                      },
            );
            await tx
                .update(audioJobs)
                .set({ parts, updatedAt: new Date() })
                .where(
                    and(
                        eq(audioJobs.id, job.id),
                        eq(audioJobs.userId, session.user.id),
                    ),
                );
        }
        await tx
            .update(recordings)
            .set({ updatedAt: new Date() })
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            );
        return renamed;
    });
    return NextResponse.json({ text });
});
