import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  validateProfile, loadMapping, buildRelease, applyWriteBack, resolveAudience, checkRequester, authorityFor,
} from "../index.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const employee = () => read("../examples/employee.profile.json");
const scimBack = () => read("../examples/acme-writeback.scim.json");
const ON = "2026-11-07";
const ACME = { domain: "acme.example", method: "oidc", application: "acme-directory" };
const scim = loadMapping("scim");

// ---------- schema ----------

test("the employee example is valid, and 2.0.0 files remain valid", () => {
  assert.deepEqual(validateProfile(employee()).errors, []);
  assert.equal(validateProfile(read("../examples/sample.profile.json")).valid, true);
});

test("audience and release references are checked", () => {
  const p = employee();
  p.skills[0].audiences = ["nobody"];
  p.audiences["current-employer"].verification.writeBackMethods = ["emailDomain"];
  p.audiences.public = { kind: "group", purpose: "other" };
  p.releases = [{ id: "r1", audience: "ghost", issued: "2026-11-07T00:00:00Z", payloadSha256: "a".repeat(64) }];
  const errs = validateProfile(p).errors.join("\n");
  assert.match(errs, /unknown audience "nobody"/);
  assert.match(errs, /emailDomain can never authorize write-back/);
  assert.match(errs, /built-in audience/);
  assert.match(errs, /releases\/r1: unknown audience "ghost"/);
});

test("employer audiences must say which employer", () => {
  const p = employee();
  p.audiences.loose = { kind: "employer", purpose: "other" };
  assert.equal(validateProfile(p).valid, false);
});

test("employerRecord is only allowed on work entries", () => {
  const p = employee();
  p.skills[0].employerRecord = { department: "x" };
  assert.equal(validateProfile(p).valid, false);
});

// ---------- resolving audiences ----------

test("'current employer' follows the current job", () => {
  const r = resolveAudience(employee(), "current-employer", { on: ON });
  assert.equal(r.active, true);
  assert.deepEqual(r.bindings.map((b) => b.organization.id), ["acme"]);
  const f = resolveAudience(employee(), "former-employers", { on: ON });
  assert.deepEqual(f.bindings.map((b) => b.organization.id), ["northwind"]);
});

test("'current employer' lapses on separation and moves to the next job", () => {
  const p = employee();
  const acme = p.work.find((w) => w.id === "acme-platform");
  acme.current = false;
  acme.endDate = "2027-06";
  assert.equal(resolveAudience(p, "current-employer", { on: "2027-07-01" }).active, false);
  p.organizations.globex = { name: "Globex Example", domains: ["globex.example"] };
  p.work.push({ id: "globex", status: "approved", confidence: "high", organization: "globex", title: "Principal Engineer", startDate: "2027-07", current: true });
  const r = resolveAudience(p, "current-employer", { on: "2027-07-15" });
  assert.deepEqual(r.bindings.map((b) => b.organization.id), ["globex"]);
});

test("requesters qualify only by an accepted method and a matching domain", () => {
  const p = employee();
  assert.equal(checkRequester(p, "current-employer", ACME, { on: ON }).ok, true);
  assert.equal(checkRequester(p, "current-employer", { domain: "hr.acme-corp.example", method: "saml" }, { on: ON }).ok, true, "subdomain of a listed domain");
  assert.match(checkRequester(p, "current-employer", { domain: "acme.example", method: "emailDomain" }, { on: ON }).reason, /not accepted/);
  assert.match(checkRequester(p, "current-employer", { domain: "evilacme.example", method: "oidc" }, { on: ON }).reason, /does not belong/);
  assert.match(checkRequester(p, "current-employer", { domain: "northwind.example", method: "oidc" }, { on: ON }).reason, /does not belong/);
});

test("write-back needs a strong method and an audience that allows it", () => {
  const p = employee();
  assert.equal(checkRequester(p, "current-employer", ACME, { writeBack: true, on: ON }).ok, true);
  assert.match(checkRequester(p, "current-employer", { ...ACME, method: "dnsTxt" }, { writeBack: true, on: ON }).reason, /not accepted/);
  assert.match(checkRequester(p, "former-employers", { domain: "northwind.example", method: "oidc" }, { writeBack: true, on: ON }).reason, /may not write back/);
});

test("authority rules: employer for its records, subject for everything else", () => {
  const a = employee().audiences["current-employer"];
  assert.equal(authorityFor(a, "employerRecord.department"), "employer");
  assert.equal(authorityFor(a, "startDate"), "employer");
  assert.equal(authorityFor(a, "title"), "subject");
  assert.equal(authorityFor(a, "person.name"), "subject");
});

// ---------- releases ----------

test("a directory release contains exactly what was granted", () => {
  const { payload, text } = buildRelease(employee(), "current-employer", scim, { requester: ACME, on: ON, now: "2026-11-07T12:00:00Z" });
  assert.equal(payload.userName, "sam.rivera@acme.example");
  assert.equal(payload.title, "Senior Software Engineer II", "official title from the employer record");
  const ext = payload["urn:turnrow:params:scim:schemas:extension:profile:2.0:User"];
  assert.equal(ext.preferredTitle, "Platform Engineering Lead");
  assert.equal(ext.pronouns, "she/her");
  assert.ok(ext.credentials.some((c) => c.name === "First Aid / CPR"), "private entry shared because it names this audience");
  for (const secret of ["+1-555-0142", "Rivera Cole", "Competitive barbecue", "NW-0099", "Northwind", "Developer Productivity"]) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
});

test("a release refuses an unqualified requester", () => {
  assert.throws(() => buildRelease(employee(), "current-employer", scim, { requester: { domain: "other.example", method: "oidc" }, on: ON }), /Release refused/);
});

test("the receipt records the release and its payload hash", () => {
  const r = buildRelease(employee(), "current-employer", scim, { requester: ACME, on: ON, now: "2026-11-07T12:00:00Z", id: "test" });
  assert.equal(r.receipt.payloadSha256, createHash("sha256").update(r.text).digest("hex"));
  assert.equal(r.receipt.recipient.domain, "acme.example");
  assert.equal(r.receipt.purpose.code, "employeeDirectory");
  assert.match(r.receipt.notice, /Copies already delivered/);
  const p = employee();
  p.releases = [r.record];
  assert.deepEqual(validateProfile(p).errors, []);
});

test("a verification release to a former employer carries only the legal name and that job", () => {
  const p = employee();
  p.work.find((w) => w.id === "northwind-devex").audiences = ["former-employers"];
  const { payload, text } = buildRelease(p, "former-employers", loadMapping("jsonresume"), { requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  assert.equal(payload.basics.name, "Sam Rivera");
  assert.deepEqual(payload.work.map((w) => w.name), ["Northwind Example Ltd"]);
  assert.ok(!text.includes("Acme"));
});

// ---------- write-back ----------

test("employer corrections are accepted as primary-source claims, keeping the old value", () => {
  const { profile, changes, suggestions } = applyWriteBack(employee(), "current-employer", scimBack(), { requester: ACME, on: ON, now: "2026-11-07T12:00:00Z" });
  assert.deepEqual(validateProfile(profile).errors, []);
  const job = profile.work.find((w) => w.id === "acme-platform");
  assert.equal(job.employerRecord.department, "Platform Engineering");
  assert.equal(job.employerRecord.managerName, "Jordan Example");
  assert.equal(job.startDate, "2026-11-03");
  assert.equal(job.title, "Platform Engineering Lead", "the subject's own title is untouched");
  const dept = job.claims.filter((c) => c.field === "employerRecord.department");
  assert.deepEqual(dept.map((c) => [c.value, !!c.accepted]), [["Engineering", false], ["Platform Engineering", true]]);
  assert.equal(profile.sources["writeback-current-employer-2026-11-07"].defaultQuality, "primary");
  assert.ok(changes.some((c) => c.field === "startDate" && c.action === "accepted"));
  assert.deepEqual(suggestions.map((s) => s.field), ["person.name"]);
  assert.equal(profile.person.name, "Sam Rivera", "suggestions are never applied");
});

test("a locked job keeps its values and flags the employer's for review", () => {
  const p = employee();
  p.work.find((w) => w.id === "acme-platform").lock = { by: "Sam Rivera", on: "2026-11-02" };
  const { profile, changes } = applyWriteBack(p, "current-employer", scimBack(), { requester: ACME, on: ON });
  const job = profile.work.find((w) => w.id === "acme-platform");
  assert.equal(job.employerRecord.department, "Engineering");
  assert.ok(changes.filter((c) => c.from !== undefined).every((c) => c.action !== "accepted"), "existing values are not changed");
  assert.match(job.openQuestion, /entry is locked/);
  assert.deepEqual(validateProfile(profile).errors, []);
});

test("write-back is refused without a strong, matching requester", () => {
  assert.throws(() => applyWriteBack(employee(), "current-employer", scimBack(), { requester: { ...ACME, method: "emailDomain" }, on: ON }), /never enough/);
  assert.throws(() => applyWriteBack(employee(), "current-employer", scimBack(), { requester: { domain: "northwind.example", method: "oidc" }, on: ON }), /does not belong/);
});

test("a second identical write-back changes nothing", () => {
  const first = applyWriteBack(employee(), "current-employer", scimBack(), { requester: ACME, on: ON, now: "2026-11-07T12:00:00Z" });
  const second = applyWriteBack(first.profile, "current-employer", scimBack(), { requester: ACME, on: ON, now: "2026-11-08T12:00:00Z" });
  assert.ok(second.changes.every((c) => c.action === "unchanged"));
  const job = second.profile.work.find((w) => w.id === "acme-platform");
  assert.equal(job.claims.filter((c) => c.field === "employerRecord.department").length, 2);
  assert.equal(second.profile.sources["writeback-current-employer-2026-11-08"], undefined, "no unused source added");
});

test("repeated conflicting corrections to a locked job stay valid, and empty fields can still be filled", () => {
  const p = employee();
  p.work.find((w) => w.id === "acme-platform").lock = { by: "Sam Rivera", on: "2026-11-02" };
  const once = applyWriteBack(p, "current-employer", scimBack(), { requester: ACME, on: ON });
  const other = scimBack();
  other["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"].department = "Infrastructure";
  const twice = applyWriteBack(once.profile, "current-employer", other, { requester: ACME, on: ON });
  assert.deepEqual(validateProfile(twice.profile).errors, []);
  const job = twice.profile.work.find((w) => w.id === "acme-platform");
  assert.equal(job.employerRecord.department, "Engineering", "locked value kept");
  assert.equal(job.employerRecord.managerName, "Jordan Example", "empty field filled despite the lock");
  const accepted = job.claims.filter((c) => c.field === "employerRecord.department" && c.accepted);
  assert.deepEqual(accepted.map((c) => c.value), ["Engineering"]);
});

// ---------- regressions from the PR #2 review ----------

test("'any employer' audiences include past employers and don't lapse on separation", () => {
  const p = employee();
  p.audiences.anyemp = { kind: "employer", relation: "any", purpose: "employmentVerification" };
  const r = resolveAudience(p, "anyemp", { on: ON });
  assert.deepEqual(r.bindings.map((b) => b.organization.id).sort(), ["acme", "northwind"]);
});

test("a release carries only the organizations, places and sources it refers to, without source locations", () => {
  const p = employee();
  p.sources["offer-letter"].location = "Drive: /HR/offer.pdf";
  const leak = { target: "x", output: { orgs: "$$.organizations", sources: "$$.sources", places: "$$.places" } };
  const { payload } = buildRelease(p, "current-employer", leak, { requester: ACME, on: ON });
  assert.deepEqual(Object.keys(payload.orgs).sort(), ["acme", "red-cross-example"]);
  assert.deepEqual(Object.keys(payload.sources), ["offer-letter"]);
  assert.equal(payload.sources["offer-letter"].location, undefined);
});

test("write-back doesn't suggest a name the profile already has", () => {
  const s = scimBack();
  s.displayName = "Sam Rivera";
  s.name = { givenName: "Sam", familyName: "Rivera" };
  s.nickName = "Sam";
  assert.deepEqual(applyWriteBack(employee(), "current-employer", s, { requester: ACME, on: ON }).suggestions, []);
});

test("write-back keeps translations of a translated field and flags them for checking", () => {
  const p = employee();
  p.work[0].employerRecord.officialTitle = { "en-US": "Senior Software Engineer II", es: "Ingeniera de software sénior II" };
  const { profile } = applyWriteBack(p, "current-employer", scimBack(), { requester: ACME, on: ON });
  const job = profile.work[0];
  assert.deepEqual(job.employerRecord.officialTitle, { "en-US": "Senior Software Engineer II, Platform", es: "Ingeniera de software sénior II" });
  assert.match(job.openQuestion, /check its translations \(es\)/);
  assert.deepEqual(validateProfile(profile).errors, []);
  const same = structuredClone(p);
  same.work[0].employerRecord.officialTitle = { "en-US": "Senior Software Engineer II, Platform", es: "x" };
  const again = applyWriteBack(same, "current-employer", scimBack(), { requester: ACME, on: ON });
  assert.equal(again.changes.find((c) => c.field === "employerRecord.officialTitle").action, "unchanged");
});
