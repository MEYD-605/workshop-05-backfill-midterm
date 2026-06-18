import { test, expect } from "bun:test";
import {
  openDb, upsertMessage, tombstoneMessage, checkParity,
  search, getCursor, setCursor, stats, embedText, type RawMessage,
} from "../lib/db";

function msg(id: string, content: string, author = "เมฆ"): RawMessage {
  return {
    id, guild_id: "g1", room_id: "r1", channel_id: "r1",
    author_id: "u1", author_name: author, content, timestamp: `2026-06-19T00:00:${id.padStart(2, "0")}Z`,
  };
}

test("insert + parity ok when all ids present", () => {
  const db = openDb(":memory:");
  upsertMessage(db, msg("1", "backfill discord ทั้งหมด"));
  upsertMessage(db, msg("2", "index ด้วย sqlite fts5"));
  upsertMessage(db, msg("3", "vector search แบบ hybrid"));
  const p = checkParity(db, ["1", "2", "3"]);
  expect(p.ok).toBe(true);
  expect(p.actual).toBe(3);
  expect(p.missingIds.length).toBe(0);
});

test("parity detects missing ids (verify ไม่เดา)", () => {
  const db = openDb(":memory:");
  upsertMessage(db, msg("1", "hello"));
  const p = checkParity(db, ["1", "2", "3"]);
  expect(p.ok).toBe(false);
  expect(p.missingIds).toEqual(["2", "3"]);
});

test("edit keeps history (Nothing is Deleted)", () => {
  const db = openDb(":memory:");
  expect(upsertMessage(db, msg("1", "เวอร์ชันแรก"))).toBe("inserted");
  expect(upsertMessage(db, msg("1", "เวอร์ชันแรก"))).toBe("unchanged");
  expect(upsertMessage(db, msg("1", "แก้ไขแล้ว"))).toBe("edited");
  const versions = db.query("SELECT version, content FROM edit_history WHERE message_id='1' ORDER BY version").all() as { version: number; content: string }[];
  expect(versions.length).toBe(2);
  expect(versions[0].content).toBe("เวอร์ชันแรก");
  expect(versions[1].content).toBe("แก้ไขแล้ว");
  const cur = db.query("SELECT content, version FROM messages WHERE id='1'").get() as { content: string; version: number };
  expect(cur.version).toBe(2);
});

test("tombstone hides from search but keeps row", () => {
  const db = openDb(":memory:");
  upsertMessage(db, msg("1", "ความลับ secret topic"));
  expect(search(db, "ความลับ").length).toBe(1);
  expect(tombstoneMessage(db, "1")).toBe(true);
  expect(search(db, "ความลับ").length).toBe(0);
  const row = db.query("SELECT deleted_at, content FROM messages WHERE id='1'").get() as { deleted_at: string; content: string };
  expect(row.deleted_at).not.toBeNull();
  expect(row.content).toBe("ความลับ secret topic");
});

test("hybrid search ranks exact match high", () => {
  const db = openDb(":memory:");
  upsertMessage(db, msg("1", "backfill pagination before cursor"));
  upsertMessage(db, msg("2", "อาหารกลางวันอร่อยมาก"));
  upsertMessage(db, msg("3", "vector embedding hybrid search"));
  const hits = search(db, "backfill cursor", "hybrid");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].id).toBe("1");
});

test("watermark cursor persists for incremental", () => {
  const db = openDb(":memory:");
  setCursor(db, "r1", { backfill_oldest_id: "100", live_newest_id: "200" });
  setCursor(db, "r1", { live_newest_id: "250" });
  const c = getCursor(db, "r1");
  expect(c.backfill_oldest_id).toBe("100");
  expect(c.live_newest_id).toBe("250");
});

test("embedText deterministic + normalized", () => {
  const a = embedText("hello world");
  const b = embedText("hello world");
  expect(a).toEqual(b);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  expect(Math.abs(norm - 1)).toBeLessThan(0.001);
});

test("stats counts edits and deletions", () => {
  const db = openDb(":memory:");
  upsertMessage(db, msg("1", "a"));
  upsertMessage(db, msg("2", "b"));
  upsertMessage(db, msg("1", "a-edited"));
  tombstoneMessage(db, "2");
  const s = stats(db);
  expect(s.messages).toBe(2);
  expect(s.edits).toBe(1);
  expect(s.deleted).toBe(1);
});
