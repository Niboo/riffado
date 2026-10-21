import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    writes: [] as Array<Record<string, unknown>>,
    rows: [] as unknown[][],
}));
vi.mock("@/db", () => ({ db: { transaction: mock.transaction } }));
vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));
vi.mock("@/lib/posthog-server", () => ({ captureServerException: vi.fn() }));
vi.mock("@/lib/encryption/fields", () => ({
    encryptText: (text: string) => `encrypted:${text}`,
    decryptText: (text: string) => text.replace(/^encrypted:/, ""),
}));

import { PATCH } from "@/app/api/recordings/[id]/speakers/route";
import { requireApiSession } from "@/lib/auth-server";

const original = "Speaker 1: Bonjour.\nSpeaker 2: Salut.";
const request = (body: unknown) =>
    new Request("http://localhost/api/recordings/rec/speakers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
const body = {
    source: "riffado",
    expectedText: original,
    names: { "Speaker 1": "Sam" },
};
const context = { params: Promise.resolve({ id: "rec" }) };
beforeEach(() => {
    vi.clearAllMocks();
    mock.writes = [];
    mock.rows = [
        [{ id: "rec" }],
        [
            {
                id: "job",
                status: "completed",
                parts: [{ encryptedText: `encrypted:${original}` }],
            },
        ],
        [{ id: "transcript", text: `encrypted:${original}` }],
    ];
    mock.select.mockImplementation(() => ({
        from: () => ({
            where: () => ({
                for: () => ({ limit: async () => mock.rows.shift() ?? [] }),
            }),
        }),
    }));
    mock.update.mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
            mock.writes.push(values);
            return { where: async () => {} };
        },
    }));
    mock.transaction.mockImplementation((fn) =>
        fn({ select: mock.select, update: mock.update }),
    );
});
it("saves encrypted names in the full transcript and saved partial results", async () => {
    const response = await PATCH(request(body), context);
    expect(response.status).toBe(200);
    expect(requireApiSession).toHaveBeenCalled();
    expect(mock.writes[0]).toEqual({
        text: "encrypted:Speaker 1 (Sam): Bonjour.\nSpeaker 2: Salut.",
    });
    expect(mock.writes[1]).toMatchObject({
        parts: [
            {
                encryptedText:
                    "encrypted:Speaker 1 (Sam): Bonjour.\nSpeaker 2: Salut.",
            },
        ],
    });
});
it("rejects inaccessible recordings without writing", async () => {
    mock.rows = [[]];
    expect((await PATCH(request(body), context)).status).toBe(404);
    expect(mock.update).not.toHaveBeenCalled();
});
it("rejects active jobs and stale transcripts without overwriting results", async () => {
    mock.rows = [[{ id: "rec" }], [{ status: "transcribing" }]];
    expect((await PATCH(request(body), context)).status).toBe(409);
    expect(mock.update).not.toHaveBeenCalled();
    mock.rows = [
        [{ id: "rec" }],
        [],
        [{ id: "t", text: "encrypted:New content" }],
    ];
    expect((await PATCH(request(body), context)).status).toBe(409);
    expect(mock.update).not.toHaveBeenCalled();
});
it("rejects malformed names before opening a transaction", async () => {
    expect(
        (
            await PATCH(
                request({
                    ...body,
                    names: { "Speaker 1": "Sam\nSpeaker 2: injected" },
                }),
                context,
            )
        ).status,
    ).toBe(400);
    expect(mock.transaction).not.toHaveBeenCalled();
});
