#!/usr/bin/env node
// Fetches the HR Open Standards 4.5 release that test/hropen.test.mjs validates the hropen output
// against, and unpacks the JSON Schemas a Candidate needs (common/ and recruiting/) with the
// release's licence into .cache/hropen/4.5/. The release is HR Open's to distribute, under its own
// licence agreement, so it is fetched, not kept in git. The archive is checked against the hash
// recorded here, so the validator can't change under a green build.
//
//   node scripts/fetch-hropen-schemas.mjs [--dir .cache/hropen/4.5]

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE = {
  version: "4.5",
  url: "https://hropentech.org/standards/4.5-build-2026-02-05.zip",
  sha256: "a5bf352f8026ac3e410086cefc8d6e267ea5d60ad5558b6762b1231b777d6d77",
  root: "4.5-build-2026-02-05/",
};
export const DEFAULT_DIR = fileURLToPath(new URL("../.cache/hropen/4.5/", import.meta.url));
/** Written last, so its presence means the whole set is there. */
export const MARKER = "fetched.json";
const WANTED = /^(LICENSE\.md|common\/json\/(?!samples\/).+\.json|recruiting\/json\/(?!samples\/).+\.json)$/;

/** The files of a zip archive (stored or deflated entries), read from its central directory. */
export function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("the zip's directory is damaged");
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`${name}: compression method ${method} is not supported`);
    files.push({ name, data: () => (method === 0 ? raw : inflateRawSync(raw)) });
  }
  return files;
}

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
  const marker = join(dir, MARKER);
  if (existsSync(marker) && JSON.parse(readFileSync(marker, "utf8")).sha256 === RELEASE.sha256) { console.log(`have HR Open ${RELEASE.version}`); process.exit(0); }
  try {
    const zip = await get(RELEASE.url);
    const got = createHash("sha256").update(zip).digest("hex");
    if (got !== RELEASE.sha256) throw new Error(`the HR Open ${RELEASE.version} archive has changed at its source (sha256 ${got}). Read the change, then update the hash in scripts/fetch-hropen-schemas.mjs`);
    let n = 0;
    for (const f of unzip(zip)) {
      if (!f.name.startsWith(RELEASE.root)) continue;
      const rel = f.name.slice(RELEASE.root.length);
      if (!WANTED.test(rel) || rel.split("/").some((part) => part === ".." || part.startsWith("."))) continue;
      const out = join(dir, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.data());
      n++;
    }
    writeFileSync(marker, JSON.stringify({ version: RELEASE.version, url: RELEASE.url, sha256: RELEASE.sha256, files: n }, null, 2) + "\n");
    console.log(`fetched HR Open ${RELEASE.version}: ${n} files`);
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
