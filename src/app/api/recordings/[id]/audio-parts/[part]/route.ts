import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { getAudioJob } from "@/lib/transcription/audio-jobs";
import { audioPartFormat } from "@/types/audio-processing";

type PartContext = { params: Promise<{ id: string; part: string }> };

export const GET = apiHandler<PartContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id, part } = await (context as PartContext).params;
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
    const job = recording ? await getAudioJob(session.user.id, id) : null;
    const audio = /^\d+$/.test(part)
        ? job?.parts.find((p) => p.index === Number(part))
        : undefined;
    if (!audio)
        throw new AppError(ErrorCode.NOT_FOUND, "Audio part not found", 404);
    const storage = await createUserStorageProvider(session.user.id);
    const stream = await storage.downloadStream(audio.storageKey);
    const format = audioPartFormat(audio);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
            "Content-Type": format.contentType,
            "Content-Length": String(audio.bytes),
            "Cache-Control": "private, no-store",
            "Content-Disposition": `${new URL(request.url).searchParams.has("download") ? "attachment" : "inline"}; filename="part-${audio.index + 1}.${format.extension}"`,
        },
    });
});
