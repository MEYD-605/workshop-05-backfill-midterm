declare const process: any;

import { existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";

const REQUIRED = [
  "plugin.json",
  "index.ts",
  "commands/backfill.ts",
  "commands/db.ts",
  "commands/search.ts",
  "commands/check.ts",
  "lib/discord.ts",
  "lib/mirror-db.ts",
  "lib/search-db.ts",
];

export async function check(log: (s: string) => void) {
  const root = process.cwd();
  log("maw no10 check");
  log(`root: ${root}`);
  let missing = 0;
  for (const file of REQUIRED) {
    if (existsSync(resolve(root, file))) log(`✓ ${file}`);
    else { log(`✗ missing ${file}`); missing++; }
  }
  if (existsSync(resolve(root, "commands"))) {
    const commands = readdirSync(resolve(root, "commands")).filter((f: string) => f.endsWith(".ts")).sort();
    log(`commands: ${commands.join(", ")}`);
  }
  log(missing ? `\n✗ ${missing} missing file(s)` : "\n✓ no10-indexer plugin is internally consistent");
}
