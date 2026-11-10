// The plain-text ATS résumé: the résumé view as one column of text, saying what the PDF says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert, loadMapping, resolveMapping, renderAts } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const ON = "2026-11-07";
const ats = (p, opts = {}) => convert(p, loadMapping("ats"), { on: ON, ...opts }).text;
const view = (p, opts = {}) => convert(p, loadMapping("resume"), { on: ON, ...opts }).output;
const EXAMPLES = ["examples/sample.profile.json", "examples/history.profile.json", "examples/employee.profile.json", "examples/rtl.profile.json", "examples/recommended/profile.json"];

test("it is plain text a parser can read top to bottom", () => {
  for (const f of EXAMPLES) {
    const text = ats(load(f));
    assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"), f);
    assert.doesNotMatch(text, /\t/, "no tabs, so no columns");
    assert.doesNotMatch(text, /[|].*[|].*\n[-| ]+\n/, "no tables");
    assert.doesNotMatch(text, /^[#*>]|\*\*|__|\]\(/m, "no markup");
    assert.doesNotMatch(text, / {2,}/, "no runs of spaces standing in for layout");
    assert.doesNotMatch(text, /\n{3,}/, "one blank line at most");
    assert.doesNotMatch(text, /undefined|\[object Object\]/);
    assert.doesNotMatch(text, /[\u0000-\u0009\u000B-\u001F]/, "no control characters");
  }
});

test("the name comes first, then contact details and links written out in full", () => {
  const lines = ats(sample()).split("\n");
  assert.equal(lines[0], "Ines Calloway");
  assert.equal(lines[2], "New York, NY | https://example.com");
  assert.equal(lines[3], "LinkedIn: https://www.linkedin.com/in/example-ines-calloway/");
  assert.doesNotMatch(ats(sample()), /ines@example\.com|555-0100/, "private contact details stay out");
});

test("headings are plain capitals on their own line, with a blank line either side", () => {
  const lines = ats(sample()).split("\n");
  for (const h of ["SUMMARY", "EXPERIENCE", "EDUCATION", "LICENSES AND CERTIFICATIONS", "SKILLS", "LANGUAGES"]) {
    const i = lines.indexOf(h);
    assert.ok(i > 0, `${h} is a line of its own`);
    assert.equal(lines[i - 1], "");
    assert.equal(lines[i + 1], "");
  }
  assert.ok(lines.indexOf("EXPERIENCE") < lines.indexOf("EDUCATION"));
  assert.match(ats(sample(), { locale: "es" }), /\nEXPERIENCIA\n/);
});

test("dates are MM/YYYY with a plain hyphen, and keep their doubt", () => {
  const text = ats(sample());
  assert.match(text, /\nFounder & CEO\nTidewater Trails, New York, NY\n03\/2024 - Present\n/);
  assert.match(text, /\n06\/2009 - 12\/2023\n/);
  assert.match(text, /\nc\. 1996 - 05\/2009\n/);
  assert.doesNotMatch(text, /[–—]/, "no typographic dashes");
  assert.doesNotMatch(text, /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/, "no month names in dates");
});

test("a job with several titles gives the employer once, then each title with its dates", () => {
  const text = ats(load("examples/history.profile.json"));
  assert.match(text, /\nEDS \(now DXC Technology\), Plano, Texas\n06\/2005 - 03\/2011\n\nSolutions Architect\n02\/2010 - 03\/2011\n/);
  assert.match(text, /\nSystems Engineer\n06\/2005 - 03\/2007\n- Ran nightly batch operations/);
});

test("it says what the PDF says: everything in the résumé view is in the text", () => {
  const flat = (s) => String(s).replace(/\s+/g, " ").trim();
  for (const f of EXAMPLES) {
    const p = load(f);
    const v = view(p);
    const text = flat(ats(p));
    const want = [v.person.name, v.person.headline, v.person.location, v.summary?.text];
    for (const s of v.sections) for (const e of s.entries) {
      want.push(e.title, e.organization, e.location, e.detail, e.summary, e.url, ...(e.bullets ?? []), ...(e.keywords ?? []));
      for (const pos of e.positions ?? []) want.push(pos.title, pos.summary, ...(pos.bullets ?? []));
    }
    for (const w of want.filter(Boolean)) for (const line of String(w).split("\n")) assert.ok(text.includes(flat(line)), `${f}: "${flat(line).slice(0, 50)}" is in the text`);
    assert.equal((ats(p).match(/^[^\n]+\n\n/gm) ?? []).length > 0, true);
  }
});

test("the same entries as the résumé: what is left out of, or reworded for, the résumé is so here too", () => {
  const raw = load("mappings/ats.json");
  assert.equal(raw.extends, "resume");
  assert.deepEqual(raw.followsTargets, ["resume"]);
  assert.deepEqual(resolveMapping(raw).output, load("mappings/resume.json").output);
  const p = sample();
  p.awards[0].targets = { resume: { omit: true } };
  p.work.find((w) => w.id === "harborline-director").targets = { resume: { title: "Development Director" } };
  const text = ats(p);
  assert.doesNotMatch(text, /Waterfront Project of the Year/);
  assert.match(text, /\nDevelopment Director\nHarborline Resorts/);
  // The ATS text can still make a choice of its own.
  p.languages[0].targets = { ats: { omit: true } };
  assert.doesNotMatch(ats(p), /English \(/);
  assert.ok(view(p).sections.find((s) => s.id === "languages").entries.some((e) => e.title === "English"), "the résumé keeps it");
});

test("only approved public entries, and the content rules still guard it", () => {
  const text = ats(sample());
  assert.doesNotMatch(text, /Hospitality consultant|Coastal Management/);
  const p = sample();
  p.person.headline = "A guaranteed safe pair of hands";
  assert.throws(() => ats(p), /no-safe/);
});

test("an untitled entry is titled by its organization; right-to-left text passes through", () => {
  const p = sample();
  delete p.service[0].role;
  assert.match(ats(p), /\nCoast Guard Auxiliary \(fictional unit\)\n/);
  const ar = ats(load("examples/rtl.profile.json"));
  assert.match(ar, /^ليلى حداد\n/);
  assert.match(ar, /\n03\/2022 - حتى الآن\n/);
  assert.match(ar, /بكالوريوس، علوم الحاسوب/, "the language's own comma");
});

test("renderAts needs nothing but a view", () => {
  assert.equal(renderAts({ person: { name: "A B" }, sections: [{ id: "skills", heading: "Skills", entries: [{ id: "x", title: "Python", detail: "Expert" }, { id: "y", title: "SQL" }] }] }), "A B\n\nSKILLS\n\nPython (Expert); SQL\n");
});

test("the committed example files are current", () => {
  for (const [name, src] of [["sample", "examples/sample.profile.json"], ["history", "examples/history.profile.json"], ["recommended", "examples/recommended/profile.json"]]) {
    assert.equal(readFileSync(join(root, "examples", "out", `${name}.ats.txt`), "utf8"), ats(load(src)), name);
  }
});
