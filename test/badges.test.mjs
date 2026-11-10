import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateProfile } from "../index.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const has = (list, re) => list.some((x) => re.test(x));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

export const OB3 = {
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"],
  id: "https://badges.example/credentials/42",
  type: ["VerifiableCredential", "OpenBadgeCredential"],
  issuer: { id: "https://badges.example/issuers/acme", type: ["Profile"], name: "Acme Academy" },
  validFrom: "2024-03-01T00:00:00Z",
  name: "Kubernetes Platform Practitioner",
  credentialSubject: {
    type: ["AchievementSubject"],
    achievement: {
      id: "https://badges.example/achievements/k8s",
      type: ["Achievement"],
      achievementType: "Badge",
      name: "Kubernetes Platform Practitioner",
      description: "Operates production Kubernetes clusters.",
      criteria: { narrative: "Passed the practical assessment." },
      alignment: [{ type: ["Alignment"], targetName: "Network and Computer Systems Administrators", targetUrl: "https://www.onetonline.org/link/summary/15-1244.00", targetFramework: "O*NET", targetCode: "15-1244.00" }],
    },
  },
};

export function withBadge(edit = (b) => b) {
  const p = read("../examples/employee.profile.json");
  p.schemaVersion = "2.6.0";
  p.organizations["acme-academy"] = { name: "Acme Academy", kind: "school" };
  p.badges = [edit({
    id: "k8s-badge", status: "approved", confidence: "high",
    achievement: {
      id: "https://badges.example/achievements/k8s", achievementType: "Badge", name: "Kubernetes Platform Practitioner",
      description: "Operates production Kubernetes clusters.", criteria: { narrative: "Passed the practical assessment." },
      alignment: [{ targetName: "Network and Computer Systems Administrators", targetUrl: "https://www.onetonline.org/link/summary/15-1244.00", targetFramework: "O*NET", targetCode: "15-1244.00" }],
      tag: ["kubernetes"],
    },
    issuer: "acme-academy", issuerId: "https://badges.example/issuers/acme",
    validFrom: "2024-03-01T00:00:00Z", awardedFor: "acme-platform",
    credential: { format: "ob3-jsonld", url: "https://badges.example/credentials/42", platform: "other" },
    verification: { status: "unverified" },
  })];
  return p;
}

test("a badge validates", () => {
  const r = validateProfile(withBadge());
  assert.equal(r.valid, true, r.errors.join("\n"));
});

test("achievementType takes the Open Badges 3.0 vocabulary or an ext: term", () => {
  assert.equal(validateProfile(withBadge((b) => { b.achievement.achievementType = "MicroCredential"; return b; })).valid, true);
  assert.equal(validateProfile(withBadge((b) => { b.achievement.achievementType = "ext:Safety"; return b; })).valid, true);
  assert.equal(validateProfile(withBadge((b) => { b.achievement.achievementType = "Trophy"; return b; })).valid, false);
});

test("the stored original credential must match its hash", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-badge-"));
  mkdirSync(join(dir, "badges"));
  const bytes = Buffer.from(JSON.stringify(OB3));
  writeFileSync(join(dir, "badges", "k8s.json"), bytes);
  const ok = withBadge((b) => { b.credential.file = "bundle:badges/k8s.json"; b.credential.sha256 = sha256(bytes); return b; });
  assert.equal(validateProfile(ok, { bundleDir: dir }).valid, true);
  const bad = withBadge((b) => { b.credential.file = "bundle:badges/k8s.json"; b.credential.sha256 = "0".repeat(64); return b; });
  assert.ok(has(validateProfile(bad, { bundleDir: dir }).errors, /badges\/k8s-badge\.credential: sha256 mismatch/));
});

test("'verified' needs the method and when it was checked (2.6)", () => {
  const p = withBadge((b) => { b.verification = { status: "verified" }; return b; });
  assert.ok(has(validateProfile(p).errors, /badges\/k8s-badge: verification\.status is verified but method and checkedAt are not recorded/));
});

test("an approved badge that expired warns", () => {
  const p = withBadge((b) => { b.validUntil = "2020-01-01"; return b; });
  assert.ok(has(validateProfile(p).warnings, /badges\/k8s-badge: expired 2020-01-01/));
});

test("alignment codes in O*NET or SOC are checked like occupation codes", () => {
  const p = withBadge((b) => { b.achievement.alignment.push({ targetName: "x", targetUrl: "https://example.com", targetFramework: "SOC", targetCode: "99-9999" }, { targetName: "y", targetUrl: "https://example.com", targetFramework: "O*NET", targetCode: "2.B.9.z" }); return b; });
  const e = validateProfile(p).errors;
  assert.ok(has(e, /alignment SOC 99-9999: 99-9999 is not a 2018 SOC code/));
  assert.ok(has(e, /alignment O\*NET 2\.B\.9\.z: .* not a O\*NET 31\.0 code/));
});

test("credentialRef, issuer and awardedFor must exist", () => {
  const p = withBadge((b) => { b.credentialRef = "nope"; b.issuer = "nobody"; b.awardedFor = "nothing"; return b; });
  const e = validateProfile(p).errors;
  assert.ok(has(e, /badges\/k8s-badge: credentialRef "nope" is not a credentials entry/));
  assert.ok(has(e, /badges\/k8s-badge: unknown organization "nobody"/));
  assert.ok(has(e, /badges\/k8s-badge: awardedFor "nothing" is not an entry/));
});

test("an endorsement can target a badge", () => {
  const p = withBadge();
  p.people = { m: { name: "M" } };
  p.endorsements = [{ id: "e1", author: "m", target: "k8s-badge", date: "2024-05-01", visibility: "private" }];
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
});

// ---------- import ----------

import { deflateSync, crc32 } from "node:zlib";
import { parseBadge, verifyBadge } from "../lib/badges.mjs";

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, "latin1"), data, u32(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])))]);
const bakedPng = (keyword, text) => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", Buffer.concat([u32(1), u32(1), Buffer.from([8, 2, 0, 0, 0])])),
  chunk("iTXt", Buffer.concat([Buffer.from(`${keyword}\0\0\0\0\0`, "latin1"), Buffer.from(text, "utf8")])),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const OB2 = {
  "@context": "https://w3id.org/openbadges/v2", type: "Assertion", id: "https://badges.example/assertions/7",
  recipient: { type: "email", hashed: true, identity: "sha256$abc" }, issuedOn: "2021-06-01T00:00:00Z", expires: "2031-06-01T00:00:00Z",
  verification: { type: "hosted" },
  badge: { type: "BadgeClass", id: "https://badges.example/badges/safety", name: "Site Safety Lead", description: "Leads site safety.", criteria: { narrative: "Completed 40 hours." },
    image: "https://badges.example/badges/safety.png", tags: ["safety"], issuer: { type: "Issuer", id: "https://badges.example/issuer", name: "Builders Guild" },
    alignment: [{ targetName: "Construction Managers", targetUrl: "https://www.onetonline.org/link/summary/11-9021.00", targetFramework: "O*NET", targetCode: "11-9021.00" }] },
};

test("import: Open Badges 3.0 JSON-LD", () => {
  const bytes = Buffer.from(JSON.stringify(OB3, null, 2));
  const { entry, original, ext } = parseBadge(bytes);
  assert.equal(entry.credential.format, "ob3-jsonld");
  assert.equal(entry.credential.url, "https://badges.example/credentials/42");
  assert.equal(entry.achievement.achievementType, "Badge");
  assert.equal(entry.achievement.alignment[0].targetCode, "15-1244.00");
  assert.equal(entry.issuerId, "https://badges.example/issuers/acme");
  assert.deepEqual(entry.issuer, { name: "Acme Academy" });
  assert.equal(entry.validFrom, "2024-03-01T00:00:00Z");
  assert.equal(entry.status, "draft");
  assert.deepEqual(entry.verification, { status: "unverified" });
  assert.ok(original.equals(bytes));
  assert.equal(ext, ".json");
});

test("import: VC-JWT and an Open Badges 2.0 signed assertion", () => {
  const vcJwt = `${b64u({ alg: "EdDSA" })}.${b64u({ iss: "did:web:badges.example", vc: OB3 })}.c2ln`;
  const a = parseBadge(Buffer.from(vcJwt));
  assert.equal(a.entry.credential.format, "ob3-jwt");
  assert.equal(a.entry.achievement.name, "Kubernetes Platform Practitioner");
  assert.equal(a.ext, ".jwt");
  const jws = `${b64u({ alg: "RS256" })}.${b64u({ ...OB2, verification: { type: "signed", creator: "https://badges.example/key" } })}.c2ln`;
  const b = parseBadge(Buffer.from(jws));
  assert.equal(b.entry.credential.format, "ob2-signed");
  assert.equal(b.entry.achievement.name, "Site Safety Lead");
});

test("import: Open Badges 2.0 hosted assertion, with its BadgeClass and issuer", () => {
  const { entry } = parseBadge(Buffer.from(JSON.stringify(OB2)));
  assert.equal(entry.credential.format, "ob2-hosted");
  assert.equal(entry.credential.url, "https://badges.example/assertions/7");
  assert.equal(entry.achievement.id, "https://badges.example/badges/safety");
  assert.equal(entry.achievement.criteria.narrative, "Completed 40 hours.");
  assert.deepEqual(entry.achievement.tag, ["safety"]);
  assert.equal(entry.achievement.image.url, "https://badges.example/badges/safety.png");
  assert.equal(entry.validFrom, "2021-06-01T00:00:00Z");
  assert.equal(entry.validUntil, "2031-06-01T00:00:00Z");
  assert.deepEqual(entry.issuer, { name: "Builders Guild" });
});

test("import: baked PNG (2.0 JSON and 3.0) and baked SVG", () => {
  const png2 = bakedPng("openbadges", JSON.stringify(OB2));
  const a = parseBadge(png2);
  assert.equal(a.entry.credential.format, "ob2-baked");
  assert.equal(a.ext, ".png");
  assert.ok(a.original.equals(png2), "the image is kept byte for byte");
  const png3 = bakedPng("openbadgecredential", JSON.stringify(OB3));
  assert.equal(parseBadge(png3).entry.credential.format, "ob3-jsonld");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:openbadges="https://openbadges.org" width="10" height="10"><openbadges:assertion verify="https://badges.example/assertions/7"><![CDATA[${JSON.stringify(OB2)}]]></openbadges:assertion></svg>`);
  const c = parseBadge(svg);
  assert.equal(c.entry.credential.format, "ob2-baked");
  assert.equal(c.entry.achievement.name, "Site Safety Lead");
  assert.equal(c.ext, ".svg");
});

test("a baked PNG holding only a URL becomes ob2-hosted with the PNG as its file, without fetching", () => {
  const png = bakedPng("openbadges", "https://badges.example/assertions/7");
  const { entry, original } = parseBadge(png, { name: "Site Safety Lead" });
  assert.equal(entry.credential.format, "ob2-hosted");
  assert.equal(entry.credential.url, "https://badges.example/assertions/7");
  assert.equal(entry.achievement.name, "Site Safety Lead");
  assert.ok(original.equals(png));
});

test("anything else is refused with a plain message", () => {
  assert.throws(() => parseBadge(Buffer.from("hello")), /not an Open Badge/);
});

test("verifyBadge never fetches unless a fetcher is passed; hosted assertions are re-fetched and compared", async () => {
  const { entry, original } = parseBadge(Buffer.from(JSON.stringify(OB2)));
  assert.deepEqual(await verifyBadge(entry, original), { status: "unverified", method: "not checked: no fetcher" });
  const calls = [];
  const fetch = async (url) => { calls.push(url); return { ok: true, json: async () => OB2 }; };
  const ok = await verifyBadge(entry, original, { fetch, now: "2026-11-09T10:00:00Z" });
  assert.deepEqual(ok, { status: "verified", method: "ob2-hosted: re-fetched and matched", checkedAt: "2026-11-09T10:00:00Z" });
  assert.deepEqual(calls, ["https://badges.example/assertions/7"]);
  const revoked = await verifyBadge(entry, original, { fetch: async () => ({ ok: true, json: async () => ({ ...OB2, revoked: true }) }), now: "2026-11-09T10:00:00Z" });
  assert.equal(revoked.status, "revoked");
  const jsonld = parseBadge(Buffer.from(JSON.stringify(OB3)));
  assert.deepEqual(await verifyBadge(jsonld.entry, jsonld.original, { fetch }), { status: "unverified", method: "not implemented for ob3-jsonld" });
});

import { spawnSync } from "node:child_process";
const CLI = new URL("../bin/profile.mjs", import.meta.url).pathname;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("badges import writes the original into the bundle and a draft entry that validates", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-bimp-"));
  const p = read("../examples/employee.profile.json");
  p.schemaVersion = "2.6.0";
  writeFileSync(join(dir, "profile.json"), JSON.stringify(p));
  const src = join(dir, "..", `k8s-${Date.now()}.json`);
  const bytes = Buffer.from(JSON.stringify(OB3));
  writeFileSync(src, bytes);
  const r = cli("badges", "import", dir, src, "--id", "k8s");
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  const b = after.badges.find((x) => x.id === "k8s");
  assert.equal(b.credential.file, "bundle:badges/k8s.json");
  assert.equal(b.credential.sha256, sha256(bytes));
  assert.ok(readFileSync(join(dir, "badges", "k8s.json")).equals(bytes));
  assert.equal(validateProfile(after, { bundleDir: dir }).valid, true);
  const url = cli("badges", "import", dir, "https://badges.example/credentials/42", "--id", "k8s2");
  assert.equal(url.status, 2);
  assert.match(url.stderr, /a URL needs --fetch/);
});

// ---------- badges in outputs (Task 8) ----------

import { loadMapping as lm, convert } from "../index.mjs";

test("schema.org: a badge is an EducationalOccupationalCredential with credentialCategory badge", () => {
  const out = convert(withBadge(), lm("schemaorg"), { on: "2026-11-07" }).output;
  const c = out.mainEntity.hasCredential.find((x) => x.credentialCategory === "badge");
  assert.equal(c["@type"], "EducationalOccupationalCredential");
  assert.equal(c.name, "Kubernetes Platform Practitioner");
  assert.equal(c.url, "https://badges.example/credentials/42");
  assert.equal(c.recognizedBy.name, "Acme Academy");
});

test("JSON Resume: certificates from badges, still valid against the upstream schema", async () => {
  const out = convert(withBadge(), lm("jsonresume"), { on: "2026-11-07" }).output;
  const c = out.certificates.find((x) => x.name === "Kubernetes Platform Practitioner");
  assert.equal(c.issuer, "Acme Academy");
  assert.equal(c.date, "2024-03-01");
  assert.equal(c.url, "https://badges.example/credentials/42");
  const { default: Ajv } = await import("ajv");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
  const v = ajv.compile(read("../upstream/jsonresume/schema.json"));
  assert.ok(v(out), JSON.stringify(v.errors));
});

test("LinkedIn: badges under Licenses & certifications with the credential URL", () => {
  const t = convert(withBadge(), lm("linkedin"), { on: "2026-11-07" }).text;
  const sec = t.split(/\n(?=\S.*\n)/).find((s) => s.startsWith("Licenses & certifications")) ?? t;
  assert.match(sec, /Kubernetes Platform Practitioner/);
  assert.match(t, /Credential URL: https:\/\/badges\.example\/credentials\/42/);
});

test("a badge that stands for a credential entry isn't listed twice", () => {
  const p = withBadge((b) => ({ ...b, credentialRef: "aws-sa" }));
  p.credentials = [...(p.credentials ?? []), { id: "aws-sa", name: "Kubernetes Platform Practitioner", issuer: "acme-academy", status: "approved", confidence: "high" }];
  const out = convert(p, lm("jsonresume"), { on: "2026-11-07" }).output;
  assert.equal(out.certificates.filter((c) => c.name.startsWith("Kubernetes Platform Practitioner")).length, 1);
});
