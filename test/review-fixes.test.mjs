// Findings from the 2.6 whole-branch review, each pinned by a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { crc32, deflateSync } from "node:zlib";
import { validateProfile, convert, loadMapping, scopeProfile } from "../index.mjs";
import { readImageInfo, stripGps, pngChunks } from "../lib/media.mjs";
import { withRec } from "./people-fixtures.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CLI = join(ROOT, "bin/profile.mjs");
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: "utf8" });
const ON = "2026-11-07";
const bundle = () => { const d = join(mkdtempSync(join(tmpdir(), "tp-rf-")), "b"); cpSync(join(ROOT, "examples/recommended"), d, { recursive: true }); return d; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const chunk = (t, d) => Buffer.concat([u32(d.length), Buffer.from(t, "latin1"), d, u32(crc32(Buffer.concat([Buffer.from(t, "latin1"), d])))]);
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = chunk("IHDR", Buffer.concat([u32(1), u32(1), Buffer.from([8, 2, 0, 0, 0])]));
const tail = [chunk("IDAT", deflateSync(Buffer.from([0, 9, 9, 9]))), chunk("IEND", Buffer.alloc(0))];
const pngWith = (...extra) => Buffer.concat([SIG, ihdr, ...extra, ...tail]);
// TIFF with a GPS IFD whose one entry points at valueAt.
const exifGps = (valueAt) => Buffer.concat([Buffer.from("MM\0*", "latin1"), u32(8),
  u16(1), u16(0x8825), u16(4), u32(1), u32(26), u32(0),
  u16(1), u16(2), u16(5), u32(3), u32(valueAt), u32(0)]);

// ---------- C1: never overwrite or delete a file the command didn't create ----------

test("media add refuses an id whose file already exists, and leaves it alone", () => {
  const d = bundle();
  const before = readFileSync(join(d, "media/headshot.png"));
  const p = JSON.parse(readFileSync(join(d, "profile.json"), "utf8"));
  p.media[0].id = "portrait"; p.person.images[0].media = "portrait"; // portrait → media/headshot.png
  writeFileSync(join(d, "profile.json"), JSON.stringify(p));
  const src = join(d, "..", "new.png"); writeFileSync(src, pngWith());
  const r = cli("media", "add", d, src, "--id", "headshot", "--alt", "x");
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /already exists/);
  assert.ok(readFileSync(join(d, "media/headshot.png")).equals(before));
});

test("media add and badges import refuse an id that isn't a plain id, and touch nothing", () => {
  const d = bundle();
  writeFileSync(join(d, "keep.png"), "keep");
  const src = join(d, "..", "new.png"); writeFileSync(src, pngWith());
  const r = cli("media", "add", d, src, "--id", "../keep", "--alt", "x");
  assert.equal(r.status, 2); assert.match(r.stderr, /not a valid id/);
  assert.equal(readFileSync(join(d, "keep.png"), "utf8"), "keep");
  const b = cli("badges", "import", d, join(d, "badges/harbor-ops-badge.json"), "--id", "../media/headshot");
  assert.equal(b.status, 2); assert.match(b.stderr, /not a valid id/);
  assert.ok(existsSync(join(d, "media/headshot.png")));
});

// ---------- C2: anonymous means title only ----------

test("anonymous scope: no output names the author's employer, and schema.org has no worksFor", () => {
  const p = withRec({ consent: { given: true, on: "2026-11-02", scope: "anonymous" } });
  const li = convert(p, loadMapping("linkedin"), { on: ON }).text;
  assert.match(li, /From: Engineering Manager\n/);
  const r = convert(p, loadMapping("schemaorg"), { on: ON }).output.review[0];
  assert.equal(r.author.worksFor, undefined);
  assert.equal(r.author.jobTitle, "Engineering Manager");
  const brief = convert({ ...p, recommendations: [{ ...p.recommendations[0], priority: 90 }] }, loadMapping("brief"), { on: ON }).output;
  assert.equal(brief.recommendations[0].by, "Engineering Manager");
});

// ---------- I1: a draft or private photo is never the output's image ----------

test("a private or draft media entry is not used as the person's image", () => {
  const p = JSON.parse(readFileSync(join(ROOT, "examples/recommended/profile.json"), "utf8"));
  assert.ok(convert(p, loadMapping("brief"), { on: ON }).output.photo);
  p.media[0].visibility = "private";
  assert.equal(convert(p, loadMapping("brief"), { on: ON }).output.photo, undefined);
  p.media[0].visibility = "public"; p.media[0].status = "draft";
  assert.equal(convert(p, loadMapping("jsonresume"), { on: ON }).output.basics.image, undefined);
});

// ---------- I2: every bundle: link is checked ----------

test("bundle links on people images and badge images are checked like the rest", () => {
  const d = bundle();
  const p = JSON.parse(readFileSync(join(d, "profile.json"), "utf8"));
  p.people["maria-chen"].images.push({ url: "bundle:people/missing.png" });
  p.badges[0].achievement.image = { url: "bundle:../../etc/hostname" };
  const r = validateProfile(p, { bundleDir: d });
  assert.ok(r.errors.some((e) => /people\/maria-chen.*not found/.test(e)), r.errors.join("\n"));
  assert.ok(r.errors.some((e) => /badges\/harbor-ops-badge.*escapes/.test(e)), r.errors.join("\n"));
});

// ---------- I3: malformed images don't throw, and stripping stays inside its block ----------

test("malformed PNG and EXIF data are reported, not thrown", () => {
  const truncated = Buffer.concat([SIG, u32(13), Buffer.from("IHDR"), Buffer.from([0, 0])]);
  assert.doesNotThrow(() => readImageInfo(truncated));
  const hugeIfd = pngWith(chunk("eXIf", Buffer.concat([Buffer.from("MM\0*", "latin1"), u32(8), u16(0xffff)])));
  assert.doesNotThrow(() => readImageInfo(hugeIfd));
  assert.doesNotThrow(() => stripGps(pngWith(chunk("eXIf", exifGps(0x7fffffff)))));
  const d = bundle();
  writeFileSync(join(d, "media/headshot.png"), truncated);
  const p = JSON.parse(readFileSync(join(d, "profile.json"), "utf8"));
  delete p.media[0].sha256;
  const r = validateProfile(p, { bundleDir: d });
  assert.ok(r.errors.some((e) => /media\/headshot: .*unreadable/.test(e)), r.errors.join("\n"));
});

test("stripping GPS never writes outside the EXIF block", () => {
  const exif = exifGps(40); // points past the end of the eXIf data (38 bytes)
  const png = pngWith(chunk("eXIf", exif));
  assert.equal(readImageInfo(png).gps, true);
  const out = stripGps(png);
  assert.deepEqual(pngChunks(out).map((c) => c.type), pngChunks(png).map((c) => c.type));
  assert.equal(readImageInfo(out).gps, false);
});

// ---------- I4: versions match the id exactly ----------

test("media add versions only the same id, not ids that share a prefix", () => {
  const d = bundle();
  const p = JSON.parse(readFileSync(join(d, "profile.json"), "utf8"));
  p.media.push({ ...p.media[0], id: "head-vintage", uuid: "11111111-2222-4333-8444-555555555555", url: "https://example.com/v.png" });
  delete p.media.at(-1).sha256;
  writeFileSync(join(d, "profile.json"), JSON.stringify(p));
  const src = join(d, "..", "n.png"); writeFileSync(src, pngWith());
  assert.equal(cli("media", "add", d, src, "--id", "head", "--alt", "x").status, 0);
  const after = JSON.parse(readFileSync(join(d, "profile.json"), "utf8")).media.at(-1);
  assert.equal(after.id, "head");
  assert.equal(after.supersedes, undefined);
  assert.notEqual(after.uuid, "11111111-2222-4333-8444-555555555555");
  writeFileSync(src, pngWith(chunk("tEXt", Buffer.from("Comment\0v2"))));
  assert.equal(cli("media", "add", d, src, "--id", "headshot", "--alt", "x").status, 0);
  const v2 = JSON.parse(readFileSync(join(d, "profile.json"), "utf8")).media.at(-1);
  assert.equal(v2.id, "headshot-v2"); assert.equal(v2.supersedes, "headshot"); assert.equal(v2.uuid, p.media[0].uuid);
});

// ---------- I5: consent covers named audiences, and releases leave out what can't be shown ----------

test("a recommendation shared with a named audience needs consent, and a release never carries an unconsented one", () => {
  const p = withRec({ consent: undefined, visibility: "private", audiences: ["current-employer"] });
  assert.ok(validateProfile(p).errors.some((e) => /consent/.test(e)));
  p.audiences["current-employer"].sections.push("recommendations");
  const { scoped, released } = scopeProfile(p, "current-employer", { on: ON });
  assert.equal(scoped.recommendations, undefined);
  assert.ok(!released.includes("rec-maria"));
  assert.equal(scoped.people, undefined);
});
