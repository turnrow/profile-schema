import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { validateProfile, convert, loadMapping, fromJsonResume, RuleViolationError, checkRules } from "../index.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const sample = () => read("../examples/sample.profile.json");
const upstreamSchema = read("../upstream/jsonresume/schema.json");
const upstreamSample = read("../upstream/jsonresume/sample.resume.json");

function jsonResumeValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(upstreamSchema);
}
const minimal = (extra = {}) => ({
  schemaVersion: "2.0.0",
  meta: { defaultLocale: "en" },
  person: { name: "Test Person" },
  ...extra,
});

// ---------- schema and validator ----------

test("the sample profile is valid and reports its open items", () => {
  const r = validateProfile(sample());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.openItems.map((o) => o.status).sort(), ["disputed", "pending"]);
});

test("a minimal profile is valid", () => {
  assert.equal(validateProfile(minimal()).valid, true);
});

test("unknown fields are rejected", () => {
  const p = sample();
  p.work[0].salary = 100;
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.match(r.errors.join("\n"), /unevaluated properties/);
});

test("enums are enforced", () => {
  const p = sample();
  p.credentials[0].kind = "badge";
  assert.equal(validateProfile(p).valid, false);
});

test("fuzzy dates accept exact, qualified and between forms and reject bad ones", () => {
  for (const d of ["1990", "1990-06", "1990-06-30", { value: "1990", qualifier: "about" }, { between: ["1990", "1991"] }]) {
    const p = minimal({ awards: [{ id: "a", title: "x", date: d }] });
    assert.equal(validateProfile(p).valid, true, JSON.stringify(d));
  }
  for (const d of ["1990-13", "90", { value: "1990", qualifier: "maybe" }, { between: ["1990"] }]) {
    const p = minimal({ awards: [{ id: "a", title: "x", date: d }] });
    assert.equal(validateProfile(p).valid, false, JSON.stringify(d));
  }
});

test("text fields accept translations keyed by BCP 47 tags only", () => {
  assert.equal(validateProfile(minimal({ person: { name: "x", headline: { en: "a", "pt-BR": "b" } } })).valid, true);
  assert.equal(validateProfile(minimal({ person: { name: "x", headline: { english: "a" } } })).valid, false);
});

test("images require alt text", () => {
  const r = validateProfile(minimal({ person: { name: "x", image: { url: "https://example.com/a.jpg" } } }));
  assert.equal(r.valid, false);
});

test("cross-references are checked", () => {
  const p = sample();
  p.work[0].organization = "nope";
  p.work[0].skills.push("missing-skill");
  p.work[0].location = "atlantis";
  p.work[0].citations.push({ source: "no-such-source" });
  p.timeline[0].relatedTo = ["ghost"];
  const errs = validateProfile(p).errors.join("\n");
  for (const s of ['unknown organization "nope"', 'unknown skill "missing-skill"', 'unknown place "atlantis"', 'unknown source "no-such-source"', 'relatedTo unknown id "ghost"']) {
    assert.ok(errs.includes(s), s);
  }
});

test("duplicate ids are rejected across sections", () => {
  const p = sample();
  p.skills[0].id = p.work[0].id;
  assert.match(validateProfile(p).errors.join("\n"), /duplicate id/);
});

test("pending and disputed items must say what is open", () => {
  const p = sample();
  delete p.work.find((w) => w.id === "consulting-gap").openQuestion;
  assert.match(validateProfile(p).errors.join("\n"), /openQuestion is missing/);
});

test("claims: the accepted value must match the field", () => {
  const p = sample();
  p.work.find((w) => w.id === "harborline-director").title = "VP Development";
  assert.match(validateProfile(p).errors.join("\n"), /accepted claim says "Director of Development"/);
});

test("claims: conflicting values with none accepted require status disputed", () => {
  const p = sample();
  p.work.find((w) => w.id === "harborline-director").metrics.find((m) => m.id === "marina-slips").status = "approved";
  assert.match(validateProfile(p).errors.join("\n"), /none is accepted, so status must be "disputed"/);
});

test("claims: only one accepted claim per field", () => {
  const p = sample();
  p.work.find((w) => w.id === "harborline-director").claims[1].accepted = true;
  assert.match(validateProfile(p).errors.join("\n"), /2 accepted claims/);
});

test("non-private references need consent", () => {
  const p = sample();
  p.references[0].visibility = "public";
  assert.match(validateProfile(p).errors.join("\n"), /consentToPublish/);
});

test("credential ids that look like notes are flagged", () => {
  const p = minimal({ credentials: [{ id: "c", name: "Diver", kind: "certification", credentialId: "1000+ Dives logged overall" }] });
  assert.match(validateProfile(p).warnings.join("\n"), /looks like a note/);
});

test("high confidence on self-reported evidence only is flagged", () => {
  const p = sample();
  p.work.find((w) => w.id === "coastal-lab-researcher").confidence = "high";
  assert.match(validateProfile(p).warnings.join("\n"), /self-reported/);
});

test("bundle files are checked for presence and checksum", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  mkdirSync(join(dir, "media"));
  writeFileSync(join(dir, "media", "cv.pdf"), "pdf-bytes");
  const ok = minimal({ media: [{ id: "cv", title: "CV", url: "bundle:media/cv.pdf" }] });
  assert.equal(validateProfile(ok, { bundleDir: dir }).valid, true);
  const missing = minimal({ media: [{ id: "cv", title: "CV", url: "bundle:media/nope.pdf" }] });
  assert.match(validateProfile(missing, { bundleDir: dir }).errors.join("\n"), /not found/);
  const badSum = minimal({ media: [{ id: "cv", title: "CV", url: "bundle:media/cv.pdf", sha256: "0".repeat(64) }] });
  assert.match(validateProfile(badSum, { bundleDir: dir }).errors.join("\n"), /sha256 mismatch/);
});

// ---------- converter ----------

test("JSON Resume export validates against the upstream JSON Resume schema", () => {
  const { output } = convert(sample(), loadMapping("jsonresume"));
  const v = jsonResumeValidator();
  assert.equal(v(output), true, JSON.stringify(v.errors));
});

test("nothing pending, disputed, retired or private is exported", () => {
  const all = ["jsonresume", "schemaorg", "linkedin", "brief", "timeline"].map((m) => convert(sample(), loadMapping(m)).text).join("\n");
  assert.ok(!all.includes("Hospitality consultant"), "pending entry leaked");
  assert.ok(!/\b1[24]0 marina slips\b/.test(all), "disputed metric leaked");
  assert.ok(!all.includes("Private pilot"), "retired credential leaked");
  assert.ok(!all.includes("EX-12345"), "private credential id leaked");
  assert.ok(!all.includes("+1-555-0100"), "private phone leaked");
  assert.ok(!all.includes("Calloway Ortega"), "private legal name leaked");
  assert.ok(!all.includes("calmest person"), "unconsented reference leaked");
});

test("public outputs leave out network-only entries", () => {
  const { text } = convert(sample(), loadMapping("schemaorg"));
  assert.ok(!text.includes("ines@example.com"));
  assert.ok(!text.includes("Open Trails Foundation"));
  const li = convert(sample(), loadMapping("linkedin")).text;
  assert.ok(li.includes("Open Trails Foundation"), "network entry should reach LinkedIn");
});

test("qualified dates are not presented as exact in JSON Resume but read naturally in text", () => {
  const p = sample();
  const jr = convert(p, loadMapping("jsonresume")).output;
  const lab = jr.work.find((w) => w.position === "Research Biologist");
  assert.equal(lab.startDate, undefined);
  const li = convert(p, loadMapping("linkedin")).text;
  assert.match(li, /c\. 1996 – May 2009/);
  assert.match(li, /1990\/91 – 1995/);
});

test("locale switches translated text and falls back to the default", () => {
  const { output } = convert(sample(), loadMapping("brief"), { locale: "es" });
  assert.equal(output.title, "Fundadora y directora ejecutiva, Tidewater Trails");
  assert.equal(output.proofPoints[1].role, "Director of Development, Harborline Resorts");
});

test("schema.org output is a ProfilePage about a Person with linked place ids", () => {
  const { output } = convert(sample(), loadMapping("schemaorg"));
  assert.equal(output["@type"], "ProfilePage");
  assert.equal(output.mainEntity["@type"], "Person");
  assert.equal(output.mainEntity.homeLocation.sameAs, "https://www.wikidata.org/entity/Q60");
  assert.ok(output.mainEntity.hasCredential.some((c) => c.name.startsWith("Master Mariner")));
});

test("priority and confidence filters shape the brief", () => {
  const { output } = convert(sample(), loadMapping("brief"));
  assert.ok(output.proofPoints.length <= 3);
  assert.ok(!JSON.stringify(output).includes("Research Biologist"), "priority 60 entry should be excluded");
});

test("target overrides change or omit an entry for one output only", () => {
  const p = sample();
  p.work[0].targets = { linkedin: { title: "Founder" }, jsonresume: { omit: true } };
  assert.match(convert(p, loadMapping("linkedin")).text, /Title: Founder\n/);
  assert.ok(!convert(p, loadMapping("jsonresume")).output.work.some((w) => w.name === "Tidewater Trails"));
  assert.ok(convert(p, loadMapping("schemaorg")).text.includes("Founder & CEO"));
});

test("content rules block output that breaks them", () => {
  const p = sample();
  p.person.shortBio = "Dr. Calloway makes every trip safe.";
  assert.throws(() => convert(p, loadMapping("brief")), (err) => {
    assert.ok(err instanceof RuleViolationError);
    assert.deepEqual(err.violations.map((v) => v.rule).sort(), ["no-phd", "no-safe"]);
    return true;
  });
  const { violations } = convert(p, loadMapping("brief"), { allowRuleViolations: true });
  assert.equal(violations.length, 2);
});

test("phrase rules match whole words only and patterns honour appliesTo", () => {
  const p = sample();
  assert.equal(checkRules(p, "a safer approach to travel", ["public"]).length, 0);
  assert.equal(checkRules(p, "completely safe", ["public"]).length, 1);
  assert.equal(checkRules(p, "holds an MS in biology", ["private"]).length, 0);
  assert.equal(checkRules(p, "holds an MS in biology", ["network"]).length, 1);
});

// ---------- importer ----------

test("JSON Resume import produces a valid draft profile", () => {
  const profile = fromJsonResume(upstreamSample, { now: "2026-11-07T00:00:00Z" });
  const r = validateProfile(profile);
  assert.deepEqual(r.errors, []);
  assert.ok(profile.work.length > 0);
  assert.ok(profile.work.every((w) => w.status === "draft"));
  assert.equal(profile.person.contact.emailVisibility, "private");
});

test("imported drafts are not published until approved, then round-trip to valid JSON Resume", () => {
  const profile = fromJsonResume(upstreamSample, { now: "2026-11-07T00:00:00Z" });
  const before = convert(profile, loadMapping("jsonresume")).output;
  assert.equal(before.work, undefined);
  for (const s of ["work", "education", "skills", "projects", "awards", "credentials", "publications", "languages", "interests", "service"]) {
    for (const e of profile[s] ?? []) e.status = "approved";
  }
  const after = convert(profile, loadMapping("jsonresume")).output;
  assert.equal(after.work.length, upstreamSample.work.length);
  const v = jsonResumeValidator();
  assert.equal(v(after), true, JSON.stringify(v.errors));
});

// ---------- regressions from the PR #1 review ----------

test("schema.org given and family names come from the preferred name, never a private one", () => {
  const p = sample();
  p.person.names = [p.person.names[1], p.person.names[0], p.person.names[2]]; // legal (private) first
  const me = convert(p, loadMapping("schemaorg")).output.mainEntity;
  assert.equal(me.givenName, "Ines");
  assert.equal(me.familyName, "Calloway");
  assert.ok(!JSON.stringify(me).includes("Calloway Ortega"));
});

test("rules catch a phrase that follows a line break", () => {
  const p = sample();
  p.person.shortBio = "First line.\nsafe travels for all";
  assert.throws(() => convert(p, loadMapping("brief")), RuleViolationError);
});

test("bundle paths cannot escape the bundle folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  const p = minimal({ media: [{ id: "m", title: "t", url: "bundle:../outside.txt" }] });
  assert.match(validateProfile(p, { bundleDir: dir }).errors.join("\n"), /escapes the bundle folder/);
});

test("sorting treats a missing priority as the default 50", () => {
  const p = sample();
  p.skills.find((s) => s.id === "marine-biology").priority = 40;
  p.skills.push({ id: "no-priority", status: "approved", confidence: "high", name: "No Priority" });
  const skills = convert(p, loadMapping("linkedin")).output["Skills (first 3 pinned)"];
  assert.ok(skills.indexOf("No Priority") < skills.indexOf("Marine Biology"));
});

test("accepted claims compare equal whatever the key order", () => {
  const p = sample();
  const w = p.work.find((x) => x.id === "coastal-lab-researcher");
  w.claims = [{ field: "startDate", value: { qualifier: "about", value: "1996" }, accepted: true, citations: [{ source: "cv" }] }];
  assert.deepEqual(validateProfile(p).errors, []);
});

test("import drops impossible dates instead of producing an invalid profile", () => {
  const profile = fromJsonResume({ basics: { name: "x" }, work: [{ name: "A", position: "B", startDate: "2020-13" }] });
  assert.equal(validateProfile(profile).valid, true);
  assert.equal(profile.work[0].startDate, undefined);
});

test("import keeps organizations whose names slug the same apart", () => {
  const profile = fromJsonResume({ basics: { name: "x" }, work: [{ name: "A&B", position: "p" }, { name: "A B", position: "q" }] });
  assert.equal(Object.keys(profile.organizations).length, 2);
  assert.notEqual(profile.work[0].organization, profile.work[1].organization);
});
