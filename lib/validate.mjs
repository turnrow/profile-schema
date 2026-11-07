// Turnrow Profile validator: JSON Schema validation plus the checks a schema cannot express
// (cross-references, claim consistency, open questions, consent, bundle files, rule syntax).

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(readFileSync(new URL("../schema/profile.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemaCheck = ajv.compile(schema);

export const SECTIONS = [
  "work", "service", "education", "credentials", "awards", "projects", "publications",
  "timeline", "media", "skills", "languages", "interests", "references",
];
const ORG_FIELDS = ["organization", "client", "institution", "issuer", "awarder", "publisher"];

/**
 * @param {object} profile
 * @param {{ bundleDir?: string }} [options]  bundleDir: folder that 'bundle:' URLs resolve against
 * @returns {{ valid: boolean, errors: string[], warnings: string[], openItems: {id: string, status: string, question?: string}[] }}
 */
export function validateProfile(profile, options = {}) {
  const errors = [];
  const warnings = [];
  const openItems = [];

  if (!schemaCheck(profile)) {
    for (const e of schemaCheck.errors) errors.push(`schema ${e.instancePath || "/"} ${e.message}`);
    return { valid: false, errors, warnings, openItems };
  }

  const orgs = new Set(Object.keys(profile.organizations ?? {}));
  const places = new Set(Object.keys(profile.places ?? {}));
  const sources = profile.sources ?? {};
  const byId = new Map();
  for (const s of SECTIONS) for (const e of profile[s] ?? []) {
    if (byId.has(e.id)) errors.push(`${s}/${e.id}: duplicate id (also in ${byId.get(e.id).section})`);
    byId.set(e.id, { section: s, entry: e });
  }
  const idsIn = (section) => new Set((profile[section] ?? []).map((e) => e.id));
  const skillIds = idsIn("skills"), projectIds = idsIn("projects"), mediaIds = idsIn("media");

  const checkPlace = (ref, at) => { if (typeof ref === "string" && !places.has(ref)) errors.push(`${at}: unknown place "${ref}"`); };
  const checkCitations = (cits, at) => {
    for (const c of cits ?? []) if (!sources[c.source]) errors.push(`${at}: unknown source "${c.source}"`);
  };
  const qualities = (cits) => (cits ?? []).map((c) => c.quality ?? sources[c.source]?.defaultQuality ?? "selfReported");

  checkPlace(profile.person.location, "person.location");
  for (const [id, org] of Object.entries(profile.organizations ?? {})) checkPlace(org.location, `organizations/${id}.location`);
  for (const [id, src] of Object.entries(sources)) {
    if (src.media && !mediaIds.has(src.media)) errors.push(`sources/${id}: unknown media "${src.media}"`);
  }

  for (const s of SECTIONS) {
    for (const e of profile[s] ?? []) {
      const at = `${s}/${e.id}`;
      for (const k of ORG_FIELDS) if (typeof e[k] === "string" && !orgs.has(e[k])) errors.push(`${at}: unknown organization "${e[k]}"`);
      checkPlace(e.location, `${at}.location`);
      for (const p of e.places ?? []) checkPlace(p, `${at}.places`);
      for (const x of e.skills ?? []) if (!skillIds.has(x)) errors.push(`${at}: unknown skill "${x}"`);
      for (const x of e.projects ?? []) if (!projectIds.has(x)) errors.push(`${at}: unknown project "${x}"`);
      for (const x of e.media ?? []) if (!mediaIds.has(x)) errors.push(`${at}: unknown media "${x}"`);
      const related = Array.isArray(e.relatedTo) ? e.relatedTo : e.relatedTo ? [e.relatedTo] : [];
      for (const x of related) if (!byId.has(x)) errors.push(`${at}: relatedTo unknown id "${x}"`);
      checkCitations(e.citations, at);
      for (const c of e.claims ?? []) checkCitations(c.citations, `${at} claim on ${c.field}`);

      checkOpen(e, at, errors, openItems);
      checkClaims(e, e, at, errors);
      if (e.lock && e.status !== "approved") warnings.push(`${at}: locked but status is "${e.status ?? "draft"}"`);
      if (e.confidence === "high" && e.citations?.length && qualities(e.citations).every((q) => q === "selfReported" || q === "hearsay")) {
        warnings.push(`${at}: confidence is high but every citation is self-reported or hearsay`);
      }
      if (s === "references" && (e.visibility ?? "public") !== "private" && !e.consentToPublish) {
        errors.push(`${at}: reference is ${e.visibility ?? "public"} but consentToPublish is not true`);
      }
      if (s === "credentials" && e.credentialId && /\s/.test(e.credentialId) && /[a-z]{4,}/i.test(e.credentialId)) {
        warnings.push(`${at}: credentialId "${e.credentialId}" looks like a note, not an issuer number`);
      }
      const metricIds = new Set();
      for (const m of e.metrics ?? []) {
        const mat = `${at} › metric ${m.id}`;
        if (metricIds.has(m.id)) errors.push(`${mat}: duplicate metric id`);
        metricIds.add(m.id);
        checkCitations(m.citations, mat);
        for (const c of m.claims ?? []) checkCitations(c.citations, `${mat} claim`);
        checkOpen(m, mat, errors, openItems);
        checkClaims(m, m, mat, errors);
      }
    }
  }

  for (const r of profile.rules ?? []) {
    if (r.pattern) { try { new RegExp(r.pattern, "giu"); } catch (err) { errors.push(`rules/${r.id}: invalid pattern (${err.message})`); } }
    checkCitations(r.citations, `rules/${r.id}`);
  }

  if (options.bundleDir) checkBundle(profile, options.bundleDir, errors);
  if ((profile.work ?? []).some((e) => (e.visibility ?? "public") === "public") && profile.meta.subjectConsent?.given !== true) {
    warnings.push("meta.subjectConsent.given is not true: get the subject's consent before publishing public entries");
  }

  return { valid: errors.length === 0, errors, warnings, openItems };
}

function checkOpen(item, at, errors, openItems) {
  if (item.status === "pending" || item.status === "disputed") {
    if (!item.openQuestion) errors.push(`${at}: status is ${item.status} but openQuestion is missing`);
    openItems.push({ id: at, status: item.status, question: item.openQuestion });
  }
}

// Claims: at most one accepted per field; the accepted value must equal the field's value;
// competing values with none accepted require status "disputed".
function checkClaims(item, root, at, errors) {
  const byField = new Map();
  for (const c of item.claims ?? []) {
    if (!byField.has(c.field)) byField.set(c.field, []);
    byField.get(c.field).push(c);
  }
  for (const [field, claims] of byField) {
    const accepted = claims.filter((c) => c.accepted);
    if (accepted.length > 1) { errors.push(`${at}: ${accepted.length} accepted claims for "${field}"`); continue; }
    const distinct = new Set(claims.map((c) => JSON.stringify(c.value)));
    if (accepted.length === 1) {
      const actual = getField(root, field);
      if (JSON.stringify(actual) !== JSON.stringify(accepted[0].value)) {
        errors.push(`${at}: "${field}" is ${JSON.stringify(actual)} but the accepted claim says ${JSON.stringify(accepted[0].value)}`);
      }
    } else if (distinct.size > 1 && item.status !== "disputed") {
      errors.push(`${at}: claims disagree on "${field}" and none is accepted, so status must be "disputed"`);
    }
  }
}

// Dotted path where "metrics.<id>" selects a metric by id.
export function getField(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    if (parts[i] === "metrics" && Array.isArray(cur.metrics) && parts[i + 1]) {
      cur = cur.metrics.find((m) => m.id === parts[i + 1]);
      i++;
    } else cur = cur[parts[i]];
  }
  return cur;
}

function checkBundle(profile, dir, errors) {
  const urls = [];
  if (profile.person.image) urls.push(["person.image", profile.person.image.url]);
  for (const m of profile.media ?? []) urls.push([`media/${m.id}`, m.url, m.sha256]);
  for (const [at, url, sha] of urls) {
    if (!url?.startsWith("bundle:")) continue;
    const file = join(dir, url.slice("bundle:".length));
    if (!existsSync(file)) { errors.push(`${at}: bundle file not found: ${url}`); continue; }
    if (sha) {
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (actual !== sha) errors.push(`${at}: sha256 mismatch for ${url}`);
    }
  }
}
