import { existsSync } from "fs";
import { defaultPaths } from "./db";
import { ensureSearchIndex, searchDb } from "../lib/search-db";

type Log = (s: string) => void;

function argValue(args: string[], name: string): string | undefined {
  const p = args.find(a => a.startsWith(`${name}=`));
  return p ? p.split("=").slice(1).join("=") : undefined;
}
function usage(log: Log) {
  log("usage:");
  log("  maw no10 search index [--db=FILE]");
  log("  maw no10 search <query> [--mode=hybrid|fts|vector] [--limit=N] [--db=FILE]");
}

export async function search(log: Log, args: string[]) {
  const paths = defaultPaths(args);
  if (!existsSync(paths.dbPath)) { log(`✗ DB not found: ${paths.dbPath}`); log("run: maw no10 backfill --guild=<name> --all"); return; }
  const sub = args[1]?.toLowerCase();
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") { usage(log); return; }
  if (sub === "index" || sub === "build") {
    const r = ensureSearchIndex(paths.dbPath);
    log(`✓ search index built: ${paths.dbPath}`);
    log(`  fts rows=${r.messages} vector rows=${r.messages} dims=${r.dims} topics=${r.topics}`);
    return;
  }
  const mode = (argValue(args, "--mode") || "hybrid") as "hybrid" | "fts" | "vector";
  const limit = Number(argValue(args, "--limit") || 12);
  const query = args.slice(1).filter(a => !a.startsWith("--")).join(" ").trim();
  if (!query) { usage(log); return; }
  ensureSearchIndex(paths.dbPath);
  const rows = searchDb(paths.dbPath, query, mode, limit);
  log(`search '${query}' mode=${mode} results=${rows.length}`);
  for (const r of rows) {
    const target = r.thread_id ? `#${r.room_name} / 🧵 ${r.thread_name}` : `#${r.room_name}`;
    const text = String(r.content || "").replace(/\s+/g, " ").slice(0, 180);
    log(`- ${(r.score || 0).toFixed(3)} ${target} · ${r.author_name || r.author_id || "unknown"} · ${r.timestamp}`);
    log(`  ${text || "(no content)"}`);
    log(`  ids: message=${r.id} room=${r.room_id}${r.thread_id ? ` thread=${r.thread_id}` : ""}${r.author_id ? ` author=${r.author_id}` : ""}`);
  }
}
