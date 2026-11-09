import { readFileSync } from "node:fs";

export { validateProfile, getField, canonical, SECTIONS } from "./lib/validate.mjs";
export { convert, checkRules, stringsOf, renderText, RuleViolationError, DEFAULT_INCLUDE, withoutNotes, withPublishedMedia } from "./lib/convert.mjs";
export { fromJsonResume } from "./lib/import-jsonresume.mjs";
export { resolveAudience, checkRequester, authorityFor, isCurrent, DEFAULT_AUTHORITY } from "./lib/audience.mjs";
export { buildRelease, scopeProfile, consentReceipt, ReleaseRefusedError } from "./lib/release.mjs";
export { officialTitle, checkCode, codeSet, socLevel, BUNDLED as BUNDLED_CODE_LISTS } from "./lib/codes.mjs";
export { applyWriteBack, readScim } from "./lib/writeback.mjs";

/** The Turnrow Profile JSON Schema (draft 2020-12). */
export const schema = JSON.parse(readFileSync(new URL("./schema/profile.schema.json", import.meta.url), "utf8"));

/** Load one of the bundled mappings by name: jsonresume, schemaorg, linkedin, brief, timeline, scim, verification. */
export function loadMapping(name) {
  return JSON.parse(readFileSync(new URL(`./mappings/${name}.json`, import.meta.url), "utf8"));
}
