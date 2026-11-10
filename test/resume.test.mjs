// The résumé view: a neutral JSON view that templates lay out, with every decision already made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert, loadMapping, validateProfile } from "../index.mjs";
import { direction } from "../lib/i18n.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const view = (p, opts = {}) => convert(p, loadMapping("resume"), { on: "2026-11-07", ...opts }).output;
const section = (v, id) => v.sections.find((s) => s.id === id);
const ENTRY_KEYS = new Set(["id", "priority", "title", "organization", "location", "detail", "dates", "datesNumeric", "summary", "bullets", "keywords", "url", "positions"]);

test("the view names itself, its language and direction, and its date", () => {
  const v = view(sample());
  assert.equal(v.view, "resume");
  assert.equal(v.viewVersion, 1);
  assert.equal(v.locale, "en-US");
  assert.equal(v.direction, "ltr");
  assert.equal(v.madeFor, "2026-11-07");
  assert.equal(v.title, "Ines Calloway: résumé");
  assert.equal(view(sample(), { locale: "ar" }).direction, "rtl");
  assert.equal(direction("he-IL"), "rtl");
  assert.equal(direction("not a locale"), "ltr");
});

test("every entry in every section has the same shape", () => {
  for (const file of ["examples/sample.profile.json", "examples/history.profile.json", "examples/recommended/profile.json", "examples/employee.profile.json"]) {
    const v = view(load(file));
    assert.ok(Array.isArray(v.sections) && v.sections.length > 0, file);
    for (const s of v.sections) {
      assert.deepEqual(Object.keys(s), ["id", "heading", "entries"]);
      assert.ok(s.entries.length > 0, `${file}: ${s.id} is not empty`);
      for (const e of s.entries) {
        for (const k of Object.keys(e)) assert.ok(ENTRY_KEYS.has(k), `${file}: ${s.id}/${e.id} has unexpected key ${k}`);
        assert.equal(typeof e.id, "string");
        assert.equal(typeof e.title, "string", `${file}: ${s.id}/${e.id} has a title`);
        assert.equal(typeof e.priority, "number", `${file}: ${s.id}/${e.id} has a priority`);
      }
    }
  }
});

test("a section with nothing to show is left out, heading and all", () => {
  const p = sample();
  p.awards = [];
  p.languages = p.languages.map((l) => ({ ...l, status: "draft" }));
  const v = view(p);
  assert.equal(section(v, "awards"), undefined);
  assert.equal(section(v, "languages"), undefined);
  assert.ok(section(v, "experience"));
});

test("only approved, public entries appear; --visibility widens it", () => {
  const v = view(sample());
  const ids = v.sections.flatMap((s) => s.entries.map((e) => e.id));
  assert.ok(!ids.includes("consulting-gap"), "pending entries stay out");
  assert.ok(!ids.includes("state-u-ms"), "network-only entries stay out");
  const wider = view(sample(), { visibility: ["public", "network"] });
  assert.ok(section(wider, "education").entries.some((e) => e.id === "state-u-ms"));
  assert.equal(v.person.email, undefined, "a private email is not shown");
});

test("jobs are newest first, the current one says Present, and dates come in two forms", () => {
  const jobs = section(view(sample()), "experience").entries;
  assert.deepEqual(jobs.map((e) => e.id), ["tidewater-ceo", "harborline-director", "coastal-lab-researcher"]);
  assert.equal(jobs[0].dates, "Mar 2024 – Present");
  assert.equal(jobs[0].datesNumeric, "03/2024 – Present");
  assert.equal(jobs[2].dates, "c. 1996 – May 2009");
  assert.equal(jobs[2].datesNumeric, "c. 1996 – 05/2009", "an uncertain date keeps its qualifier");
  const es = section(view(sample(), { locale: "es" }), "experience");
  assert.equal(es.heading, "Experiencia");
  assert.match(es.entries[0].dates, /mar 2024 – Actualidad/);
  assert.equal(es.entries[0].datesNumeric, "03/2024 – Actualidad");
});

test("a job lists its positions newest first, each with its own dates and bullets", () => {
  const job = section(view(load("examples/history.profile.json")), "experience").entries.find((e) => e.id === "eds-job");
  assert.equal(job.organization, "EDS (now DXC Technology)");
  assert.deepEqual(job.positions.map((p) => p.id), ["eds-sa", "eds-tc3", "eds-sse", "eds-se"]);
  assert.equal(job.positions[0].dates, "Feb 2010 – Mar 2011");
  assert.ok(job.positions[0].bullets.some((b) => /8 engineers/.test(b)), "the figure in force for that position");
  assert.ok(!job.positions[0].bullets.some((b) => /\b3 engineers/.test(b)), "not the earlier figure");
  // A job without positions still has one, so a template has a single path.
  const single = section(view(sample()), "experience").entries[0];
  assert.equal(single.positions.length, 1);
  assert.equal(single.positions[0].title, single.title);
});

test("study that didn't end in a degree never reads as one", () => {
  const p = sample();
  const ms = p.education.find((e) => e.id === "state-u-ms");
  ms.visibility = "public";
  ms.confidence = "high";
  p.rules = [];
  assert.equal(section(view(p), "education").entries.find((e) => e.id === "state-u-ms").title, "Coastal Management");
  ms.credential = "MS";
  assert.equal(section(view(p), "education").entries.find((e) => e.id === "state-u-ms").title, "MS, Coastal Management (not completed)");
  assert.equal(section(view(p), "education").entries.find((e) => e.id === "state-u-bs").title, "BS, Marine Biology");
});

test("entry ids are not read as prose by the content rules, but everything shown is", () => {
  // "state-u-ms" contains the forbidden "MS"; it is a key, not a claim.
  assert.doesNotThrow(() => view(sample(), { visibility: ["public", "network"] }));
  const p = sample();
  p.person.headline = "MS in Coastal Management";
  assert.throws(() => view(p), /no-ms-degree/);
});

test("the content rules still guard the view", () => {
  const p = sample();
  const ms = p.education.find((e) => e.id === "state-u-ms");
  Object.assign(ms, { visibility: "public", credential: "MS" });
  assert.throws(() => view(p), /no-ms-degree/);
});

test("skills and languages carry translated levels; priorities default to 50", () => {
  const v = view(sample(), { locale: "es" });
  const langs = section(v, "languages").entries;
  assert.equal(langs.find((l) => l.id === "lang-es").title, "Español");
  assert.equal(langs.find((l) => l.id === "lang-es").detail, "Nativo o bilingüe, C2");
  assert.equal(langs[0].priority, 50);
  const skills = section(view(sample()), "skills").entries;
  assert.ok(skills[0].priority >= skills.at(-1).priority, "pinned and high-priority skills first");
});

test("the photo is the one in force, with its alt text; bundle photos need a base", () => {
  const p = load("examples/recommended/profile.json");
  assert.match(view(p).person.photo.url, /^https:\/\/ines-ortega\.example\/files\/media\//, "the profile's own media base");
  delete p.meta.mediaBaseUrl;
  assert.equal(view(p).person.photo, undefined, "a bundle: photo has nowhere to point without a base");
  const withBase = view(p, { mediaBaseUrl: "/srv/bundle/" });
  assert.match(withBase.person.photo.url, /^\/srv\/bundle\/media\//);
  assert.equal(typeof withBase.person.photo.alt, "string");
  assert.equal(view(sample()).person.photo.url, "https://example.com/images/ines-calloway.jpg");
});

test("recommendations appear only with consent, cut to its scope", () => {
  const p = load("examples/recommended/profile.json");
  const recs = section(view(p), "recommendations").entries;
  assert.match(recs.find((r) => r.id === "rec-maria").title, /^Maria Chen, /);
  const sam = p.recommendations.find((r) => r.id === "rec-sam");
  const shown = recs.find((r) => r.id === "rec-sam").summary;
  assert.notEqual(shown, typeof sam.text === "string" ? sam.text : Object.values(sam.text)[0], "highlights only, not the full text");
  p.recommendations.forEach((r) => { r.consent = { given: false }; r.visibility = "private"; });
  assert.equal(validateProfile(p).valid, true);
  assert.equal(section(view(p), "recommendations"), undefined);
});

test("the committed example views are current", () => {
  for (const [name, src] of [["sample", "examples/sample.profile.json"], ["history", "examples/history.profile.json"], ["recommended", "examples/recommended/profile.json"]]) {
    assert.deepEqual(load(`examples/out/${name}.resume.json`), view(load(src)), name);
  }
});
