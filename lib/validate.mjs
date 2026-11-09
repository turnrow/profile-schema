// Turnrow Profile validator: JSON Schema validation plus the checks a schema cannot express
// (cross-references, claim consistency, open questions, consent, bundle files, rule syntax).

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { leiValid, normalizeId, visibilityOf } from "./identifiers.mjs";
import { checkCode, socOf } from "./codes.mjs";

const schema = JSON.parse(readFileSync(new URL("../schema/profile.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemaCheck = ajv.compile(schema);

export const SECTIONS = [
  "work", "service", "education", "credentials", "awards", "projects", "publications",
  "timeline", "media", "skills", "languages", "interests", "references",
];
const ORG_FIELDS = ["organization", "client", "institution", "issuer", "awarder", "publisher", "employerOfRecord"];

/**
 * @param {object} profile
 * @param {{ bundleDir?: string }} [options]  bundleDir: folder that 'bundle:' URLs resolve against
 * @returns {{ valid: boolean, errors: string[], warnings: string[], openItems: {id: string, status: string, question?: string}[] }}
 *   openItems: pending and disputed items, plus approved items that still carry an openQuestion (status "question").
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
  const v25 = versionAtLeast(profile.schemaVersion, "2.5.0");
  const codeCheck = (system, entry, at) => {
    const r = checkCode(system, entry, at);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  };
  const checkOccupations = (list, at) => {
    for (const c of list ?? []) {
      if (c.system === "soc" || c.system === "onetSoc") codeCheck(c.system, c, `${at} › ${c.system} ${c.code}`);
      checkCitations(c.citations, `${at} › ${c.system} ${c.code}`);
    }
    for (const sys of new Set((list ?? []).map((c) => c.system))) {
      const primaries = (list ?? []).filter((c) => c.system === sys && (c.match ?? "primary") === "primary");
      if (primaries.length > 1) warnings.push(`${at}: ${primaries.length} primary ${sys} codes; mark the others secondary or related`);
    }
    const soc = (list ?? []).find((c) => c.system === "soc" && (c.match ?? "primary") === "primary");
    const onet = (list ?? []).find((c) => c.system === "onetSoc" && (c.match ?? "primary") === "primary");
    if (soc && onet && socOf(onet.code) !== soc.code) warnings.push(`${at}: primary O*NET-SOC ${onet.code} is not under primary SOC ${soc.code}`);
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
      checkClaims(e, e, at, errors, profile.meta.defaultLocale);
      if (e.lock && e.status !== "approved") warnings.push(`${at}: locked but status is "${e.status ?? "draft"}"`);
      // Your own account can be complete and true, but it can't be high confidence on its own.
      if (e.confidence === "high" && e.citations?.length && qualities(e.citations).every((q) => q === "selfReported" || q === "hearsay")) {
        (v25 ? errors : warnings).push(`${at}: confidence is high but every citation is self-reported or hearsay; use medium, or cite a primary, published or secondary source`);
      }
      checkOccupations(e.occupations, at);
      for (const c of e.codes ?? []) if (c.system === "onet") codeCheck("onet", c, `${at} › onet ${c.code}`);
      if (s === "timeline" && e.type === "careerBreak" && e.reason === "health" && (e.visibility ?? "public") !== "private") {
        warnings.push(`${at}: a career break for health reasons is ${e.visibility ?? "public"}; keep it private, or give the reason as "personal"`);
      }
      if (s === "credentials" && e.kind === "clearance" && (e.visibility ?? "public") === "public") {
        warnings.push(`${at}: a security clearance is public; share it with named audiences instead`);
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
        checkClaims(m, m, mat, errors, profile.meta.defaultLocale);
      }
    }
  }

  // ---------- identifiers ----------
  const seenIds = new Map();
  for (const [id, org] of Object.entries(profile.organizations ?? {})) {
    for (const ident of org.identifiers ?? []) {
      const at = `organizations/${id} › ${ident.scheme} ${ident.value}`;
      if (ident.scheme === "lei" && !leiValid(ident.value)) errors.push(`${at}: LEI check digits are wrong`);
      for (const a of ident.audiences ?? []) if (!(profile.audiences ?? {})[a]) errors.push(`${at}: unknown audience "${a}"`);
      if (ident.scheme === "ein" && visibilityOf(ident) === "public") warnings.push(`${at}: an EIN is public; for a sole proprietor it identifies a person, so share it with named audiences instead`);
      const key = `${ident.scheme}|${ident.jurisdiction ?? ""}|${normalizeId(ident.scheme, ident.value)}`;
      if (seenIds.has(key) && seenIds.get(key) !== id) {
        warnings.push(`${at}: the same identifier is on organizations "${seenIds.get(key)}" and "${id}"; if they are one entity, merge them and use names and events for the change`);
      }
      seenIds.set(key, id);
    }
  }

  // ---------- organization history ----------
  for (const [id, org] of Object.entries(profile.organizations ?? {})) {
    const at = `organizations/${id}`;
    for (const par of org.parents ?? []) {
      if (!orgs.has(par.organization)) errors.push(`${at}: unknown parent organization "${par.organization}"`);
      if (par.organization === id) errors.push(`${at}: an organization cannot be its own parent`);
    }
    for (const l of org.locations ?? []) checkPlace(l.place, `${at}.locations`);
    for (const c of org.classifications ?? []) if (c.system === "naics") codeCheck("naics", c, `${at} › naics ${c.code}`);
  }
  for (const e of profile.organizationEvents ?? []) {
    const at = `organizationEvents/${e.id}`;
    if (byId.has(e.id)) errors.push(`${at}: duplicate id (also in ${byId.get(e.id).section})`);
    byId.set(e.id, { section: "organizationEvents", entry: e });
    const refs = [e.organization, e.acquirer, e.target, e.recordsTo, ...(e.predecessors ?? []), ...(e.successors ?? [])].filter(Boolean);
    for (const r of refs) if (!orgs.has(r)) errors.push(`${at}: unknown organization "${r}"`);
    if (e.recordsTo && !(e.successors ?? []).includes(e.recordsTo)) errors.push(`${at}: recordsTo must be one of the successors`);
    const needs = {
      merger: ["predecessors", "successors"], split: ["predecessors", "successors"], acquisition: ["acquirer", "target"],
      spinOff: ["target"], splitOff: ["target"], divisionTransfer: ["target", "acquirer"],
      rename: ["organization", "name"], rebrand: ["organization", "name"], tradeName: ["organization", "name"],
      reincorporation: ["organization"], dissolution: ["organization"],
    }[e.type] ?? [];
    for (const f of needs) if (e[f] == null || (Array.isArray(e[f]) && !e[f].length)) errors.push(`${at}: a ${e.type} needs ${f}`);
    if (e.type === "split" && (e.successors ?? []).length > 1 && !e.recordsTo) warnings.push(`${at}: split without recordsTo, so nobody can be found to verify past employment`);
    checkCitations(e.citations, at);
    checkOpen(e, at, errors, openItems);
  }

  // ---------- positions and responsibilities ----------
  for (const w of profile.work ?? []) {
    const at = `work/${w.id}`;
    const posIds = new Set();
    for (const p of w.positions ?? []) {
      if (posIds.has(p.id) || byId.has(p.id)) errors.push(`${at} › position ${p.id}: duplicate id`);
      posIds.add(p.id);
      checkPlace(p.location, `${at} › position ${p.id}.location`);
      checkCitations(p.citations, `${at} › position ${p.id}`);
      checkOpen(p, `${at} › position ${p.id}`, errors, openItems);
      checkOccupations(p.occupations, `${at} › position ${p.id}`);
    }
    const sorted = [...(w.positions ?? [])].sort((a, b) => String(lowerOf(a.startDate) ?? "").localeCompare(String(lowerOf(b.startDate) ?? "")));
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = lowerOf(sorted[i - 1].endDate), start = lowerOf(sorted[i].startDate);
      if (prevEnd && start && prevEnd > start && !sorted[i - 1].current) warnings.push(`${at}: positions ${sorted[i - 1].id} and ${sorted[i].id} overlap`);
    }
    const respIds = new Set();
    for (const r of w.responsibilities ?? []) {
      const rat = `${at} › responsibility ${r.id}`;
      if (respIds.has(r.id) || posIds.has(r.id) || byId.has(r.id)) errors.push(`${rat}: duplicate id`);
      respIds.add(r.id);
      for (const pid of r.positions ?? []) if (!posIds.has(pid)) errors.push(`${rat}: unknown position "${pid}"`);
      for (const x of r.skills ?? []) if (!skillIds.has(x)) errors.push(`${rat}: unknown skill "${x}"`);
      checkCitations(r.citations, rat);
      for (const c of r.claims ?? []) checkCitations(c.citations, `${rat} claim on ${c.field}`);
      checkOpen(r, rat, errors, openItems);
      checkClaims(r, r, rat, errors, profile.meta.defaultLocale);
      checkOccupations(r.occupations, rat);
      for (const m of [...(r.scope ?? []), ...(r.metrics ?? [])]) {
        checkCitations(m.citations, `${rat} › metric ${m.id}`);
        checkOpen(m, `${rat} › metric ${m.id}`, errors, openItems);
      }
    }
  }

  const audiences = profile.audiences ?? {};
  for (const [id, a] of Object.entries(audiences)) {
    const at = `audiences/${id}`;
    if (["public", "network", "private"].includes(id)) errors.push(`${at}: "${id}" is a built-in audience and cannot be redefined`);
    if (typeof a.organization === "string" && !orgs.has(a.organization)) errors.push(`${at}: unknown organization "${a.organization}"`);
    for (const o of a.organizations ?? []) if (typeof o === "string" && !orgs.has(o)) errors.push(`${at}: unknown organization "${o}"`);
    if (a.recipients === "anyVerified") {
      if ((a.verification?.methods ?? []).includes("emailDomain")) errors.push(`${at}: an anyVerified audience cannot accept emailDomain (anyone has an email address somewhere)`);
      if (a.organization || a.organizations || a.relation || a.workRef) warnings.push(`${at}: recipients is anyVerified, so the listed organizations and relation are ignored`);
    }
    if (a.workRef && byId.get(a.workRef)?.section !== "work") errors.push(`${at}: workRef "${a.workRef}" is not a work entry`);
    if ((a.verification?.writeBackMethods ?? []).includes("emailDomain")) errors.push(`${at}: emailDomain can never authorize write-back`);
    if (a.writeBack?.allowed && a.kind !== "employer" && a.kind !== "client") warnings.push(`${at}: write-back is allowed for a ${a.kind} audience`);
  }
  for (const s of SECTIONS) for (const e of profile[s] ?? []) {
    for (const a of e.audiences ?? []) if (!audiences[a]) errors.push(`${s}/${e.id}: unknown audience "${a}"`);
    if (e.employerRecord && s !== "work") errors.push(`${s}/${e.id}: employerRecord is only allowed on work entries`);
  }
  const releaseIds = new Set();
  for (const r of profile.releases ?? []) {
    const at = `releases/${r.id}`;
    if (releaseIds.has(r.id)) errors.push(`${at}: duplicate release id`);
    releaseIds.add(r.id);
    if (!audiences[r.audience]) errors.push(`${at}: unknown audience "${r.audience}"`);
    if (r.workRef && byId.get(r.workRef)?.section !== "work") errors.push(`${at}: workRef "${r.workRef}" is not a work entry`);
    for (const id of r.entries ?? []) if (!byId.has(id)) warnings.push(`${at}: released entry "${id}" no longer exists`);
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

const lowerOf = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);

function checkOpen(item, at, errors, openItems) {
  if (item.status === "pending" || item.status === "disputed") {
    if (!item.openQuestion) errors.push(`${at}: status is ${item.status} but openQuestion is missing`);
    openItems.push({ id: at, status: item.status, question: item.openQuestion });
  } else if (item.openQuestion && item.status !== "retired") {
    // Approved and shown, but something about it is still to be asked.
    openItems.push({ id: at, status: "question", question: item.openQuestion });
  }
}

/** Compare dotted versions: is a at least b? */
export function versionAtLeast(a, b) {
  const pa = String(a ?? "0").split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
}

// Claims: at most one accepted per field; the accepted value must equal the field's value;
// competing values with none accepted require status "disputed".
// A translated field matches a plain-string claim on its default-language text.
function comparable(actual, claimValue, defaultLocale) {
  if (typeof claimValue === "string" && actual && typeof actual === "object" && !Array.isArray(actual)) {
    return actual[defaultLocale] ?? actual[defaultLocale?.split("-")[0]] ?? Object.values(actual)[0];
  }
  return actual;
}

function checkClaims(item, root, at, errors, defaultLocale) {
  const byField = new Map();
  for (const c of item.claims ?? []) {
    if (!byField.has(c.field)) byField.set(c.field, []);
    byField.get(c.field).push(c);
  }
  for (const [field, claims] of byField) {
    const accepted = claims.filter((c) => c.accepted);
    if (accepted.length > 1) { errors.push(`${at}: ${accepted.length} accepted claims for "${field}"`); continue; }
    const distinct = new Set(claims.map((c) => canonical(c.value)));
    if (accepted.length === 1) {
      const actual = comparable(getField(root, field), accepted[0].value, defaultLocale);
      if (canonical(actual) !== canonical(accepted[0].value)) {
        errors.push(`${at}: "${field}" is ${canonical(actual)} but the accepted claim says ${canonical(accepted[0].value)}`);
      }
    } else if (distinct.size > 1 && item.status !== "disputed") {
      errors.push(`${at}: claims disagree on "${field}" and none is accepted, so status must be "disputed"`);
    }
  }
}

// JSON with object keys sorted, so equal values compare equal whatever their key order.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
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
    const root = resolve(dir);
    const file = resolve(root, url.slice("bundle:".length));
    if (!file.startsWith(root + sep)) { errors.push(`${at}: bundle path escapes the bundle folder: ${url}`); continue; }
    if (!existsSync(file)) { errors.push(`${at}: bundle file not found: ${url}`); continue; }
    // Follow symbolic links before deciding: a link inside the bundle may point anywhere on disk.
    if (!realpathSync(file).startsWith(realpathSync(root) + sep)) { errors.push(`${at}: bundle file links outside the bundle folder: ${url}`); continue; }
    if (sha) {
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (actual !== sha) errors.push(`${at}: sha256 mismatch for ${url}`);
    }
  }
}
