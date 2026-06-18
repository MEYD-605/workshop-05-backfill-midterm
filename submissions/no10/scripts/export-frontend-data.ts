import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

type Row = Record<string, any>;
const root = process.cwd();
const dbPath = process.env.NO10_DB || join(root, ".discord/no10.sqlite");
const outPath = process.env.NO10_FRONTEND_DATA || join(root, "frontend/public/no10-data.json");
const db = new Database(dbPath);

const one = (sql: string) => db.query(sql).get() as Row;
const all = (sql: string, ...args: any[]) => db.query(sql).all(...args) as Row[];
const clamp = (n: number) => Math.max(-1, Math.min(1, Number(n.toFixed(4))));
const colorFor = (s: string) => `hsl(${[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)} 75% 62%)`;

function lastCursor(channelId: string, threadId: string | null = null) {
  const row = threadId
    ? one(`SELECT id, timestamp FROM messages WHERE thread_id='${threadId}' ORDER BY timestamp DESC, id DESC LIMIT 1`)
    : one(`SELECT id, timestamp FROM messages WHERE room_id='${channelId}' AND thread_id IS NULL ORDER BY timestamp DESC, id DESC LIMIT 1`);
  return row ? { messageId: row.id, timestamp: row.timestamp } : null;
}
function project(embedding: string) {
  const v = JSON.parse(embedding) as number[];
  const axes = [[0, 7, 19, 31, 43, 67], [2, 11, 23, 37, 53, 71], [5, 13, 29, 41, 59, 83]];
  return axes.map(axis => clamp(axis.reduce((s, i, k) => s + (v[i] || 0) * (k % 2 ? -1 : 1), 0) * 1.8));
}

const guildRows = all("SELECT id, name FROM guilds ORDER BY name");
const guilds = guildRows.map(g => {
  const rooms = all("SELECT id, name, position FROM rooms WHERE guild_id=? ORDER BY position, name", g.id).map(r => {
    const messages = all("SELECT id, author_id, author_name, author_is_bot, content, timestamp, attachments_json FROM messages WHERE room_id=? AND thread_id IS NULL ORDER BY timestamp, id", r.id);
    const threads = all("SELECT id, name, state FROM threads WHERE parent_room_id=? ORDER BY name", r.id).map(t => {
      const tMessages = all("SELECT id, author_id, author_name, author_is_bot, content, timestamp, attachments_json FROM messages WHERE thread_id=? ORDER BY timestamp, id", t.id);
      return { ...t, messages: tMessages, counter: { messages: tMessages.length }, cursor: lastCursor(r.id, t.id), status: tMessages.length ? "complete" : "empty" };
    });
    return { ...r, messages, threads, counter: { messages: messages.length, threads: threads.length }, cursor: lastCursor(r.id), status: messages.length || threads.length ? "complete" : "empty" };
  });
  return { ...g, rooms, counter: { rooms: rooms.length, threads: rooms.reduce((n, r) => n + r.threads.length, 0), messages: rooms.reduce((n, r) => n + r.messages.length + r.threads.reduce((m: number, t: any) => m + t.messages.length, 0), 0) } };
});

const totals = {
  guilds: guilds.length,
  rooms: Number(one("SELECT count(*) c FROM rooms").c),
  threads: Number(one("SELECT count(*) c FROM threads").c),
  messages: Number(one("SELECT count(*) c FROM messages").c),
  users: Number(one("SELECT count(DISTINCT author_id) c FROM messages WHERE author_id IS NOT NULL").c),
};
const users = all(`SELECT author_id id, coalesce(author_name, author_id) name, max(author_is_bot) bot, count(*) messages, group_concat(DISTINCT room_id) rooms, group_concat(DISTINCT thread_id) threads FROM messages WHERE author_id IS NOT NULL GROUP BY author_id ORDER BY messages DESC`).map(u => ({ ...u, bot: !!u.bot, rooms: String(u.rooms || '').split(',').filter(Boolean), threads: String(u.threads || '').split(',').filter(Boolean) }));
const vectorPoints = all(`SELECT m.id, m.author_id, m.author_name, m.content, m.timestamp, r.id room_id, r.name room_name, t.id thread_id, t.name thread_name, v.embedding_json FROM message_vectors v JOIN messages m ON m.id=v.message_id JOIN rooms r ON r.id=m.room_id LEFT JOIN threads t ON t.id=m.thread_id ORDER BY m.timestamp, m.id`).map(r => {
  const [x, y, z] = project(r.embedding_json);
  return { id: r.id, x, y, z, room_id: r.room_id, room_name: r.room_name, thread_id: r.thread_id, thread_name: r.thread_name, author_id: r.author_id, author_name: r.author_name, color: colorFor(r.thread_id || r.room_id), excerpt: String(r.content || '').replace(/\s+/g, ' ').slice(0, 110), timestamp: r.timestamp };
});
const topics = all(`SELECT topic_id, label, scope, room_id, thread_id, count, keywords_json, representative_message_ids_json FROM topics ORDER BY count DESC`).map(t => ({
  topic_id: t.topic_id, label: t.label, scope: t.scope, room_id: t.room_id, thread_id: t.thread_id, count: t.count,
  keywords: JSON.parse(t.keywords_json || '[]'), representativeMessageIds: JSON.parse(t.representative_message_ids_json || '[]'),
  color: colorFor(t.thread_id || t.room_id || t.topic_id),
}));
let diff = { previousMessages: 0, currentMessages: totals.messages, deltaMessages: totals.messages };
try {
  const lines = await Bun.file(join(root, ".discord/no10-mirror/mirror-runs.jsonl")).text().then(t => t.trim().split(/\n/).filter(Boolean));
  const prev = lines.length > 1 ? JSON.parse(lines[lines.length - 2]) : null;
  if (prev?.totals) diff = { previousMessages: prev.totals.messages || 0, currentMessages: totals.messages, deltaMessages: totals.messages - (prev.totals.messages || 0) };
} catch {}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totals, diff, users, topics, vectorPoints, guilds }, null, 2));
db.close();
console.log(`wrote ${outPath} guilds=${totals.guilds} rooms=${totals.rooms} threads=${totals.threads} messages=${totals.messages} vectors=${vectorPoints.length}`);
