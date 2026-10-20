import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import * as schema from "@/db/schema";

const holder = vi.hoisted(() => ({
    db: null as PostgresJsDatabase<typeof schema> | null,
}));
vi.mock("@/db", () => ({
    get db() {
        return holder.db;
    },
}));
vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        exists: vi.fn().mockResolvedValue(true),
        deleteFile: vi.fn().mockResolvedValue(undefined),
    }),
}));
vi.mock("@/lib/env", () => ({ env: { ENCRYPTION_KEY: "ab".repeat(32) } }));

import {
    claimAudioJob,
    expireAudioJobs,
    selectDeletedAudioJobs,
    updateAudioJob,
} from "@/db/queries/audio-jobs";
import { encryptText } from "@/lib/encryption/fields";
import {
    audioJobView,
    deleteSavedAudioParts,
    enqueueAudioJob,
    getAudioJob,
} from "@/lib/transcription/audio-jobs";

const socket = process.env.AUDIO_JOB_TEST_DB_SOCKET;

describe.runIf(socket?.startsWith("/tmp/"))(
    "durable audio jobs (isolated PostgreSQL)",
    () => {
        let client: ReturnType<typeof postgres>;
        let db: PostgresJsDatabase<typeof schema>;
        beforeAll(async () => {
            client = postgres({
                host: socket,
                port: 55439,
                username: "riffado_test",
                database: "postgres",
                max: 5,
            });
            db = drizzle(client, { schema });
            holder.db = db;
            await client`drop table if exists audio_jobs`;
            const migration = await readFile(
                new URL(
                    "../db/migrations/0039_sparkling_morlun.sql",
                    import.meta.url,
                ),
                "utf8",
            );
            await client.unsafe(migration);
        });
        afterAll(async () => {
            await client?.end();
        });
        beforeEach(async () => {
            await client`truncate audio_jobs, recordings, users cascade`;
            await db.insert(schema.users).values([
                { id: "u1", email: "one@example.test" },
                { id: "u2", email: "two@example.test" },
            ]);
            for (const [id, userId] of [
                ["r1", "u1"],
                ["r2", "u2"],
                ["r3", "u1"],
            ]) {
                await db.insert(schema.recordings).values({
                    id,
                    userId,
                    deviceSn: "test",
                    plaudFileId: id,
                    filename: "Meeting",
                    duration: 8_196_000,
                    startTime: new Date(),
                    endTime: new Date(),
                    filesize: 1024,
                    fileMd5: "test",
                    storageType: "local",
                    storagePath: `${id}.mp3`,
                    plaudVersion: "1",
                });
            }
        });
        it("queues idempotently and refuses another user's recording", async () => {
            const [a, b] = await Promise.all([
                enqueueAudioJob("u1", "r1", "split"),
                enqueueAudioJob("u1", "r1", "split"),
            ]);
            expect(a.id).toBe(b.id);
            expect((await db.select().from(schema.audioJobs)).length).toBe(1);
            await expect(enqueueAudioJob("u2", "r1", "split")).rejects.toThrow(
                "Recording not found",
            );
            expect(await getAudioJob("u2", "r1")).toBeNull();
        });
        it("claims concurrent work once, with at most one running job per user", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            await enqueueAudioJob("u1", "r3", "split");
            await enqueueAudioJob("u2", "r2", "split");
            await Promise.all([
                claimAudioJob(),
                claimAudioJob(),
                claimAudioJob(),
            ]);
            const active = await db
                .select()
                .from(schema.audioJobs)
                .where(eq(schema.audioJobs.status, "splitting"));
            expect(active).toHaveLength(2);
            expect(new Set(active.map((j) => j.userId)).size).toBe(2);
        });
        it("expires a dead claim without losing saved parts or allowing its old worker to write", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            const job = await claimAudioJob();
            if (!job) throw new Error("missing claim");
            const part = {
                index: 0,
                startSeconds: 0,
                endSeconds: 1199,
                storageKey: "private/path",
                bytes: 20,
                status: "completed" as const,
                encryptedText: encryptText("Saved words"),
            };
            await updateAudioJob(job, {
                parts: [part],
                leaseUntil: new Date(0),
            });
            await expireAudioJobs();
            const failed = await getAudioJob("u1", "r1");
            expect(failed?.status).toBe("failed");
            expect(failed?.parts).toEqual([part]);
            await expect(
                updateAudioJob(job, { status: "completed" }),
            ).rejects.toThrow("interrupted");
            const resumed = await enqueueAudioJob("u1", "r1", "transcribe");
            expect(resumed.parts).toEqual([part]);
            const view = audioJobView(resumed);
            expect(view.parts[0].text).toBe("Saved words");
            expect(JSON.stringify(view)).not.toContain("private/path");
            expect(JSON.stringify(view)).not.toContain("encryptedText");
        });
        it("does not overwrite another user's job even with a valid claim token", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            const job = await claimAudioJob();
            if (!job) throw new Error("missing claim");
            await expect(
                updateAudioJob(
                    { ...job, userId: "u2" },
                    { status: "completed" },
                ),
            ).rejects.toThrow("interrupted");
            expect((await getAudioJob("u1", "r1"))?.status).toBe("splitting");
        });
        it("keeps prepared audio when explicitly retranscribing a completed recording", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            const job = await claimAudioJob();
            if (!job) throw new Error("missing claim");
            await updateAudioJob(job, {
                splitComplete: true,
                parts: [
                    {
                        index: 0,
                        startSeconds: 0,
                        endSeconds: 10,
                        bytes: 10,
                        storageKey: "audio",
                        status: "completed",
                        encryptedText: encryptText("old"),
                    },
                ],
                status: "completed",
                claimToken: null,
                leaseUntil: null,
            });
            const queued = await enqueueAudioJob("u1", "r1", "transcribe");
            expect(queued.splitComplete).toBe(true);
            expect(queued.parts[0].storageKey).toBe("audio");
            expect(queued.parts[0].encryptedText).toBeUndefined();
        });
        it("rejects stale audio parts if the original audio changed", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            const job = await claimAudioJob();
            if (!job) throw new Error("missing claim");
            await updateAudioJob(job, {
                status: "ready",
                claimToken: null,
                leaseUntil: null,
            });
            await db
                .update(schema.recordings)
                .set({ fileMd5: "changed" })
                .where(
                    and(
                        eq(schema.recordings.id, "r1"),
                        eq(schema.recordings.userId, "u1"),
                    ),
                );
            await expect(enqueueAudioJob("u1", "r1", "split")).rejects.toThrow(
                "original audio has changed",
            );
        });
        it("finds saved parts for cleanup after their parent recording is deleted", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            await db
                .update(schema.recordings)
                .set({ deletedAt: new Date() })
                .where(
                    and(
                        eq(schema.recordings.id, "r1"),
                        eq(schema.recordings.userId, "u1"),
                    ),
                );
            expect(await claimAudioJob()).toBeNull();
            const cleanup = await selectDeletedAudioJobs();
            expect(cleanup).toHaveLength(1);
            expect(cleanup[0].recordingId).toBe("r1");
        });
        it("protects active jobs from removal and leaves the original intact when clearing idle parts", async () => {
            await enqueueAudioJob("u1", "r1", "split");
            await expect(deleteSavedAudioParts("u1", "r1")).rejects.toThrow(
                "Wait for audio processing",
            );
            const job = await claimAudioJob();
            if (!job) throw new Error("missing claim");
            await updateAudioJob(job, {
                status: "ready",
                claimToken: null,
                leaseUntil: null,
            });
            await expect(deleteSavedAudioParts("u2", "r1")).rejects.toThrow(
                "Recording not found",
            );
            await deleteSavedAudioParts("u1", "r1");
            expect(await getAudioJob("u1", "r1")).toBeNull();
            expect(
                (
                    await db
                        .select()
                        .from(schema.recordings)
                        .where(eq(schema.recordings.id, "r1"))
                ).length,
            ).toBe(1);
        });
    },
);
