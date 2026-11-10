// A GEDCOM 7 structure checker for the tests, driven by FamilySearch's own tables in
// upstream/gedcom7/: which tag may sit under which, how often, and what kind of value it takes.
// It is trusted only because it accepts the official test files (a test asserts that first).
import { readFileSync } from "node:fs";

const dir = new URL("../upstream/gedcom7/", import.meta.url);
const rows = (file) => readFileSync(new URL(file, dir), "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split("\t"));
const V7 = "https://gedcom.io/terms/v7/";

const SUB = new Map();    // parent structure → tag → structure
for (const [parent, tag, structure] of rows("substructures.tsv")) { if (!SUB.has(parent)) SUB.set(parent, new Map()); SUB.get(parent).set(tag, structure); }
const CARD = new Map();   // parent structure → [structure, cardinality]
for (const [parent, structure, card] of rows("cardinalities.tsv")) { if (!CARD.has(parent)) CARD.set(parent, []); CARD.get(parent).push([structure, card]); }
const PAYLOAD = new Map(rows("payloads.tsv").map(([s, p]) => [s, p ?? ""]));
const ENUM_OF = new Map(rows("enumerations.tsv"));
const ENUMS = new Map();  // set → values
for (const [set, value] of rows("enumerationsets.tsv")) { if (!ENUMS.has(set)) ENUMS.set(set, new Set()); ENUMS.get(set).add(value.slice(value.lastIndexOf("/") + 1).split("-").at(-1)); /* …/enum-ADOP-HUSB stands for HUSB, …/v7/BIRT for BIRT */ }

const MONTH = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)";
const DATE = `(?:(?:GREGORIAN|JULIAN|FRENCH_R|HEBREW|_[A-Z0-9_]+) )?(?:(?:\\d{1,2} )?[A-Z][A-Z0-9_]* )?\\d+(?: (?:BCE|_[A-Z0-9_]+))?`;
const GREG = `(?:(?:\\d{1,2} )?${MONTH} )?\\d+`;
const PERIOD = `(?:TO ${DATE}|FROM ${DATE}(?: TO ${DATE})?)`;
const RE = {
  value: new RegExp(`^(?:|${DATE}|${PERIOD}|BET ${DATE} AND ${DATE}|AFT ${DATE}|BEF ${DATE}|(?:ABT|CAL|EST) ${DATE})$`),
  exact: new RegExp(`^\\d{1,2} ${MONTH} \\d+$`),
  period: new RegExp(`^(?:|${PERIOD})$`),
  gregorianOnly: new RegExp(`^(?:|(?:FROM |TO |BET |AFT |BEF |ABT |CAL |EST )?${GREG}(?: (?:TO|AND) ${GREG})?)$`),
};

/** Parse GEDCOM text into records: [{ level, xref, tag, value, children, line }]. CONT lines are folded into the value. */
export function parseGedcom(text) {
  const errors = [];
  const roots = [];
  const stack = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((raw, i) => {
    const m = raw.match(/^(0|[1-9]\d*) (?:(@[A-Z0-9_]+@) )?([A-Z_][A-Z0-9_]*)(?: (.*))?$/s);
    if (!m) { errors.push(`line ${i + 1}: not a GEDCOM line: ${JSON.stringify(raw.slice(0, 60))}`); return; }
    const node = { level: Number(m[1]), xref: m[2], tag: m[3], value: m[4] ?? "", children: [], line: i + 1 };
    if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(node.value)) errors.push(`line ${i + 1}: control character in the value`);
    if (node.level > stack.length) { errors.push(`line ${i + 1}: level ${node.level} skips a level`); return; }
    stack.length = node.level;
    if (node.tag === "CONT") {
      const parent = stack[node.level - 1];
      if (!parent) errors.push(`line ${i + 1}: CONT with nothing to continue`); else parent.value += `\n${node.value.replace(/^@@/, "@")}`;
      return;
    }
    // A leading "@@" stands for a single "@" (a lone leading "@" would read as a pointer).
    if (node.value.startsWith("@@")) node.value = node.value.slice(1);
    else if (node.value.startsWith("@")) node.pointer = node.value;
    (node.level === 0 ? roots : stack[node.level - 1].children).push(node);
    stack[node.level] = node;
  });
  return { roots, errors };
}

/** Check GEDCOM 7 text against the standard's tables. Returns a list of problems (empty when it conforms). */
export function checkGedcom7(text) {
  const { roots, errors } = parseGedcom(text);
  if (roots[0]?.tag !== "HEAD") errors.push("the first record must be HEAD");
  if (roots.at(-1)?.tag !== "TRLR") errors.push("the last record must be TRLR");
  const records = new Map(roots.filter((r) => r.xref).map((r) => [r.xref, r]));
  if (records.size !== roots.filter((r) => r.xref).length) errors.push("two records share a cross-reference id");
  const declared = new Set(roots[0]?.children.find((c) => c.tag === "SCHMA")?.children.filter((c) => c.tag === "TAG").map((c) => c.value.split(" ")[0]) ?? []);
  const where = (n) => `line ${n.line} ${n.tag}`;

  const visit = (node, parentUri) => {
    if (node.tag.startsWith("_")) {
      // An extension: its contents are its own business, but it must be declared in HEAD.SCHMA.
      if (!declared.has(node.tag)) errors.push(`${where(node)}: extension tag is not declared in HEAD.SCHMA`);
      return undefined;
    }
    const uri = SUB.get(parentUri)?.get(node.tag);
    if (!uri) { errors.push(`${where(node)}: not allowed under ${parentUri.replace(V7, "") || "the top level"}`); return undefined; }
    const type = PAYLOAD.get(uri) ?? "";
    const v = node.value;
    if (type === "") { if (v !== "" ) errors.push(`${where(node)}: takes no value`); }
    else if (type.startsWith("@<")) {
      const want = type.slice(2, -2);
      if (!node.pointer) errors.push(`${where(node)}: needs a pointer`);
      else if (v !== "@VOID@") {
        const target = records.get(v);
        if (!target) errors.push(`${where(node)}: points to ${v}, which is not a record`);
        else if (SUB.get("")?.get(target.tag) !== want) errors.push(`${where(node)}: points to a ${target.tag} record, not ${want.replace(V7, "")}`);
      }
    } else if (node.pointer) errors.push(`${where(node)}: a value starting with "@" must be written "@@"`);
    else if (type === `${V7}type-Date`) { if (!RE.value.test(v) || !RE.gregorianOnly.test(v)) errors.push(`${where(node)}: "${v}" is not a date value`); }
    else if (type === `${V7}type-Date#exact`) { if (!RE.exact.test(v)) errors.push(`${where(node)}: "${v}" is not an exact date`); }
    else if (type === `${V7}type-Date#period`) { if (!RE.period.test(v)) errors.push(`${where(node)}: "${v}" is not a date period`); }
    else if (type === `${V7}type-Enum`) {
      const set = ENUMS.get(ENUM_OF.get(uri));
      if (set && !set.has(v) && !v.startsWith("_")) errors.push(`${where(node)}: "${v}" is not one of ${[...set].join(", ")}`);
    } else if (type === "Y|<NULL>") { if (v !== "" && v !== "Y") errors.push(`${where(node)}: takes Y or nothing`); }
    else if (type === `${V7}type-TagDef`) { if (!/^_[A-Z0-9_]+ \S+$/.test(v)) errors.push(`${where(node)}: "${v}" is not a tag definition`); }

    const counts = new Map();
    for (const child of node.children) {
      const childUri = visit(child, uri);
      if (childUri) counts.set(childUri, (counts.get(childUri) ?? 0) + 1);
    }
    for (const [structure, card] of CARD.get(uri) ?? []) {
      const n = counts.get(structure) ?? 0;
      const [min, max] = card.slice(1, -1).split(":");
      if (min === "1" && n < 1) errors.push(`${where(node)}: needs a ${structure.replace(V7, "")}`);
      if (max === "1" && n > 1) errors.push(`${where(node)}: has ${n} ${structure.replace(V7, "")}, and one is the most allowed`);
    }
    return uri;
  };
  for (const root of roots) visit(root, "");
  return errors;
}
