#!/usr/bin/env node
// Builds data/*.json from the official code-list releases. The JSON files are generated:
// change this script or its inputs, never the output (CI can re-run it and diff).
//
//   node scripts/build-code-lists.mjs --soc <BLS-structure.csv> --onet <db_31_0_text dir> --naics <2-6 digit_2022_Codes.csv>
//
// Each input's SHA-256 is recorded in the output, so a reader can tell which download built it.
// Expected inputs: the BLS 2018 SOC structure (SOC Group, SOC Code, SOC Title columns), the O*NET
// text database folder, and the Census 2022 NAICS "2-6 digit" code file.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const out = (name, obj) => writeFileSync(new URL(`../data/${name}`, import.meta.url), JSON.stringify(obj, null, 0).replace(/,"/g, ',\n"') + "\n");
const generated = (inputs) => ({ generatedBy: "scripts/build-code-lists.mjs", inputs: Object.fromEntries(inputs.map(([n, f]) => [n, sha(f)])) });

// Minimal CSV: quoted fields with doubled quotes, commas inside quotes.
function csv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const tsv = (text) => text.replace(/\r/g, "").split("\n").filter(Boolean).map((l) => l.split("\t"));
const strip = (s) => s.replace(/^﻿/, "").trim();

if (args.soc) {
  const rows = csv(readFileSync(args.soc, "utf8"));
  const h = rows[0].map(strip);
  const [g, c, t] = ["SOC Group", "SOC Code", "SOC Title"].map((k) => h.indexOf(k));
  const codes = {};
  for (const r of rows.slice(1)) if (r[c]) codes[strip(r[c])] = { title: strip(r[t]), level: strip(r[g]).toLowerCase() };
  out("soc-2018.json", { system: "soc", edition: "2018", publisher: "U.S. Bureau of Labor Statistics", url: "https://www.bls.gov/soc/2018/", ...generated([["soc", args.soc]]), codes });
}
if (args.onet) {
  const occFile = join(args.onet, "Occupation Data.txt"), cmFile = join(args.onet, "Content Model Reference.txt");
  const release = readFileSync(join(args.onet, "Read Me.txt"), "utf8").match(/O\*NET ([\d.]+) Database\s*\n\s*([A-Za-z]+ \d{4})/);
  const edition = release ? `O*NET ${release[1]} (${release[2]})` : "O*NET";
  const occ = tsv(readFileSync(occFile, "utf8"));
  const codes = Object.fromEntries(occ.slice(1).map((r) => [r[0], r[1]]));
  const meta = { publisher: "O*NET Resource Center, U.S. Department of Labor/ETA", license: "CC BY 4.0", ...generated([["occupations", occFile], ["contentModel", cmFile]]) };
  out("onet-soc.json", { system: "onetSoc", edition: `2019 taxonomy, ${edition}`, url: "https://www.onetcenter.org/database.html", ...meta, codes });
  const cm = tsv(readFileSync(cmFile, "utf8"));
  const keep = (id) => ["1", "2", "4"].includes(id) || ["1.A", "2.A", "2.B", "2.C", "2.E", "4.A"].includes(id.slice(0, 3));
  const elements = Object.fromEntries(cm.slice(1).filter((r) => keep(r[0])).map((r) => [r[0], r[1]]));
  out("onet-elements.json", { system: "onet", edition, url: "https://www.onetcenter.org/content.html", ...meta, elements });
}
if (args.naics) {
  const rows = csv(readFileSync(args.naics, "utf8"));
  const codes = {};
  for (const r of rows.slice(1)) if (r[1] && strip(r[1])) codes[strip(r[1])] = strip(r[2]);
  out("naics-2022.json", { system: "naics", edition: "2022", publisher: "U.S. Census Bureau", url: "https://www.census.gov/naics/", ...generated([["naics", args.naics]]), codes });
}
