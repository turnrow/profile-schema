#!/usr/bin/env node
// Lists versions that have a CHANGELOG entry but no tag, each with the commit on main where
// package.json first reached that version (following main's first-parent history, so a version
// built on a branch is tagged where it landed, not mid-branch). One "version sha" per line,
// oldest first. The release workflow tags and publishes each; nothing else is changed.
//
//   node scripts/missing-releases.mjs [--ref origin/main]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "HEAD";
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 }).trim();

const tags = new Set(git("tag", "--list", "v*").split("\n").filter(Boolean));
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);

const firstOnMain = new Map();
for (const sha of git("rev-list", "--first-parent", "--reverse", ref, "--", "package.json").split("\n").filter(Boolean)) {
  let version;
  try { version = JSON.parse(git("show", `${sha}:package.json`)).version; } catch { continue; }
  if (!firstOnMain.has(version)) firstOnMain.set(version, sha);
}

const missing = versions.filter((v) => !tags.has(`v${v}`) && firstOnMain.has(v)).reverse();
for (const v of missing) console.log(`${v} ${firstOnMain.get(v)}`);
