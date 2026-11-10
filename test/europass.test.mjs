// The Europass CV, as the XML the Europass editor imports. Checked against what is known of the
// editor's importer (test/europass-check.mjs); the official schema is not published.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert, loadMapping, resolveMapping, validateProfile } from "../index.mjs";
import { splitPhone, realDate, iso6392 } from "../lib/europass.mjs";
import { checkEuropass, parseXml, kid, kids, at, all, textOf } from "./europass-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const ON = "2026-11-07";
const eu = (p, opts = {}) => convert(p, loadMapping("europass"), { on: ON, ...opts }).text;
const doc = (p, opts) => parseXml(eu(p, opts));
const profileOf = (d) => kid(d, "CandidateProfile");
const EXAMPLES = ["examples/sample.profile.json", "examples/history.profile.json", "examples/employee.profile.json", "examples/rtl.profile.json", "examples/recommended/profile.json"];

test("every example passes the checks, in every language", () => {
  for (const f of EXAMPLES) for (const locale of [undefined, "es", "de", "ar"]) {
    assert.deepEqual(checkEuropass(eu(load(f), { locale })), [], `${f} ${locale ?? ""}`);
  }
});

test("the same profile on the same day gives the same file", () => {
  assert.equal(eu(sample()), eu(sample()));
  assert.notEqual(kid(doc(sample()), "hr:DocumentID").attrs.schemeID, kid(parseXml(eu(sample(), { on: "2026-11-08" })), "hr:DocumentID").attrs.schemeID);
});

test("the person: name, links by kind, the home town, mother tongues", () => {
  const person = kid(doc(sample()), "CandidatePerson");
  assert.equal(textOf(at(person, "PersonName/oa:GivenName")), "Ines");
  assert.equal(textOf(at(person, "PersonName/hr:FamilyName")), "Calloway");
  const comms = kids(person, "Communication").map((c) => [textOf(kid(c, "ChannelCode")), textOf(kid(c, "UseCode")), textOf(kid(c, "oa:URI"))]);
  assert.deepEqual(comms.filter((c) => c[0] === "Social Media"), [["Social Media", "linkedin", "https://www.linkedin.com/in/example-ines-calloway/"]]);
  assert.ok(comms.some((c) => c[0] === "Web" && /orcid/.test(c[2])), "a network Europass does not list is a web link");
  assert.equal(textOf(all(person, "CountryCode")[0]), "us");
  assert.deepEqual(kids(person, "PrimaryLanguageCode").map(textOf), ["eng", "spa"]);
});

test("private contact details stay out; a public phone needs its country code", () => {
  const p = sample();
  p.person.contact = { ...p.person.contact, email: "ines@example.com", phone: "+351 21 000 0000" };
  assert.doesNotMatch(eu(p), /ines@example\.com|Telephone/);
  Object.assign(p.person.contact, { emailVisibility: "public", phoneVisibility: "public" });
  const person = kid(doc(p), "CandidatePerson");
  const tel = kids(person, "Communication").find((c) => textOf(kid(c, "ChannelCode")) === "Telephone");
  assert.equal(textOf(kid(tel, "CountryDialing")), "351");
  assert.equal(textOf(kid(tel, "oa:DialNumber")), "210000000");
  assert.equal(textOf(at(kid(doc(p), "CandidateSupplier"), "PersonContact/Communication/oa:URI")), "ines@example.com");
  p.person.contact.phone = "(555) 010-0000";
  assert.doesNotMatch(eu(p), /Telephone/, "a number with no country code would make the editor refuse the file");
  assert.deepEqual(checkEuropass(eu(p)), []);
});

test("country calling codes are split by the numbering plan", () => {
  assert.deepEqual(splitPhone("+1 (212) 555-0100"), ["1", "2125550100"]);
  assert.deepEqual(splitPhone("+44 20 7946 0000"), ["44", "2079460000"]);
  assert.deepEqual(splitPhone("+351 21 000 0000"), ["351", "210000000"]);
  assert.deepEqual(splitPhone("+39 333 000 0000"), ["39", "3330000000"]);
  assert.deepEqual(splitPhone("+7 495 000 00 00"), ["7", "4950000000"]);
  assert.deepEqual(splitPhone("+971 4 000 0000"), ["971", "40000000"]);
  assert.deepEqual(splitPhone("+86 10 0000 0000"), ["86", "1000000000"]);
  assert.deepEqual(splitPhone("+852 0000 0000"), ["852", "00000000"]);
  assert.equal(splitPhone("020 7946 0000"), undefined);
  assert.equal(splitPhone("+44"), undefined);
});

test("one EmployerHistory per position, newest first, employers named as they were", () => {
  const p = load("examples/history.profile.json");
  const d = doc(p);
  const jobs = all(d, "EmployerHistory");
  const positions = p.work.filter((w) => w.status === "approved" && (w.visibility ?? "public") === "public").flatMap((w) => (w.positions?.length ? w.positions : [w]));
  assert.ok(jobs.length >= 2 && jobs.length <= positions.length);
  const starts = jobs.map((j) => textOf(at(j, "PositionHistory/eures:EmploymentPeriod/eures:StartDate/hr:FormattedDateTime"))).filter(Boolean);
  assert.deepEqual(starts, [...starts].sort().reverse());
});

test("a qualified date is said in words in the description, never written as exact", () => {
  const job = all(doc(sample()), "EmployerHistory").find((j) => textOf(kid(j, "hr:OrganizationName")) === "Coastal Ecology Lab");
  const period = at(job, "PositionHistory/eures:EmploymentPeriod");
  assert.equal(kid(period, "eures:StartDate"), undefined, "about 1996 is not 1996");
  assert.equal(textOf(at(period, "eures:EndDate/hr:FormattedDateTime")), "2009-05");
  assert.match(at(job, "PositionHistory/oa:Description").text, /^<p>c\. 1996 – May 2009<\/p><p>Field research/);
});

test("long text is HTML kept as text, with its own characters escaped", () => {
  const p = sample();
  p.person.summary = "Ships & <harbors>.\n\nSecond \"paragraph\".";
  const xml = eu(p);
  assert.match(xml, /<hr:ExecutiveSummary>&lt;p&gt;Ships &amp;amp; &amp;lt;harbors&amp;gt;\.&lt;\/p&gt;&lt;p&gt;Second &quot;paragraph&quot;\.&lt;\/p&gt;<\/hr:ExecutiveSummary>/);
  assert.equal(kid(profileOf(parseXml(xml)), "hr:ExecutiveSummary").text, "<p>Ships &amp; &lt;harbors&gt;.</p><p>Second \"paragraph\".</p>");
  assert.deepEqual(checkEuropass(xml), []);
  const job = all(parseXml(xml), "EmployerHistory").find((j) => textOf(kid(j, "hr:OrganizationName")) === "Harborline Resorts");
  assert.match(at(job, "PositionHistory/oa:Description").text, /<ul><li>3 resorts opened<\/li><li>~\$240M development portfolio<\/li><\/ul>$/);
});

test("languages: a mother tongue is a primary language; another carries its level across the five skills", () => {
  const prof = profileOf(doc(sample()));
  const langs = kids(kid(prof, "PersonQualifications"), "PersonCompetency");
  assert.deepEqual(langs.map((l) => textOf(kid(l, "CompetencyID"))), ["por"]);
  assert.equal(kids(langs[0], "eures:CompetencyDimension").length, 5);
  assert.ok(all(langs[0], "hr:ScoreText").every((s) => textOf(s) === "B2"));
  const p = sample();
  p.languages = [{ id: "kl", status: "approved", confidence: "high", language: "tlh", name: "Klingon", fluency: "elementary" }];
  const klingon = kids(kid(profileOf(doc(p)), "PersonQualifications"), "PersonCompetency")[0];
  assert.equal(kid(klingon, "CompetencyID").attrs.schemeName, "FREE_TEXT");
  assert.equal(textOf(kid(klingon, "CompetencyID")), "Klingon");
  assert.equal(kids(klingon, "eures:CompetencyDimension").length, 0, "no level is invented");
  assert.equal(iso6392("pt-BR"), "por");
});

test("everything else becomes a custom section under its résumé heading, one element per entry", () => {
  const p = sample();
  const view = convert(p, loadMapping("resume"), { on: ON }).output;
  const prof = profileOf(doc(p));
  const others = kids(prof, "Others");
  const expected = view.sections.filter((s) => !["experience", "education", "languages", "publications"].includes(s.id));
  assert.deepEqual([...new Set(others.map((o) => textOf(kid(o, "Title"))))], expected.map((s) => s.heading));
  const skills = others.find((o) => textOf(kid(o, "Title")) === "Skills");
  assert.match(at(skills, "Other/Description").text, /^<p>[^<]+; [^<]+<\/p>$/, "skills are one line");
  assert.equal(textOf(kid(prof, "Skills")), undefined, "Europass's own skills section is for digital skills only");
  const es = kids(profileOf(doc(p, { locale: "es" })), "Others").map((o) => textOf(kid(o, "Title")));
  assert.ok(es.includes("Competencias"));
});

test("it says what the résumé says: the same entries, and the résumé's per-entry choices", () => {
  const m = resolveMapping(loadMapping("europass"));
  assert.deepEqual(m.followsTargets, ["resume"]);
  assert.deepEqual(m.output.sections, resolveMapping(loadMapping("resume")).output.sections);
  assert.ok(m.output.europass, "extendOutput adds to the résumé view");
  const p = sample();
  p.work.find((w) => w.id === "harborline-director").targets = { resume: { omit: true } };
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
  const employers = (x) => all(parseXml(eu(x)), "EmployerHistory").map((j) => textOf(kid(j, "hr:OrganizationName")));
  assert.ok(employers(sample()).includes("Harborline Resorts"));
  assert.equal(employers(p).includes("Harborline Resorts"), false);
  const q = sample();
  q.work.find((w) => w.id === "harborline-director").targets = { europass: { omit: true } };
  assert.equal(employers(q).includes("Harborline Resorts"), false, "targets.europass can still make its own choice");
  // Every title in the résumé is somewhere in the CV, as plain text or inside the HTML of a description.
  const texts = [];
  (function collect(n) { texts.push(n.text, n.text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")); n.children.forEach(collect); })(doc(sample()));
  const everything = texts.join("\n");
  for (const s of convert(sample(), loadMapping("resume"), { on: ON }).output.sections) {
    for (const e of s.entries) if (e.title && s.id !== "languages") assert.ok(everything.includes(e.title), `${s.id}: ${e.title}`);
  }
});

test("only approved public entries; the content rules still guard it", () => {
  assert.doesNotMatch(eu(sample()), /Hospitality consultant|Coastal Management|Open Trails/);
  const p = sample();
  p.person.summary = "A guaranteed safe pair of hands";
  assert.throws(() => eu(p), /no-safe/);
});

test("publications go to their own section; sections are listed only when present", () => {
  const p = sample();
  p.publications = [{ id: "pub", status: "approved", confidence: "high", title: "Reef recovery", kind: "paper", date: "2005-06", authors: ["Ines Calloway", "A. Reyes"], doi: "10.1000/example" }];
  assert.equal(validateProfile(p).valid, true, validateProfile(p).errors.join("\n"));
  const d = doc(p);
  const pub = at(profileOf(d), "PublicationHistory/Publication");
  assert.equal(textOf(kid(pub, "Title")), "Reef recovery");
  assert.equal(textOf(kid(pub, "Year")), "2005");
  assert.equal(textOf(kid(pub, "Authors")), "Ines Calloway, A. Reyes");
  const order = (x) => all(x, "Section").map((s) => textOf(kid(s, "Title")));
  assert.deepEqual(order(d), ["work-experience", "education-training", "language", "publication"]);
  assert.deepEqual(order(doc(sample())), ["work-experience", "education-training", "language"]);
  const bare = { schemaVersion: p.schemaVersion, meta: p.meta, person: { name: "Ada Example" } };
  const only = doc(bare);
  assert.deepEqual(order(only), []);
  assert.equal(textOf(at(kid(only, "CandidatePerson"), "PersonName/oa:GivenName")), "Ada Example");
  assert.deepEqual(checkEuropass(eu(bare)), []);
});

test("characters XML does not allow are dropped; right-to-left text passes through", () => {
  const p = sample();
  p.person.summary = "Bell\u0007 and form\u000C feed";
  assert.match(eu(p), /Bell and form feed/);
  const ar = eu(load("examples/rtl.profile.json"));
  assert.match(ar, /<oa:GivenName>ليلى<\/oa:GivenName>|<oa:GivenName>ليلى حداد<\/oa:GivenName>/);
  assert.match(ar, /<CandidateProfile languageCode="en">/, "Arabic is not a language the editor offers, so the profile is marked English");
});

test("the checker can fail", () => {
  const xml = eu(sample());
  const breaks = [
    [/<hr:FormattedDateTime>2009-06</, "<hr:FormattedDateTime>2009-13<", /real date/],
    [/<UseCode>linkedin</, "<UseCode>mastodon<", /social media/],
    [/languageCode="en"/, 'languageCode="xx"', /profile language/],
    [/<Title>work-experience<\/Title>/, "<Title>jobs</Title>", /section "jobs"/],
    [/<hr:CurrentIndicator>true</, "<hr:CurrentIndicator>yes<", /current/],
    [/<oa:GivenName>/g, "<GivenName>", /well-formed|GivenName/],
    [/<Country>us</, "<Country>US<", /lower-case/],
    [/&lt;p&gt;I started/, "I started &lt;b&gt;", /paragraphs and lists/],
    [/ xmlns:hr="[^"]*"/, "", /xmlns:hr/],
  ];
  for (const [from, to, expect] of breaks) {
    const broken = xml.replace(from, to);
    assert.notEqual(broken, xml, String(from));
    assert.match(checkEuropass(broken).join("\n"), expect, String(from));
  }
  assert.equal(realDate("1990-02-31"), false);
  assert.equal(realDate("2024-02-29"), true);
  assert.match(checkEuropass(xml.replace("</Candidate>", "")).join(), /not well-formed/);
});
