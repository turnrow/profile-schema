// Open Badges 3.0 presentation and CLR 2.0 template: the originals untouched, nothing private,
// nothing signed, and both valid against 1EdTech's JSON Schemas when those have been fetched
// (node scripts/fetch-1edtech-schemas.mjs; CI does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2019 from "ajv/dist/2019.js";
import addFormats from "ajv-formats";
import { convert, loadMapping, validateProfile, bundleFileReader, originalCredential, urnUuid, RuleViolationError, CONTEXT_VC, CONTEXT_OB3, CONTEXT_CLR } from "../index.mjs";
import { SCHEMAS, DEFAULT_DIR } from "../scripts/fetch-1edtech-schemas.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const BUNDLE = join(root, "examples/recommended");
const ON = "2026-11-07";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const profile = () => JSON.parse(readFileSync(join(BUNDLE, "profile.json"), "utf8"));
const run = (target, p = profile(), opts = {}) => convert(p, loadMapping(target), { on: ON, readBundleFile: bundleFileReader(BUNDLE), ...opts }).output;
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin/profile.mjs"), ...args], { encoding: "utf8" });
const original = () => JSON.parse(readFileSync(join(BUNDLE, "badges/harbor-ops-badge.json"), "utf8"));
const badge = (p, id) => p.badges.find((b) => b.id === id);

/** A copy of the example bundle in a temp folder, to change. */
function copyOfBundle(edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "ob3-"));
  cpSync(BUNDLE, dir, { recursive: true });
  const p = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  edit(p, dir);
  writeFileSync(join(dir, "profile.json"), JSON.stringify(p, null, 2));
  return { dir, p };
}

test("the presentation carries the original credential exactly as issued, and is not signed", () => {
  const vp = run("ob3");
  assert.deepEqual(vp["@context"], [CONTEXT_VC]);
  assert.deepEqual(vp.type, ["VerifiablePresentation"]);
  assert.equal(vp.holder, "https://ines-ortega.example/");
  assert.deepEqual(vp.verifiableCredential, [original()]);
  assert.equal(vp.proof, undefined, "we never sign");
  assert.deepEqual(Object.keys(vp), ["@context", "type", "holder", "verifiableCredential"]);
});

test("an Open Badges 2.0 badge is not a Verifiable Credential: it is not presented, and the CLR lists it as an achievement", () => {
  assert.equal(JSON.stringify(run("ob3")).includes("Site Safety Lead"), false);
  const clr = run("clr");
  const a = clr.credentialSubject.achievement.find((x) => x.name === "Site Safety Lead");
  assert.equal(a.id, "https://badges.example/badges/site-safety");
  assert.equal(a.achievementType, "Badge");
  assert.equal(a.criteria.narrative, "Completed 40 supervised hours.");
  assert.equal(a.creator.id, "https://badges.example/issuers/builders-guild");
  assert.deepEqual(a.tag, ["safety"]);
});

test("the CLR is a template: the right contexts and types, the holder as subject, no proof, the same file every time", () => {
  const clr = run("clr");
  assert.deepEqual(clr["@context"], [CONTEXT_VC, CONTEXT_CLR, CONTEXT_OB3]);
  assert.deepEqual(clr.type, ["VerifiableCredential", "ClrCredential"]);
  assert.match(clr.id, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(clr.validFrom, "2026-11-07T00:00:00Z");
  assert.equal(clr.name, "Ines Ortega: learning and employment record");
  assert.equal(clr.credentialSubject.id, "https://ines-ortega.example/");
  assert.deepEqual(clr.credentialSubject.type, ["ClrSubject"]);
  assert.deepEqual(clr.credentialSubject.verifiableCredential, [original()]);
  assert.equal(clr.proof, undefined);
  assert.deepEqual(run("clr"), clr);
  for (const a of clr.credentialSubject.achievement) {
    for (const k of ["id", "type", "name", "description", "criteria"]) assert.ok(a[k], `${a.name}: ${k} is required by the standard`);
    assert.match(a.id, /^(https?:|urn:uuid:)/);
  }
});

test("licenses, certifications and completed education join the CLR; a badge that stands for one is counted once", () => {
  const p = profile();
  p.credentials = [
    { id: "twic", status: "approved", confidence: "high", kind: "license", name: "Transportation Worker Identification Credential", issuer: "port-example" },
    { id: "harbor-cert", status: "approved", confidence: "high", kind: "certification", name: "Harbor Operations Planner", issuer: "maritime-academy" },
    { id: "old", status: "approved", confidence: "high", kind: "certification", name: "Lapsed Certificate", active: false },
  ];
  p.education = [
    { id: "bs", status: "approved", confidence: "high", kind: "degree", institution: "maritime-academy", credential: "BS", area: "Logistics", completed: true },
    { id: "unfinished", status: "approved", confidence: "high", kind: "degree", institution: "maritime-academy", credential: "MS", area: "Planning", completed: false },
  ];
  badge(p, "harbor-ops-badge").credentialRef = "harbor-cert";
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
  const list = run("clr", p).credentialSubject.achievement;
  const names = list.map((a) => a.name);
  assert.ok(names.includes("Transportation Worker Identification Credential"));
  assert.ok(names.includes("BS, Logistics"));
  assert.equal(list.find((a) => a.name === "BS, Logistics").achievementType, "Degree");
  assert.equal(list.find((a) => a.name.startsWith("Transportation")).achievementType, "License");
  assert.equal(names.includes("Harbor Operations Planner"), false, "the badge already says it");
  assert.equal(names.includes("Lapsed Certificate"), false);
  assert.equal(names.includes("MS, Planning"), false);
});

test("a badge that is private, unapproved, failed, revoked or run out is not handed over", () => {
  const cases = {
    private: (b) => { b.visibility = "private"; },
    draft: (b) => { b.status = "draft"; },
    "low confidence": (b) => { b.confidence = "low"; },
    failed: (b) => { b.verification = { status: "failed" }; },
    revoked: (b) => { b.verification = { status: "revoked" }; },
    "run out": (b) => { b.validUntil = "2025-01-01"; },
  };
  for (const [name, edit] of Object.entries(cases)) {
    const p = profile();
    edit(badge(p, "harbor-ops-badge"));
    assert.throws(() => run("ob3", p), /nothing to present/, name);
    assert.throws(() => run("clr", p), /needs at least one Verifiable Credential/, name);
    const q = profile();
    edit(badge(q, "site-safety-badge"));
    assert.equal(JSON.stringify(run("clr", q)).includes("Site Safety Lead"), false, name);
  }
});

test("the content rules still stop the CLR's own words; the issuer's original is theirs and is not reworded", () => {
  const p = profile();
  p.rules = [{ id: "no-safety", kind: "forbiddenPhrase", phrases: ["Site Safety Lead"], reason: "test" }];
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
  assert.throws(() => run("clr", p), (e) => e instanceof RuleViolationError && /no-safety/.test(e.message));
  assert.doesNotThrow(() => run("ob3", p), "the presentation carries no words of ours");
});

test("a changed original is refused, and so is a path out of the bundle", () => {
  const { dir, p } = copyOfBundle((_, d) => writeFileSync(join(d, "badges/harbor-ops-badge.json"), JSON.stringify({ ...original(), name: "Harbor Master" })));
  assert.throws(() => convert(p, loadMapping("ob3"), { on: ON, readBundleFile: bundleFileReader(dir) }), /does not match its recorded sha256/);
  const q = profile();
  badge(q, "harbor-ops-badge").credential.file = "bundle:../../package.json";
  delete badge(q, "harbor-ops-badge").credential.sha256;
  assert.throws(() => run("ob3", q), /not a file inside the bundle/);
});

test("a VC-JWT original goes in the envelope the Data Model defines, byte for byte", () => {
  const jwt = "eyJhbGciOiJFZERTQSJ9.eyJ2YyI6e319.c2lnbmF0dXJl";
  const { dir, p } = copyOfBundle((prof, d) => {
    writeFileSync(join(d, "badges/harbor.jwt"), jwt + "\n");
    Object.assign(badge(prof, "harbor-ops-badge").credential, { format: "ob3-jwt", file: "bundle:badges/harbor.jwt", sha256: sha256(Buffer.from(jwt + "\n")) });
  });
  const vp = convert(p, loadMapping("ob3"), { on: ON, readBundleFile: bundleFileReader(dir) }).output;
  assert.deepEqual(vp.verifiableCredential, [{ "@context": CONTEXT_VC, id: `data:application/vc+jwt,${jwt}`, type: "EnvelopedVerifiableCredential" }]);
});

test("without the bundle there is nothing to carry, and the error says so", () => {
  assert.throws(() => convert(profile(), loadMapping("ob3"), { on: ON }), /needs the bundle folder/);
  const r = cli("convert", join(BUNDLE, "profile.json"), "ob3");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs the bundle folder/);
  const none = cli("convert", join(root, "examples/sample.profile.json"), "clr");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /needs at least one Verifiable Credential/);
});

test("the command line writes both from a bundle folder", () => {
  const vp = cli("convert", BUNDLE, "ob3", "--on", ON);
  assert.equal(vp.status, 0, vp.stderr);
  assert.deepEqual(JSON.parse(vp.stdout), run("ob3"));
  const clr = cli("convert", BUNDLE, "clr", "--on", ON);
  assert.equal(clr.status, 0, clr.stderr);
  assert.deepEqual(JSON.parse(clr.stdout), run("clr"));
});

test("ids are stable, and differ when what they name differs", () => {
  assert.equal(urnUuid("a", "b"), urnUuid("a", "b"));
  assert.notEqual(urnUuid("a", "b"), urnUuid("ab"));
  assert.equal(originalCredential({ credential: { format: "ob2-baked", file: "bundle:x.png" } }, () => { throw new Error("not read"); }), undefined);
});

// ---------- 1EdTech's JSON Schemas ----------
const have = SCHEMAS.every((s) => existsSync(join(DEFAULT_DIR, s.file)) && sha256(readFileSync(join(DEFAULT_DIR, s.file))) === s.sha256);
const skip = have ? false : "the 1EdTech schemas are not here: run node scripts/fetch-1edtech-schemas.mjs";
const validator = (file) => {
  const ajv = new Ajv2019({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(join(DEFAULT_DIR, file), "utf8")));
};
const errorsOf = (v) => (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("\n");

test("each presented credential is a valid Open Badges 3.0 AchievementCredential", { skip }, () => {
  const v = validator("ob_v3p0_achievementcredential_schema.json");
  for (const c of run("ob3").verifiableCredential) assert.equal(v(c), true, errorsOf(v));
});

test("the CLR template is a valid CLR 2.0 ClrCredential", { skip }, () => {
  const v = validator("clr_v2p0_clrcredential_schema.json");
  assert.equal(v(run("clr")), true, errorsOf(v));
  const p = profile();
  p.credentials = [{ id: "twic", status: "approved", confidence: "high", kind: "license", name: "Transportation Worker Identification Credential", issuer: "port-example" }];
  p.education = [{ id: "bs", status: "approved", confidence: "high", kind: "degree", institution: "maritime-academy", credential: "BS", area: "Logistics", completed: true }];
  assert.equal(v(run("clr", p)), true, errorsOf(v));
});

test("the schema check can fail: a CLR without its subject's credentials is refused", { skip }, () => {
  const v = validator("clr_v2p0_clrcredential_schema.json");
  const clr = run("clr");
  delete clr.credentialSubject.verifiableCredential;
  assert.equal(v(clr), false);
});
