// Parity gate + lifecycle test สำหรับ backfill (cold→edit→delete→search)
// ทุกงานเพื่อนที่ผ่านมี test ตัวนี้ — เช็คว่า idempotent + Nothing-is-Deleted จริง
import { test, expect } from "bun:test";
import { openDb, upsertMessage, counts, search, tombstone } from "./backfill";

const m = (id: string, content: string) => ({ id, channel_id: "c1", author: "tinky", author_id: "a1", content, ts: "2026-06-19T00:00:00.000Z" });

test("idempotent: รันซ้ำข้อความเดิม +0 แถว", () => {
  const db = openDb(":memory:");
  expect(upsertMessage(db, m("1", "hello world"))).toBe("new");
  expect(upsertMessage(db, m("1", "hello world"))).toBe("same"); // ซ้ำ = same
  expect(counts(db, "c1").total).toBe(1);
});

test("edit: content เปลี่ยน → version bump ไม่เพิ่มแถว", () => {
  const db = openDb(":memory:");
  upsertMessage(db, m("1", "v1"));
  expect(upsertMessage(db, m("1", "v2"))).toBe("edit");
  expect(counts(db, "c1").total).toBe(1);
  expect((db.query("SELECT version FROM messages WHERE id=?").get("1") as any).version).toBe(2);
});

test("FTS search เจอข้อความ + quote กัน punctuation crash", () => {
  const db = openDb(":memory:");
  upsertMessage(db, m("1", "สวัสดีชาวโรงเรียน hello:world"));
  expect(search(db, "hello").length).toBe(1);
  expect(() => search(db, "a:b (c)")).not.toThrow(); // punctuation ต้องไม่ crash
});

test("Nothing is Deleted: tombstone แล้วแถวยังอยู่ แต่หาย/ค้นไม่เจอ", () => {
  const db = openDb(":memory:");
  upsertMessage(db, m("1", "secret"));
  tombstone(db, "1", "2026-06-19T01:00:00.000Z");
  expect(counts(db, "c1").total).toBe(1); // ยังอยู่ (ไม่ลบจริง)
  expect(counts(db, "c1").live).toBe(0); // live=0
  expect(search(db, "secret").length).toBe(0); // ออกจาก search แล้ว
});

test("parity gate: stored == จำนวนที่ใส่จริง", () => {
  const db = openDb(":memory:");
  const N = 35;
  for (let i = 0; i < N; i++) upsertMessage(db, m(String(i), `message number ${i}`));
  expect(counts(db, "c1").total).toBe(N);
  // backfill รอบสอง (ของเดิมทั้งหมด) → ต้อง same ทั้งหมด +0 แถว
  let same = 0;
  for (let i = 0; i < N; i++) if (upsertMessage(db, m(String(i), `message number ${i}`)) === "same") same++;
  expect(same).toBe(N);
  expect(counts(db, "c1").total).toBe(N);
});
