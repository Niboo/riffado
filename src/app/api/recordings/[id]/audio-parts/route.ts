import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    audioJobView,
    deleteSavedAudioParts,
    enqueueAudioJob,
    getAudioJob,
} from "@/lib/transcription/audio-jobs";

type IdContext = { params: Promise<{ id: string }> };

export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);
    if (!recording)
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    const job = await getAudioJob(session.user.id, id);
    return NextResponse.json(
        { job: job ? audioJobView(job) : null },
        { headers: { "Cache-Control": "no-store" } },
    );
});

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const job = await enqueueAudioJob(session.user.id, id, "split");
    return NextResponse.json({ job: audioJobView(job) }, { status: 202 });
});

export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    await deleteSavedAudioParts(session.user.id, id);
    return NextResponse.json({ success: true });
});
