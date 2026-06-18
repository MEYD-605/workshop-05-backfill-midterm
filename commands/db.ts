import { join } from "path";
import { existsSync } from "fs";
import { importMirrorToDb, verifyMirrorDbParity, writeFrontendFromDb } from "../lib/mirror-db";

declare const process: any;

function argValue(args: string[], name: string): string | undefined {
  const p = args.find(a => a.startsWith(`${name}=`));
  return p ? p.split("=").slice(1).join("=") : undefined;
}

export function defaultPaths(args: string[]) {
  const root = argValue(args, "--root") || process.cwd();
  const mirrorDir = argValue(args, "--mirror") || join(root, ".discord/kikyo-mirror");
  const dbPath = argValue(args, "--db") || join(root, ".discord/kikyo.sqlite");
  const outPath = argValue(args, "--out") || join(root, ".discord/kikyo-frontend/index.html");
  return { root, mirrorDir, dbPath, outPath };
}

function usage(log: (s: string) => void) {
  log("usage:");
  log("  maw kikyo db build [--mirror=DIR] [--db=FILE]");
  log("  maw kikyo db check [--mirror=DIR] [--db=FILE]");
  log("  maw kikyo db frontend [--db=FILE] [--out=HTML]");
  log("  maw kikyo db all [same options]");
}

export async function db(log: (s: string) => void, args: string[]) {
  const sub = args[1]?.toLowerCase();
  const paths = defaultPaths(args);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") { usage(log); return; }
  if (!existsSync(paths.mirrorDir) && (sub === "build" || sub === "check" || sub === "all" || sub === "frontend")) {
    log(`✗ mirror dir not found: ${paths.mirrorDir}`);
    log("run: maw kikyo backfill --guild=<name> --all");
    return;
  }

  if (sub === "build" || sub === "all") {
    const r = importMirrorToDb({ mirrorDir: paths.mirrorDir, dbPath: paths.dbPath });
    log(`✓ DB built: ${r.dbPath}`);
    log(`  guilds=${r.totals.guilds} rooms=${r.totals.rooms} threads=${r.totals.threads} messages=${r.totals.messages}`);
  }

  if (sub === "check" || sub === "all") {
    const p = verifyMirrorDbParity({ mirrorDir: paths.mirrorDir, dbPath: paths.dbPath });
    log(`parity expected: guilds=${p.expected.guilds} rooms=${p.expected.rooms} threads=${p.expected.threads} messages=${p.expected.messages}`);
    log(`parity actual:   guilds=${p.actual.guilds} rooms=${p.actual.rooms} threads=${p.actual.threads} messages=${p.actual.messages}`);
    if (!p.ok) {
      log(`✗ parity failed: missing=${p.missingMessageIds.length} extra=${p.extraMessageIds.length}`);
      if (p.missingMessageIds.length) log(`  missing ids: ${p.missingMessageIds.slice(0, 10).join(", ")}`);
      if (p.extraMessageIds.length) log(`  extra ids: ${p.extraMessageIds.slice(0, 10).join(", ")}`);
      return;
    }
    log("✓ DB parity matches mirror JSON exactly");
  }

  if (sub === "frontend" || sub === "all") {
    if (sub === "frontend") {
      const p = verifyMirrorDbParity({ mirrorDir: paths.mirrorDir, dbPath: paths.dbPath });
      if (!p.ok) { log("✗ refusing frontend build: DB parity check failed"); return; }
      log("✓ DB parity matches mirror JSON exactly");
    }
    const out = writeFrontendFromDb(paths.dbPath, paths.outPath);
    log(`✓ frontend built: ${out}`);
    return;
  }

  if (!["build", "check", "frontend", "all"].includes(sub)) {
    log(`unknown db subcommand: ${sub}`);
    usage(log);
  }
}
