// A GEDCOM 5.5.1 structure checker for the tests. Which tag may sit where, how often, and how long
// a value may be come from upstream/gedcom551/grammar.txt, extracted from the specification itself.
// The few rules the specification gives only in prose (dates, at-signs, line length, enumerations)
// are written out below, each with where it comes from.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../upstream/gedcom551/grammar.txt", import.meta.url), "utf8");
const [, structuresPart, sizesPart] = text.split(/^## (?:structures|sizes)$/m);

const SIZE = new Map();
for (const l of sizesPart.split("\n")) { const m = l.match(/^([A-Z_0-9]+):= \{Size=(\d+)(?::(\d+))?\}$/); if (m) SIZE.set(m[1], Number(m[3] ?? m[2])); }

// structure name → { entries: [...top-level entries], alternatives: boolean }
// entry: { tags, ref, min, max, pointer, primitive, noValue, children }
const STRUCT = new Map();
{
  let name, stack;
  for (const raw of structuresPart.split("\n")) {
    const l = raw.trim();
    const def = l.match(/^([A-Z_0-9]+):=$/);
    if (def) { name = def[1]; STRUCT.set(name, { entries: [], alternatives: false }); stack = []; continue; }
    if (!name || !l) continue;
    // Alternation brackets, which may carry a comment: "[ /* pointer to source record */".
    const bracket = l.replace(/\/\*.*?\*\//g, "").trim();
    if (bracket === "[" || bracket === "]") continue;
    if (bracket === "|") { STRUCT.get(name).alternatives = true; continue; }
    const m = l.match(/^(n|0|\+\d+)\s+(.*)$/);
    if (!m) continue;
    const level = m[1] === "n" || m[1] === "0" ? 0 : Number(m[1].slice(1));
    let rest = m[2].replace(/\/\*.*?\*\//g, " ").replace(/\s+p\.\d+(?:,\s*\d+)*\s*$/, "").trim();
    const card = rest.match(/\{(\d):([\dM])[})*]\*?/);   // the specification's own typos: "{0:1)", "{0:1*"
    const min = card ? Number(card[1]) : 0, max = card ? (card[2] === "M" ? Infinity : Number(card[2])) : Infinity;
    if (card) rest = rest.slice(0, card.index).trim();
    const entry = { tags: [], min, max, children: [] };
    const ref = rest.match(/^<<([A-Z_0-9]+)>>/);
    if (ref) entry.ref = ref[1];
    else {
      rest = rest.replace(/^@<?XREF:[A-Z]+>?@\s+/, "");                     // a record's own id
      const alt = rest.match(/^\[\s*([A-Z_0-9|\s]+?)\s*\]/);               // [ BIRT | CHR ]
      if (alt && !alt[1].includes("<")) { entry.tags = alt[1].split("|").map((t) => t.trim()).filter(Boolean); rest = rest.slice(alt[0].length).trim(); }
      else { const tag = rest.match(/^[A-Z_0-9]+/); if (!tag) continue; entry.tags = [tag[0]]; rest = rest.slice(tag[0].length).trim(); }
      const pointer = rest.match(/@<XREF:([A-Z]+)>@/);
      if (pointer) entry.pointer = pointer[1];
      else if (/<[A-Z_0-9]+>/.test(rest)) { entry.primitive = rest.match(/<([A-Z_0-9]+)>/)[1]; entry.optionalValue = /<NULL>/.test(rest); }
      else if (/\[Y\|<NULL>\]/.test(rest)) entry.yOrNull = true;
      else entry.noValue = true;
    }
    stack.length = level;
    (level === 0 ? STRUCT.get(name).entries : stack[level - 1]?.children ?? STRUCT.get(name).entries).push(entry);
    stack[level] = entry;
  }
}

// The entries a list stands for once references are followed. `firm` is false for anything reached
// through a structure with alternatives, where "required" belongs to one alternative only.
// A reference's own count multiplies what is inside it: "<<NOTE_STRUCTURE>> {0:M}" allows many NOTEs
// though the structure itself says "NOTE {1:1}".
function expand(entries, firm = true, seen = new Set(), times = 1) {
  return entries.flatMap((e) => {
    if (!e.ref) return [{ ...e, firm, max: e.max * times }];
    const s = STRUCT.get(e.ref);
    if (!s || seen.has(e.ref)) return [];
    return expand(s.entries, firm && !s.alternatives && e.min >= 1, new Set([...seen, e.ref]), times * e.max);
  });
}
const RECORDS = expand([{ ref: "HEADER", min: 1, max: 1 }, ...["FAM_RECORD", "INDIVIDUAL_RECORD", "MULTIMEDIA_RECORD", "NOTE_RECORD", "REPOSITORY_RECORD", "SOURCE_RECORD", "SUBMITTER_RECORD", "SUBMISSION_RECORD"].map((ref) => ({ ref, min: 0, max: Infinity }))]);

// Dates (specification, DATE_VALUE and its parts, pp. 45–47): Gregorian dates only are checked here.
const MONTH = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)";
const D = `(?:(?:\\d{1,2} )?${MONTH} )?\\d{3,4}`;
const DATE_VALUE = new RegExp(`^(?:${D}|FROM ${D}(?: TO ${D})?|TO ${D}|BEF ${D}|AFT ${D}|BET ${D} AND ${D}|(?:ABT|CAL|EST) ${D}|INT ${D} \\(.+\\)|\\(.+\\))$`);
const DATE_EXACT = new RegExp(`^\\d{1,2} ${MONTH} \\d{4}$`);
// Two limits of the specification are knowingly not enforced, because the export knowingly passes them:
//  - MULTIMEDIA_FILE_REFERENCE is limited to 30 characters, which no web address and few paths fit.
//    The whole reference is written, as other software does; a cut address would point nowhere.
//  - MULTIMEDIA_FORMAT lists bmp, gif, jpg, ole, pcx, tif and wav, a list older than PNG. The real
//    format is written (png, pdf, svg).
// A test states both, so they stay decisions and not oversights.
// Enumerations the specification lists in prose.
const ENUM = {
  CERTAINTY_ASSESSMENT: ["0", "1", "2", "3"],
  SOURCE_MEDIA_TYPE: ["audio", "book", "card", "electronic", "fiche", "film", "magazine", "manuscript", "map", "newspaper", "photo", "tombstone", "video"],
  CHARACTER_SET: ["ANSEL", "UTF-8", "UNICODE", "ASCII"],
};

/** Parse GEDCOM 5.5.1 text: CONC joins directly, CONT joins with a line break. Also returns per-line problems. */
export function parseGedcom551(gedcom) {
  const errors = [], roots = [], stack = [];
  const lines = gedcom.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((raw, i) => {
    // "The total length of a GEDCOM line … must not exceed 255 (wide) characters" (p. 10). Bytes are
    // checked too, since some readers count those.
    if (raw.length + 1 > 255 || Buffer.byteLength(raw, "utf8") + 1 > 255) errors.push(`line ${i + 1}: longer than 255`);
    const m = raw.match(/^(0|[1-9]\d?) (?:(@[A-Za-z0-9_]{1,20}@) )?([A-Z_][A-Z0-9_]*)(?: (.*))?$/s);
    if (!m) { errors.push(`line ${i + 1}: not a GEDCOM line: ${JSON.stringify(raw.slice(0, 60))}`); return; }
    const node = { level: Number(m[1]), xref: m[2], tag: m[3], value: m[4] ?? "", children: [], line: i + 1 };
    if (node.level > stack.length) { errors.push(`line ${i + 1}: level ${node.level} skips a level`); return; }
    stack.length = node.level;
    const pointer = /^@[A-Za-z0-9_]{1,20}@$/.test(node.value);
    // Every at-sign in a value is doubled (p. 11); a lone one would start a pointer or an escape.
    if (!pointer && /(?<!@)@(?!@)/.test(node.value.replace(/@@/g, ""))) errors.push(`line ${i + 1}: a lone "@" in the value must be written "@@"`);
    if (pointer) node.pointer = node.value; else node.value = node.value.replace(/@@/g, "@");
    if (node.tag === "CONC" || node.tag === "CONT") {
      const parent = stack[node.level - 1];
      if (!parent) errors.push(`line ${i + 1}: ${node.tag} with nothing to continue`);
      else { parent.value += (node.tag === "CONT" ? "\n" : "") + node.value; parent.continued = true; }
      return;
    }
    (node.level === 0 ? roots : stack[node.level - 1].children).push(node);
    stack[node.level] = node;
  });
  return { roots, errors };
}

/** Check GEDCOM 5.5.1 text against the specification's grammar. Returns a list of problems. */
export function checkGedcom551(gedcom) {
  const { roots, errors } = parseGedcom551(gedcom);
  if (roots[0]?.tag !== "HEAD") errors.push("the first record must be HEAD");
  if (roots.at(-1)?.tag !== "TRLR") errors.push("the last record must be TRLR");
  const records = new Map(roots.filter((r) => r.xref).map((r) => [r.xref, r]));
  const where = (n) => `line ${n.line} ${n.tag}`;

  const visit = (node, candidates, parentLabel) => {
    if (node.tag.startsWith("_")) return;   // user-defined tags are allowed anywhere (p. 56)
    const mine = candidates.filter((e) => e.tags.includes(node.tag));
    if (!mine.length) { errors.push(`${where(node)}: not allowed under ${parentLabel}`); return; }
    const v = node.value;
    // A value is right if it fits any of the forms the grammar offers for this tag here.
    const fits = mine.some((e) => {
      if (e.pointer) return !!node.pointer;
      if (node.pointer) return false;
      if (e.noValue) return v === "";
      if (e.yOrNull) return v === "" || v === "Y";
      return v !== "" || e.optionalValue || node.children.length > 0;
    });
    if (!fits) errors.push(`${where(node)}: ${node.pointer ? "does not take a pointer" : v === "" ? "needs a value" : "takes no value"}`);
    for (const e of mine) {
      if (e.pointer && node.pointer) {
        const target = records.get(v);
        if (!target) errors.push(`${where(node)}: points to ${v}, which is not a record`);
        else if (target.tag !== e.pointer) errors.push(`${where(node)}: points to a ${target.tag} record, not ${e.pointer}`);
      }
      if (e.primitive && !node.pointer && v !== "") {
        const max = SIZE.get(e.primitive);
        const canContinue = e.children.some((c) => c.tags.includes("CONC") || c.tags.includes("CONT"));
        // The size is of one line's value; text that may continue is limited by line length instead.
        if (max && !canContinue && mine.length === 1 && [...v].length > max) errors.push(`${where(node)}: ${[...v].length} characters, and ${e.primitive} allows ${max}`);
        if (node.continued && !canContinue && mine.length === 1) errors.push(`${where(node)}: may not be continued with CONC or CONT`);
        if (e.primitive === "DATE_VALUE" && !DATE_VALUE.test(v)) errors.push(`${where(node)}: "${v}" is not a date value`);
        if (e.primitive === "TRANSMISSION_DATE" && !DATE_EXACT.test(v)) errors.push(`${where(node)}: "${v}" is not an exact date`);
        // A tag offered in several forms (QUAY sits in both kinds of citation) is checked once, when the forms agree.
        if (ENUM[e.primitive] && e === mine[0] && mine.every((x) => x.primitive === e.primitive) && !ENUM[e.primitive].includes(v)) errors.push(`${where(node)}: "${v}" is not one of ${ENUM[e.primitive].join(", ")}`);
      }
    }
    const allowed = expand(mine.flatMap((e) => e.children));
    for (const child of node.children) visit(child, allowed, node.tag);
    // "Required" and "at most one" are enforced only where every form of this tag agrees.
    if (mine.length === 1) {
      const byTag = new Map();
      for (const e of allowed) for (const t of e.tags) byTag.set(t, [...(byTag.get(t) ?? []), e]);
      for (const [tag, es] of byTag) {
        if (tag === "CONC" || tag === "CONT") continue;
        const n = node.children.filter((c) => c.tag === tag).length;
        if (es.every((e) => e.firm && e.min >= 1) && n < 1) errors.push(`${where(node)}: needs a ${tag}`);
        if (es.every((e) => e.max === 1) && n > 1) errors.push(`${where(node)}: has ${n} ${tag}, and one is the most allowed`);
      }
    }
  };
  for (const root of roots) {
    if (root.tag === "TRLR") continue;
    visit(root, RECORDS, "the top level");
  }
  const head = roots[0];
  const sub = (n, t) => n?.children.find((c) => c.tag === t);
  if (head?.tag === "HEAD") {
    // GEDC.VERS and FORM, and UTF-8, are what make this a 5.5.1 lineage-linked file (pp. 23, 44, 50).
    if (sub(sub(head, "GEDC"), "VERS")?.value !== "5.5.1") errors.push("HEAD.GEDC.VERS must be 5.5.1");
    if (sub(sub(head, "GEDC"), "FORM")?.value !== "LINEAGE-LINKED") errors.push("HEAD.GEDC.FORM must be LINEAGE-LINKED");
  }
  return errors;
}
