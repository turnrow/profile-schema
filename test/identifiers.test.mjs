import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProfile, convert, loadMapping, buildRelease } from "../index.mjs";
import { leiValid, visibilityOf } from "../lib/identifiers.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const employee = () => read("../examples/employee.profile.json");
const ON = "2026-11-07";
const minimal = (identifiers, extra = {}) => ({
  schemaVersion: "2.3.0",
  meta: { defaultLocale: "en" },
  person: { name: "x" },
  organizations: { co: { name: "Co", identifiers } },
  ...extra,
});
const valid = (ids) => validateProfile(minimal(ids)).valid;

test("all examples are valid", () => {
  for (const f of ["sample", "employee", "history"]) assert.deepEqual(validateProfile(read(`../examples/${f}.profile.json`)).errors, [], f);
});

test("identifier formats are checked per scheme", () => {
  const ok = [
    ["ein", "12-3456789"], ["ein", "123456789"],
    ["uei", "JM5AQKH7XYZ1"], ["uei", "vn1ajfad19j9"],
    ["duns", "123456789"], ["duns", "12-345-6789"],
    ["cage", "1AB23"], ["secCik", "0000320193"],
    ["npi", "1234567893"], ["ipeds", "228778"], ["wikidata", "Q42"],
    ["vat", "GB123456789"], ["abn", "51824753556"], ["bn", "123456789RC0001"],
    ["siren", "732829320"], ["siret", "73282932000074"], ["ticker", "NYSE:EDS"],
  ];
  for (const [scheme, value] of ok) assert.equal(valid([{ scheme, value }]), true, `${scheme} ${value}`);
  const bad = [
    ["ein", "1234-56789"], ["uei", "0M5AQKH7XYZ1"], ["uei", "IO5AQKH7XYZ1"], ["uei", "JM5AQKH7XYZ"],
    ["duns", "12345678"], ["cage", "1AO23"], ["npi", "123"], ["wikidata", "42"], ["ticker", "EDS"],
  ];
  for (const [scheme, value] of bad) assert.equal(valid([{ scheme, value }]), false, `${scheme} ${value}`);
});

test("LEI check digits are verified", () => {
  assert.equal(leiValid("529900T8BM49AURSDO55"), true);
  assert.equal(leiValid("529900T8BM49AURSDO56"), false);
  assert.match(validateProfile(minimal([{ scheme: "lei", value: "529900T8BM49AURSDO56" }])).errors.join("\n"), /LEI check digits are wrong/);
});

test("state identifiers need the state they belong to", () => {
  assert.equal(valid([{ scheme: "stateEntityNumber", value: "0801234567" }]), false);
  assert.equal(valid([{ scheme: "stateEntityNumber", value: "0801234567", jurisdiction: "US" }]), false, "a country is not a state");
  assert.equal(valid([{ scheme: "stateEntityNumber", value: "0801234567", jurisdiction: "US-TX", label: "Texas SOS file number" }]), true);
  assert.equal(valid([{ scheme: "stateTaxId", value: "1234567-8", jurisdiction: "US-OR", label: "Oregon BIN" }]), true);
  assert.equal(valid([{ scheme: "companyNumber", value: "00445790" }]), false);
  assert.equal(valid([{ scheme: "companyNumber", value: "00445790", jurisdiction: "GB" }]), true);
});

test("tax ids are private by default; registry ids are public", () => {
  assert.equal(visibilityOf({ scheme: "ein", value: "x" }), "private");
  assert.equal(visibilityOf({ scheme: "stateTaxId", value: "x" }), "private");
  assert.equal(visibilityOf({ scheme: "uei", value: "x" }), "public");
  assert.match(validateProfile(minimal([{ scheme: "ein", value: "12-3456789", visibility: "public" }])).warnings.join("\n"), /EIN is public/);
});

test("the same identifier on two organizations is flagged", () => {
  const p = minimal([{ scheme: "duns", value: "123456789" }]);
  p.organizations.other = { name: "Other", identifiers: [{ scheme: "duns", value: "12-345-6789" }] };
  assert.match(validateProfile(p).warnings.join("\n"), /same identifier is on organizations "co" and "other"/);
});

test("personal government ids can't be stored as person identifiers", () => {
  for (const key of ["ssn", "SSN", "passport", "driversLicense", "itin"]) {
    const p = minimal([], { person: { name: "x", identifiers: { [key]: "123" } } });
    assert.equal(validateProfile(p).valid, false, key);
  }
  assert.equal(validateProfile(minimal([], { person: { name: "x", identifiers: { orcid: "0000-0002-1825-0097" } } })).valid, true);
});

test("public schema.org output shows registry ids but never a private EIN", () => {
  const p = employee();
  const job = p.work.find((w) => w.id === "acme-platform");
  job.confidence = "high"; job.visibility = "public";
  const { output, text } = convert(p, loadMapping("schemaorg"), { on: ON });
  const acme = output.mainEntity.worksFor[0];
  assert.equal(acme.leiCode, "5493000EXAMPLEACME64");
  assert.equal(acme.naics, "541512");
  assert.ok(acme.identifier.some((i) => i.propertyID === "uei" && i.value === "JM5AQKH7XYZ1"));
  assert.ok(acme.identifier.some((i) => i.propertyID === "stateEntityNumber" && i.name === "Texas SOS file number"));
  assert.equal(acme.taxID, undefined);
  for (const secret of ["12-3456789", "32012345678"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
});

test("a verification release carries the EIN only for the employer it was shared with", () => {
  const p = employee();
  p.work.find((w) => w.id === "northwind-devex").audiences = ["former-employers"];
  const { payload, text } = buildRelease(p, "former-employers", loadMapping("verification"), { requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  const job = payload.employment.find((e) => e.employer.legalName === "Northwind Example Ltd");
  assert.equal(job.employer.ein, "98-7654321");
  assert.equal(job.employer.ueiToday, "VN1AJFAD19J9");
  assert.equal(job.employer.duns, "123456789", "the DUNS in force when the job started");
  assert.deepEqual(job.employer.stateEntityNumbers, [{ jurisdiction: "US-WA", label: "Washington UBI", value: "603123456" }]);
  assert.deepEqual(job.titles.map((t) => t.title), ["Staff Software Engineer"], "official title, from the employer record");
  for (const secret of ["12-3456789", "32012345678", "Acme"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
});

test("a directory release doesn't carry tax ids that weren't shared with it", () => {
  const p = employee();
  const leak = { target: "x", output: { orgs: "$$.organizations" } };
  const { payload } = buildRelease(p, "current-employer", leak, { requester: { domain: "acme.example", method: "oidc" }, on: ON });
  const schemes = payload.orgs.acme.identifiers.map((i) => i.scheme).sort();
  assert.deepEqual(schemes, ["cage", "ein", "lei", "stateEntityNumber", "uei"], "the EIN was shared with this audience; the state tax id was not");
});

test("dated identifiers apply only in their period", () => {
  const p = employee();
  p.work.find((w) => w.id === "northwind-devex").audiences = ["former-employers"];
  const m = loadMapping("verification");
  m.output.employment.$map.employer.dunsAtStart = { $fn: "orgIdentifier", args: ["$.organization", "duns", "$.startDate"] };
  m.output.employment.$map.employer.ueiAtStart = { $fn: "orgIdentifier", args: ["$.organization", "uei", "$.startDate"] };
  const { payload } = buildRelease(p, "former-employers", m, { requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  const job = payload.employment[0];
  assert.equal(job.employer.dunsAtStart, "123456789", "in 2019 Northwind had a DUNS");
  assert.equal(job.employer.ueiAtStart, undefined, "UEIs only began in 2022");
});

test("an identifier asked for without a date is the one in force today", () => {
  const p = employee();
  p.work.find((w) => w.id === "northwind-devex").audiences = ["former-employers"];
  const m = { target: "x", output: { "$each": "$$.work", "$map": { duns: { "$fn": "orgIdentifier", "args": ["$.organization", "duns"] } } } };
  const { payload } = buildRelease(p, "former-employers", m, { requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  assert.deepEqual(payload, [], "Northwind's DUNS was retired in 2022, so nothing is presented as current");
});

// ---------- regressions from the PR #4 review ----------

test("an SSN-shaped value is refused whatever its key", () => {
  for (const v of ["123-45-6789", "123 45 6789", "123456789"]) {
    const p = minimal([], { person: { name: "x", identifiers: { taxNumber: v } } });
    assert.equal(validateProfile(p).valid, false, v);
  }
  assert.equal(validateProfile(minimal([], { person: { name: "x", identifiers: { orcid: "0000-0002-1825-0097" } } })).valid, true);
});

test("a release resolves 'now' on the release's own date", () => {
  const h = read("../examples/history.profile.json");
  const { payload } = buildRelease(h, "past-employers", loadMapping("jsonresume"), { requester: { domain: "hp.com", method: "oidc" }, on: "2012-01-01" });
  assert.deepEqual(payload.work.filter((w) => w.position === "Systems Engineer").map((w) => w.name), ["EDS (now HP Enterprise Services)"]);
});

test("revoked identifiers are never presented, and undated replaced ones aren't current", () => {
  const p = employee();
  p.organizations.northwind.identifiers.push({ scheme: "cage", value: "9XY78", status: "revoked" });
  p.organizations.northwind.identifiers.push({ scheme: "npi", value: "1234567893", status: "replaced" });
  p.work.find((w) => w.id === "northwind-devex").audiences = ["former-employers"];
  const m = { target: "x", output: { "$each": "$$.work", "$map": {
    cage: { "$fn": "orgIdentifier", "args": ["$.organization", "cage"] },
    npi: { "$fn": "orgIdentifier", "args": ["$.organization", "npi"] } } } };
  const { payload } = buildRelease(p, "former-employers", m, { requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  assert.deepEqual(payload, []);
});
