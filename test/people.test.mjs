import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProfile, convert, loadMapping } from "../index.mjs";
import { nameAt, roleAt, currentImage } from "../lib/people.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const ON = "2026-11-07";
const has = (list, re) => list.some((x) => re.test(x));

export function withPeople() {
  const p = read("../examples/employee.profile.json");
  p.schemaVersion = "2.6.0";
  p.organizations.globex = { name: "Globex", kind: "company" };
  p.people = {
    "maria-chen": {
      name: "Maria Chen",
      names: [
        { full: "Maria Lopez", type: "birth", to: "2019-05" },
        { full: "Maria Chen", type: "preferred", from: "2019-06" },
      ],
      identifiers: [{ scheme: "linkedin", value: "https://www.linkedin.com/in/mariachen" }],
      roles: [
        { title: "Engineering Manager", organization: "acme", from: "2021-02", to: "2024-08" },
        { title: "Director of Engineering", organization: "globex", from: "2024-09" },
      ],
      contacts: [
        { type: "email", value: "maria@acme.example", from: "2021-02", to: "2024-08" },
        { type: "email", value: "maria.chen@globex.example", from: "2024-09" },
      ],
      images: [
        { url: "https://example.com/maria-2021.jpg", asOf: "2021-03" },
        { url: "https://example.com/maria-2025.jpg", asOf: "2025-01" },
      ],
    },
  };
  return p;
}

test("a valid people registry validates", () => {
  const r = validateProfile(withPeople());
  assert.equal(r.valid, true, r.errors.join("\n"));
});

test("unknown people refs and unknown organizations in roles are errors", () => {
  const p = withPeople();
  p.references = [{ id: "ref-1", name: "Someone", person: "nobody" }];
  p.people["maria-chen"].roles[0].organization = "initech";
  const e = validateProfile(p).errors;
  assert.ok(has(e, /references\/ref-1: unknown person "nobody"/));
  assert.ok(has(e, /people\/maria-chen\.roles\[0\]: unknown organization "initech"/));
});

test("roleAt returns the role in force; between roles, nothing", () => {
  const m = withPeople().people["maria-chen"];
  assert.deepEqual(roleAt(m, "2023-01-15"), { title: "Engineering Manager", organization: "acme" });
  assert.deepEqual(roleAt(m, "2025-01-01"), { title: "Director of Engineering", organization: "globex" });
  assert.equal(roleAt({ ...m, roles: [m.roles[0]] }, "2025-01-01"), undefined);
});

test("nameAt uses dated names, falling back to the display name", () => {
  const m = withPeople().people["maria-chen"];
  assert.equal(nameAt(m, "2018-01-01"), "Maria Lopez");
  assert.equal(nameAt(m, "2022-01-01"), "Maria Chen");
  assert.equal(nameAt({ name: "X" }, "2022-01-01"), "X");
});

test("currentImage is the newest asOf", () => {
  assert.equal(currentImage(withPeople().people["maria-chen"]).url, "https://example.com/maria-2025.jpg");
});

test("contacts default private and never reach an output", () => {
  const p = withPeople();
  for (const m of ["jsonresume", "schemaorg", "linkedin", "brief", "timeline", "verification", "scim"]) {
    const { text } = convert(p, loadMapping(m), { on: ON, visibility: ["public", "network"] });
    assert.ok(!/globex\.example|acme\.example\b.*maria/.test(text) && !text.includes("maria.chen@"), m);
  }
});

test("a contact explicitly marked public is still a third party's: validation warns", () => {
  const p = withPeople();
  p.people["maria-chen"].contacts[1].visibility = "public";
  assert.ok(has(validateProfile(p).warnings, /people\/maria-chen\.contacts\[1\] is public/));
});

// ---------- recommendations ----------

import { verbatim } from "../lib/people.mjs";

const BODY = "Ines rebuilt our harbor program from nothing.  She is the most “careful” planner I know,\nand the team trusted her completely.";
function withRec(extra = {}) {
  const p = withPeople();
  p.recommendations = [{
    id: "rec-maria", author: "maria-chen", date: "2023-05-02T14:30:00-05:00",
    relationship: { type: "manager", work: "acme-platform", description: "Managed Ines directly" },
    authorAt: { title: "Engineering Manager", organization: "acme" },
    text: BODY,
    highlights: [{ id: "h1", text: "She is the most “careful” planner I know, and the team trusted her completely.", featured: true }],
    source: { platform: "linkedin", url: "https://www.linkedin.com/in/example/details/recommendations/", retrievedOn: "2026-11-01" },
    consent: { given: true, on: "2026-11-02", scope: "full", by: "email" },
    status: "approved", confidence: "high", citations: [],
    ...extra,
  }];
  return p;
}

test("a recommendation validates", () => {
  const r = validateProfile(withRec());
  assert.equal(r.valid, true, r.errors.join("\n"));
});

test("verbatim: whitespace runs and Unicode normalization don't matter; wording and quote style do", () => {
  assert.equal(verbatim("the team  trusted\nher", "and the team trusted her completely").ok, true);
  assert.equal(verbatim("Café", "at the Café").ok, true, "NFC");
  const quotes = verbatim('the most "careful" planner', BODY);
  assert.equal(quotes.ok, false);
  assert.equal(quotes.at, 9, "first differing character: the straight quote");
  assert.equal(verbatim("the most reliable planner", BODY).ok, false);
});

test("a highlight that isn't verbatim is an error naming where it differs", () => {
  const p = withRec();
  p.recommendations[0].highlights[0].text = "She is the best planner I know.";
  assert.ok(has(validateProfile(p).errors, /recommendations\/rec-maria › highlight h1: not verbatim from the text \(differs at character 12: "best planner/));
});

test("a public recommendation without the author's consent is an error in 2.6, a warning in 2.5", () => {
  const p = withRec({ consent: undefined });
  assert.ok(has(validateProfile(p).errors, /recommendations\/rec-maria: public, but the author's consent is not recorded/));
  p.schemaVersion = "2.5.0";
  const r = validateProfile(p);
  assert.ok(has(r.warnings, /author's consent is not recorded/));
  assert.ok(!has(r.errors, /consent/));
  const priv = withRec({ consent: undefined, visibility: "private" });
  assert.equal(validateProfile(priv).valid, true, "a private one needs no consent");
});

test("authorAt that disagrees with the author's roles on the date warns", () => {
  const p = withRec({ authorAt: { title: "VP Engineering", organization: "globex" } });
  const w = validateProfile(p).warnings;
  assert.ok(has(w, /authorAt says "VP Engineering" at globex, but people\/maria-chen was "Engineering Manager" at acme on 2023-05-02/));
});

test("relationship.work must be a work entry; author and capture must exist", () => {
  const p = withRec({ author: "nobody", relationship: { type: "manager", work: "nope" }, source: { platform: "email", capture: "missing" } });
  const e = validateProfile(p).errors;
  assert.ok(has(e, /unknown person "nobody"/));
  assert.ok(has(e, /relationship\.work "nope" is not a work entry/));
  assert.ok(has(e, /source\.capture: unknown media "missing"/));
});

test("a time without an offset is refused", () => {
  assert.equal(validateProfile(withRec({ date: "2023-05-02T14:30" })).valid, false);
  assert.equal(validateProfile(withRec({ date: "2023-05-02" })).valid, true);
});

// ---------- endorsements ----------

import { endorsementCount } from "../lib/people.mjs";

function withEndorsements() {
  const p = withPeople();
  const base = { author: "maria-chen", date: "2024-02-01", relationship: { type: "manager", work: "acme-platform" }, status: "approved", confidence: "medium", consent: { given: true, on: "2026-11-02", scope: "full" } };
  p.endorsements = [
    { id: "e1", target: "platform", ...base },
    { id: "e2", target: "platform", ...base, status: "pending", openQuestion: "Confirm with Maria" },
    { id: "e3", target: "platform", ...base, consent: undefined, visibility: "private" },
    { id: "e4", target: "kubernetes", ...base, text: "Ran our cluster migration.", credential: { url: "https://badges.example/endorsements/123" } },
  ];
  return p;
}

test("endorsements validate", () => {
  const r = validateProfile(withEndorsements());
  assert.equal(r.valid, true, r.errors.join("\n"));
});

test("an endorsement's target must be a skill, credential or badge", () => {
  const p = withEndorsements();
  p.endorsements[0].target = "acme-platform";
  assert.ok(has(validateProfile(p).errors, /endorsements\/e1: target "acme-platform" is not a skill, credential or badge/));
});

test("endorsementCount counts only approved, consented endorsements", () => {
  const p = withEndorsements();
  assert.equal(endorsementCount(p, "platform"), 1);
  assert.equal(endorsementCount(p, "kubernetes"), 1);
  assert.equal(endorsementCount(p, "mentoring"), 0);
});

test("a public endorsement without consent is an error in 2.6", () => {
  const p = withEndorsements();
  delete p.endorsements[0].consent;
  assert.ok(has(validateProfile(p).errors, /endorsements\/e1: public, but the author's consent is not recorded/));
});

// ---------- recommendations in outputs and releases (Task 8) ----------

import { scopeProfile } from "../index.mjs";

const OUTPUTS = ["jsonresume", "schemaorg", "linkedin", "brief"];
const outputsOf = (p) => OUTPUTS.map((m) => convert(p, loadMapping(m), { on: ON }).text);
const scoped = (scope) => withRec({ consent: { given: true, on: "2026-11-02", scope } });

test("scope highlights: no mapping output contains the full text", () => {
  const texts = outputsOf(scoped("highlights"));
  for (const t of texts) assert.doesNotMatch(t, /rebuilt our harbor program/);
  assert.match(texts[2], /the team trusted her completely/, "LinkedIn shows the featured highlight");
});

test("scope anonymous: no output contains the author's name", () => {
  const texts = outputsOf(scoped("anonymous"));
  for (const t of texts) assert.doesNotMatch(t, /Maria|Lopez|Chen/);
  assert.match(texts[2], /Engineering Manager/, "shown by title");
});

test("scope nameOnly: the author is named, the text is not", () => {
  const texts = outputsOf(scoped("nameOnly"));
  for (const t of texts) assert.doesNotMatch(t, /harbor program|trusted her/);
  assert.match(texts[2], /Maria Chen/);
});

test("a recommendation without consent never reaches an output, whatever its visibility", () => {
  const p = withRec({ consent: undefined });
  p.schemaVersion = "2.5.0"; // 2.5 only warns
  for (const t of outputsOf(p)) assert.doesNotMatch(t, /harbor program|trusted her/);
});

test("schema.org: Recommendation with author Person and reviewBody", () => {
  const p = withRec(); p.meta.canonicalUrl = "https://ines.example/";
  const out = convert(p, loadMapping("schemaorg"), { on: ON }).output;
  const r = out.review.find((x) => x["@type"] === "Recommendation");
  assert.equal(r.author["@type"], "Person");
  assert.equal(r.author.name, "Maria Chen");
  assert.equal(r.author.jobTitle, "Engineering Manager");
  assert.equal(r.reviewBody, BODY);
  assert.equal(r.datePublished, "2023-05-02T14:30:00-05:00");
  assert.equal(r.itemReviewed["@id"], out.mainEntity["@id"]);
});

test("JSON Resume: references from recommendations", () => {
  const out = convert(withRec(), loadMapping("jsonresume"), { on: ON }).output;
  const r = out.references.find((x) => /Maria Chen/.test(x.name));
  assert.match(r.name, /Engineering Manager/);
  assert.equal(r.reference, BODY);
});

test("LinkedIn: a Recommendations section listing text per consent", () => {
  const t = convert(withRec(), loadMapping("linkedin"), { on: ON }).text;
  assert.match(t, /Recommendations/);
  assert.match(t, /Maria Chen, Engineering Manager at Acme/);
  assert.match(t, /rebuilt our harbor program/);
});

test("release without personContacts carries no contacts; people travel only when referenced", () => {
  const p = withRec();
  p.people.unrelated = { name: "Not Referenced" };
  p.audiences["current-employer"].sections.push("recommendations");
  const { scoped: s } = scopeProfile(p, "current-employer", { on: ON });
  assert.deepEqual(Object.keys(s.people), ["maria-chen"]);
  assert.equal(s.people["maria-chen"].contacts, undefined);
  assert.equal(s.recommendations.length, 1);
  p.audiences["current-employer"].person.push("personContacts");
  const { scoped: s2 } = scopeProfile(p, "current-employer", { on: ON });
  assert.equal(s2.people["maria-chen"].contacts.length, 2);
  assert.ok(s2.people["maria-chen"].contacts.every((c) => c.visibility === "audience"));
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
});

test("an email kept as an identifier is a contact too: withheld without personContacts", () => {
  const p = withRec();
  p.people["maria-chen"].identifiers.push({ scheme: "email", value: "maria@acme.example" });
  p.audiences["current-employer"].sections.push("recommendations");
  const { scoped: s } = scopeProfile(p, "current-employer", { on: ON });
  assert.deepEqual(s.people["maria-chen"].identifiers.map((i) => i.scheme), ["linkedin"]);
});
