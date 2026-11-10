// The HR Open Standards 4.5 Candidate: what goes where, what stays out, and (when the release has
// been fetched: node scripts/fetch-hropen-schemas.mjs; CI does) validity against HR Open's schemas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv4 from "ajv-draft-04";
import addFormats from "ajv-formats";
import { convert, loadMapping, validateProfile } from "../index.mjs";
import { DEFAULT_DIR, MARKER, RELEASE, unzip } from "../scripts/fetch-hropen-schemas.mjs";
import { storeZip } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const ON = "2026-11-07";
const hr = (p, opts = {}) => convert(p, loadMapping("hropen"), { on: ON, ...opts }).output;
const EXAMPLES = ["examples/sample.profile.json", "examples/history.profile.json", "examples/employee.profile.json", "examples/rtl.profile.json", "examples/recommended/profile.json"];

test("a candidate: the person, then one profile", () => {
  const c = hr(sample());
  assert.equal(c.person.name.formattedName, "Ines Calloway");
  assert.equal(c.person.name.family, "Calloway");
  assert.equal(c.uri, "https://example.com/team/ines-calloway");
  assert.equal(c.profiles.length, 1);
  assert.equal(c.profiles[0].languageCode, "en-US");
  assert.match(c.profiles[0].executiveSummary, /research boats/);
  assert.equal(c.person.communication.address[0].countryCode, "US");
});

test("private contact details stay out unless the output is asked to carry them", () => {
  const p = sample();
  p.person.contact = { ...p.person.contact, email: "ines@example.com", phone: "+1 555 0100" };
  const c = hr(p).person.communication;
  assert.equal(c.email, undefined);
  assert.equal(c.phone, undefined);
  p.person.contact.emailVisibility = "public";
  assert.deepEqual(hr(p).person.communication.email, [{ address: "ines@example.com" }]);
});

test("a job's positions are its position histories, newest first", () => {
  const p = load("examples/history.profile.json");
  const job = p.work.find((w) => (w.positions ?? []).length > 1);
  const out = hr(p).profiles[0].employment.find((e) => e.id.value === job.id);
  assert.ok(out.positionHistories.length > 1);
  const starts = out.positionHistories.map((x) => x.start).filter(Boolean);
  assert.deepEqual(starts, [...starts].sort().reverse());
  assert.ok(out.positionHistories.every((x) => x.title));
});

test("a date the format can only state exactly is said in words, never rounded", () => {
  const e = hr(sample()).profiles[0].employment.find((x) => x.id.value === "coastal-lab-researcher");
  assert.equal(e.start, undefined, "about 1996 is not 1996");
  assert.equal(e.end, "2009-05");
  assert.match(e.descriptions[0], /1996/);
  assert.match(e.positionHistories[0].descriptions[0], /1996/);
});

test("only approved public entries; the content rules still guard it", () => {
  const text = JSON.stringify(hr(sample()));
  assert.doesNotMatch(text, /Hospitality consultant|Coastal Management|Open Trails/);
  const p = sample();
  p.person.headline = "A guaranteed safe pair of hands";
  assert.throws(() => hr(p), /no-safe/);
});

test("credentials are sorted into licenses, certifications, clearances and memberships", () => {
  const p = sample();
  const base = { status: "approved", confidence: "high", visibility: "public" };
  p.credentials = [
    { ...base, id: "lic", kind: "license", name: "Master Mariner", issuer: "state-u", issued: "2020-04", credentialId: "MM-1" },
    { ...base, id: "cert", kind: "certification", name: "Wilderness First Responder", issued: { value: "2018", qualifier: "about" } },
    { ...base, id: "clr", kind: "clearance", name: "Port access clearance" },
    { ...base, id: "mem", kind: "membership", name: "Member", issuer: "state-u" },
    { ...base, id: "gone", kind: "certification", name: "Lapsed", active: false },
  ];
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
  const prof = hr(p).profiles[0];
  assert.deepEqual(prof.licenses.map((x) => x.name), ["Master Mariner"]);
  assert.equal(prof.licenses[0].issued, "2020-04");
  assert.equal(prof.licenses[0].id, undefined, "a credential number is private unless marked otherwise");
  assert.deepEqual(prof.certifications.map((x) => x.name), ["Wilderness First Responder"]);
  assert.equal(prof.certifications[0].issued, undefined);
  assert.deepEqual(prof.securityCredentials.map((x) => x.name), ["Port access clearance"]);
  assert.equal(prof.affiliations.some((a) => a.role === "Member" && a.affiliationTypeCode === "Professional"), true);
  assert.doesNotMatch(JSON.stringify(prof), /Lapsed/);
});

test("education says whether the degree was granted", () => {
  const p = sample();
  const ms = p.education.find((e) => e.id === "state-u-ms");
  Object.assign(ms, { visibility: "public", credential: "Graduate coursework" });
  p.rules = [];
  Object.assign(ms, { completed: false, endDate: "1993" });
  const degree = (q, id) => hr(q).profiles[0].education.find((e) => e.id.value === id).educationDegrees[0];
  assert.equal(degree(p, "state-u-bs").degreeGrantedStatus, "Granted");
  assert.equal(degree(p, "state-u-ms").degreeGrantedStatus, "NotGranted");
  assert.equal(degree(p, "state-u-ms").date, undefined, "no date of a degree that was not granted");
  delete ms.endDate;
  assert.equal(degree(p, "state-u-ms").degreeGrantedStatus, "InProgress");
});

test("skills and languages are qualifications; press about the person is not their publication", () => {
  const prof = hr(sample()).profiles[0];
  const p = sample();
  const skill = p.skills.find((s) => (s.visibility ?? "public") === "public" && s.status === "approved");
  if (skill) assert.ok(prof.qualifications.some((q) => q.competencyName === (skill.name.en ?? skill.name)));
  const q = sample();
  q.publications = [
    { id: "pub", status: "approved", confidence: "high", title: "Reef recovery", kind: "paper", date: "2005", authors: ["Ines Calloway", "A. Reyes"] },
    { id: "press", status: "approved", confidence: "high", title: "Profile of a founder", kind: "pressCoverage", aboutPerson: true, date: "2019-10-12" },
    { id: "pat", status: "approved", confidence: "high", title: "Mooring device", kind: "patent", number: "US 1,234,567", authors: ["Ines Calloway"] },
  ];
  assert.equal(validateProfile(q).valid, true, validateProfile(q).errors.join("\n"));
  const out = hr(q).profiles[0];
  assert.deepEqual(out.publications.map((x) => [x.title, x.type]), [["Reef recovery", "Paper"]]);
  assert.deepEqual(out.publications[0].contributors, [{ name: "Ines Calloway" }, { name: "A. Reyes" }]);
  assert.deepEqual(out.patents.map((x) => [x.title, x.status, x.ids[0].value]), [["Mooring device", "Issued", "US 1,234,567"]]);
});

test("recommendations appear only as their authors allowed", () => {
  const out = hr(load("examples/recommended/profile.json")).profiles[0].references;
  assert.ok(out.length >= 2);
  assert.ok(out.every((r) => r.personName.formattedName));
  const full = convert(load("examples/recommended/profile.json"), loadMapping("jsonresume"), { on: ON }).output.references;
  assert.deepEqual(out.map((r) => r.comments?.[0]?.note), full.map((r) => r.reference), "the same words as every other output");
});

test("every example converts, and nothing is left undefined", () => {
  for (const f of EXAMPLES) {
    const text = JSON.stringify(hr(load(f)));
    assert.doesNotMatch(text, /undefined|\[object Object\]|:null/, f);
  }
});

// ---------- HR Open's JSON Schemas ----------
const have = existsSync(join(DEFAULT_DIR, MARKER)) && JSON.parse(readFileSync(join(DEFAULT_DIR, MARKER), "utf8")).sha256 === RELEASE.sha256;
const skip = have ? false : "the HR Open release is not here: run node scripts/fetch-hropen-schemas.mjs";
const BASE = "https://hropen.invalid/";
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : n.endsWith(".json") && n !== MARKER ? [p] : []; });
let cached;
function schemas() {
  if (cached) return cached;
  // HR Open's schemas are JSON Schema draft-04, and their patterns are not written for the "u" flag.
  const ajv = new Ajv4({ allErrors: true, strict: false, unicodeRegExp: false });
  addFormats(ajv);
  const byId = new Map();
  for (const f of walk(DEFAULT_DIR)) {
    const id = BASE + relative(DEFAULT_DIR, f).split("\\").join("/");
    // A reference inside a file ("#/definitions/…") is written out with the file's own address. The
    // validator otherwise resolves some of them against the file that pulled this one in, and four
    // LER-RS files then fail to compile. The meaning is unchanged.
    const s = JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "").replace(/("\$ref"\s*:\s*")#/g, `$1${id}#`));
    delete s.$id; // several LER-RS files share one "$id", which is not their address
    byId.set(id, s);
    ajv.addSchema(s, id);
  }
  return (cached = { validate: ajv.getSchema(BASE + "recruiting/json/CandidateType.json"), get validateLer() { return ajv.getSchema(BASE + "recruiting/json/LER-RSType.json"); }, byId });
}

/**
 * HR Open's schemas accept any extra key, so a misspelled one would pass. This walks a document
 * beside the schema and returns every key the schema does not define.
 */
function undefinedKeys(byId, value, schema, at, path = "") {
  const resolve = (s, base) => {
    const out = [];
    const visit = (x, b) => {
      if (!x || typeof x !== "object") return;
      if (x.$ref) {
        const [file, frag] = x.$ref.split("#");
        const nb = file ? new URL(file, b).href : b;
        let target = byId.get(nb);
        for (const part of (frag ?? "").split("/").filter(Boolean)) target = target?.[part];
        assert.ok(target, `${x.$ref} from ${b} resolves`);
        visit(target, nb);
      }
      out.push({ s: x, base: b });
      for (const k of ["allOf", "anyOf", "oneOf"]) for (const y of x[k] ?? []) visit(y, b);
    };
    visit(s, base);
    return out;
  };
  const parts = resolve(schema, at);
  const bad = [];
  if (Array.isArray(value)) {
    const items = parts.find((p) => p.s.items);
    if (items) value.forEach((v, i) => bad.push(...undefinedKeys(byId, v, items.s.items, items.base, `${path}/${i}`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const def = parts.find((p) => p.s.properties && k in p.s.properties);
      if (!def) { bad.push(`${path}/${k}`); continue; }
      bad.push(...undefinedKeys(byId, v, def.s.properties[k], def.base, `${path}/${k}`));
    }
  }
  return bad;
}

test("every example is a valid HR Open 4.5 Candidate, using only keys the standard defines", { skip }, () => {
  const { validate, byId } = schemas();
  const id = BASE + "recruiting/json/CandidateType.json";
  for (const f of EXAMPLES) {
    const c = hr(load(f));
    assert.equal(validate(c), true, `${f}\n${(validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("\n")}`);
    assert.deepEqual(undefinedKeys(byId, c, byId.get(id), id), [], f);
  }
});

test("a fuller profile is valid too", { skip }, () => {
  const { validate, byId } = schemas();
  const id = BASE + "recruiting/json/CandidateType.json";
  const p = sample();
  const base = { status: "approved", confidence: "high", visibility: "public" };
  p.person.contact = { ...p.person.contact, email: "ines@example.com", emailVisibility: "public", phone: "+1 555 0100", phoneVisibility: "public" };
  p.credentials = [
    { ...base, id: "lic", kind: "license", name: "Master Mariner", issued: "2020-04-02", credentialId: "MM-1", credentialIdVisibility: "public" },
    { ...base, id: "clr", kind: "clearance", name: "Port access clearance" },
    { ...base, id: "mem", kind: "membership", name: "Member", issuer: "state-u", issued: "2015" },
  ];
  p.publications = [
    { ...base, id: "pub", title: "Reef recovery", kind: "paper", date: "2005-06", authors: ["Ines Calloway"] },
    { ...base, id: "pat", title: "Mooring device", kind: "patentApplication", number: "US 1,234,567" },
  ];
  for (const s of p.service ?? []) Object.assign(s, { visibility: "public" });
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
  const c = hr(p, { visibility: ["public", "network"] });
  assert.equal(validate(c), true, (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("\n"));
  assert.deepEqual(undefinedKeys(byId, c, byId.get(id), id), []);
  assert.ok(c.profiles[0].licenses[0].id.value === "MM-1");
});

test("the checks can fail: a bad date, a wrong code and a misspelled key are all caught", { skip }, () => {
  const { validate, byId } = schemas();
  const id = BASE + "recruiting/json/CandidateType.json";
  const c = hr(sample());
  c.profiles[0].employment[0].start = "March 2024";
  assert.equal(validate(c), false);
  const d = hr(sample());
  d.person.communication.address[0].countryCode = "USA";
  assert.equal(validate(d), false);
  const e = hr(sample());
  e.profiles[0].employment[0].positionHistory = [];
  assert.deepEqual(undefinedKeys(byId, e, byId.get(id), id), ["/profiles/0/employment/0/positionHistory"]);
});

const ler = (p, opts = {}) => convert(p, loadMapping("lerrs"), { on: ON, ...opts }).output;

test("LER-RS: the same entries as the Candidate, in the résumé document's shape", () => {
  const r = ler(sample()), c = hr(sample());
  assert.equal(r.type, "http://schema.hropenstandards.org/4.4/recruiting/json/ler-rs/LER-RSType.json");
  assert.deepEqual(r.person.name, c.person.name);
  assert.deepEqual(r.communication, c.person.communication);
  assert.deepEqual(r.employmentHistories, c.profiles[0].employment);
  assert.deepEqual(r.educationAndLearnings, c.profiles[0].education);
  assert.equal(r.narratives[0].name, "Summary");
  assert.match(r.narratives[0].texts[0].lines[0], /research boats/);
  assert.ok(r.skills.every((s) => s.name));
  const p = sample();
  p.credentials = [{ id: "c", status: "approved", confidence: "high", visibility: "public", kind: "certification", name: "First Aid" }];
  p.skills[0].years = 7.5;
  const out = ler(p);
  assert.equal(out.certifications[0].issuingAuthority.name, "Issuer not recorded", "LER-RS requires an issuer; a missing one is said, not invented");
  assert.equal(out.skills.find((s) => s.yearsOfExperience !== undefined).yearsOfExperience, 7);
  p.person.summary = "A guaranteed safe pair of hands";
  assert.throws(() => ler(p), /no-safe/);
});

test("LER-RS: every example is valid, using only keys the standard defines", { skip }, () => {
  const { byId } = schemas();
  const validateLer = schemas().validateLer;
  const id = BASE + "recruiting/json/LER-RSType.json";
  for (const f of EXAMPLES) {
    const r = ler(load(f));
    assert.equal(validateLer(r), true, `${f}\n${(validateLer.errors ?? []).slice(0, 8).map((e) => `${e.instancePath} ${e.message}`).join("\n")}`);
    assert.deepEqual(undefinedKeys(byId, r, byId.get(id), id), [], f);
  }
  const bad = ler(sample());
  delete bad.type;
  assert.equal(validateLer(bad), false, "the check can fail");
});

test("the archive reader reads stored entries and refuses what is not a zip", () => {
  const files = unzip(storeZip([{ name: "a/b.json", data: "{}" }, { name: "c.txt", data: "hi" }]));
  assert.deepEqual(files.map((f) => [f.name, f.data().toString()]), [["a/b.json", "{}"], ["c.txt", "hi"]]);
  assert.throws(() => unzip(Buffer.from("not a zip at all, just some text here")), /not a zip/);
});
