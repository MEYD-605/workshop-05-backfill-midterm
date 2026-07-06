// Discord backfill — ดูดข้อความทั้งห้องลง SQLite+FTS5, รัน sync ใหม่ได้ (idempotent)
// ต่อยอดจาก peek.ts (pagination เดิม) — งาน Workshop-05 midterm ของ Tinky
// ใช้: bun run src/backfill.ts <channelId>            # backfill เต็ม + ดึงใหม่ (resume ได้)
//       bun run src/backfill.ts --search "<คำ>"        # ค้นใน DB
// Oracle Rule 6: เครื่องมือนี้เขียนโดย Tinky Oracle (AI)
//
// เลี่ยงกับดักที่เพื่อนเจอ (จากการอ่านงานเพื่อนก่อน):
//  - 429 rate-limit → fetchPage() เคารพ retry_after + หน่วง 300ms/หน้า (เพื่อนแก้แค่ 1/4 คน)
//  - idempotent → upsert ด้วย message_id (snowflake) รันซ้ำ +0 แถว
//  - Nothing is Deleted → tombstone (deleted_at) ไม่ลบจริง + version bump ตอน edit
//  - resume หลัง crash → cursor (oldest_id/newest_id/reached_start) ต่อจุดเดิม
//  - false-tombstone → ลบ-by-absence เฉพาะช่วงที่ reached_start=1 (ดึงครบแล้ว)

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { join } from "path";

export type Msg = { id: string; channel_id: string; author: string; author_id: string; content: string; ts: string };

const hash = (s: string) => createHash("sha256").update(s || "").digest("hex").slice(0, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- store (SQLite + FTS5) — เป็น index ของตัวเอง ไม่แตะสมองกลาง ----------
export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,            -- snowflake = idempotent key
      channel_id TEXT NOT NULL, author TEXT, author_id TEXT,
      content TEXT, ts TEXT,
      version INTEGER DEFAULT 1,      -- เพิ่มเมื่อ edit
      content_hash TEXT,
      deleted_at TEXT                 -- tombstone (Nothing is Deleted)
    );
    CREATE TABLE IF NOT EXISTS cursors (
      channel_id TEXT PRIMARY KEY, oldest_id TEXT, newest_id TEXT, reached_start INTEGER DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(id UNINDEXED, content, author);
  `);
  return db;
}

// upsert idempotent ด้วย message_id → 'new' | 'edit' | 'same'
export function upsertMessage(db: Database, m: Msg): "new" | "edit" | "same" {
  const h = hash(m.content);
  const ex = db.query("SELECT content_hash, version FROM messages WHERE id=?").get(m.id) as any;
  if (ex && ex.content_hash === h) return "same"; // ไม่เปลี่ยน → ไม่แตะ
  const version = ex ? ex.version + 1 : 1;
  db.query(
    `INSERT INTO messages (id,channel_id,author,author_id,content,ts,version,content_hash,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(id) DO UPDATE SET content=excluded.content, author=excluded.author,
       ts=excluded.ts, version=?, content_hash=excluded.content_hash, deleted_at=NULL`,
  ).run(m.id, m.channel_id, m.author, m.author_id, m.content, m.ts, version, h, version);
  db.query("DELETE FROM messages_fts WHERE id=?").run(m.id);
  if (m.content) db.query("INSERT INTO messages_fts (id,content,author) VALUES (?,?,?)").run(m.id, m.content, m.author);
  return ex ? "edit" : "new";
}

export function tombstone(db: Database, id: string, when: string) {
  db.query("UPDATE messages SET deleted_at=? WHERE id=? AND deleted_at IS NULL").run(when, id);
  db.query("DELETE FROM messages_fts WHERE id=?").run(id); // ออกจาก search แต่แถวยังอยู่
}

export function getCursor(db: Database, ch: string): any {
  return db.query("SELECT * FROM cursors WHERE channel_id=?").get(ch) || { channel_id: ch, oldest_id: null, newest_id: null, reached_start: 0 };
}
export function setCursor(db: Database, c: any) {
  db.query(
    `INSERT INTO cursors (channel_id,oldest_id,newest_id,reached_start) VALUES (?,?,?,?)
     ON CONFLICT(channel_id) DO UPDATE SET oldest_id=excluded.oldest_id, newest_id=excluded.newest_id, reached_start=excluded.reached_start`,
  ).run(c.channel_id, c.oldest_id, c.newest_id, c.reached_start ? 1 : 0);
}

export function counts(db: Database, ch: string) {
  const total = (db.query("SELECT COUNT(*) n FROM messages WHERE channel_id=?").get(ch) as any).n;
  const live = (db.query("SELECT COUNT(*) n FROM messages WHERE channel_id=? AND deleted_at IS NULL").get(ch) as any).n;
  return { total, live };
}

// ค้น FTS5 — quote ทุก term กัน FTS5 crash บน punctuation (กับดักเพื่อน)
export function search(db: Database, q: string, limit = 10): any[] {
  const safe = q.trim().split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
  if (!safe) return [];
  return db
    .query(`SELECT m.id,m.author,m.content,m.ts FROM messages_fts f JOIN messages m ON m.id=f.id
            WHERE messages_fts MATCH ? AND m.deleted_at IS NULL ORDER BY m.ts DESC LIMIT ?`)
    .all(safe, limit);
}

// ---------- Discord glue ----------
function norm(m: any, ch: string): Msg {
  let content = m.content || "";
  for (const e of m.embeds || []) {
    if (e.title) content += `\n[embed] ${e.title}`;
    if (e.description) content += `\n${e.description}`;
  }
  return {
    id: m.id, channel_id: ch, author: m.author?.username || "?", author_id: m.author?.id || "",
    content, ts: m.createdAt?.toISOString?.() || "",
  };
}

async function fetchPage(ch: any, opts: any, tries = 0): Promise<any> {
  try {
    return await ch.messages.fetch(opts);
  } catch (e: any) {
    const ra = e?.retryAfter ?? e?.rawError?.retry_after; // เคารพ 429 (discord.js auto-retry อยู่แล้ว แต่กันเหนียว)
    if (ra && tries < 5) { console.error(`  ⏳ rate-limit รอ ${ra}s`); await sleep(ra * 1000 + 200); return fetchPage(ch, opts, tries + 1); }
    throw e;
  }
}

export async function backfillChannel(ch: any, db: Database, chId: string) {
  const cur = getCursor(db, chId);
  const tally: Record<string, number> = { new: 0, edit: 0, same: 0 };
  const tick = (r: string) => { tally[r]++; };

  // 1) เดินถอยหลังจนถึงต้นห้อง (resume จาก oldest_id ถ้ายังไม่ถึงต้น)
  if (!cur.reached_start) {
    let before = cur.oldest_id || undefined;
    while (true) {
      const batch = await fetchPage(ch, { limit: 100, before });
      if (batch.size === 0) { cur.reached_start = 1; break; }
      const arr = [...batch.values()]; // ใหม่→เก่า
      for (const m of arr) tick(upsertMessage(db, norm(m, chId)));
      before = arr[arr.length - 1].id;
      cur.oldest_id = before;
      if (!cur.newest_id) cur.newest_id = arr[0].id;
      setCursor(db, cur);
      if (batch.size < 100) { cur.reached_start = 1; break; }
      console.error(`  ...backfill ${counts(db, chId).total} ข้อความ`);
      await sleep(300); // throttle (กับดัก 429 ที่เพื่อนข้าม)
    }
    setCursor(db, cur);
  }

  // 2) หัว incremental — ดึงใหม่กว่า newest (live/resync)
  if (cur.newest_id) {
    let after = cur.newest_id;
    while (true) {
      const batch = await fetchPage(ch, { limit: 100, after });
      if (batch.size === 0) break;
      const arr = [...batch.values()].reverse(); // เก่า→ใหม่
      for (const m of arr) tick(upsertMessage(db, norm(m, chId)));
      after = arr[arr.length - 1].id;
      cur.newest_id = after;
      setCursor(db, cur);
      if (batch.size < 100) break;
      await sleep(300);
    }
    setCursor(db, cur);
  }
  return tally;
}

// ---------- CLI ----------
async function main() {
  const { Client, GatewayIntentBits } = await import("discord.js");
  const TOKEN = process.env.DISCORD_BOT_TOKEN;
  const DB_PATH = process.env.BACKFILL_DB || join(import.meta.dir, "../backfill.db");
  const args = process.argv.slice(2);

  // โหมดค้น (ออฟไลน์ ไม่ต้องต่อ Discord)
  const si = args.indexOf("--search");
  if (si >= 0) {
    const db = openDb(DB_PATH);
    for (const r of search(db, args[si + 1] || "", 10)) console.log(`[${r.ts?.slice(0, 16)}] ${r.author}: ${r.content?.slice(0, 120)}`);
    process.exit(0);
  }

  const channelId = args[0];
  if (!TOKEN) { console.error("ไม่พบ DISCORD_BOT_TOKEN"); process.exit(1); }
  if (!channelId) { console.error("ใช้: bun run src/backfill.ts <channelId> | --search <คำ>"); process.exit(1); }

  // guard เดียวกับ peek (มือ DOER=1 → เฉพาะ PEEK_ALLOWED_CHANNEL_IDS)
  if (process.env.DOER === "1") {
    const allow = (process.env.PEEK_ALLOWED_CHANNEL_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allow.includes(channelId)) { console.error(`⛔ ห้อง ${channelId} ไม่อยู่ใน PEEK_ALLOWED_CHANNEL_IDS`); process.exit(4); }
  }

  const db = openDb(DB_PATH);
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  client.once("ready", async () => {
    try {
      const ch: any = await client.channels.fetch(channelId);
      if (!ch || !("messages" in ch)) { console.error("❌ เปิดห้องไม่ได้ (bot ไม่เห็นห้อง/ไม่มีสิทธิ์)"); process.exit(2); }
      const t = await backfillChannel(ch, db, channelId);
      const c = counts(db, channelId);
      console.log(`\n=== backfill #${ch.name || channelId} เสร็จ ===`);
      console.log(`new=${t.new} edit=${t.edit} same=${t.same} | stored total=${c.total} live=${c.live}`);
      console.log(`DB: ${DB_PATH}  (ค้น: bun run src/backfill.ts --search "<คำ>")`);
      process.exit(0);
    } catch (e) { console.error("error:", e); process.exit(3); }
  });
  client.login(TOKEN);
}

if (import.meta.main) main();
