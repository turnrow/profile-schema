// GEDCOM 7.0 export and GEDZip. The output is held to FamilySearch's own structure tables
// (upstream/gedcom7/), by a checker that must first accept FamilySearch's own test files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert, loadMapping, validateProfile, gedcomDate, gedcomDateValue, gedcomPeriod, renderGedcom7, storeZip, gedzip, readBundleMedia, GEDCOM_EXTENSIONS } from "../index.mjs";
import { checkGedcom7, parseGedcom } from "./gedcom-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const upstream = (f) => readFileSync(join(root, "upstream", "gedcom7", f));
const sample = () => load("examples/sample.profile.json");
const ON = "2026-11-07";
const ged = (p, opts = {}) => convert(p, loadMapping("gedcom7"), { on: ON, ...opts }).text;
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin", "profile.mjs"), ...args], { encoding: "utf8" });
const tmp = () => mkdtempSync(join(tmpdir(), "turnrow-ged-"));
const indi = (text) => parseGedcom(text).roots.find((r) => r.tag === "INDI");
const kids = (node, tag) => node.children.filter((c) => c.tag === tag);
const kid = (node, tag) => kids(node, tag)[0];

// The stored files of a zip archive, read from its central directory: [{ name, method, data }].
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "has an end-of-central-directory record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), n = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + n);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, method, data: buf.subarray(dataAt, dataAt + size), crc: buf.readUInt32LE(at + 16) });
    at += 46 + n + extra + comment;
  }
  return out;
}

// ---------- the checker is trusted because it accepts the standard's own files ----------

test("the checker accepts FamilySearch's test files and rejects broken ones", () => {
  for (const f of ["minimal70.ged", "maximal70.ged", "escapes.ged"]) assert.deepEqual(checkGedcom7(upstream(f).toString("utf8")), [], f);
  const bad = checkGedcom7("0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 OCCU x\n2 DATE FROM 31 FOO 2020\n2 BOGUS y\n1 EVEN z\n1 SOUR @S9@\n1 NAME a\n2 TYPE NICK\n1 _X y\n0 TRLR\n").join("\n");
  assert.match(bad, /DATE: "FROM 31 FOO 2020" is not a date value/);
  assert.match(bad, /BOGUS: not allowed under OCCU/);
  assert.match(bad, /EVEN: needs a TYPE/);
  assert.match(bad, /points to @S9@, which is not a record/);
  assert.match(bad, /"NICK" is not one of/);
  assert.match(bad, /_X: extension tag is not declared/);
  assert.match(checkGedcom7("0 HEAD\n1 GEDC\n2 VERS 7.0\n").join("\n"), /last record must be TRLR/);
  assert.match(checkGedcom7("0 HEAD\n0 TRLR\n").join("\n"), /HEAD: needs a GEDC/);
});

// ---------- dates ----------

test("dates keep the precision and the doubt they were recorded with", () => {
  assert.equal(gedcomDate("1996"), "1996");
  assert.equal(gedcomDate("1996-03"), "MAR 1996");
  assert.equal(gedcomDate("1996-03-05"), "5 MAR 1996");
  assert.equal(gedcomDate("2023-05-02T14:30:00-07:00"), "2 MAY 2023");
  assert.equal(gedcomDate("1996-13"), undefined);
  assert.equal(gedcomDateValue({ value: "1996", qualifier: "about" }), "ABT 1996");
  assert.equal(gedcomDateValue({ value: "1996", qualifier: "estimated" }), "EST 1996");
  assert.equal(gedcomDateValue({ value: "1996", qualifier: "calculated" }), "CAL 1996");
  assert.equal(gedcomDateValue({ value: "1998", qualifier: "before" }), "BEF 1998");
  assert.equal(gedcomDateValue({ value: "1998-06", qualifier: "after" }), "AFT JUN 1998");
  assert.equal(gedcomDateValue({ between: ["1990", "1991"] }), "BET 1990 AND 1991");
});

test("a span is a period, an open one runs on, and a lone date is a moment", () => {
  assert.deepEqual(gedcomPeriod("2019-03", "2026-10"), { value: "FROM MAR 2019 TO OCT 2026", uncertain: false });
  assert.deepEqual(gedcomPeriod("2024-03", undefined, true), { value: "FROM MAR 2024", uncertain: false });
  assert.deepEqual(gedcomPeriod("2024-03"), { value: "MAR 2024", uncertain: false }, "not 'from March 2024 on'");
  assert.deepEqual(gedcomPeriod({ value: "2008", qualifier: "about" }), { value: "ABT 2008", uncertain: false });
  // A period holds only plain dates, so an uncertain end is flagged for a PHRASE beside it.
  assert.deepEqual(gedcomPeriod({ value: "1996", qualifier: "about" }, "2009-05"), { value: "FROM 1996 TO MAY 2009", uncertain: true });
  assert.deepEqual(gedcomPeriod({ between: ["1990", "1991"] }, "1995"), { value: "FROM 1990 TO 1995", uncertain: true });
  assert.deepEqual(gedcomPeriod(undefined, "1995"), { value: "TO 1995", uncertain: false });
});

// ---------- the export ----------

test("every example exports as GEDCOM 7 that conforms to the standard's tables", () => {
  for (const f of ["examples/sample.profile.json", "examples/history.profile.json", "examples/employee.profile.json", "examples/rtl.profile.json", "examples/recommended/profile.json"]) {
    const text = ged(load(f));
    assert.deepEqual(checkGedcom7(text), [], f);
    assert.match(text, /^0 HEAD\n1 GEDC\n2 VERS 7\.0\n/);
    assert.match(text, /\n0 TRLR\n$/);
    assert.equal(parseGedcom(text).roots.filter((r) => r.tag === "INDI").length, 1, "one individual");
  }
  assert.deepEqual(checkGedcom7(ged(sample(), { visibility: ["public", "network"], locale: "es" })), []);
});

test("the header names the version, the extension, the product, the date and the language", () => {
  const head = parseGedcom(ged(sample())).roots[0];
  assert.equal(kid(kid(head, "GEDC"), "VERS").value, "7.0");
  assert.deepEqual(kids(kid(head, "SCHMA"), "TAG").map((t) => t.value), Object.entries(GEDCOM_EXTENSIONS).map(([tag, uri]) => `${tag} ${uri}`));
  assert.equal(kid(head, "SOUR").value, "https://github.com/turnrow/profile-schema");
  assert.equal(kid(head, "DATE").value, "7 NOV 2026");
  assert.equal(kid(head, "LANG").value, "en-US");
});

test("each title held is an occupation with its dates, place and the employer's name at the time", () => {
  const me = indi(ged(load("examples/history.profile.json")));
  const jobs = kids(me, "OCCU");
  assert.deepEqual(jobs.map((j) => j.value).slice(0, 3), ["Associate", "Senior Associate", "Network Engineer"], "oldest first, one per title");
  assert.equal(kid(jobs[0], "AGNC").value, "Coopers & Lybrand", "the name then, not today's");
  assert.equal(kid(jobs[0], "DATE").value, "FROM MAR 1996 TO JUN 1998");
  assert.equal(kid(jobs[0], "PLAC").value, "Dallas, Texas");
  // Four titles at one employer are four occupations, each under the name the employer had then.
  assert.deepEqual(jobs.slice(3).map((j) => kid(j, "AGNC").value), ["EDS", "EDS", "EDS, an HP Company", "HP Enterprise Services"]);
  const current = kids(indi(ged(sample())), "OCCU").at(-1);
  assert.equal(kid(current, "DATE").value, "FROM MAR 2024", "a current job has no end");
});

test("uncertain dates say so: a qualified date, or a period with its wording beside it", () => {
  const me = indi(ged(sample()));
  const lab = kids(me, "OCCU").find((o) => o.value === "Research Biologist");
  assert.equal(kid(lab, "DATE").value, "FROM 1996 TO MAY 2009");
  assert.equal(kid(kid(lab, "DATE"), "PHRASE").value, "c. 1996 – May 2009");
  assert.equal(kid(kid(me, "RESI"), "DATE").value, "ABT 2008");
  const founding = kids(me, "EVEN").find((e) => kid(e, "TYPE").value === "Founding");
  assert.equal(kid(founding, "DATE").value, "MAR 2024");
  const reserve = kids(me, "EVEN").find((e) => kid(e, "TYPE").value === "Reserve service");
  assert.equal(kid(reserve, "DATE").value, "FROM 1990 TO 1995");
  assert.match(kid(kid(reserve, "DATE"), "PHRASE").value, /between 1990 and 1991/);
  assert.equal(kid(reserve, "AGNC").value, "Coast Guard Auxiliary (fictional unit)");
});

test("facts cite their sources, with the page and a quality from the evidence", () => {
  const text = ged(sample());
  const { roots } = parseGedcom(text);
  const me = indi(text);
  const director = kids(me, "OCCU").find((o) => o.value === "Director of Development");
  const cites = kids(director, "SOUR");
  assert.equal(cites.length, 2);
  const titleOf = (c) => kid(roots.find((r) => r.xref === c.value), "TITL").value;
  assert.equal(titleOf(cites[0]), "Harborline offer letter");
  assert.equal(kid(cites[0], "QUAY").value, "3", "primary evidence");
  assert.equal(titleOf(cites[1]), "Ines Calloway CV, 2024");
  assert.equal(kid(cites[1], "QUAY").value, "1", "the subject's own account");
  assert.equal(kid(cites[1], "PAGE").value, "p1");
  assert.equal(kid(director, "_CONF").value, "high");
  // Only sources that a written fact cites are written.
  const written = roots.filter((r) => r.tag === "SOUR").length;
  assert.ok(written > 0 && written < Object.keys(sample().sources).length + 1);
  for (const s of roots.filter((r) => r.tag === "SOUR")) assert.ok(text.includes(`SOUR ${s.xref}\n`), `${s.xref} is cited`);
});

test("what is private, unapproved or internal stays out", () => {
  const p = sample();
  p.work[0].note = "INTERNAL-NOTE do not publish";
  Object.values(p.sources)[0].location = "SECRET-DRAWER third shelf";
  const text = ged(p);
  assert.doesNotMatch(text, /Calloway Ortega/, "the private legal name");
  assert.doesNotMatch(text, /\bNes\b/, "the network-only nickname");
  assert.doesNotMatch(text, /Hospitality consultant/, "a pending job");
  assert.doesNotMatch(text, /Coastal Management/, "network-only study");
  assert.doesNotMatch(text, /INTERNAL-NOTE|SECRET-DRAWER/);
  assert.doesNotMatch(text, /ines@example\.com|555-0100/, "contact details");
  // Other people's names and words are not part of a GEDCOM individual.
  assert.doesNotMatch(ged(load("examples/recommended/profile.json")), /Maria Chen|Sam Okafor|Priya Raman/);
  // Network-level entries arrive only when asked for.
  assert.match(ged(sample(), { visibility: ["public", "network"] }), /1 NAME Nes\n2 TYPE AKA\n2 NICK Nes/);
});

test("names carry their parts, their type, and when they were in use", () => {
  const p = sample();
  p.person.names.push({ type: "birth", full: "Ines Marlow", given: "Ines", family: "Marlow", to: "2001-06" }, { type: "professional", full: "I. M. Calloway", from: "2001-07" });
  assert.equal(validateProfile(p).valid, true);
  const names = kids(indi(ged(p)), "NAME");
  assert.deepEqual(names.map((n) => n.value), ["Ines /Calloway/", "Ines /Marlow/", "I. M. Calloway"]);
  assert.equal(kid(names[0], "GIVN").value, "Ines");
  assert.equal(kid(names[0], "SURN").value, "Calloway");
  assert.equal(kid(names[1], "TYPE").value, "BIRTH");
  assert.match(kid(names[1], "NOTE").value, /^In use: Jun 2001$/);
  assert.equal(kid(names[2], "TYPE").value, "PROFESSIONAL");
  // With no dated names at all, the display name is the name.
  const bare = sample();
  delete bare.person.names;
  assert.deepEqual(kids(indi(ged(bare)), "NAME").map((n) => n.value), ["Ines Calloway"]);
});

test("text that spans lines or starts with @ survives the trip", () => {
  const view = { name: "A", facts: [{ tag: "OCCU", value: "@home worker", note: "First line\n\n@second para\r\nthird\u0007 line", date: "1999" }], sources: [] };
  const text = renderGedcom7(view);
  assert.match(text, /1 OCCU @@home worker\n/);
  assert.match(text, /2 NOTE First line\n3 CONT\n3 CONT @@second para\n3 CONT third  line\n/);
  assert.deepEqual(checkGedcom7(text), []);
  const occu = kid(indi(text), "OCCU");
  assert.equal(occu.value, "@home worker");
  assert.equal(kid(occu, "NOTE").value, "First line\n\n@second para\nthird  line");
});

test("media travel as OBJE records: by web address in a .ged, by path in a GEDZip", () => {
  const p = load("examples/recommended/profile.json");
  const web = ged(p);
  assert.match(web, /1 OBJE @O1@\n0 @O1@ OBJE\n1 FILE https:\/\/ines-ortega\.example\/files\/media\/headshot\.png\n2 FORM image\/png\n3 MEDI PHOTO\n2 TITL /);
  assert.match(web, /1 NOTE Description: Illustrated placeholder portrait/);
  delete p.meta.mediaBaseUrl;
  assert.doesNotMatch(ged(p), /OBJE/, "a bundle file with nowhere to point is left out");
  assert.deepEqual(checkGedcom7(ged(p)), []);
});

test("the committed example files are current", () => {
  for (const [name, src] of [["sample", "examples/sample.profile.json"], ["history", "examples/history.profile.json"], ["recommended", "examples/recommended/profile.json"]]) {
    assert.equal(readFileSync(join(root, "examples", "out", `${name}.ged`), "utf8"), ged(load(src)), name);
  }
});

// ---------- GEDZip ----------

test("the zip reader used here reads FamilySearch's own GEDZip", () => {
  const files = readZip(upstream("maximal70.gdz"));
  assert.ok(files.some((f) => f.name === "gedcom.ged"));
  assert.ok(files.length > 1);
});

test("a GEDZip holds gedcom.ged and the media, stored as they are", () => {
  const png = readFileSync(join(root, "examples", "recommended", "media", "headshot.png"));
  const zip = gedzip("0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n", [{ name: "media/headshot.png", data: png }, { name: "media/ünï côde.txt", data: Buffer.from("x") }]);
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ["gedcom.ged", "media/headshot.png", "media/ünï côde.txt"]);
  assert.ok(files.every((f) => f.method === 0), "stored, not compressed");
  assert.ok(files[1].data.equals(png));
  assert.equal(files[0].data.toString("utf8"), "0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n");
  assert.ok(zip.equals(gedzip("0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n", [{ name: "media/headshot.png", data: png }, { name: "media/ünï côde.txt", data: Buffer.from("x") }])), "the same input makes the same archive");
  for (const name of ["../escape.txt", "/abs.txt", "a/../../b", "a\\b"]) assert.throws(() => storeZip([{ name, data: "x" }]), /not a relative archive path/);
  assert.throws(() => storeZip([{ name: "a", data: "x" }, { name: "a", data: "y" }]), /already holds/);
});

test("a GEDZip takes media only from inside the bundle", () => {
  const dir = join(tmp(), "bundle");
  cpSync(join(root, "examples", "recommended"), dir, { recursive: true });
  assert.equal(readBundleMedia(dir, ["media/headshot.png", "media/headshot.png"]).length, 1);
  const secret = join(tmp(), "secret.txt");
  writeFileSync(secret, "secret");
  symlinkSync(secret, join(dir, "media", "link.txt"));
  for (const rel of ["media/link.txt", "../outside.txt", "media/missing.png"]) assert.throws(() => readBundleMedia(dir, [rel]), /not a file inside the bundle/);
});

test("convert … gedcom7 --gedzip writes an archive whose file names its media by path", () => {
  const out = join(tmp(), "deep", "ines.gdz");
  const r = cli("convert", join(root, "examples", "recommended"), "gedcom7", "--gedzip", "--on", ON, "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /gedcom\.ged and 1 media file\./);
  const files = readZip(readFileSync(out));
  assert.deepEqual(files.map((f) => f.name), ["gedcom.ged", "media/headshot.png"]);
  const text = files[0].data.toString("utf8");
  assert.match(text, /1 FILE media\/headshot\.png\n2 FORM image\/png/);
  assert.deepEqual(checkGedcom7(text), []);
  // Plain text to the screen, and the option's own checks.
  const plain = cli("convert", join(root, "examples", "sample.profile.json"), "gedcom7", "--on", ON);
  assert.equal(plain.status, 0);
  assert.deepEqual(checkGedcom7(plain.stdout), []);
  assert.match(cli("convert", join(root, "examples", "sample.profile.json"), "gedcom7", "--gedzip").stderr, /--gedzip needs --out/);
  assert.match(cli("convert", join(root, "examples", "sample.profile.json"), "brief", "--gedzip", "--out", join(tmp(), "x.gdz")).stderr, /goes with the gedcom7 output/);
  assert.ok(!existsSync(join(tmp(), "x.gdz")));
});
