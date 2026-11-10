// The 2.6 fixture: a bundle made entirely by scripts/make-fixtures.mjs, with outputs checked in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
const BUNDLE = "examples/recommended";
const MAPPINGS = { jsonresume: "json", schemaorg: "json", linkedin: "txt", brief: "json", timeline: "json" };

test("the recommended bundle validates", () => {
  const r = run("bin/profile.mjs", "validate", BUNDLE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("each output of the recommended bundle matches examples/out", () => {
  for (const [m, ext] of Object.entries(MAPPINGS)) {
    const r = run("bin/profile.mjs", "convert", BUNDLE, m, "--on", "2026-11-07");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, readFileSync(join(root, `examples/out/recommended.${m}.${ext}`), "utf8"), m);
  }
});

test("the fixture is generated, not hand-edited: the script reproduces it byte for byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-fix-"));
  const r = run("scripts/make-fixtures.mjs", "--out", dir);
  assert.equal(r.status, 0, r.stderr);
  const walk = (d, pre = "") => readdirSync(join(d, pre), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(d, join(pre, e.name)) : [join(pre, e.name)])).sort();
  const want = walk(join(root, BUNDLE));
  assert.deepEqual(walk(join(dir, "recommended")), want);
  for (const f of want) assert.ok(readFileSync(join(dir, "recommended", f)).equals(readFileSync(join(root, BUNDLE, f))), f);
});

test("the fixture shows every new model: people, both consent scopes, an endorsement, both badge formats", () => {
  const p = JSON.parse(readFileSync(join(root, BUNDLE, "profile.json"), "utf8"));
  assert.equal(p.schemaVersion, "2.6.0");
  assert.equal(Object.keys(p.people).length, 3);
  assert.deepEqual(p.recommendations.map((r) => r.consent.scope).sort(), ["full", "highlights"]);
  assert.equal(p.endorsements.length, 1);
  assert.deepEqual(p.badges.map((b) => b.credential.format).sort(), ["ob2-baked", "ob3-jsonld"]);
  for (const b of p.badges) assert.ok(existsSync(join(root, BUNDLE, b.credential.file.slice("bundle:".length))));
  const brief = readFileSync(join(root, "examples/out/recommended.brief.json"), "utf8");
  assert.doesNotMatch(brief, /note/i, "no internal notes in outputs");
});
