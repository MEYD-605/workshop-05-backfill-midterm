import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { importMirrorToDb, verifyMirrorDbParity, buildFrontendHtml } from "../lib/mirror-db";

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

describe("mirror database importer", () => {
  test("imports room and thread messages with Discord IDs and verifies parity", () => {
    const root = mkdtempSync(join(tmpdir(), "maw-atlas-mirror-"));
    try {
      const mirror = join(root, "mirror");
      const room = join(mirror, "Guild__g1", "rooms", "000_general__c1");
      const thread = join(room, "threads", "topic__t1");
      mkdirSync(thread, { recursive: true });
      writeJson(join(mirror, "manifest.json"), {
        guilds: [{ id: "g1", name: "Guild", rooms: [{ id: "c1", name: "general", threads: [{ id: "t1", name: "topic", state: "active", messages: 1 }], messages: 1 }] }],
        totals: { rooms: 1, threads: 1, messages: 2 },
      });
      writeJson(join(room, "channel.json"), { id: "c1", name: "general", type: 0 });
      writeJson(join(room, "messages.json"), [{ id: "m1", channel_id: "c1", guild_id: "g1", author: { id: "u1", username: "Nat" }, content: "hello", timestamp: "2026-01-01T00:00:00.000Z", attachments: [] }]);
      writeJson(join(thread, "thread.json"), { id: "t1", parent_id: "c1", name: "topic" });
      writeJson(join(thread, "messages.json"), [{ id: "m2", channel_id: "t1", author: { id: "u2", username: "Kikyo", bot: true }, content: "reply", timestamp: "2026-01-01T00:01:00.000Z", attachments: [{ id: "a1", url: "https://example.test/a.png" }] }]);

      const dbPath = join(root, "atlas.sqlite");
      const imported = importMirrorToDb({ mirrorDir: mirror, dbPath });
      expect(imported.totals).toEqual({ guilds: 1, rooms: 1, threads: 1, messages: 2 });

      const parity = verifyMirrorDbParity({ mirrorDir: mirror, dbPath });
      expect(parity.ok).toBe(true);
      expect(parity.expected.messages).toBe(2);
      expect(parity.actual.messages).toBe(2);
      expect(parity.missingMessageIds).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("frontend html renders guild, room, thread, and message content", () => {
    const html = buildFrontendHtml({
      generatedAt: "2026-01-01T00:00:00.000Z",
      guilds: [{ id: "g1", name: "Guild", rooms: [{ id: "c1", name: "general", messages: [{ id: "m1", author_name: "Nat", content: "hello", ts: "2026" }], threads: [{ id: "t1", name: "topic", messages: [{ id: "m2", author_name: "Kikyo", content: "reply", ts: "2026" }] }] }] }],
    } as any);
    expect(html).toContain("Guild");
    expect(html).toContain("#general");
    expect(html).toContain("🧵 topic");
    expect(html).toContain("hello");
    expect(html).toContain("reply");
  });
});
