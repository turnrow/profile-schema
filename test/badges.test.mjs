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
