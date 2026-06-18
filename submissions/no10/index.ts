/**
 * maw kikyo — Kikyo's own Discord mirror/backfill plugin.
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { backfill } from "./commands/backfill";
import { db } from "./commands/db";
import { check } from "./commands/check";
import { search } from "./commands/search";

export const command = {
  name: "kikyo",
  description: "Kikyo Discord mirror/backfill: rooms + threads → DB parity → frontend.",
};

const HELP = `
  backfill [--guild=x] [--all|--limit=N]  mirror Discord → sqlite parity → frontend
  db build|check|frontend|all             operate on existing mirror data
  search index|<query> [--mode=hybrid]     FTS + local vector search
  check                                   plugin consistency check
`.trim();

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const out: string[] = [];
  const log = (s: string) => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean, exitCode = ok ? 0 : 1): InvokeResult =>
    ({ ok, output: ctx.writer ? "" : out.join("\n"), error: ok ? undefined : "", exitCode });
  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    log("maw kikyo — Kikyo Discord mirror/backfill");
    log("");
    for (const line of HELP.split("\n")) log(`  ${line.trim()}`);
    return done(true);
  }

  try {
    switch (sub) {
      case "backfill": await backfill(log, args); break;
      case "db": await db(log, args); break;
      case "search": await search(log, args); break;
      case "frontend": await db(log, ["db", "frontend", ...args.slice(1)]); break;
      case "check": await check(log); break;
      default:
        log(`unknown: ${sub} — run 'maw kikyo --help'`);
        return done(false);
    }
    return done(true);
  } catch (e) {
    log(`error: ${e instanceof Error ? e.message : String(e)}`);
    return done(false);
  }
}
