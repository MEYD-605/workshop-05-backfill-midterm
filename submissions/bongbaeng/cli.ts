#!/usr/bin/env bun
// cli.ts — maw bongbaeng-backfill <backfill|search|parity|stats|demo>
import { openDb, upsertMessage, checkParity, search, setCursor, getCursor, stats, type RawMessage } from "./lib/db";
import { getToken, listGuilds, getGuildChannels, fetchMessages, type DiscordMessage } from "./lib/discord";

const C = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
const DB_PATH = process.env.BACKFILL_DB || `${process.env.HOME}/.bongbaeng-backfill/mirror.db`;

function toRaw(m: DiscordMessage, guildId: string, channelId: string): RawMessage {
  return {
    id: m.id, guild_id: guildId, room_id: channelId, channel_id: channelId,
    author_id: m.author?.id ?? null, author_name: m.author?.username ?? null,
    author_is_bot: m.author?.bot ?? false, content: m.content ?? null,
    timestamp: m.timestamp ?? null, edited_timestamp: m.edited_timestamp ?? null,
    attachments: m.attachments,
  };
}

async function cmdBackfill(args: string[]): Promise<void> {
  const channelId = args[0];
  if (!channelId) { console.log("usage: backfill <channel-id> [--limit=N] [--guild=ID]"); return; }
  const limit = Number((args.find((a) => a.startsWith("--limit=")) || "--limit=100000").split("=")[1]);
  const guildId = (args.find((a) => a.startsWith("--guild=")) || "--guild=").split("=")[1] || "unknown";
  const db = openDb(DB_PATH);
  const token = getToken();
  const cur = getCursor(db, channelId);
  console.log(`${C.bold}${C.red}🐆 backfill${C.reset} channel ${channelId} ${cur.live_newest_id ? C.dim + "(incremental since " + cur.live_newest_id + ")" + C.reset : ""}`);
  const msgs = await fetchMessages(token, channelId, { limit, stopAtId: cur.live_newest_id ?? undefined });
  let ins = 0, ed = 0, un = 0;
  for (const m of msgs) {
    const r = upsertMessage(db, toRaw(m, guildId, channelId), "backfill");
    if (r === "inserted") ins++; else if (r === "edited") ed++; else un++;
  }
  if (msgs.length > 0) setCursor(db, channelId, { live_newest_id: msgs[msgs.length - 1].id, backfill_oldest_id: msgs[0].id });
  const ids = msgs.map((m) => m.id);
  const p = checkParity(db, ids);
  console.log(`  fetched ${msgs.length} · ${C.green}+${ins} inserted${C.reset} · ${C.yellow}~${ed} edited${C.reset} · ${un} unchanged`);
  console.log(`  parity: ${p.ok ? C.green + "✓ ok" : C.red + "✗ missing " + p.missingIds.length} ${C.reset}(expected ${p.expected}, db total ${p.actual})`);
}

function cmdSearch(args: string[]): void {
  const mode = (args.find((a) => a.startsWith("--mode=")) || "--mode=hybrid").split("=")[1] as "fts" | "vector" | "hybrid";
  const query = args.filter((a) => !a.startsWith("--")).join(" ");
  if (!query) { console.log("usage: search <query> [--mode=fts|vector|hybrid]"); return; }
  const db = openDb(DB_PATH);
  const hits = search(db, query, mode, 10);
  console.log(`${C.bold}${C.red}🔎 "${query}"${C.reset} ${C.dim}(${mode}, ${hits.length} hits)${C.reset}`);
  for (const h of hits) {
    console.log(`  ${C.green}${h.score.toFixed(3)}${C.reset} ${C.yellow}${h.author_name ?? "?"}${C.reset} ${C.dim}fts=${h.ftsScore.toFixed(2)} vec=${h.vectorScore.toFixed(2)}${C.reset}`);
    console.log(`    ${(h.content ?? "").slice(0, 100).replace(/\n/g, " ")}`);
  }
}

function cmdStats(): void {
  const db = openDb(DB_PATH);
  const s = stats(db);
  console.log(`${C.bold}${C.red}📊 backfill stats${C.reset} ${C.dim}(${DB_PATH})${C.reset}`);
  console.log(`  messages : ${C.yellow}${s.messages}${C.reset}`);
  console.log(`  edits    : ${s.edits} ${C.dim}(versions > 1, ประวัติเก็บครบ)${C.reset}`);
  console.log(`  deleted  : ${s.deleted} ${C.dim}(tombstoned, ไม่ลบจริง)${C.reset}`);
  console.log(`  channels : ${s.channels} ${C.dim}(มี watermark)${C.reset}`);
}

const [, , sub, ...args] = process.argv;
if (sub === "backfill") await cmdBackfill(args);
else if (sub === "search") cmdSearch(args);
else if (sub === "stats") cmdStats();
else {
  console.log(`${C.bold}${C.red}maw bongbaeng-backfill${C.reset} — Discord backfill + index + hybrid search (design v3)`);
  console.log(`  backfill <channel-id> [--limit=N] [--guild=ID]   ดึง+index (incremental ผ่าน watermark)`);
  console.log(`  search <query> [--mode=fts|vector|hybrid]         ค้นแบบ FTS5+vector fusion`);
  console.log(`  stats                                            สรุป messages/edits/deleted/channels`);
}
