import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { readImageInfo, stripGps } from "../lib/media.mjs";
import { validateProfile, convert, loadMapping } from "../index.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const sample = () => read("../examples/sample.profile.json");
const ON = "2026-11-07";
const has = (list, re) => list.some((x) => re.test(x));

// ---------- fixtures built from bytes ----------

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, "latin1"), data, u32(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])))]);
const IDAT = chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0])));
function png({ xmp } = {}) {
  const ihdr = Buffer.concat([u32(1), u32(1), Buffer.from([8, 2, 0, 0, 0])]);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (xmp) parts.push(chunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), Buffer.from(xmp, "utf8")])));
  parts.push(IDAT, chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const XMP_GPS = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="35,44.6N" exif:GPSLongitude="81,41.1W"><exif:GPSAltitude>350/1</exif:GPSAltitude></rdf:Description></rdf:RDF></x:xmpmeta>`;

// A JPEG with an Exif APP1 holding IFD0 (Make, GPS pointer) and a GPS IFD with a latitude (out-of-line RATIONALs).
function jpegWithGps() {
  const le16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const entry = (tag, type, count, value) => Buffer.concat([le16(tag), le16(type), le32(count), value]);
  // TIFF header at 0; IFD0 at 8 with 2 entries (2 + 2*12 + 4 = 30 bytes) → ends at 38.
  const make = Buffer.from("Acme\0\0\0\0", "latin1"); // 8 bytes at 38
  const gpsIfdAt = 46;
  const ifd0 = Buffer.concat([le16(2), entry(0x010f, 2, 5, le32(38)), entry(0x8825, 4, 1, le32(gpsIfdAt)), le32(0)]);
  // GPS IFD: 2 entries (VersionID inline, Latitude → 3 RATIONALs at 76) = 30 bytes → 46..76
  const lat = Buffer.concat([le32(35), le32(1), le32(44), le32(1), le32(36), le32(1)]); // 24 bytes at 76
  const gps = Buffer.concat([le16(2), entry(0x0000, 1, 4, Buffer.from([2, 3, 0, 0])), entry(0x0002, 5, 3, le32(76)), le32(0)]);
  const tiff = Buffer.concat([Buffer.from("II*\0", "latin1"), le32(8), ifd0, make, gps, lat]);
  const app1Data = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(app1Data.length + 2) >> 8, (app1Data.length + 2) & 255]), app1Data]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00]); // 3×2, 1 component
  const scan = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9]);
  return { file: Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, scan]), scan };
}

// ---------- readImageInfo and stripGps ----------

test("readImageInfo reads PNG and JPEG dimensions", () => {
  assert.deepEqual({ ...readImageInfo(png()), metadata: undefined }, { mediaType: "image/png", width: 1, height: 1, gps: false, gpsWhere: [], metadata: undefined });
  const j = readImageInfo(jpegWithGps().file);
  assert.equal(j.mediaType, "image/jpeg");
  assert.equal(j.width, 3);
  assert.equal(j.height, 2);
  assert.equal(j.metadata.make, "Acme");
});

test("GPS is found in EXIF and in XMP", () => {
  assert.deepEqual(readImageInfo(jpegWithGps().file).gpsWhere, ["exif"]);
  assert.deepEqual(readImageInfo(png({ xmp: XMP_GPS })).gpsWhere, ["xmp"]);
  assert.equal(readImageInfo(png({ xmp: "<x:xmpmeta/>" })).gps, false);
});

test("stripGps removes both, keeps pixels and other metadata", () => {
  const { file, scan } = jpegWithGps();
  const j = stripGps(file, "image/jpeg");
  assert.equal(readImageInfo(j).gps, false);
  assert.equal(readImageInfo(j).metadata.make, "Acme", "the rest of EXIF survives (orientation, camera)");
  assert.ok(j.subarray(j.length - scan.length).equals(scan), "scan data untouched");
  assert.equal(j.length, file.length, "rewritten in place");
  assert.ok(!j.includes(Buffer.from([35, 0, 0, 0, 1, 0, 0, 0, 44]), "latitude values zeroed"));

  const p = stripGps(png({ xmp: XMP_GPS }), "image/png");
  const info = readImageInfo(p);
  assert.equal(info.gps, false);
  assert.deepEqual([info.width, info.height], [1, 1]);
  assert.ok(p.includes(IDAT), "pixel data untouched");
  assert.ok(!p.toString("latin1").includes("GPS"));
});

// ---------- validation ----------

function bundleWith(files, edit) {
  const dir = mkdtempSync(join(tmpdir(), "tp-media-"));
  mkdirSync(join(dir, "media"));
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, "media", name), bytes);
  const p = sample();
  p.schemaVersion = "2.6.0";
  edit(p);
  return { dir, p };
}

test("validate (2.6): a bundle image with GPS is an error; in 2.5 a warning", () => {
  const { dir, p } = bundleWith({ "me.jpg": jpegWithGps().file }, (p) => { p.person.image = { url: "bundle:media/me.jpg", alt: "Portrait" }; });
  assert.ok(has(validateProfile(p, { bundleDir: dir }).errors, /person\.image: media\/me\.jpg carries location \(GPS\) metadata in exif/));
  p.schemaVersion = "2.5.0";
  const r = validateProfile(p, { bundleDir: dir });
  assert.equal(r.valid, true, r.errors.join("\n"));
  assert.ok(has(r.warnings, /carries location \(GPS\) metadata/));
});

test("validate: an image without alt warns", () => {
  const p = sample();
  p.schemaVersion = "2.6.0";
  p.media.push({ id: "pic", title: "Team photo", url: "https://example.com/team.jpg", mediaType: "image/jpeg", status: "approved" });
  assert.ok(has(validateProfile(p).warnings, /media\/pic: an image without alt text/));
});

test("validate: unknown media id on a position or responsibility errors", () => {
  const p = read("../examples/history.profile.json");
  p.work[0].positions[0].media = ["nope"];
  p.work[0].responsibilities[0].media = ["nope2"];
  const e = validateProfile(p).errors;
  assert.ok(has(e, /position eds-se: unknown media "nope"/));
  assert.ok(has(e, /responsibility .*: unknown media "nope2"/));
});

// ---------- choosing the image ----------

function withImages() {
  const p = sample();
  p.schemaVersion = "2.6.0";
  p.media.push(
    { id: "h2015", title: "Headshot 2015", url: "https://example.com/h2015.jpg", mediaType: "image/jpeg", alt: "Ines in 2015", status: "approved", confidence: "high" },
    { id: "h2024", title: "Headshot 2024", url: "https://example.com/h2024.jpg", mediaType: "image/jpeg", alt: "Ines in 2024", status: "approved", confidence: "high",
      renditions: [{ url: "https://example.com/h2024-sq.jpg", width: 400, height: 400, purpose: "square" }] },
    { id: "h2024b", title: "Headshot 2024 (alt)", url: "https://example.com/h2024b.jpg", mediaType: "image/jpeg", alt: "Ines in 2024, outdoors", status: "approved", confidence: "high" },
  );
  p.person.images = [
    { media: "h2015", purpose: "primary", from: "2015", to: "2023-12" },
    { media: "h2024", purpose: "primary", from: "2024-01" },
    { media: "h2024b", purpose: "primary", from: "2024-06" },
  ];
  return p;
}

test("the dated image in force is chosen; when two overlap the later 'from' wins, with a warning", () => {
  const p = withImages();
  const v = validateProfile(p);
  assert.equal(v.valid, true, v.errors.join("\n"));
  assert.ok(has(v.warnings, /person\.images: h2024 and h2024b overlap for "primary"/));
  const at = (on) => convert(p, loadMapping("schemaorg"), { on }).output.mainEntity.image.contentUrl;
  assert.equal(at("2019-05-01"), "https://example.com/h2015.jpg");
  assert.equal(at("2024-03-01"), "https://example.com/h2024-sq.jpg", "the square rendition, when there is one");
  assert.equal(at(ON), "https://example.com/h2024b.jpg");
  assert.equal(convert(p, loadMapping("brief"), { on: "2019-05-01" }).output.photoAlt, "Ines in 2015");
});

test("imageFor(position) prefers the position's media, then the job's, then the person image at the position's start", async () => {
  const { imageFor } = await import("../lib/media.mjs");
  const p = withImages();
  const w = p.work[0];
  w.media = ["h2015"];
  const pos = { id: "x", title: "t", startDate: "2024-02", media: ["h2024b"] };
  assert.equal(imageFor(p, { entry: w, position: pos }).id, "h2024b");
  assert.equal(imageFor(p, { entry: w, position: { ...pos, media: undefined } }).id, "h2015");
  assert.equal(imageFor(p, { entry: { ...w, media: undefined }, position: { ...pos, media: undefined } }).id, "h2024");
});

test("person.image still works when there are no dated images", () => {
  const p = sample();
  const ld = convert(p, loadMapping("schemaorg"), { on: ON }).output;
  assert.equal(ld.mainEntity.image.contentUrl, p.person.image.url);
});

// ---------- media add ----------

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const CLI = new URL("../bin/profile.mjs", import.meta.url).pathname;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
function newBundle() {
  const dir = mkdtempSync(join(tmpdir(), "tp-add-"));
  const p = sample();
  p.schemaVersion = "2.6.0";
  delete p.person.image;
  writeFileSync(join(dir, "profile.json"), JSON.stringify(p, null, 2));
  return dir;
}
const profileIn = (dir) => JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));

test("media add copies into media/, records hash, size, dimensions and uuid, and adds a dated person image", () => {
  const dir = newBundle();
  const src = join(dir, "..", `pic-${Date.now()}.png`);
  writeFileSync(src, png());
  const r = cli("media", "add", dir, src, "--id", "me", "--alt", "Portrait of Ines", "--kind", "headshot", "--purpose", "primary", "--from", "2024-01");
  assert.equal(r.status, 0, r.stderr);
  const p = profileIn(dir);
  const m = p.media.find((x) => x.id === "me");
  assert.equal(m.url, "bundle:media/me.png");
  assert.equal(m.sha256, sha256(png()));
  assert.deepEqual([m.byteSize, m.width, m.height, m.mediaType, m.kind], [png().length, 1, 1, "image/png", "headshot"]);
  assert.match(m.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(p.person.images, [{ media: "me", purpose: "primary", from: "2024-01" }]);
  assert.ok(readFileSync(join(dir, "media", "me.png")).equals(png()));
  assert.equal(validateProfile(p, { bundleDir: dir }).valid, true);
});

test("media add refuses a file with GPS unless --strip-gps, and then stores a stripped copy", () => {
  const dir = newBundle();
  const src = join(dir, "..", `gps-${Date.now()}.jpg`);
  writeFileSync(src, jpegWithGps().file);
  const refused = cli("media", "add", dir, src, "--id", "me", "--alt", "Portrait");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /location \(GPS\) metadata in exif; re-run with --strip-gps/);
  assert.equal(profileIn(dir).media.some((x) => x.id === "me"), false, "nothing written");
  const ok = cli("media", "add", dir, src, "--id", "me", "--alt", "Portrait", "--strip-gps");
  assert.equal(ok.status, 0, ok.stderr);
  const m = profileIn(dir).media.find((x) => x.id === "me");
  const stored = readFileSync(join(dir, "media", "me.jpg"));
  assert.equal(readImageInfo(stored).gps, false);
  assert.notEqual(m.sha256, sha256(jpegWithGps().file));
  assert.equal(m.sha256, sha256(stored));
  assert.equal(m.metadata.make, "Acme");
});

test("media add with an existing id adds a new version that keeps the uuid", () => {
  const dir = newBundle();
  const src = join(dir, "..", `v-${Date.now()}.png`);
  writeFileSync(src, png());
  cli("media", "add", dir, src, "--id", "me", "--alt", "Portrait", "--purpose", "primary", "--from", "2020");
  writeFileSync(src, png({ xmp: "<x:xmpmeta/>" }));
  const r = cli("media", "add", dir, src, "--id", "me", "--alt", "Portrait, newer", "--purpose", "primary", "--from", "2025-03");
  assert.equal(r.status, 0, r.stderr);
  const p = profileIn(dir);
  const [v1, v2] = ["me", "me-v2"].map((id) => p.media.find((x) => x.id === id));
  assert.equal(v2.supersedes, "me");
  assert.equal(v2.uuid, v1.uuid);
  assert.equal(v2.version, "2");
  assert.equal(v2.url, "bundle:media/me-v2.png");
  assert.deepEqual(p.person.images.map((x) => x.media), ["me", "me-v2"]);
});
