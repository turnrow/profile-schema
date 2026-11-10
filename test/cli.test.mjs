// The command line as people meet it: help, mistyped options, awkward files, several files at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProfile, loadMapping, convert, schema, BUNDLED_MAPPINGS, scopeProfile, withPublishedMedia } from "../index.mjs";
import { readImageInfo, imageFor } from "../lib/media.mjs";
import { endorsementCount } from "../lib/people.mjs";
import { SUPPORTED_MESSAGE_LANGUAGES, MESSAGE_KEYS, translates } from "../lib/i18n.mjs";

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
  assert.match(r.stderr, /unknown mapping "europass": use one of ats, brief, gedcom551, gedcom7, jsonresume, linkedin, resume, schemaorg, scim, timeline, verification/);
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
  for (const lang of SUPPORTED_MESSAGE_LANGUAGES) for (const k of MESSAGE_KEYS) assert.ok(translates(lang, k), `${lang} has ${k}`);
});

test("a recommender's role is phrased in the output's language", () => {
  const p = JSON.parse(readFileSync(join(root, "examples", "recommended", "profile.json"), "utf8"));
  const from = (locale) => convert(p, loadMapping("linkedin"), { locale, on: "2026-11-07" }).text.match(/From: .*/)[0];
  assert.match(from("en"), /Shift Lead at Port of Example/);
  assert.match(from("es"), /Shift Lead en Port of Example/);
  assert.match(from("de"), /Shift Lead bei Port of Example/);
});

// ---------- fixes from the review of the 2.5/2.6 stack ----------

const RECOMMENDED = join(root, "examples", "recommended");
const recommended = () => JSON.parse(readFileSync(join(RECOMMENDED, "profile.json"), "utf8"));
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1")]);
const webp = Buffer.from("RIFF\x10\0\0\0WEBPVP8 ", "latin1");

test("a forgotten option value does not swallow the next option", () => {
  const r = cli("convert", SAMPLE, "brief", "--out", "--allow-rule-violations");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out needs a value/);
});

test("image formats that can't be checked for GPS are said to be unchecked, not clean", () => {
  for (const [bytes, type] of [[heic, "image/heic"], [webp, "image/webp"], [Buffer.from("II*\0\x08\0\0\0", "latin1"), "image/tiff"]]) {
    const info = readImageInfo(bytes);
    assert.equal(info.mediaType, type);
    assert.equal(info.uninspected, true);
  }
  assert.equal(readImageInfo(Buffer.from("%PDF-1.7")).uninspected, undefined);
});

test("media add refuses a photo it can't check for location metadata, and leaves the bundle alone", () => {
  const dir = join(tmp(), "bundle");
  cpSync(RECOMMENDED, dir, { recursive: true });
  const photo = join(tmp(), "phone.heic");
  writeFileSync(photo, heic);
  const before = readFileSync(join(dir, "profile.json"), "utf8");
  const r = cli("media", "add", dir, photo, "--id", "phone", "--alt", "A photo");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /image\/heic, which can't be checked for location/);
  assert.equal(readFileSync(join(dir, "profile.json"), "utf8"), before);
  assert.ok(!readdirSync(join(dir, "media")).some((f) => f.startsWith("phone")));
});

test("a 2.6.0 bundle holding an unchecked image format is invalid; an older one is warned", () => {
  const dir = join(tmp(), "bundle");
  cpSync(RECOMMENDED, dir, { recursive: true });
  writeFileSync(join(dir, "media", "phone.webp"), webp);
  const p = recommended();
  p.media.push({ id: "phone", title: "Phone photo", url: "bundle:media/phone.webp", alt: "A photo", status: "approved" });
  const strict = validateProfile(p, { bundleDir: dir });
  assert.match(strict.errors.join("\n"), /media\/phone: media\/phone\.webp is image\/webp, which can't be checked/);
  const older = validateProfile({ ...p, schemaVersion: "2.5.0" }, { bundleDir: dir });
  assert.match(older.warnings.join("\n"), /can't be checked for location/);
  assert.doesNotMatch(older.errors.join("\n"), /can't be checked for location/);
});

test("a media base without its closing slash still makes a folder URL", () => {
  const p = { person: { name: "A" }, media: [{ id: "m", url: "bundle:media/a.jpg" }] };
  assert.equal(withPublishedMedia(p, "https://example.com/me").media[0].url, "https://example.com/me/media/a.jpg");
  assert.equal(withPublishedMedia(p, "https://example.com/me/").media[0].url, "https://example.com/me/media/a.jpg");
  assert.match(cli("convert", RECOMMENDED, "schemaorg", "--media-base", "https://example.com/me", "--on", "2026-11-07").stdout, /example\.com\/me\/media\//);
  assert.equal(cli("convert", RECOMMENDED, "schemaorg", "--media-base", "example.com/me").status, 2);
});

test("a photo dated by month is in force for a job dated by year", () => {
  const profile = {
    media: [{ id: "old", url: "https://x.example/old.jpg", mediaType: "image/jpeg" }, { id: "new", url: "https://x.example/new.jpg", mediaType: "image/jpeg" }],
    person: { images: [{ media: "old", purpose: "primary", to: "2019-02" }, { media: "new", purpose: "primary", from: "2019-03" }] },
  };
  assert.equal(imageFor(profile, { entry: { startDate: "2019" } }, "2026-11-07").id, "new");
  assert.equal(imageFor(profile, { entry: { startDate: "2018" } }, "2026-11-07").id, "old");
  assert.equal(imageFor(profile, {}, "2019-02-10").id, "old");
  assert.equal(imageFor(profile, {}, "2019-03-01").id, "new");
});

test("endorsement counts leave out what an output may not show", () => {
  const profile = { endorsements: [
    { id: "a", target: "s", status: "approved", consent: { given: true } },
    { id: "b", target: "s", status: "approved", consent: { given: true }, visibility: "private" },
  ] };
  assert.equal(endorsementCount(profile, "s"), 2);
  assert.equal(endorsementCount(profile, "s", (e) => (e.visibility ?? "public") === "public"), 1);
});

test("a release holds no more of a recommendation than its author agreed to", () => {
  const audience = { kind: "other", purpose: "x", sections: ["recommendations"], baseVisibility: ["public", "network"], recipients: "anyVerified", verification: { methods: ["oidc"] } };
  const scopedWith = (scope) => {
    const p = recommended();
    p.audiences = { ...(p.audiences ?? {}), t: audience };
    const rec = p.recommendations.find((r) => r.consent?.given === true);
    rec.consent.scope = scope;
    // Only this recommendation names its author, so nothing else brings the person along.
    p.recommendations = [rec];
    p.endorsements = [];
    p.references = [];
    const { scoped } = scopeProfile(p, "t", { on: "2026-11-07" });
    return { rec: scoped.recommendations[0], who: scoped.people?.[rec.author], original: p.people[rec.author] };
  };
  const full = scopedWith("full");
  assert.ok(full.rec.text && full.who.name);

  const anon = scopedWith("anonymous");
  assert.equal(anon.who.name, undefined);
  assert.deepEqual(Object.keys(anon.who), ["roles"]);
  assert.ok(anon.who.roles.every((r) => !("organization" in r)));
  assert.equal(anon.rec.source, undefined);
  assert.ok(!anon.rec.authorAt || Object.keys(anon.rec.authorAt).join() === "title");
  assert.doesNotMatch(JSON.stringify([anon.rec, anon.who]), new RegExp(anon.original.name));

  const highlights = scopedWith("highlights");
  assert.equal(highlights.rec.text, undefined);
  assert.ok(highlights.who.name);

  const nameOnly = scopedWith("nameOnly");
  assert.equal(nameOnly.rec.text, undefined);
  assert.equal(nameOnly.rec.highlights, undefined);
});
