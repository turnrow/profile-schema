// The command line as people meet it: help, mistyped options, awkward files, several files at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProfile, loadMapping, convert, schema, BUNDLED_MAPPINGS } from "../index.mjs";
import { t, SUPPORTED_MESSAGE_LANGUAGES } from "../lib/i18n.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(root, "bin", "profile.mjs");
const SAMPLE = join(root, "examples", "sample.profile.json");
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const tmp = () => mkdtempSync(join(tmpdir(), "turnrow-cli-"));
const sample = () => JSON.parse(readFileSync(SAMPLE, "utf8"));

test("help lists every command and exits 0; no arguments does the same", () => {
  for (const args of [["help"], ["--help"], ["-h"], []]) {
    const r = cli(...args);
    assert.equal(r.status, 0, args.join(" "));
    for (const c of ["validate", "open", "convert", "import", "release", "writeback", "media add", "badges import", "Exit codes"]) {
      assert.match(r.stdout, new RegExp(c), `${args.join(" ")} mentions ${c}`);
    }
  }
});

test("version prints the package version", () => {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(cli("--version").stdout.trim(), version);
});

test("an unknown command or option is refused with exit code 2, not ignored", () => {
  assert.equal(cli("frobnicate").status, 2);
  const typo = cli("release", SAMPLE, "x", "--recrod");
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown option --recrod/);
  const missing = cli("convert", SAMPLE, "brief", "--out");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--out needs a value/);
});

test("--on and --locale are checked before they are used", () => {
  assert.match(cli("convert", SAMPLE, "linkedin", "--on", "tomorrow").stderr, /--on takes a date as yyyy-mm-dd/);
  assert.equal(cli("convert", SAMPLE, "linkedin", "--on", "2026-13-40").status, 2);
  assert.match(cli("convert", SAMPLE, "brief", "--locale", "en_US").stderr, /BCP 47/);
  assert.equal(cli("convert", SAMPLE, "brief", "--locale=es", "--on=2026-11-07").status, 0);
});

test("validate checks every file it is given", () => {
  const dir = tmp();
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ ...sample(), work: [{ id: "a", organisation: "x" }] }));
  const r = cli("validate", SAMPLE, bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /sample\.profile\.json is valid/);
  assert.match(r.stderr, /bad\.json/);
  assert.match(r.stderr, /1 of 2 files are not valid/);
  assert.equal(cli("validate", SAMPLE, SAMPLE).status, 0);
});

test("validate --json gives a machine-readable result and keeps the exit code", () => {
  const ok = cli("validate", SAMPLE, "--json");
  assert.equal(ok.status, 0);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.valid, true);
  assert.ok(Array.isArray(parsed.warnings) && Array.isArray(parsed.openItems));
  const dir = tmp();
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{}");
  const r = cli("validate", SAMPLE, bad, "--json");
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).map((x) => x.valid), [true, false]);
});

test("a file saved with a byte-order mark (Windows editors) still loads", () => {
  const dir = tmp();
  const file = join(dir, "bom.profile.json");
  writeFileSync(file, "﻿" + readFileSync(SAMPLE, "utf8").replace(/\n/g, "\r\n"));
  assert.equal(cli("validate", file).status, 0);
});

test("a zip, a missing file and a bad mapping name each get a plain explanation", () => {
  const dir = tmp();
  const zip = join(dir, "bundle.zip");
  writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
  assert.match(cli("validate", zip).stderr, /zip archive: unzip it/);
  assert.match(cli("validate", join(dir, "nope.json")).stderr, /no such file or folder/);
  const r = cli("convert", SAMPLE, "europass");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown mapping "europass": use one of jsonresume, schemaorg/);
  assert.match(cli("convert", SAMPLE, join(dir, "mine.json")).stderr, /no such mapping file/);
});

test("--out creates the folder it needs", () => {
  const dir = tmp();
  const file = join(dir, "out", "deep", "brief.json");
  assert.equal(cli("convert", SAMPLE, "brief", "--out", file).status, 0);
  assert.ok(existsSync(file));
});

test("import refuses what is not a JSON Resume", () => {
  const dir = tmp();
  const arr = join(dir, "arr.json");
  writeFileSync(arr, "[1]");
  assert.match(cli("import", arr).stderr, /is not a JSON Resume/);
  assert.match(cli("import", SAMPLE).stderr, /already a Turnrow Profile/);
});

test("schema errors name the misspelled field and list the allowed values", () => {
  const p = sample();
  p.work[0].organisation = "x";
  assert.match(validateProfile(p).errors.join("\n"), /"organisation" is not a known field here/);
  const q = sample();
  q.work[0].status = "aproved";
  assert.match(validateProfile(q).errors.join("\n"), /"draft", "pending", "approved"/);
});

test("loadMapping knows every bundled mapping and names them when asked for another", () => {
  for (const name of BUNDLED_MAPPINGS) assert.equal(typeof loadMapping(name).target, "string");
  assert.throws(() => loadMapping("../package"), /unknown mapping/);
});

test("the schema's $id points at the default branch", () => {
  assert.match(schema.$id, /\/turnrow\/profile-schema\/main\/schema\/profile\.schema\.json$/);
});

test("every supported language translates every phrase", () => {
  const keys = ["between", "present", "circa", "before", "after", "since", "nowAlso", "dba", "continued", "acquiredBy", "acquired",
    "mergedInto", "independent", "spunOff", "splitInto", "renamed", "and", "titleAt", "aColleague"];
  for (const lang of SUPPORTED_MESSAGE_LANGUAGES) for (const k of keys) {
    assert.notEqual(t(lang, k), k, `${lang}.${k} exists`);
    if (lang !== "en" && !["circa"].includes(k)) assert.notEqual(t(lang, k), t("en", k), `${lang}.${k} is translated`);
  }
});

test("a recommender's role is phrased in the output's language", () => {
  const p = JSON.parse(readFileSync(join(root, "examples", "recommended", "profile.json"), "utf8"));
  const from = (locale) => convert(p, loadMapping("linkedin"), { locale, on: "2026-11-07" }).text.match(/From: .*/)[0];
  assert.match(from("en"), /Shift Lead at Port of Example/);
  assert.match(from("es"), /Shift Lead en Port of Example/);
  assert.match(from("de"), /Shift Lead bei Port of Example/);
});
