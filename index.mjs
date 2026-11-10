import { readFileSync, readdirSync } from "node:fs";

export { validateProfile, getField, canonical, SECTIONS } from "./lib/validate.mjs";
export { convert, checkRules, stringsOf, renderText, RuleViolationError, DEFAULT_INCLUDE, withoutNotes, withPublishedMedia, inclusion, sectionsRead, resolveMapping } from "./lib/convert.mjs";
export { fromJsonResume } from "./lib/import-jsonresume.mjs";
export { resolveAudience, checkRequester, authorityFor, isCurrent, DEFAULT_AUTHORITY } from "./lib/audience.mjs";
export { buildRelease, scopeProfile, consentReceipt, ReleaseRefusedError } from "./lib/release.mjs";
export { officialTitle, checkCode, codeSet, socLevel, BUNDLED as BUNDLED_CODE_LISTS } from "./lib/codes.mjs";
export { applyWriteBack, readScim } from "./lib/writeback.mjs";
export { reviewMarkdown } from "./lib/review.mjs";
export { renderAts } from "./lib/ats.mjs";
export { renderEuropass } from "./lib/europass.mjs";
export { validateOrganization, stateOn, compareDates, holderText, inEffect } from "./lib/orgchart/index.mjs";
export { buildOrganization } from "./lib/orgchart/build.mjs";
export { orgRows, orgMarkdown, orgCsv } from "./lib/orgchart/views.mjs";
export { orgHtml } from "./lib/orgchart/html.mjs";
export { renderOrgPdf, orgPdfView } from "./lib/orgchart/pdf.mjs";
export { orgStats, orgSeries, statsMarkdown, monthStarts } from "./lib/orgchart/stats.mjs";
export { CONNECTORS as DIRECTORY_CONNECTORS, FIELDS as DIRECTORY_FIELDS, readProfileFolder, matchUser, diffDirectory, changeReport } from "./lib/directory/index.mjs";
export { renderPresentation, renderClr, originalCredential, bundleFileReader, NothingToExportError, urnUuid, CONTEXT_VC, CONTEXT_OB3, CONTEXT_CLR } from "./lib/ob3.mjs";
export { renderGedcom7, renderGedcom551, gedcomDate, gedcomDateValue, gedcomPeriod, gedzip, gedzipMedia, readBundleMedia, storeZip, GEDZIP_MEDIA, EXTENSIONS as GEDCOM_EXTENSIONS } from "./lib/gedcom.mjs";
export { renderResumePdf, resumeViewForPdf, dropCandidates, PdfError, LAYOUTS as PDF_LAYOUTS } from "./lib/pdf.mjs";

/** The Turnrow Profile JSON Schema (draft 2020-12). */
export const schema = JSON.parse(readFileSync(new URL("./schema/profile.schema.json", import.meta.url), "utf8"));

/** The mappings shipped in mappings/. */
export const BUNDLED_MAPPINGS = Object.freeze(
  readdirSync(new URL("./mappings/", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort());

/** Load one of the bundled mappings by name (see BUNDLED_MAPPINGS). */
export function loadMapping(name) {
  if (!BUNDLED_MAPPINGS.includes(name)) {
    throw new Error(`unknown mapping "${name}": use one of ${BUNDLED_MAPPINGS.join(", ")}, or the path to your own mapping .json file`);
  }
  return JSON.parse(readFileSync(new URL(`./mappings/${name}.json`, import.meta.url), "utf8"));
}
