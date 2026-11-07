import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProfile, convert, loadMapping, checkRequester, buildRelease } from "../index.mjs";
import { nameAt, activeDomains, successorsAt, relatedOrgs, positionsOf, orgById } from "../lib/history.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const history = () => read("../examples/history.profile.json");
const TODAY = "2026-11-07";

// ---------- schema and validation ----------

test("the history example is valid, and earlier examples still are", () => {
  assert.deepEqual(validateProfile(history()).errors, []);
  assert.equal(validateProfile(read("../examples/sample.profile.json")).valid, true);
  assert.equal(validateProfile(read("../examples/employee.profile.json")).valid, true);
});

test("organization events are checked for references and required parts", () => {
  const p = history();
  p.organizationEvents.push({ id: "bad-merger", type: "merger", date: "2001", predecessors: ["nobody"], successors: [] });
  p.organizationEvents.push({ id: "bad-split", type: "split", date: "2002", predecessors: ["hp"], successors: ["hp", "hpe"], recordsTo: "dxc" });
  const errs = validateProfile(p).errors.join("\n");
  assert.match(errs, /bad-merger: unknown organization "nobody"/);
  assert.match(errs, /bad-merger: a merger needs successors/);
  assert.match(errs, /bad-split: recordsTo must be one of the successors/);
});

test("parents and responsibilities are checked", () => {
  const p = history();
  p.organizations.eds.parents.push({ organization: "eds", relation: "subsidiary" });
  p.work[0].responsibilities[2].positions = ["eds-ghost"];
  const errs = validateProfile(p).errors.join("\n");
  assert.match(errs, /cannot be its own parent/);
  assert.match(errs, /unknown position "eds-ghost"/);
});

test("overlapping positions are flagged", () => {
  const p = history();
  p.work[0].positions[1].startDate = "2007-01";
  assert.match(validateProfile(p).warnings.join("\n"), /positions eds-se and eds-sse overlap/);
});

// ---------- organization history ----------

test("an organization's name depends on the date", () => {
  const eds = orgById(history(), "eds");
  assert.equal(nameAt(eds, "2005-06"), "EDS");
  assert.equal(nameAt(eds, "2009-01"), "EDS, an HP Company");
  assert.equal(nameAt(eds, "2010-02"), "HP Enterprise Services");
  assert.equal(nameAt(eds, "2005", ["legal"]), "Electronic Data Systems Corporation");
  const pwc = orgById(history(), "pwc");
  assert.equal(nameAt(pwc, "2005"), "PricewaterhouseCoopers");
  assert.equal(nameAt(pwc, TODAY), "PwC");
  assert.equal(nameAt(pwc, TODAY, ["legal"]), "PricewaterhouseCoopers", "the 2010 rebrand did not change the legal name");
});

test("successors are followed through mergers", () => {
  const p = history();
  assert.deepEqual(successorsAt(p, "eds", TODAY), ["dxc"]);
  assert.deepEqual(successorsAt(p, "eds", "2012"), ["eds"], "nothing had happened yet in 2012");
  assert.deepEqual(successorsAt(p, "coopers-lybrand", TODAY), ["pwc"]);
  assert.deepEqual(relatedOrgs(p, "eds", "2010").sort(), ["eds", "hp"]);
  assert.deepEqual(relatedOrgs(p, "eds", TODAY).sort(), ["dxc", "eds"]);
});

test("retired domains never count, and dated domains count only while in force", () => {
  const p = history();
  assert.deepEqual(activeDomains(orgById(p, "eds"), "2005"), []);
  assert.deepEqual(activeDomains(orgById(p, "pwc"), TODAY), ["pwc.com"]);
  p.organizations.pwc.domains.push({ domain: "pwcglobal.com", from: "1998", to: "2010" });
  assert.deepEqual(activeDomains(orgById(p, "pwc"), "2005"), ["pwc.com", "pwcglobal.com"]);
  assert.deepEqual(activeDomains(orgById(p, "pwc"), TODAY), ["pwc.com"]);
});

// ---------- audiences follow history ----------

test("past-employer verification is answered by whoever holds the records now", () => {
  const p = history();
  const ok = (domain, on = TODAY) => checkRequester(p, "past-employers", { domain, method: "oidc" }, { on }).ok;
  assert.equal(ok("dxc.com"), true, "DXC holds EDS's records today");
  assert.equal(ok("eds.com"), false, "a retired domain can be bought by anyone");
  assert.equal(ok("hp.com"), false, "HP stopped owning EDS in 2015");
  assert.equal(ok("hpe.com"), false, "HPE handed the business to DXC in 2017");
  assert.equal(ok("hp.com", "2012-01-01"), true, "in 2012 HP owned EDS");
  assert.equal(ok("pwc.com"), true, "PwC succeeded Coopers & Lybrand");
  assert.equal(ok("pwcglobal.com"), false);
});

test("a verification release can name employers by their legal names at the time", () => {
  const p = history();
  const mapping = { ...loadMapping("jsonresume"), orgNameStyle: "legal" };
  const { payload } = buildRelease(p, "past-employers", mapping, { requester: { domain: "dxc.com", method: "oidc" }, on: TODAY });
  const names = payload.work.map((w) => w.name);
  assert.ok(names.includes("Electronic Data Systems Corporation (doing business as EDS)"));
  assert.ok(names.includes("CSI (doing business as Buchanan Associates)"));
});

// ---------- positions and responsibilities ----------

test("responsibilities continue through promotions and re-titles", () => {
  const positions = positionsOf(history().work[0]);
  assert.deepEqual(positions.map((x) => x.id), ["eds-se", "eds-sse", "eds-tc3", "eds-sa"]);
  const byPos = Object.fromEntries(positions.map((x) => [x.id, x.responsibilities.map((r) => `${r.id}${r.continuing ? "*" : ""}`)]));
  assert.deepEqual(byPos["eds-se"], ["batch-ops"]);
  assert.deepEqual(byPos["eds-sse"], ["batch-ops*", "release-team", "mentoring"]);
  assert.deepEqual(byPos["eds-tc3"], ["batch-ops*", "release-team*", "mentoring*"]);
  assert.deepEqual(byPos["eds-sa"], ["release-team*", "architecture"]);
});

test("a job without positions acts as one position", () => {
  const job = history().work.find((w) => w.id === "buchanan-job");
  const positions = positionsOf(job);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].title, "Network Engineer");
});

test("JSON Resume gets one entry per position, named as the employer was then", () => {
  const { output } = convert(history(), loadMapping("jsonresume"));
  const rows = output.work.map((w) => `${w.name} | ${w.position}`);
  assert.ok(rows.includes("EDS (now DXC Technology) | Systems Engineer"));
  assert.ok(rows.includes("EDS, an HP Company (now DXC Technology) | Technology Consultant III"));
  assert.ok(rows.includes("HP Enterprise Services (now DXC Technology) | Solutions Architect"));
  assert.ok(rows.includes("Coopers & Lybrand (now PwC) | Associate"));
  assert.ok(rows.includes("PricewaterhouseCoopers (now PwC) | Senior Associate"), "after the merger the employer was the merged firm");
  assert.ok(rows.includes("Buchanan Associates (now Buchanan Technologies) | Network Engineer"));
});

test("scope figures appear only for the positions they applied to", () => {
  const { output } = convert(history(), loadMapping("jsonresume"));
  const line = (title) => output.work.find((w) => w.position === title).highlights.find((h) => h.includes("release-engineering"));
  assert.match(line("Senior Systems Engineer"), /3 engineers/);
  assert.doesNotMatch(line("Senior Systems Engineer"), /8 engineers/);
  assert.match(line("Solutions Architect"), /^Continued: .*8 engineers/);
  assert.doesNotMatch(line("Solutions Architect"), /3 engineers/);
});

test("LinkedIn groups positions under one company and lists what changed while you were there", () => {
  const { output } = convert(history(), loadMapping("linkedin"));
  const eds = output.Experience.find((e) => e["Company at the time"] === "EDS");
  assert.equal(eds["Company (search LinkedIn for)"], "DXC Technology");
  assert.deepEqual(eds["Changes while there"], ["Acquired by HP (Aug 2008)", "Renamed HP Enterprise Services (Sep 2009)"]);
  assert.equal(eds.Positions.length, 4);
});

test("employer name styles", () => {
  const p = history();
  const name = (style) => convert(p, { ...loadMapping("jsonresume"), orgNameStyle: style }).output.work.find((w) => w.position === "Associate").name;
  assert.equal(name("atTheTime"), "Coopers & Lybrand");
  assert.equal(name("today"), "PwC");
  assert.equal(name("both"), "Coopers & Lybrand (now PwC)");
});

test("JSON Resume output from the history example validates against the upstream schema", async () => {
  const { default: Ajv } = await import("ajv");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(read("../upstream/jsonresume/schema.json"));
  assert.equal(validate(convert(history(), loadMapping("jsonresume")).output), true, JSON.stringify(validate.errors));
});

test("a release carries the history of the organizations it mentions", () => {
  const p = history();
  const { payload } = buildRelease(p, "past-employers", loadMapping("jsonresume"), { requester: { domain: "dxc.com", method: "oidc" }, on: TODAY });
  assert.ok(payload.work.some((w) => w.name === "EDS (now DXC Technology)"));
  assert.ok(payload.work.some((w) => w.name === "PricewaterhouseCoopers (now PwC)"));
});

// ---------- regressions from the PR #3 review ----------

test("an undated job uses the employer's display name, not a dated legal name", () => {
  const p = history();
  const job = p.work.find((w) => w.id === "buchanan-job");
  delete job.startDate; delete job.endDate; job.organization = "eds";
  const row = convert(p, loadMapping("jsonresume"), { on: TODAY }).output.work.find((w) => w.position === "Network Engineer");
  assert.equal(row.name, "EDS (now DXC Technology)");
});

test("schema.org names a current employer as it is now", () => {
  const p = history();
  const job = p.work.find((w) => w.id === "eds-job");
  job.current = true; job.confidence = "high"; delete job.endDate;
  delete job.positions.at(-1).endDate; job.positions.at(-1).current = true;
  const names = convert(p, loadMapping("schemaorg"), { on: "2012-01-01" }).output.mainEntity.worksFor.map((o) => o.name);
  assert.deepEqual(names, ["HP Enterprise Services"]);
});

test("job-level figures appear once, on the latest position", () => {
  const p = history();
  p.work[0].metrics = [{ id: "clients-served", label: "state agencies served", value: 4 }];
  const rows = convert(p, loadMapping("jsonresume"), { on: TODAY }).output.work
    .filter((w) => (w.highlights ?? []).some((h) => h.includes("state agencies served")));
  assert.deepEqual(rows.map((r) => r.position), ["Solutions Architect"]);
});
