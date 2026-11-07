import { readFileSync } from "node:fs";

export { validateProfile, getField, SECTIONS } from "./lib/validate.mjs";
export { convert, checkRules, renderText, RuleViolationError, DEFAULT_INCLUDE } from "./lib/convert.mjs";
export { fromJsonResume } from "./lib/import-jsonresume.mjs";

/** The Turnrow Profile JSON Schema (draft 2020-12). */
export const schema = JSON.parse(readFileSync(new URL("./schema/profile.schema.json", import.meta.url), "utf8"));

/** Load one of the bundled mappings by name: jsonresume, schemaorg, linkedin, brief, timeline. */
export function loadMapping(name) {
  return JSON.parse(readFileSync(new URL(`./mappings/${name}.json`, import.meta.url), "utf8"));
}
