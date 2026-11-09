// Code lists bundled in data/ (built by scripts/build-code-lists.mjs): SOC 2018 (BLS), the O*NET-SOC taxonomy and content-model
// elements (O*NET 31.0, CC BY 4.0), and NAICS 2022 (Census). Loaded on first use.

import { readFileSync } from "node:fs";

const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8")));
  return cache.get(name);
}

/** The editions the bundled lists cover, per system. A code in another edition is not checked. */
export const BUNDLED = Object.freeze({
  soc: { editions: ["2018"], file: "soc-2018.json" },
  onetSoc: { editions: ["2019", "31.0", "30.3"], file: "onet-soc.json" }, // the taxonomy, or the O*NET release it came from
  onet: { editions: ["31.0", "30.3"], file: "onet-elements.json" }, // 30.3 and 31.0 share element ids and names
  naics: { editions: ["2022"], file: "naics-2022.json" },
});

const EDITION_SET = { soc: "2018 SOC", onetSoc: "O*NET-SOC 2019", onet: "O*NET 31.0", naics: "NAICS 2022", isco: "ISCO-08", esco: "ESCO", noc: "NOC", anzsco: "ANZSCO", lightcast: "Lightcast Open Skills" };
const SET_URL = {
  soc: "https://www.bls.gov/soc/2018/",
  onetSoc: "https://www.onetcenter.org/taxonomy.html",
  onet: "https://www.onetcenter.org/content.html",
  naics: "https://www.census.gov/naics/",
  isco: "https://isco.ilo.org/",
  esco: "https://esco.ec.europa.eu/",
};

/** Is this code's edition one the bundled lists cover? A missing version means the bundled edition. */
export function checkable(system, version) {
  const b = BUNDLED[system];
  return !!b && (version == null || b.editions.includes(String(version)));
}

/** Official title of a code from the bundled lists, or undefined. */
export function officialTitle(system, code, version) {
  if (!checkable(system, version)) return undefined;
  const data = load(BUNDLED[system].file);
  if (system === "soc") return data.codes[code]?.title;
  if (system === "onet") return data.elements[code];
  return data.codes[code];
}

/** SOC level (major, minor, broad, detailed) of a 2018 code. */
export const socLevel = (code) => load("soc-2018.json").codes[code]?.level;

/** Human name and URL of a code set, for JSON-LD inCodeSet / inDefinedTermSet. */
export function codeSet(system, version) {
  const name = EDITION_SET[system] ?? system;
  return { name: version && !name.includes(version) ? `${name} (${version})` : name, url: SET_URL[system] };
}

/**
 * Check one code. Returns { errors, warnings } as strings.
 * Unknown codes in a bundled edition are errors; a label that differs from the official title is a warning.
 */
export function checkCode(system, entry, at) {
  const errors = [], warnings = [];
  if (!checkable(system, entry.version)) return { errors, warnings };
  const title = officialTitle(system, entry.code, entry.version);
  if (!title) {
    errors.push(`${at}: ${entry.code} is not a ${EDITION_SET[system]} code`);
    return { errors, warnings };
  }
  if (system === "soc" && socLevel(entry.code) !== "detailed") {
    warnings.push(`${at}: ${entry.code} is a SOC ${socLevel(entry.code)} group; use a detailed occupation (xx-xxxx ending in a non-zero digit) where one fits`);
  }
  const label = typeof entry.label === "string" ? entry.label : entry.label && Object.values(entry.label)[0];
  if (label && norm(label) !== norm(title)) warnings.push(`${at}: label "${label}" differs from the official title "${title}"`);
  return { errors, warnings };
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** O*NET-SOC codes extend SOC codes: 11-9021.00 belongs to 11-9021. */
export const socOf = (onetSocCode) => onetSocCode.slice(0, 7);
