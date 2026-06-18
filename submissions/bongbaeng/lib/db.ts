// db.ts — bongbaeng backfill core (bun:sqlite)
// design v3: source-of-truth SQLite + parity + edit_history(Nothing is Deleted)
//           + watermark(incremental) + FTS5 + hashed-vector hybrid search
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

// --- typed shapes (no any/unknown ตามกฎพี่นัท) ---
export interface RawMessage {
  id: string;
  guild_id: string;
  room_id: string;
  thread_id?: string | null;
  channel_id: string;
  author_id?: string | null;
  author_name?: string | null;
  author_is_bot?: boolean;
  content?: string | null;
  timestamp?: string | null;
  edited_timestamp?: string | null;
  attachments?: { id: string; filename: string; size: number; url?: string }[];
}
export interface ParityResult {
  ok: boolean;
  expected: number;
  actual: number;
  missingIds: string[];
}
export interface SearchHit {
  id: string;
  room_id: string;
  thread_id: string | null;
  author_name: string | null;
  content: string | null;
  timestamp: string | null;
  score: number;
  ftsScore: number;
  vectorScore: number;
}

const DIMS = 96;
const FUSE_FTS = 0.65;
const FUSE_VEC = 0.35;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL, room_id TEXT NOT NULL, thread_id TEXT, channel_id TEXT NOT NULL,
  author_id TEXT, author_name TEXT, author_is_bot INTEGER NOT NULL DEFAULT 0,
  content TEXT, timestamp TEXT, edited_timestamp TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  raw_json TEXT NOT NULL, ingested_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'backfill'
);
CREATE TABLE IF NOT EXISTS edit_history (
  message_id TEXT NOT NULL, version INTEGER NOT NULL,
  content TEXT, edited_timestamp TEXT, captured_at TEXT NOT NULL,
  PRIMARY KEY (message_id, version)
);
CREATE TABLE IF NOT EXISTS cursors (
  channel_id TEXT PRIMARY KEY,
  backfill_oldest_id TEXT, live_newest_id TEXT, last_swept_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_room ON messages(room_id, timestamp, id);
CREATE INDEX IF NOT EXISTS idx_msg_author ON messages(author_id);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED, author_name, content, tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS message_vectors (
  message_id TEXT PRIMARY KEY, dims INTEGER NOT NULL, embedding_json TEXT NOT NULL
);
`;

export function openDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return db;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}_#@:-]+/gu) || [];
}
function hashToken(token: string): number {
  let h = 2166136261;
  for (const ch of token) { h ^= ch.codePointAt(0) || 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function embedText(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const t of tokenize(text)) { const h = hashToken(t); v[h % DIMS] += (h & 1) ? 1 : -1; }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
}
function dot(a: number[], b: number[]): number {
  let s = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function upsertMessage(db: Database, m: RawMessage, source = "backfill"): "inserted" | "edited" | "unchanged" {
  const now = new Date().toISOString();
  const existing = db.query("SELECT content, version FROM messages WHERE id = ?").get(m.id) as
    | { content: string | null; version: number }
    | null;
  const content = m.content ?? null;

  if (!existing) {
    db.query(
      `INSERT INTO messages (id,guild_id,room_id,thread_id,channel_id,author_id,author_name,author_is_bot,content,timestamp,edited_timestamp,version,raw_json,ingested_at,source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    ).run(
      m.id, m.guild_id, m.room_id, m.thread_id ?? null, m.channel_id,
      m.author_id ?? null, m.author_name ?? null, m.author_is_bot ? 1 : 0,
      content, m.timestamp ?? null, m.edited_timestamp ?? null,
      JSON.stringify(m), now, source,
    );
    db.query("INSERT INTO edit_history (message_id,version,content,edited_timestamp,captured_at) VALUES (?,1,?,?,?)").run(
      m.id, content, m.edited_timestamp ?? null, now,
    );
    indexMessage(db, m.id, m.author_name ?? "", content ?? "");
    return "inserted";
  }

  if (existing.content === content) return "unchanged";

  const nextVer = existing.version + 1;
  db.query("UPDATE messages SET content=?, edited_timestamp=?, version=?, raw_json=?, source=? WHERE id=?").run(
    content, m.edited_timestamp ?? null, nextVer, JSON.stringify(m), source, m.id,
  );
  db.query("INSERT INTO edit_history (message_id,version,content,edited_timestamp,captured_at) VALUES (?,?,?,?,?)").run(
    m.id, nextVer, content, m.edited_timestamp ?? null, now,
  );
  reindexMessage(db, m.id, m.author_name ?? "", content ?? "");
  return "edited";
}

export function tombstoneMessage(db: Database, messageId: string): boolean {
  const now = new Date().toISOString();
  const r = db.query("UPDATE messages SET deleted_at=? WHERE id=? AND deleted_at IS NULL").run(now, messageId);
  return r.changes > 0;
}

function indexMessage(db: Database, id: string, author: string, content: string): void {
  db.query("INSERT INTO messages_fts (message_id,author_name,content) VALUES (?,?,?)").run(id, author, content);
  db.query("INSERT OR REPLACE INTO message_vectors (message_id,dims,embedding_json) VALUES (?,?,?)").run(
    id, DIMS, JSON.stringify(embedText(`${author} ${content}`)),
  );
}
function reindexMessage(db: Database, id: string, author: string, content: string): void {
  db.query("DELETE FROM messages_fts WHERE message_id=?").run(id);
  indexMessage(db, id, author, content);
}

export function checkParity(db: Database, expectedIds: string[]): ParityResult {
  const actual = (db.query("SELECT COUNT(*) c FROM messages").get() as { c: number }).c;
  const have = new Set((db.query("SELECT id FROM messages").all() as { id: string }[]).map((r) => r.id));
  const missing = expectedIds.filter((id) => !have.has(id));
  return { ok: missing.length === 0 && actual >= expectedIds.length, expected: expectedIds.length, actual, missingIds: missing };
}

export function getCursor(db: Database, channelId: string): { backfill_oldest_id: string | null; live_newest_id: string | null } {
  const r = db.query("SELECT backfill_oldest_id, live_newest_id FROM cursors WHERE channel_id=?").get(channelId) as
    | { backfill_oldest_id: string | null; live_newest_id: string | null }
    | null;
  return r ?? { backfill_oldest_id: null, live_newest_id: null };
}
export function setCursor(db: Database, channelId: string, patch: { backfill_oldest_id?: string; live_newest_id?: string }): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO cursors (channel_id,backfill_oldest_id,live_newest_id,last_swept_at) VALUES (?,?,?,?)
     ON CONFLICT(channel_id) DO UPDATE SET
       backfill_oldest_id=COALESCE(excluded.backfill_oldest_id,backfill_oldest_id),
       live_newest_id=COALESCE(excluded.live_newest_id,live_newest_id),
       last_swept_at=excluded.last_swept_at`,
  ).run(channelId, patch.backfill_oldest_id ?? null, patch.live_newest_id ?? null, now);
}

export function search(db: Database, query: string, mode: "fts" | "vector" | "hybrid" = "hybrid", limit = 12): SearchHit[] {
  const qv = embedText(query);
  const byId = new Map<string, SearchHit>();

  if (mode !== "vector") {
    const rows = db.query(
      `SELECT m.id,m.room_id,m.thread_id,m.author_name,m.content,m.timestamp, bm25(messages_fts) rank
       FROM messages_fts JOIN messages m ON m.id=messages_fts.message_id
       WHERE messages_fts MATCH ? AND m.deleted_at IS NULL
       ORDER BY bm25(messages_fts) LIMIT ?`,
    ).all(query.replace(/["']/g, " "), limit * 3) as {
      id: string; room_id: string; thread_id: string | null; author_name: string | null; content: string | null; timestamp: string | null; rank: number;
    }[];
    for (const r of rows) {
      byId.set(r.id, { ...r, ftsScore: 1 / (1 + Math.abs(r.rank)), vectorScore: 0, score: 0 });
    }
  }

  if (mode !== "fts") {
    const rows = db.query(
      `SELECT m.id,m.room_id,m.thread_id,m.author_name,m.content,m.timestamp,v.embedding_json
       FROM message_vectors v JOIN messages m ON m.id=v.message_id WHERE m.deleted_at IS NULL`,
    ).all() as {
      id: string; room_id: string; thread_id: string | null; author_name: string | null; content: string | null; timestamp: string | null; embedding_json: string;
    }[];
    for (const r of rows) {
      const sc = dot(qv, JSON.parse(r.embedding_json) as number[]);
      if (sc <= 0 && mode === "vector") continue;
      const prev = byId.get(r.id);
      if (prev) prev.vectorScore = Math.max(prev.vectorScore, sc);
      else byId.set(r.id, {
        id: r.id, room_id: r.room_id, thread_id: r.thread_id, author_name: r.author_name,
        content: r.content, timestamp: r.timestamp, ftsScore: 0, vectorScore: sc, score: 0,
      });
    }
  }

  return [...byId.values()]
    .map((h) => ({ ...h, score: h.ftsScore * FUSE_FTS + h.vectorScore * FUSE_VEC }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface DbStats { messages: number; edits: number; deleted: number; channels: number; }
export function stats(db: Database): DbStats {
  const n = (q: string): number => (db.query(q).get() as { c: number }).c;
  return {
    messages: n("SELECT COUNT(*) c FROM messages"),
    edits: n("SELECT COUNT(*) c FROM edit_history WHERE version > 1"),
    deleted: n("SELECT COUNT(*) c FROM messages WHERE deleted_at IS NOT NULL"),
    channels: n("SELECT COUNT(*) c FROM cursors"),
  };
}
