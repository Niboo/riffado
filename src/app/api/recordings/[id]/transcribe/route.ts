import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";
import { audioJobView, enqueueAudioJob } from "@/lib/transcription/audio-jobs";

type IdContext = { params: Promise<{ id: string }> };

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);
    const { id } = await (context as IdContext).params;
    const body: unknown = await request.json().catch(() => null);
    const options =
        body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
    const job = await enqueueAudioJob(session.user.id, id, "transcribe", {
        providerId:
            typeof options.providerId === "string"
                ? options.providerId
                : undefined,
        model: typeof options.model === "string" ? options.model : undefined,
    });
    return NextResponse.json({ job: audioJobView(job) }, { status: 202 });
});
