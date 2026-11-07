// Releases: build what one audience may receive, in a chosen format, with a consent receipt.

import { createHash, randomUUID } from "node:crypto";
import { convert } from "./convert.mjs";
import { resolveAudience, checkRequester } from "./audience.mjs";
import { SECTIONS } from "./validate.mjs";

const SCOPED = "audience"; // synthetic visibility given to everything the audience may see

const PERSON_GRANTS = {
  name: (src, dst) => { dst.name = src.name; },
  preferredName: (src, dst) => { keepNames(src, dst, ["preferred", "nickname"]); },
  legalName: (src, dst) => { keepNames(src, dst, ["legal"]); },
  pronouns: (src, dst) => { dst.pronouns = src.pronouns; },
  headline: (src, dst) => { dst.headline = src.headline; },
  jobTitle: (src, dst) => { dst.jobTitle = src.jobTitle; },
  shortBio: (src, dst) => { dst.shortBio = src.shortBio; },
  summary: (src, dst) => { dst.summary = src.summary; },
  image: (src, dst) => { dst.image = src.image; },
  location: (src, dst) => { dst.location = src.location; dst.industry = src.industry; },
  email: (src, dst) => { if (src.contact?.email) (dst.contact ??= {}), (dst.contact.email = src.contact.email), (dst.contact.emailVisibility = SCOPED); },
  phone: (src, dst) => { if (src.contact?.phone) (dst.contact ??= {}), (dst.contact.phone = src.contact.phone), (dst.contact.phoneVisibility = SCOPED); },
  website: (src, dst) => { if (src.contact?.website) (dst.contact ??= {}), (dst.contact.website = src.contact.website); },
  profiles: (src, dst) => { dst.profiles = (src.profiles ?? []).filter((p) => (p.visibility ?? "public") !== "private").map((p) => ({ ...p, visibility: SCOPED })); },
};
function keepNames(src, dst, types) {
  const picked = (src.names ?? []).filter((n) => types.includes(n.type)).map((n) => ({ ...n, visibility: SCOPED }));
  dst.names = [...(dst.names ?? []), ...picked];
}

/**
 * Build the profile view one audience may see. Everything granted is re-labelled with the
 * synthetic visibility "audience"; everything else is removed. The employer record of a job is
 * kept only on the work entry the audience is bound to.
 */
export function scopeProfile(profile, audienceId, { on, binding } = {}) {
  const resolved = resolveAudience(profile, audienceId, { on });
  if (!resolved.active) throw new Error(`Audience "${audienceId}" is not active: ${resolved.reason}`);
  const { audience } = resolved;
  const bound = binding ?? resolved.bindings[0];
  const base = audience.baseVisibility ?? ["public"];

  const person = {};
  for (const grant of audience.person ?? ["name"]) PERSON_GRANTS[grant]?.(profile.person, person);
  if (!person.name) person.name = profile.person.name; // a release always names its subject

  const scoped = {
    schemaVersion: profile.schemaVersion,
    meta: { defaultLocale: profile.meta.defaultLocale, locales: profile.meta.locales, updated: profile.meta.updated },
    person,
    organizations: profile.organizations,
    places: profile.places,
    sources: profile.sources,
    rules: profile.rules,
  };
  const released = [];
  for (const section of SECTIONS) {
    const sectionGranted = (audience.sections ?? []).includes(section);
    const items = [];
    for (const e of profile[section] ?? []) {
      const named = (e.audiences ?? []).includes(audienceId);
      const isBoundJob = section === "work" && bound?.work && e.id === bound.work.id;
      if (!named && !isBoundJob && !(sectionGranted && base.includes(e.visibility ?? "public"))) continue;
      if ((e.visibility ?? "public") === "private" && !named && !isBoundJob) continue;
      const copy = { ...e, visibility: SCOPED };
      if (section === "work" && !isBoundJob) delete copy.employerRecord;
      items.push(copy);
      released.push(e.id);
    }
    if (items.length) scoped[section] = items;
  }
  scoped._release = {
    audience: audienceId,
    work: bound?.work ? scoped.work?.find((w) => w.id === bound.work.id) : undefined,
    organization: bound?.organization,
  };
  return { scoped, audience, binding: bound, released };
}

/**
 * Build a release for an audience.
 * @param {object} profile
 * @param {string} audienceId
 * @param {object} mapping   any mapping (e.g. loadMapping("scim")); its include.visibility is replaced by the audience scope
 * @param {{ requester?: {domain: string, method: string, application?: string}, on?: string, now?: string, locale?: string }} [opts]
 * @returns {{ payload: any, text: string, receipt: object, record: object }}
 */
export function buildRelease(profile, audienceId, mapping, opts = {}) {
  let binding;
  if (opts.requester) {
    const check = checkRequester(profile, audienceId, opts.requester, { on: opts.on });
    if (!check.ok) throw new Error(`Release refused: ${check.reason}`);
    binding = check.binding;
  }
  const { scoped, audience, binding: bound, released } = scopeProfile(profile, audienceId, { on: opts.on, binding });
  const scopedMapping = { ...mapping, include: { ...DEFAULT_RELEASE_INCLUDE, ...mapping.include, visibility: [SCOPED] } };
  const { output, text } = convert(scoped, scopedMapping, { locale: opts.locale });
  const issued = opts.now ?? new Date().toISOString();
  const payloadSha256 = createHash("sha256").update(text).digest("hex");
  const org = bound?.organization;
  const record = {
    id: `release-${(opts.id ?? randomUUID()).toLowerCase()}`,
    audience: audienceId,
    workRef: bound?.work?.id,
    recipient: {
      organization: org?.id ?? textOf(org?.name),
      domain: opts.requester?.domain,
      application: opts.requester?.application,
      verifiedBy: opts.requester?.method,
    },
    purpose: audience.purpose,
    format: mapping.target,
    issued,
    expires: typeof audience.expires === "string" ? audience.expires : "onSeparation",
    person: audience.person ?? ["name"],
    sections: audience.sections ?? [],
    entries: released,
    payloadSha256,
    notice: "Stopping this release stops future updates. Copies already delivered stay with the recipient.",
  };
  return { payload: output, text, receipt: consentReceipt(profile, record, audience, org), record: strip(record) };
}

const DEFAULT_RELEASE_INCLUDE = { status: ["approved"], confidence: ["high", "medium"], minPriority: 0 };

/** A human-readable consent receipt, after the Kantara Consent Receipt and ISO/IEC 29184 notice ideas. */
export function consentReceipt(profile, record, audience, org) {
  return strip({
    receiptVersion: "turnrow-1",
    receiptId: record.id,
    issued: record.issued,
    subject: profile.person.name,
    recipient: { name: textOf(org?.name), ...record.recipient },
    purpose: { code: record.purpose, description: textOf(audience.purposeDescription) },
    shared: { person: record.person, sections: record.sections, entries: record.entries.length },
    expires: record.expires,
    payloadSha256: record.payloadSha256,
    notice: record.notice,
  });
}

const textOf = (v) => (v && typeof v === "object" ? Object.values(v)[0] : v);
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== null) o[k] = strip(x);
    return o;
  }
  return v;
}
