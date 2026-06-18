import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";

type AnyRecord = Record<string, any>;

export interface ImportMirrorOptions { mirrorDir: string; dbPath: string; }
export interface ParityOptions { mirrorDir: string; dbPath: string; }

export interface MirrorTotals { guilds: number; rooms: number; threads: number; messages: number; }
export interface ImportResult { dbPath: string; mirrorDir: string; totals: MirrorTotals; }
export interface ParityResult {
  ok: boolean;
  expected: MirrorTotals;
  actual: MirrorTotals;
  missingMessageIds: string[];
  extraMessageIds: string[];
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER,
  type INTEGER,
  raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  parent_room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT,
  raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  thread_id TEXT,
  channel_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  author_is_bot INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  timestamp TEXT,
  attachments_json TEXT,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_guild ON rooms(guild_id, position, name);
CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_room_id, name);
CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, timestamp, id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_ts ON messages(thread_id, timestamp, id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
`;

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function json(value: any): string { return JSON.stringify(value ?? null); }

function parseIdFromDirName(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

function listDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
}

function messageRow(m: AnyRecord, guildId: string, roomId: string, threadId: string | null): any[] {
  const channelId = threadId || roomId;
  return [
    String(m.id),
    guildId,
    roomId,
    threadId,
    String(m.channel_id || m.channelId || channelId),
    m.author?.id ? String(m.author.id) : null,
    m.author?.global_name || m.author?.username || m.author?.display_name || null,
    m.author?.bot ? 1 : 0,
    m.content || "",
    m.timestamp || null,
    json(m.attachments || []),
    json(m),
  ];
}

function openDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return db;
}

function clearDb(db: Database) {
  db.exec("DELETE FROM messages; DELETE FROM threads; DELETE FROM rooms; DELETE FROM guilds;");
}

function expectedFromMirror(mirrorDir: string): { totals: MirrorTotals; messageIds: Set<string> } {
  const totals: MirrorTotals = { guilds: 0, rooms: 0, threads: 0, messages: 0 };
  const messageIds = new Set<string>();
  for (const guildDir of listDirs(mirrorDir)) {
    totals.guilds++;
    const roomsDir = join(mirrorDir, guildDir, "rooms");
    for (const roomDirName of listDirs(roomsDir)) {
      totals.rooms++;
      const roomDir = join(roomsDir, roomDirName);
      const roomMsgs = existsSync(join(roomDir, "messages.json")) ? readJson(join(roomDir, "messages.json")) : [];
      for (const m of Array.isArray(roomMsgs) ? roomMsgs : []) { totals.messages++; if (m.id) messageIds.add(String(m.id)); }
      for (const threadDirName of listDirs(join(roomDir, "threads"))) {
        totals.threads++;
        const threadDir = join(roomDir, "threads", threadDirName);
        const threadMsgs = existsSync(join(threadDir, "messages.json")) ? readJson(join(threadDir, "messages.json")) : [];
        for (const m of Array.isArray(threadMsgs) ? threadMsgs : []) { totals.messages++; if (m.id) messageIds.add(String(m.id)); }
      }
    }
  }
  return { totals, messageIds };
}

export function importMirrorToDb(opts: ImportMirrorOptions): ImportResult {
  const db = openDb(opts.dbPath);
  clearDb(db);

  const insertGuild = db.prepare("INSERT OR REPLACE INTO guilds (id, name, raw_json) VALUES (?, ?, ?)");
  const insertRoom = db.prepare("INSERT OR REPLACE INTO rooms (id, guild_id, name, position, type, raw_json) VALUES (?, ?, ?, ?, ?, ?)");
  const insertThread = db.prepare("INSERT OR REPLACE INTO threads (id, guild_id, parent_room_id, name, state, raw_json) VALUES (?, ?, ?, ?, ?, ?)");
  const insertMessage = db.prepare(`INSERT OR REPLACE INTO messages
    (id, guild_id, room_id, thread_id, channel_id, author_id, author_name, author_is_bot, content, timestamp, attachments_json, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const totals: MirrorTotals = { guilds: 0, rooms: 0, threads: 0, messages: 0 };
  const tx = db.transaction(() => {
    for (const guildDir of listDirs(opts.mirrorDir)) {
      const guildId = parseIdFromDirName(guildDir);
      const guildName = guildDir.slice(0, Math.max(0, guildDir.lastIndexOf("__"))).replace(/_/g, " ") || guildId;
      const guildRaw = { id: guildId, name: guildName, mirror_path: relative(opts.mirrorDir, join(opts.mirrorDir, guildDir)) };
      insertGuild.run(guildId, guildName, json(guildRaw));
      totals.guilds++;

      const roomsDir = join(opts.mirrorDir, guildDir, "rooms");
      for (const roomDirName of listDirs(roomsDir)) {
        const roomDir = join(roomsDir, roomDirName);
        const channelPath = join(roomDir, "channel.json");
        const channel = existsSync(channelPath) ? readJson(channelPath) : { id: parseIdFromDirName(roomDirName), name: roomDirName };
        const roomId = String(channel.id || parseIdFromDirName(roomDirName));
        insertRoom.run(roomId, guildId, channel.name || roomId, channel.position ?? null, channel.type ?? null, json(channel));
        totals.rooms++;

        const roomMsgsPath = join(roomDir, "messages.json");
        const roomMsgs = existsSync(roomMsgsPath) ? readJson(roomMsgsPath) : [];
        for (const m of Array.isArray(roomMsgs) ? roomMsgs : []) {
          insertMessage.run(...messageRow(m, guildId, roomId, null));
          totals.messages++;
        }

        for (const threadDirName of listDirs(join(roomDir, "threads"))) {
          const threadDir = join(roomDir, "threads", threadDirName);
          const threadPath = join(threadDir, "thread.json");
          const thread = existsSync(threadPath) ? readJson(threadPath) : { id: parseIdFromDirName(threadDirName), name: threadDirName };
          const threadId = String(thread.id || parseIdFromDirName(threadDirName));
          const state = thread.mirror_state || (thread.thread_metadata?.archived ? "archived" : "active");
          insertThread.run(threadId, guildId, roomId, thread.name || threadId, state, json(thread));
          totals.threads++;
          const threadMsgs = existsSync(join(threadDir, "messages.json")) ? readJson(join(threadDir, "messages.json")) : [];
          for (const m of Array.isArray(threadMsgs) ? threadMsgs : []) {
            insertMessage.run(...messageRow(m, guildId, roomId, threadId));
            totals.messages++;
          }
        }
      }
    }
  });
  tx();
  db.close();
  return { dbPath: opts.dbPath, mirrorDir: opts.mirrorDir, totals };
}

export function verifyMirrorDbParity(opts: ParityOptions): ParityResult {
  const expected = expectedFromMirror(opts.mirrorDir);
  const db = openDb(opts.dbPath);
  const actual: MirrorTotals = {
    guilds: (db.query("SELECT count(*) AS c FROM guilds").get() as any).c,
    rooms: (db.query("SELECT count(*) AS c FROM rooms").get() as any).c,
    threads: (db.query("SELECT count(*) AS c FROM threads").get() as any).c,
    messages: (db.query("SELECT count(*) AS c FROM messages").get() as any).c,
  };
  const actualIds = new Set((db.query("SELECT id FROM messages").all() as any[]).map(r => String(r.id)));
  db.close();
  const missingMessageIds = [...expected.messageIds].filter(id => !actualIds.has(id)).sort();
  const extraMessageIds = [...actualIds].filter(id => !expected.messageIds.has(id)).sort();
  const ok = expected.totals.guilds === actual.guilds
    && expected.totals.rooms === actual.rooms
    && expected.totals.threads === actual.threads
    && expected.totals.messages === actual.messages
    && missingMessageIds.length === 0
    && extraMessageIds.length === 0;
  return { ok, expected: expected.totals, actual, missingMessageIds, extraMessageIds };
}

export function loadDashboardData(dbPath: string) {
  const db = openDb(dbPath);
  const guildRows = db.query("SELECT id, name FROM guilds ORDER BY name").all() as any[];
  const guilds = guildRows.map(g => {
    const rooms = (db.query("SELECT id, name FROM rooms WHERE guild_id = ? ORDER BY position, name").all(g.id) as any[]).map(r => {
      const messages = db.query("SELECT id, author_name, content, timestamp AS ts FROM messages WHERE room_id = ? AND thread_id IS NULL ORDER BY timestamp, id").all(r.id) as any[];
      const threads = (db.query("SELECT id, name, state FROM threads WHERE parent_room_id = ? ORDER BY name").all(r.id) as any[]).map(t => ({
        ...t,
        messages: db.query("SELECT id, author_name, content, timestamp AS ts FROM messages WHERE thread_id = ? ORDER BY timestamp, id").all(t.id) as any[],
      }));
      return { ...r, messages, threads };
    });
    return { ...g, rooms };
  });
  db.close();
  return { generatedAt: new Date().toISOString(), guilds };
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

function renderMessage(m: any): string {
  return `<li class="msg"><span class="ts">${esc(m.ts || "")}</span> <b>${esc(m.author_name || "unknown")}</b>: <span>${esc(m.content || "(no content)")}</span></li>`;
}

export function buildFrontendHtml(data: ReturnType<typeof loadDashboardData>): string {
  const guildHtml = data.guilds.map(g => `
    <section class="guild">
      <h2>${esc(g.name)}</h2>
      ${g.rooms.map((r: any) => `
        <details class="room" open>
          <summary>#${esc(r.name)} <span>${r.messages.length} msg · ${r.threads.length} threads</span></summary>
          <ul>${r.messages.map(renderMessage).join("")}</ul>
          ${r.threads.map((t: any) => `
            <details class="thread" open>
              <summary>🧵 ${esc(t.name)} <span>${esc(t.state || "")} · ${t.messages.length} msg</span></summary>
              <ul>${t.messages.map(renderMessage).join("")}</ul>
            </details>`).join("")}
        </details>`).join("")}
    </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Discord Mirror</title>
<style>
:root{color-scheme:dark;background:#0b1020;color:#e8ecff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{margin:0;padding:24px}.top{position:sticky;top:0;background:#0b1020cc;backdrop-filter:blur(12px);padding:12px 0;border-bottom:1px solid #26304d}h1{margin:0;font-size:24px}.meta{color:#9aa7d8;font-size:13px}.guild{margin:18px 0;padding:16px;border:1px solid #26304d;border-radius:16px;background:#111936}.room,.thread{margin:10px 0;padding:10px;border-radius:12px;background:#172142}.thread{margin-left:16px;background:#1b294f}summary{cursor:pointer;font-weight:700}summary span{color:#9aa7d8;font-size:12px;font-weight:500;margin-left:8px}ul{margin:8px 0 0 0;padding-left:16px}.msg{margin:6px 0;line-height:1.35}.ts{color:#8591bd;font-size:12px}b{color:#b7c5ff}input{width:100%;box-sizing:border-box;margin-top:12px;padding:10px;border-radius:10px;border:1px solid #39466f;background:#0b1020;color:#e8ecff}.hidden{display:none}</style>
</head><body><div class="top"><h1>Atlas Discord Mirror</h1><div class="meta">Generated ${esc(data.generatedAt)} · DB-parity verified before frontend build</div><input id="q" placeholder="filter messages / rooms / threads"></div>${guildHtml}
<script>const q=document.getElementById('q');q.addEventListener('input',()=>{const s=q.value.toLowerCase();document.querySelectorAll('.room,.thread,.msg').forEach(el=>{el.classList.toggle('hidden',s&&!el.textContent.toLowerCase().includes(s));});});</script></body></html>`;
}

export function writeFrontendFromDb(dbPath: string, outPath: string): string {
  mkdirSync(dirname(outPath), { recursive: true });
  const html = buildFrontendHtml(loadDashboardData(dbPath));
  writeFileSync(outPath, html);
  return outPath;
}
