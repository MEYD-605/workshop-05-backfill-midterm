import {
  filterTextChannels,
  getArchivedPrivateThreads,
  getArchivedPublicThreads,
  getGuildChannels,
  getMessages,
  getToken,
  listActiveThreads,
  listGuilds,
} from "../lib/discord";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { importMirrorToDb, verifyMirrorDbParity, writeFrontendFromDb } from "../lib/mirror-db";
import { defaultPaths } from "./db";

declare const process: any;

const DISCORD_EPOCH = 1420070400000n;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const snowflakeTs = (id: string) => new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH)).toISOString();
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9฀-๿_.-]/g, "_").replace(/^\.+$/, "_").slice(0, 80) || "unnamed";
const roomDirName = (ch: any) => `${String(ch.position ?? 0).padStart(3, "0")}_${sanitize(ch.name)}__${ch.id}`;
const threadDirName = (th: any) => `${sanitize(th.name)}__${th.id}`;

type Log = (s: string) => void;

function argValue(args: string[], name: string): string | undefined {
  const p = args.find(a => a.startsWith(`${name}=`));
  return p ? p.split("=").slice(1).join("=") : undefined;
}

function help(log: Log) {
  log("usage:");
  log("  maw no10 backfill [--guild=name-or-id] [--limit=N|--all] [--root=DIR] [--dry-run] [--active-only]");
  log("");
  log("Pipeline: Discord rooms+threads → JSON mirror → SQLite DB → exact parity check → frontend");
}

async function fetchAllMessages(token: string, channelId: string, limit: number) {
  const all: any[] = [];
  let before: string | undefined;
  while (all.length < limit) {
    const batch = await getMessages(token, channelId, Math.min(100, limit - all.length), before);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await sleep(350);
  }
  all.sort((a: any, b: any) => a.id.localeCompare(b.id));
  return all;
}

async function safeThreads(fetcher: () => Promise<any[]>): Promise<any[]> {
  try { return await fetcher(); } catch { return []; }
}

async function mirrorOnce(log: Log, token: string, args: string[]) {
  const paths = defaultPaths(args);
  const startedAt = new Date().toISOString();
  const guildFilter = argValue(args, "--guild");
  const all = args.includes("--all");
  const limit = all ? 10000 : parseInt(argValue(args, "--limit") || "100", 10);
  const dryRun = args.includes("--dry-run");
  const includeArchived = !args.includes("--active-only");

  const guilds = await listGuilds(token);
  if (!Array.isArray(guilds)) { log("✗ could not list guilds"); return { mirrored: false, paths }; }

  mkdirSync(paths.mirrorDir, { recursive: true });
  let totalRooms = 0, totalThreads = 0, totalMessages = 0;
  const manifest: any = { startedAt, outDir: paths.mirrorDir, guilds: [] };

  for (const g of guilds) {
    if (guildFilter && !g.id.includes(guildFilter) && !g.name.toLowerCase().includes(guildFilter.toLowerCase())) continue;
    const channels = await getGuildChannels(token, g.id);
    if (!Array.isArray(channels)) { log(`✗ ${g.name}: channel access denied`); continue; }
    const rooms = filterTextChannels(channels).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const active = await listActiveThreads(token, g.id);
    const activeByParent = new Map<string, any[]>();
    for (const t of active) {
      const arr = activeByParent.get(t.parent_id) || [];
      arr.push({ ...t, mirror_state: "active" });
      activeByParent.set(t.parent_id, arr);
    }

    const gDir = join(paths.mirrorDir, `${sanitize(g.name)}__${g.id}`);
    const gEntry: any = { id: g.id, name: g.name, rooms: [] };
    if (!dryRun) mkdirSync(gDir, { recursive: true });
    log(`\n${g.name} — ${rooms.length} visible rooms`);

    for (const ch of rooms) {
      totalRooms++;
      const rDir = join(gDir, "rooms", roomDirName(ch));
      const rEntry: any = { id: ch.id, name: ch.name, type: ch.type, position: ch.position, threads: [] };
      if (dryRun) {
        log(`  room #${ch.name} (${ch.id})`);
      } else {
        mkdirSync(rDir, { recursive: true });
        const msgs = await fetchAllMessages(token, ch.id, limit);
        totalMessages += msgs.length;
        writeFileSync(join(rDir, "messages.json"), JSON.stringify(msgs, null, 2) + "\n");
        writeFileSync(join(rDir, "channel.json"), JSON.stringify(ch, null, 2) + "\n");
        rEntry.messages = msgs.length;
        rEntry.firstMessageAt = msgs[0]?.timestamp || (msgs[0]?.id ? snowflakeTs(msgs[0].id) : null);
        rEntry.lastMessageAt = msgs[msgs.length - 1]?.timestamp || (msgs[msgs.length - 1]?.id ? snowflakeTs(msgs[msgs.length - 1].id) : null);
        log(`  ✓ #${ch.name}: ${msgs.length} msgs`);
        await sleep(250);
      }

      const archived = includeArchived
        ? [
            ...(await safeThreads(() => getArchivedPublicThreads(token, ch.id))),
            ...(await safeThreads(() => getArchivedPrivateThreads(token, ch.id))),
          ].map(t => ({ ...t, mirror_state: t.thread_metadata?.archived ? "archived" : "unknown" }))
        : [];
      const byId = new Map<string, any>();
      for (const t of [...(activeByParent.get(ch.id) || []), ...archived]) byId.set(t.id, t);
      const threads = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));

      for (const th of threads) {
        totalThreads++;
        const tDir = join(rDir, "threads", threadDirName(th));
        if (dryRun) {
          log(`    thread ${th.name} (${th.id}) [${th.mirror_state}]`);
        } else {
          mkdirSync(tDir, { recursive: true });
          const msgs = await fetchAllMessages(token, th.id, limit);
          totalMessages += msgs.length;
          writeFileSync(join(tDir, "messages.json"), JSON.stringify(msgs, null, 2) + "\n");
          writeFileSync(join(tDir, "thread.json"), JSON.stringify(th, null, 2) + "\n");
          rEntry.threads.push({ id: th.id, name: th.name, state: th.mirror_state, messages: msgs.length });
          log(`    ✓ 🧵 ${th.name}: ${msgs.length} msgs [${th.mirror_state}]`);
          await sleep(300);
        }
      }
      gEntry.rooms.push(rEntry);
    }
    manifest.guilds.push(gEntry);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.totals = { rooms: totalRooms, threads: totalThreads, messages: totalMessages, dryRun };
  if (!dryRun) {
    writeFileSync(join(paths.mirrorDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    appendFileSync(join(paths.mirrorDir, "mirror-runs.jsonl"), JSON.stringify({ startedAt, finishedAt: manifest.finishedAt, totals: manifest.totals }) + "\n");
  }
  log(`\nmirror ${dryRun ? "dry-run" : "sync"}: ${totalRooms} rooms, ${totalThreads} threads, ${totalMessages} messages`);
  log(`mirror: ${paths.mirrorDir}`);
  return { mirrored: !dryRun, paths };
}

export async function backfill(log: Log, args: string[]) {
  if (args.includes("help") || args.includes("--help") || args.includes("-h")) { help(log); return; }
  const token = getToken();
  if (!token) { log("✗ no DISCORD_BOT_TOKEN — set env, Hermes profile .env, or pass discord/atlas-oracle-token"); return; }

  const { mirrored, paths } = await mirrorOnce(log, token, args);
  if (!mirrored) return;

  const imported = importMirrorToDb({ mirrorDir: paths.mirrorDir, dbPath: paths.dbPath });
  log(`✓ DB built: ${imported.dbPath}`);
  log(`  guilds=${imported.totals.guilds} rooms=${imported.totals.rooms} threads=${imported.totals.threads} messages=${imported.totals.messages}`);

  const parity = verifyMirrorDbParity({ mirrorDir: paths.mirrorDir, dbPath: paths.dbPath });
  log(`parity expected: guilds=${parity.expected.guilds} rooms=${parity.expected.rooms} threads=${parity.expected.threads} messages=${parity.expected.messages}`);
  log(`parity actual:   guilds=${parity.actual.guilds} rooms=${parity.actual.rooms} threads=${parity.actual.threads} messages=${parity.actual.messages}`);
  if (!parity.ok) {
    log(`✗ refusing frontend build: parity failed missing=${parity.missingMessageIds.length} extra=${parity.extraMessageIds.length}`);
    return;
  }
  log("✓ DB parity matches mirror JSON exactly");
  const out = writeFrontendFromDb(paths.dbPath, paths.outPath);
  log(`✓ frontend built: ${out}`);
}
