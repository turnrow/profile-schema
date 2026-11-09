import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateProfile, convert, loadMapping, buildRelease, officialTitle, stringsOf } from "../index.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const sample = () => read("../examples/sample.profile.json");
const employee = () => read("../examples/employee.profile.json");
const history = () => read("../examples/history.profile.json");
const ON = "2026-11-07";
const CLI = new URL("../bin/profile.mjs", import.meta.url).pathname;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const has = (list, re) => list.some((x) => re.test(x));

// ---------- code lists ----------

test("bundled code lists cover SOC 2018, O*NET-SOC, O*NET elements and NAICS 2022", () => {
  assert.equal(officialTitle("soc", "11-9021"), "Construction Managers");
  assert.equal(officialTitle("onetSoc", "53-2012.00"), "Commercial Pilots");
  assert.equal(officialTitle("onet", "2.B.5.b"), "Management of Financial Resources");
  assert.equal(officialTitle("naics", "561510"), "Travel Agencies");
  assert.equal(officialTitle("soc", "11-9021", "2028"), undefined, "an edition we don't bundle isn't looked up");
  const soc = read("../data/soc-2018.json").codes;
  const levels = Object.values(soc).reduce((n, c) => ({ ...n, [c.level]: (n[c.level] ?? 0) + 1 }), {});
  assert.deepEqual(levels, { major: 23, minor: 98, broad: 459, detailed: 867 }, "the published 2018 SOC counts");
  assert.equal(Object.keys(read("../data/onet-soc.json").codes).length, 1016);
});

test("occupation codes are checked at job, position and responsibility level", () => {
  const p = history();
  assert.equal(validateProfile(p).valid, true);
  p.work[0].positions[0].occupations = [{ system: "soc", code: "15-9999" }];
  p.work[0].responsibilities[0].occupations = [{ system: "onetSoc", code: "15-1244.99" }];
  const r = validateProfile(p);
  assert.ok(has(r.errors, /position eds-se › soc 15-9999: 15-9999 is not a 2018 SOC code/));
  assert.ok(has(r.errors, /responsibility .* › onetSoc 15-1244\.99: .* not a O\*NET-SOC 2019 code/));
});

test("code formats are enforced by the schema", () => {
  for (const code of ["119021", "11-90211", "11-9021.0"]) {
    const p = employee();
    p.work[0].occupations = [{ system: "soc", code }];
    assert.equal(validateProfile(p).valid, false, code);
  }
  const p = employee();
  p.skills[0].codes = [{ system: "onet", code: "skill-7" }];
  assert.equal(validateProfile(p).valid, false);
});

test("warnings: a group instead of an occupation, a wrong title, two primaries, O*NET under another SOC", () => {
  const p = employee();
  p.work[0].occupations = [
    { system: "soc", code: "11-3000" },
    { system: "soc", code: "15-1252", label: "Programmers" },
    { system: "onetSoc", code: "15-1252.00" },
  ];
  const w = validateProfile(p).warnings;
  assert.ok(has(w, /11-3000 is a SOC minor group/));
  assert.ok(has(w, /label "Programmers" differs from the official title "Software Developers"/));
  assert.ok(has(w, /2 primary soc codes/));
  assert.ok(has(w, /O\*NET-SOC 15-1252\.00 is not under primary SOC 11-3000/));
});

test("codes in editions we don't bundle are accepted unchecked", () => {
  const p = employee();
  p.work[0].occupations = [{ system: "soc", code: "11-9999", version: "2028" }, { system: "isco", code: "1330", version: "08" }];
  const r = validateProfile(p);
  assert.equal(r.valid, true, r.errors.join("\n"));
});

test("NAICS codes on organizations and O*NET codes on skills are checked", () => {
  const p = employee();
  p.organizations.acme.classifications = [{ system: "naics", code: "999999", version: "2022" }];
  p.skills[0].codes = [{ system: "onet", code: "2.B.9.z" }];
  const r = validateProfile(p);
  assert.ok(has(r.errors, /naics 999999: 999999 is not a NAICS 2022 code/));
  assert.ok(has(r.errors, /onet 2\.B\.9\.z: .* not a O\*NET 31\.0 code/));
});

test("JSON-LD carries occupational categories and coded skills; verification carries SOC codes", () => {
  const p = employee();
  const ld = convert(p, loadMapping("schemaorg"), { on: ON }).output;
  const occ = ld.mainEntity.hasOccupation.find((o) => o.name === "Platform Engineering Lead");
  assert.deepEqual(occ.occupationalCategory[0], {
    "@type": "CategoryCode", codeValue: "11-3021", name: "Computer and Information Systems Managers",
    inCodeSet: { "@type": "CategoryCodeSet", name: "2018 SOC", url: "https://www.bls.gov/soc/2018/" },
  });
  const skill = ld.mainEntity.knowsAbout.find((k) => k.name === "Mentoring");
  assert.equal(skill["@type"], "DefinedTerm");
  assert.equal(skill.termCode, "2.B.1.e");
  const ver = convert(p, loadMapping("verification"), { on: ON }).output;
  const acme = ver.employment.find((e) => e.titles?.[0]?.title === "Platform Engineering Lead" || e.employer.legalName?.includes("Acme"));
  assert.deepEqual(acme.occupationCodes.map((c) => c.soc), ["11-3021", "15-1252"], "primary first");
});

test("each position in JSON-LD carries its own codes, not the whole job's", () => {
  const ld = convert(history(), loadMapping("schemaorg"), { on: ON }).output;
  const codes = (name) => ld.mainEntity.hasOccupation.find((o) => o.name === name).occupationalCategory.map((c) => c.codeValue);
  assert.ok(codes("Systems Engineer").includes("15-1244"));
  assert.ok(!codes("Systems Engineer").includes("15-1299.08"), "the architect code belongs to the later position");
  assert.deepEqual(codes("Solutions Architect").slice(0, 2), ["15-1299", "15-1299.08"]);
  assert.ok(codes("Technology Consultant III").includes("15-1211"));
});

// ---------- notes ----------

test("notes and code rationales never reach an output", () => {
  const p = history();
  p.work[0].note = "SECRET-NOTE-1";
  p.work[0].responsibilities[0].note = "SECRET-NOTE-2";
  p.work[0].occupations[0].rationale = "SECRET-NOTE-3";
  p.organizations[Object.keys(p.organizations)[0]].note = "SECRET-NOTE-4";
  assert.equal(validateProfile(p).valid, true);
  for (const m of ["jsonresume", "schemaorg", "linkedin", "brief", "timeline", "verification"]) {
    const { text } = convert(p, loadMapping(m), { on: ON, visibility: ["public", "network", "private"] });
    assert.ok(!/SECRET-NOTE/.test(text), m);
  }
});

// ---------- confidence ----------

test("from 2.5, high confidence needs more than your own word", () => {
  const p = employee();
  p.sources = { ...p.sources, me: { title: "My CV", kind: "cv", defaultQuality: "selfReported" } };
  p.work[0].confidence = "high";
  p.work[0].citations = [{ source: "me" }];
  assert.ok(has(validateProfile(p).errors, /confidence is high but every citation is self-reported/));
  p.schemaVersion = "2.4.0";
  const r = validateProfile(p);
  assert.equal(r.valid, true);
  assert.ok(has(r.warnings, /confidence is high/), "older files only get a warning");
});

// ---------- open questions ----------

test("open lists questions on approved entries, not just pending ones", () => {
  const p = employee();
  p.work[0].status = "approved";
  p.work[0].openQuestion = "Which month did this start?";
  const items = validateProfile(p).openItems;
  assert.ok(items.some((o) => o.status === "question" && o.question === "Which month did this start?"));
});

// ---------- dates ----------

test("uncertain dates read as 'between', not with a slash", () => {
  const p = employee();
  p.work[0].startDate = { between: ["2025-10", "2025-12"] };
  const li = convert(p, loadMapping("linkedin"), { on: ON }).text;
  assert.match(li, /between Oct 2025 and Dec 2025 – Present/);
  assert.match(li, /the start date is uncertain \(between Oct 2025 and Dec 2025\)/, "and the sheet warns before you paste");
  const es = convert(p, loadMapping("linkedin"), { on: ON, locale: "es" }).text;
  assert.match(es, /entre oct 2025 y dic 2025/i);
});

// ---------- media ----------

test("bundle: links become published URLs, or are left out", () => {
  const p = sample();
  p.person.image.url = "bundle:media/me.jpg";
  p.media[0].url = "bundle:media/site.png";
  const without = convert(p, loadMapping("schemaorg"), { on: ON }).text;
  assert.ok(!without.includes("bundle:"));
  p.meta.mediaBaseUrl = "https://example.com/profile/";
  const ld = convert(p, loadMapping("schemaorg"), { on: ON }).output;
  assert.equal(ld.mainEntity.image.contentUrl, "https://example.com/profile/media/me.jpg");
  assert.ok(!convert(p, loadMapping("jsonresume"), { on: ON }).text.includes("bundle:"));
});

// ---------- alternate names ----------

test("an organization's alternate names don't repeat the name shown", () => {
  const p = employee();
  const ld = convert(p, loadMapping("schemaorg"), { on: ON }).output;
  for (const o of ld.mainEntity.worksFor ?? []) for (const n of o.alternateName ?? []) assert.notEqual(n, o.name);
});

// ---------- LinkedIn sheet ----------

test("LinkedIn sheet: projects, publications, languages, military under Experience, and what to fix first", () => {
  const p = sample();
  p.service = [
    { id: "navy", kind: "military", organization: "harborline", startDate: "1990", endDate: "1992", status: "approved", confidence: "medium", summary: "Two years." },
    { id: "reef", kind: "volunteer", organization: "harborline", role: "Volunteer", current: true, status: "approved", confidence: "medium" },
  ];
  p.projects = [{ id: "pier", name: "Harbor pier", role: "Project lead", value: { amount: 2000000, currency: "USD" }, status: "approved", confidence: "medium" }];
  const li = convert(p, loadMapping("linkedin"), { on: ON }).text;
  assert.match(li, /Experience: military service \(add each as an Experience entry\):[\s\S]*Company \(search LinkedIn for\)/);
  assert.match(li, /Volunteering:[\s\S]*Role: Volunteer/);
  assert.doesNotMatch(li.split("Volunteering:")[1].split("Education:")[0], /Two years/, "military isn't volunteering");
  assert.match(li, /Projects:[\s\S]*Project name: Harbor pier[\s\S]*Project lead · \$2M project/);
  assert.match(li, /Languages:[\s\S]*Proficiency: Native or bilingual proficiency/);
  assert.match(li, /Experience \(military\) ".*": needs a title \(rank or rate\) or role/);
  assert.match(li, /the start date has a year but no month \(1990\)/);
  assert.doesNotMatch(li, /Volunteering "Volunteer": needs/, "LinkedIn doesn't require volunteering dates");
});

// ---------- visibility override ----------

test("--visibility narrows or widens an output's entries", () => {
  const p = employee();
  p.work[1].visibility = "network";
  const pub = convert(p, loadMapping("jsonresume"), { on: ON }).output;
  assert.equal(pub.work.length, p.work.length - 1, "JSON Resume is public-only by default");
  const net = convert(p, loadMapping("jsonresume"), { on: ON, visibility: ["public", "network"] }).output;
  assert.equal(net.work.length, p.work.length);
});

// ---------- releases ----------

test("a release is refused until the subject has consented", () => {
  const p = employee();
  p.meta.subjectConsent = { given: false };
  assert.throws(() => buildRelease(p, "current-employer", loadMapping("scim"), { requester: { domain: "acme.example", method: "oidc" }, on: ON }),
    { name: "ReleaseRefusedError", message: /has not given consent/ });
});

test("an audience can list several organizations; any one of them qualifies", () => {
  const p = employee();
  p.organizations.fund1 = { name: "Fund One", domains: [{ domain: "fund1.example" }] };
  p.organizations.fund2 = { name: "Fund Two", domains: [{ domain: "fund2.example" }] };
  p.audiences.funds = { kind: "group", purpose: "other", organizations: ["fund1", "fund2"], sections: ["work"], verification: { methods: ["emailDomain", "oidc"] } };
  assert.equal(validateProfile(p).valid, true);
  const r = buildRelease(p, "funds", loadMapping("brief"), { requester: { domain: "fund2.example", method: "emailDomain" }, on: ON });
  assert.equal(r.record.recipient.organization, "fund2");
  assert.throws(() => buildRelease(p, "funds", loadMapping("brief"), { requester: { domain: "other.example", method: "emailDomain" }, on: ON }), /does not belong/);
});

test("anyVerified audiences: invitation works, an email address never does", () => {
  const p = employee();
  p.audiences.dataroom = { kind: "group", purpose: "other", recipients: "anyVerified", sections: ["work"], verification: { methods: ["invitation"] } };
  assert.equal(validateProfile(p).valid, true);
  const r = buildRelease(p, "dataroom", loadMapping("brief"), { requester: { method: "invitation", name: "Example Ventures" }, on: ON });
  assert.equal(r.record.recipient.name, "Example Ventures");
  assert.equal(r.receipt.recipient.name, "Example Ventures");
  assert.throws(() => buildRelease(p, "dataroom", loadMapping("brief"), { requester: { method: "emailDomain", domain: "x.example" }, on: ON }), /not accepted|never qualifies/);
  assert.throws(() => buildRelease(p, "dataroom", loadMapping("brief"), { on: ON }), /needs a verified, named requester/);
  p.audiences.dataroom.verification.methods = ["invitation", "emailDomain"];
  assert.ok(has(validateProfile(p).errors, /anyVerified audience cannot accept emailDomain/));
});

// ---------- CLI ----------

test("the CLI reports errors plainly, and --record writes into a bundle's profile.json", () => {
  const missing = cli("validate", "/nonexistent/profile.json");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^error: no such file or folder/);
  assert.doesNotMatch(missing.stderr, /at .*\.mjs:\d+/, "no stack trace");

  const dir = mkdtempSync(join(tmpdir(), "tp-"));
  const p = employee();
  p.meta.subjectConsent = { given: false };
  writeFileSync(join(dir, "profile.json"), JSON.stringify(p));
  const refused = cli("release", dir, "current-employer", "--domain", "acme.example", "--method", "oidc", "--on", ON);
  assert.equal(refused.status, 4);
  assert.match(refused.stderr, /^Release refused: the subject has not given consent/);

  p.meta.subjectConsent = employee().meta.subjectConsent;
  writeFileSync(join(dir, "profile.json"), JSON.stringify(p));
  const ok = cli("release", dir, "current-employer", "--domain", "acme.example", "--method", "oidc", "--on", ON, "--record", "--out", join(dir, "out.json"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, "profile.json"), "utf8")).releases.length, (employee().releases ?? []).length + 1);

  const badVis = cli("convert", dir, "brief", "--visibility", "everyone");
  assert.equal(badVis.status, 2);
});

test("related codes stay out of JSON-LD and verification: they are a nearest fit, not a claim", () => {
  const ld = convert(history(), loadMapping("schemaorg"), { on: ON }).output;
  const all = ld.mainEntity.hasOccupation.flatMap((o) => o.occupationalCategory ?? []).map((c) => c.codeValue);
  assert.ok(!all.includes("25-3021"));
  const ver = convert(history(), loadMapping("verification"), { on: ON }).output;
  assert.ok(!ver.employment.flatMap((e) => e.occupationCodes ?? []).some((c) => c.match === "related"));
});

test("open on an invalid file says so instead of reporting nothing open", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-"));
  const p = employee();
  p.work[0].occupations = [{ system: "soc", code: "bad" }];
  writeFileSync(join(dir, "profile.json"), JSON.stringify(p));
  const r = cli("open", dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not valid/);
  assert.doesNotMatch(r.stdout, /Nothing waiting/);
});
