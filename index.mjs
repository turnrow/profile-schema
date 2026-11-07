import { readFileSync } from "node:fs";

export { validateProfile, getField, canonical, SECTIONS } from "./lib/validate.mjs";
export { convert, checkRules, stringsOf, renderText, RuleViolationError, DEFAULT_INCLUDE } from "./lib/convert.mjs";
export { fromJsonResume } from "./lib/import-jsonresume.mjs";
export { resolveAudience, checkRequester, authorityFor, isCurrent, DEFAULT_AUTHORITY } from "./lib/audience.mjs";
export { buildRelease, scopeProfile, consentReceipt } from "./lib/release.mjs";
export { applyWriteBack, readScim } from "./lib/writeback.mjs";

/** The Turnrow Profile JSON Schema (draft 2020-12). */
export const schema = JSON.parse(readFileSync(new URL("./schema/profile.schema.json", import.meta.url), "utf8"));

/** Load one of the bundled mappings by name: jsonresume, schemaorg, linkedin, brief, timeline, scim. */
export function loadMapping(name) {
  return JSON.parse(readFileSync(new URL(`./mappings/${name}.json`, import.meta.url), "utf8"));
}
