import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../scripts/missing-releases.mjs", import.meta.url).pathname;

test("lists untagged CHANGELOG versions at the main commit where package.json first reached them", () => {
  const d = mkdtempSync(join(tmpdir(), "tp-rel-"));
  const g = (...a) => execFileSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8" }).trim();
  mkdirSync(join(d, "scripts")); copyFileSync(SCRIPT, join(d, "scripts/missing-releases.mjs"));
  g("init", "-q", "-b", "main");
  const commit = (version, msg) => { writeFileSync(join(d, "package.json"), JSON.stringify({ version })); g("add", "-A"); g("commit", "-qm", msg); return g("rev-parse", "HEAD"); };
  writeFileSync(join(d, "CHANGELOG.md"), "# Changelog\n\n## 1.1.0 (x)\n- b\n\n## 1.0.0 (x)\n- a\n");
  const one = commit("1.0.0", "1.0");
  g("tag", "v1.0.0");
  g("checkout", "-qb", "feature");
  commit("1.1.0", "bump on a branch");
  g("checkout", "-q", "main");
  g("merge", "-q", "--no-ff", "feature", "-m", "merge 1.1");
  const merge = g("rev-parse", "HEAD");
  const out = execFileSync(process.execPath, [join(d, "scripts/missing-releases.mjs")], { cwd: d, encoding: "utf8" });
  assert.equal(out, `1.1.0 ${merge}\n`, "the merge commit on main, not the branch commit; v1.0.0 already tagged");
  assert.notEqual(merge, one);
});
