// GEDCOM 5.5.1 export. It says what the 7.0 export says; this file checks the 5.5.1 form of it against
// the grammar extracted from the specification (upstream/gedcom551/), and that nothing 7.0 could say
// is lost on the way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert, loadMapping, resolveMapping, renderGedcom551, BUNDLED_MAPPINGS } from "../index.mjs";
import { checkGedcom551, parseGedcom551 } from "./gedcom551-check.mjs";
import { parseGedcom } from "./gedcom-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const ON = "2026-11-07";
const ged5 = (p, opts = {}) => convert(p, loadMapping("gedcom551"), { on: ON, ...opts }).text;
const ged7 = (p, opts = {}) => convert(p, loadMapping("gedcom7"), { on: ON, ...opts }).text;
const indi = (text) => parseGedcom551(text).roots.find((r) => r.tag === "INDI");
const kids = (node, tag) => node.children.filter((c) => c.tag === tag);
const kid = (node, tag) => kids(node, tag)[0];
const HEAD = "0 HEAD\n1 SOUR T\n1 SUBM @U1@\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 @U1@ SUBM\n1 NAME A\n";

// ---------- the checker ----------

test("the checker reads the specification's grammar and catches what breaks it", () => {
  const good = `${HEAD}0 @I1@ INDI\n1 NAME A /B/\n2 GIVN A\n1 OCCU x\n2 DATE FROM MAR 2024\n2 NOTE one\n2 NOTE two\n2 SOUR @S1@\n3 PAGE p1\n3 QUAY 3\n1 OCCU y\n1 EVEN\n2 TYPE Voyage\n1 RESI\n1 OBJE @O1@\n0 @O1@ OBJE\n1 FILE a.jpg\n2 FORM jpg\n3 TYPE photo\n0 @S1@ SOUR\n1 TITL t\n0 TRLR\n`;
  assert.deepEqual(checkGedcom551(good), []);
  const broken = (change, pattern) => assert.match(checkGedcom551(change(good)).join("\n"), pattern);
  broken((g) => g.replace("1 SUBM @U1@\n", ""), /HEAD: needs a SUBM/);
  broken((g) => g.replace("2 VERS 5.5.1", "2 VERS 7.0"), /GEDC\.VERS must be 5\.5\.1/);
  broken((g) => g.replace("1 OCCU x", `1 OCCU ${"x".repeat(91)}`), /91 characters, and OCCUPATION allows 90/);
  broken((g) => g.replace("2 DATE FROM MAR 2024", "2 DATE March 2024"), /"March 2024" is not a date value/);
  broken((g) => g.replace("2 DATE FROM MAR 2024", "2 DATE FROM MAR 2024\n2 DATE 2025"), /OCCU: has 2 DATE/);
  broken((g) => g.replace("1 RESI", "1 RESI Paris"), /RESI: takes no value/);
  broken((g) => g.replace("3 QUAY 3", "3 QUAY 9"), /"9" is not one of 0, 1, 2, 3/);
  broken((g) => g.replace("2 NOTE one", "2 PHRASE one"), /PHRASE: not allowed under OCCU/);
  broken((g) => g.replace("1 OBJE @O1@", "1 OBJE @S1@"), /points to a SOUR record, not OBJE/);
  broken((g) => g.replace("2 FORM jpg\n3 TYPE photo\n", ""), /FILE: needs a FORM/);
  broken((g) => g.replace("1 TITL t", "1 TITL me@example.com"), /lone "@"/);
  broken((g) => g.replace("1 TITL t", `1 TITL ${"t".repeat(260)}`), /longer than 255/);
  // An underscore tag is the user's own and is let through, as the specification allows.
  assert.deepEqual(checkGedcom551(good.replace("2 NOTE one", "2 _CONF high")), []);
});

// ---------- the export ----------

test("every example exports as GEDCOM 5.5.1 that follows the specification's grammar", () => {
  for (const f of ["examples/sample.profile.json", "examples/history.profile.json", "examples/employee.profile.json", "examples/rtl.profile.json", "examples/recommended/profile.json"]) {
    const text = ged5(load(f));
    assert.deepEqual(checkGedcom551(text), [], f);
    assert.match(text, /^0 HEAD\n1 SOUR TURNROW_PROFILE\n/);
    assert.match(text, /\n0 TRLR\n$/);
  }
  assert.deepEqual(checkGedcom551(ged5(sample(), { visibility: ["public", "network"], locale: "es" })), []);
});

test("the header is a 5.5.1 header: version, form, UTF-8, a submitter, the language by name", () => {
  const { roots } = parseGedcom551(ged5(sample()));
  const head = roots[0];
  assert.equal(kid(kid(head, "GEDC"), "VERS").value, "5.5.1");
  assert.equal(kid(kid(head, "GEDC"), "FORM").value, "LINEAGE-LINKED");
  assert.equal(kid(head, "CHAR").value, "UTF-8");
  assert.equal(kid(head, "LANG").value, "English");
  assert.equal(kid(head, "DATE").value, "7 NOV 2026");
  const subm = roots.find((r) => r.xref === kid(head, "SUBM").value);
  assert.equal(subm.tag, "SUBM");
  assert.equal(kid(subm, "NAME").value, "Ines Calloway");
  assert.equal(kid(head, "SCHMA"), undefined, "no 7.0 schema block");
  assert.equal(kid(parseGedcom551(ged5(load("examples/rtl.profile.json"))).roots[0], "LANG").value, "Arabic");
});

test("it says what the 7.0 export says: the same facts, dates, places, employers and citations", () => {
  for (const f of ["examples/sample.profile.json", "examples/history.profile.json", "examples/employee.profile.json"]) {
    const p = load(f);
    const five = indi(ged5(p)), seven = parseGedcom(ged7(p)).roots.find((r) => r.tag === "INDI");
    const facts = (n) => n.children.filter((c) => ["OCCU", "EDUC", "RESI", "EVEN"].includes(c.tag));
    const shape = (n) => facts(n).map((x) => [x.tag, kid(x, "DATE")?.value, kid(x, "PLAC")?.value, kid(x, "AGNC")?.value, kids(x, "SOUR").length, kids(x, "SOUR").map((s) => kid(s, "QUAY")?.value).join()]);
    assert.deepEqual(shape(five), shape(seven), f);
    assert.deepEqual(kids(five, "NAME").map((n) => n.value), kids(seven, "NAME").map((n) => n.value));
    // The 7.0 value of an occupation is the 5.5.1 value too.
    assert.deepEqual(kids(five, "OCCU").map((o) => o.value), kids(seven, "OCCU").map((o) => o.value));
  }
});

test("what 5.5.1 has no place for is kept as a note, not dropped", () => {
  const me = indi(ged5(sample()));
  const notes = (n) => kids(n, "NOTE").map((x) => x.value);
  const lab = kids(me, "OCCU").find((o) => o.value === "Research Biologist");
  assert.equal(kid(lab, "DATE").value, "FROM 1996 TO MAY 2009");
  assert.ok(notes(lab).includes("Date as recorded: c. 1996 – May 2009"), "7.0's DATE PHRASE");
  assert.ok(notes(lab).includes("Confidence: medium"), "the _CONF extension");
  assert.equal(kid(lab, "_CONF"), undefined);
  // A residence and a generic event take no value in 5.5.1, so what happened is the first note.
  const resi = kid(me, "RESI");
  assert.equal(resi.value, "");
  assert.equal(notes(resi)[0], "A year in Paris studying hotel management in the evenings");
  const voyage = kids(me, "EVEN").find((e) => kid(e, "TYPE").value === "Voyage");
  assert.equal(voyage.value, "");
  assert.equal(notes(voyage)[0], "Sailed from Lisbon to the Azores");
  // Every piece of text in the 7.0 file is somewhere in the 5.5.1 file.
  const seven = parseGedcom(ged7(sample())).roots.find((r) => r.tag === "INDI");
  const all5 = ged5(sample()).replace(/\n\d+ CONC /g, "").replace(/\n\d+ CONT /g, "\n");
  for (const fact of seven.children.filter((c) => ["OCCU", "EDUC", "RESI", "EVEN"].includes(c.tag))) {
    for (const piece of [fact.value, ...fact.children.filter((c) => ["TYPE", "PLAC", "AGNC", "NOTE", "_CONF"].includes(c.tag)).flatMap((c) => c.value.split("\n")), ...fact.children.filter((c) => c.tag === "DATE").flatMap((d) => d.children.map((x) => x.value))]) {
      if (piece) assert.ok(all5.includes(piece), `"${piece}" is kept`);
    }
  }
});

test("names: type in 5.5.1's words, the parts, and when the name was in use", () => {
  const p = sample();
  p.person.names.push({ type: "birth", full: "Ines Marlow", given: "Ines", family: "Marlow", to: "2001-06" }, { type: "legal", full: "Inés María Calloway", visibility: "public" });
  const names = kids(indi(ged5(p)), "NAME");
  assert.deepEqual(names.map((n) => n.value), ["Ines /Calloway/", "Ines /Marlow/", "Inés María Calloway"]);
  assert.equal(kid(names[1], "TYPE").value, "birth");
  assert.equal(kid(names[1], "SURN").value, "Marlow");
  assert.match(kid(names[1], "NOTE").value, /^In use: Jun 2001$/);
  assert.equal(kid(names[2], "TYPE").value, "legal name");
  assert.deepEqual(checkGedcom551(ged5(p)), []);
  assert.match(ged5(sample(), { visibility: ["public", "network"] }), /1 NAME Nes\n2 TYPE aka\n2 NICK Nes/);
});

test("long text is continued within the line limit and comes back whole", () => {
  const long = "Led the harbor program. ".repeat(40).trim() + "\n\nSecond paragraph with an address: ops@example.com and a handle @ines.";
  const arabic = "تقود فريقًا من ستة مهندسين يبني منصة البيانات. ".repeat(12).trim();
  const view = { name: "A", lang: "en", facts: [{ tag: "OCCU", value: "Planner", note: long }, { tag: "EDUC", value: "BS", note: arabic }], sources: [] };
  const text = renderGedcom551(view);
  assert.deepEqual(checkGedcom551(text), []);
  for (const l of text.split("\n")) assert.ok(Buffer.byteLength(l, "utf8") + 1 <= 255, "every line fits in 255 bytes");
  assert.match(text, /\n3 CONC /, "long lines are continued");
  assert.match(text, /ops@@example\.com and a handle @@ines\./, "every @ is doubled");
  const me = indi(text);
  assert.equal(kid(kid(me, "OCCU"), "NOTE").value, long, "CONC and CONT rebuild the text exactly");
  assert.equal(kid(kid(me, "EDUC"), "NOTE").value, arabic, "two-byte letters too");
  // No continuation begins or ends with a space, which a reader may trim.
  for (const l of text.split("\n")) { const m = l.match(/^\d+ CON[CT] (.*)$/); if (m) assert.ok(!/^ | $/.test(m[1]), JSON.stringify(m[1])); }
});

test("a value too long for its field is cut there and kept whole in a note", () => {
  const title = "Senior Vice President of " + "Very Long Department Names and ".repeat(4) + "Coordination";
  const view = { name: "A", facts: [{ tag: "OCCU", value: title, agency: "A".repeat(130) }], sources: [] };
  const text = renderGedcom551(view);
  assert.deepEqual(checkGedcom551(text), []);
  const occu = kid(indi(text), "OCCU");
  assert.equal([...occu.value].length, 90);
  assert.ok(occu.value.endsWith("…"));
  assert.ok(kids(occu, "NOTE").some((n) => n.value === `Occupation in full: ${title}`));
  assert.equal([...kid(occu, "AGNC").value].length, 120);
  assert.ok(kids(occu, "NOTE").some((n) => n.value.startsWith("Organization in full: AAAA")));
});

test("media: a record with the file, its format and its description", () => {
  const text = ged5(load("examples/recommended/profile.json"));
  assert.match(text, /1 OBJE @O1@\n0 @O1@ OBJE\n1 FILE https:\/\/ines-ortega\.example\/files\/media\/headshot\.png\n2 FORM png\n3 TYPE photo\n2 TITL /);
  assert.match(text, /1 NOTE Description: Illustrated placeholder portrait/);
});

test("two limits of 5.5.1 are passed on purpose, and this says which", () => {
  const text = ged5(load("examples/recommended/profile.json"));
  const file = text.match(/1 FILE (.*)/)[1];
  // The specification allows a file reference 30 characters; a web address does not fit, and is written whole.
  assert.ok(file.length > 30);
  // Its list of formats (bmp gif jpg ole pcx tif wav) is older than PNG; the real format is written.
  assert.match(text, /2 FORM png/);
});

test("private, unapproved and internal things stay out, as in 7.0", () => {
  const p = sample();
  p.work[0].note = "INTERNAL-NOTE do not publish";
  const text = ged5(p);
  assert.doesNotMatch(text, /Calloway Ortega|Hospitality consultant|Coastal Management|INTERNAL-NOTE|ines@@?example\.com|555-0100/);
  assert.doesNotMatch(ged5(load("examples/recommended/profile.json")), /Maria Chen|Sam Okafor|Priya Raman/);
});

test("gedcom551 is the gedcom7 mapping written another way, not a second definition", () => {
  const raw = load("mappings/gedcom551.json");
  assert.equal(raw.extends, "gedcom7");
  assert.equal(raw.output, undefined, "it has no template of its own");
  const resolved = resolveMapping(raw);
  assert.deepEqual(resolved.output, load("mappings/gedcom7.json").output);
  assert.equal(resolved.target, "gedcom551");
  assert.equal(resolved.format, "gedcom551");
  assert.ok(BUNDLED_MAPPINGS.includes("gedcom551"));
  assert.throws(() => resolveMapping({ extends: "../package" }), /name of a bundled mapping/);
  assert.throws(() => resolveMapping({ extends: "nosuch" }), /isn't bundled/);
  // An entry can leave one of the two out without leaving the other.
  const p = sample();
  p.timeline.find((t) => t.id === "paris-year").targets = { gedcom551: { omit: true } };
  assert.doesNotMatch(ged5(p), /Paris/);
  assert.match(ged7(p), /Paris/);
});

test("the committed example files are current", () => {
  for (const [name, src] of [["sample", "examples/sample.profile.json"], ["history", "examples/history.profile.json"], ["recommended", "examples/recommended/profile.json"]]) {
    assert.equal(readFileSync(join(root, "examples", "out", `${name}.551.ged`), "utf8"), ged5(load(src)), name);
  }
});
