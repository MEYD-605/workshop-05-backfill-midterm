// discord.ts — Discord REST pull (token from env DISCORD_BOT_TOKEN หรือ `pass`)
// pagination before-cursor (100/batch) + rate-limit (sleep + 429 Retry-After)
import { spawnSync } from "child_process";

const API = "https://discord.com/api/v10";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface DiscordMessage {
  id: string;
  channel_id?: string;
  author?: { id: string; username?: string; bot?: boolean };
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  attachments?: { id: string; filename: string; size: number; url?: string }[];
}

export function getToken(): string {
  const env = process.env.DISCORD_BOT_TOKEN;
  if (env && env.length > 0) return env;
  const r = spawnSync("pass", ["show", "discord/atlas-oracle-token"], { encoding: "utf8" });
  const tok = (r.stdout || "").trim().split("\n")[0];
  if (!tok) throw new Error("no token: set DISCORD_BOT_TOKEN or pass discord/atlas-oracle-token");
  return tok;
}

async function req<T>(path: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") || "1");
      await sleep((retry + 0.5) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return (await res.json()) as T;
  }
  throw new Error(`rate-limited too many times: ${path}`);
}

export function listGuilds(token: string): Promise<{ id: string; name: string }[]> {
  return req("/users/@me/guilds", token);
}
export function getGuildChannels(token: string, guildId: string): Promise<{ id: string; name: string; type: number; position?: number }[]> {
  return req(`/guilds/${guildId}/channels`, token);
}

// ดึงข้อความย้อนหลังด้วย before-cursor — หยุดเมื่อถึง stopAtId (incremental) หรือครบ limit
export async function fetchMessages(
  token: string,
  channelId: string,
  opts: { limit?: number; stopAtId?: string } = {},
): Promise<DiscordMessage[]> {
  const limit = opts.limit ?? 100000;
  const all: DiscordMessage[] = [];
  let before: string | undefined;
  while (all.length < limit) {
    const want = Math.min(100, limit - all.length);
    let path = `/channels/${channelId}/messages?limit=${want}`;
    if (before) path += `&before=${before}`;
    const batch = await req<DiscordMessage[]>(path, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    let hitStop = false;
    for (const m of batch) {
      if (opts.stopAtId && m.id <= opts.stopAtId) { hitStop = true; break; }
      all.push(m);
    }
    before = batch[batch.length - 1].id;
    if (hitStop || batch.length < want) break;
    await sleep(350);
  }
  all.sort((a, b) => a.id.localeCompare(b.id));
  return all;
}
