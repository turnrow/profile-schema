#!/usr/bin/env node
// Fetches the 1EdTech JSON Schemas that test/ob3.test.mjs validates the Open Badges 3.0 and CLR 2.0
// outputs against, into .cache/1edtech/ (not kept in git: they are 1EdTech's to distribute).
// Each file is checked against the hash recorded here, so the validator can't change under a green
// build. When 1EdTech publishes a correction, read it, then update the hash.
//
//   node scripts/fetch-1edtech-schemas.mjs [--dir .cache/1edtech]

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMAS = [
  {
    file: "ob_v3p0_achievementcredential_schema.json",
    url: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json",
    sha256: "b7358e895f492e74055dc6bfc7ffc420d0e497f90c4579fb83d9519b86d393ea",
  },
  {
    file: "clr_v2p0_clrcredential_schema.json",
    url: "https://purl.imsglobal.org/spec/clr/v2p0/schema/json/clr_v2p0_clrcredential_schema.json",
    sha256: "59d778659204b0bd593e9e2ab1683fb6f688e339885c44019f606ed6feb4caee",
  },
];
export const DEFAULT_DIR = fileURLToPath(new URL("../.cache/1edtech/", import.meta.url));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function get(url) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`${url}: HTTP ${res.status}`);
    } catch (e) { last = e; }
  }
  throw last;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : DEFAULT_DIR;
  mkdirSync(dir, { recursive: true });
  let failed = false;
  for (const s of SCHEMAS) {
    const path = join(dir, s.file);
    if (existsSync(path) && sha256(readFileSync(path)) === s.sha256) { console.log(`have ${s.file}`); continue; }
    try {
      const bytes = await get(s.url);
      const got = sha256(bytes);
      if (got !== s.sha256) throw new Error(`${s.file} has changed at its source (sha256 ${got}). Read the change, then update the hash in scripts/fetch-1edtech-schemas.mjs`);
      writeFileSync(path, bytes);
      console.log(`fetched ${s.file}`);
    } catch (e) { failed = true; console.error(`error: ${e.message}`); }
  }
  process.exit(failed ? 1 : 0);
}
