import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { audioJobs } from "@/db/schema";

export type AudioJob = typeof audioJobs.$inferSelect;
export const AUDIO_LEASE_MS = 120_000;

export async function claimAudioJob(): Promise<AudioJob | null> {
    const token = randomUUID();
    const claimed = await db.execute<{ id: string; user_id: string }>(sql`
        with candidate as (
            select j.id, j.user_id from audio_jobs j
            join users u on u.id = j.user_id
            join recordings r on r.id = j.recording_id and r.user_id = j.user_id
            where j.status = 'queued' and r.deleted_at is null
              and u.suspended_at is null
              and not exists (select 1 from audio_jobs active
                  where active.user_id = j.user_id and active.status in ('splitting', 'transcribing'))
            order by j.updated_at asc
            limit 1 for update of u skip locked
        )
        update audio_jobs j set claim_token = ${token},
            status = case when j.action = 'split' then 'splitting' else 'transcribing' end,
            lease_until = now() + interval '120 seconds', updated_at = now()
        from candidate c where j.id = c.id and j.user_id = c.user_id and j.status = 'queued'
        returning j.id, j.user_id
    `);
    const row = claimed[0];
    if (!row) return null;
    const [job] = await db
        .select()
        .from(audioJobs)
        .where(
            and(eq(audioJobs.id, row.id), eq(audioJobs.userId, row.user_id)),
        );
    return job ?? null;
}

export async function updateAudioJob(
    job: AudioJob,
    patch: Partial<
        Pick<
            AudioJob,
            | "status"
            | "parts"
            | "splitComplete"
            | "transcriptFingerprint"
            | "error"
            | "claimToken"
            | "leaseUntil"
        >
    >,
): Promise<void> {
    if (!job.claimToken) throw new Error("Audio job has no claim");
    const updated = await db
        .update(audioJobs)
        .set({ ...patch, updatedAt: new Date() })
        .where(
            and(
                eq(audioJobs.id, job.id),
                eq(audioJobs.userId, job.userId),
                eq(audioJobs.claimToken, job.claimToken),
                sql`exists (select 1 from recordings r where r.id = ${audioJobs.recordingId} and r.user_id = ${job.userId} and r.deleted_at is null)`,
            ),
        )
        .returning({ id: audioJobs.id });
    if (!updated.length)
        throw new Error("Audio job interrupted. Saved parts are preserved.");
    Object.assign(job, patch);
}

export async function expireAudioJobs(): Promise<void> {
    await db.execute(sql`
        update audio_jobs j set status = 'failed', claim_token = null, lease_until = null,
            error = 'Processing was interrupted. Retry to resume from saved parts.', updated_at = now()
        where j.status in ('splitting', 'transcribing') and j.lease_until < now()
          and exists (select 1 from users u where u.id = j.user_id)
    `);
}

export async function selectDeletedAudioJobs(): Promise<AudioJob[]> {
    const rows = await db.execute<{ id: string; user_id: string }>(sql`
        select j.id, j.user_id from audio_jobs j
        join recordings r on r.id = j.recording_id and r.user_id = j.user_id
        where r.deleted_at is not null and j.status not in ('splitting', 'transcribing')
        order by j.updated_at limit 10
    `);
    const jobs: AudioJob[] = [];
    for (const row of rows) {
        const [job] = await db
            .select()
            .from(audioJobs)
            .where(
                and(
                    eq(audioJobs.id, row.id),
                    eq(audioJobs.userId, row.user_id),
                ),
            );
        if (job) jobs.push(job);
    }
    return jobs;
}

export async function deleteAudioJobRow(job: AudioJob): Promise<void> {
    await db
        .delete(audioJobs)
        .where(and(eq(audioJobs.id, job.id), eq(audioJobs.userId, job.userId)));
}

export async function revokeAudioJobsForDeletion(
    userId: string,
): Promise<string[]> {
    const jobs = await db
        .update(audioJobs)
        .set({
            status: "failed",
            claimToken: null,
            leaseUntil: null,
            updatedAt: new Date(),
        })
        .where(eq(audioJobs.userId, userId))
        .returning({ parts: audioJobs.parts });
    return jobs.flatMap((job) => job.parts.map((part) => part.storageKey));
}
