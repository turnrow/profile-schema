// Releases: build what one audience may receive, in a chosen format, with a consent receipt.

import { createHash, randomUUID } from "node:crypto";
import { convert } from "./convert.mjs";
import { resolveAudience, checkRequester } from "./audience.mjs";
import { SECTIONS } from "./validate.mjs";
import { withShownIdentifiers } from "./identifiers.mjs";

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
    meta: { defaultLocale: profile.meta.defaultLocale, locales: profile.meta.locales, updated: profile.meta.updated, mediaBaseUrl: profile.meta.mediaBaseUrl },
    person,
    rules: profile.rules,
  };
  const released = [];
  for (const section of SECTIONS) {
    const sectionGranted = (audience.sections ?? []).includes(section);
    const items = [];
    // Words written by someone else go only where their author agreed they could.
    const needsConsent = section === "recommendations" || section === "endorsements";
    for (const e of profile[section] ?? []) {
      if (needsConsent && e.consent?.given !== true) continue;
      const named = (e.audiences ?? []).includes(audienceId);
      const isBoundJob = section === "work" && bound?.work && e.id === bound.work.id;
      if (!named && !isBoundJob && !(sectionGranted && base.includes(e.visibility ?? "public"))) continue;
      if ((e.visibility ?? "public") === "private" && !named && !isBoundJob) continue;
      const copy = { ...e, visibility: SCOPED };
      if (needsConsent) limitToConsent(copy);
      if (section === "work" && !isBoundJob) delete copy.employerRecord;
      items.push(copy);
      released.push(e.id);
    }
    if (items.length) scoped[section] = items;
  }
  // Only the organizations, places and sources the released data refers to travel with it,
  // and a source's private location never does.
  const refs = collectRefs([scoped.person, ...SECTIONS.flatMap((sec) => scoped[sec] ?? [])], bound);
  // Organization history travels with the organizations it explains (it is public record):
  // parents and every organization linked through an event, transitively.
  const events = profile.organizationEvents ?? [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of [...refs.orgs]) {
      const linked = [
        ...(profile.organizations?.[id]?.parents ?? []).map((p) => p.organization),
        ...events.filter((e) => [e.organization, e.acquirer, e.target, ...(e.predecessors ?? []), ...(e.successors ?? [])].includes(id))
          .flatMap((e) => [e.organization, e.acquirer, e.target, ...(e.predecessors ?? []), ...(e.successors ?? [])]),
      ].filter(Boolean);
      for (const l of linked) if (!refs.orgs.has(l)) { refs.orgs.add(l); grew = true; }
    }
  }
  scoped.organizationEvents = events.filter((e) =>
    [e.organization, e.acquirer, e.target, ...(e.predecessors ?? []), ...(e.successors ?? [])].some((x) => x && refs.orgs.has(x)));
  for (const e of scoped.organizationEvents) for (const c of e.citations ?? []) refs.sources.add(c.source);
  // Identifiers travel only if the audience may see them (tax ids are private unless shared with it).
  scoped.organizations = Object.fromEntries(Object.entries(pick(profile.organizations, refs.orgs)).map(([id, o]) =>
    [id, relabel(withShownIdentifiers(o, { visibilities: base, audienceId }))]));
  for (const o of Object.values(scoped.organizations)) for (const l of o.locations ?? []) if (typeof l.place === "string") refs.places.add(l.place);
  scoped.places = pick(profile.places, refs.places);
  scoped.sources = Object.fromEntries(
    Object.entries(pick(profile.sources, refs.sources)).map(([id, src]) => {
      const { location, ...rest } = src;
      return [id, rest];
    })
  );
  // Other people travel only when a released item names them, and their contacts only with personContacts.
  const shareContacts = (audience.person ?? []).includes("personContacts");
  // An author who asked to be anonymous is not named: only their dated titles travel, so "Engineering Manager" can still be shown.
  const written = [...(scoped.recommendations ?? []), ...(scoped.endorsements ?? [])];
  const peopleRefs = new Set([
    ...written.filter((x) => x.consent?.scope !== "anonymous").map((x) => x.author),
    ...(scoped.references ?? []).map((r) => r.person),
  ].filter(Boolean));
  const unnamed = new Set(written.filter((x) => x.consent?.scope === "anonymous").map((x) => x.author).filter((id) => id && !peopleRefs.has(id)));
  const titlesOnly = Object.entries(pick(profile.people, unnamed)).map(([id, who]) =>
    [id, { roles: (who.roles ?? []).map(({ title, from, to }) => ({ title, from, to })) }]);
  const people = Object.entries(pick(profile.people, peopleRefs)).map(([id, who]) => {
    const { contacts, ...rest } = who;
    const shared = shareContacts ? (contacts ?? []).map((c) => ({ ...c, visibility: SCOPED })) : [];
    if (!shareContacts && rest.identifiers) rest.identifiers = rest.identifiers.filter((i) => i.scheme !== "email");
    return [id, shared.length ? { ...rest, contacts: shared } : rest];
  });
  if (people.length || titlesOnly.length) scoped.people = Object.fromEntries([...people, ...titlesOnly]);
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
 * @param {{ requester?: {domain: string, method: string, application?: string, name?: string}, on?: string, now?: string, locale?: string }} [opts]
 * @returns {{ payload: any, text: string, receipt: object, record: object }}
 * Refused unless the subject has consented (meta.subjectConsent.given): a release hands data to someone else.
 */
export function buildRelease(profile, audienceId, mapping, opts = {}) {
  if (profile.meta?.subjectConsent?.given !== true) {
    throw new ReleaseRefusedError("the subject has not given consent (meta.subjectConsent.given is not true)");
  }
  let binding;
  // An open audience has no fixed recipient, so who receives it must be named and verified.
  if (profile.audiences?.[audienceId]?.recipients === "anyVerified" && !opts.requester) {
    throw new ReleaseRefusedError("an anyVerified audience needs a verified, named requester");
  }
  if (opts.requester) {
    const check = checkRequester(profile, audienceId, opts.requester, { on: opts.on });
    if (!check.ok) throw new ReleaseRefusedError(check.reason);
    binding = check.binding;
  }
  const { scoped, audience, binding: bound, released } = scopeProfile(profile, audienceId, { on: opts.on, binding });
  const scopedMapping = { ...mapping, include: { ...DEFAULT_RELEASE_INCLUDE, ...mapping.include, visibility: [SCOPED] } };
  const { output, text } = convert(scoped, scopedMapping, { locale: opts.locale, on: opts.on });
  const issued = opts.now ?? new Date().toISOString();
  const payloadSha256 = createHash("sha256").update(text).digest("hex");
  const org = bound?.organization;
  const record = {
    id: `release-${(opts.id ?? randomUUID()).toLowerCase()}`,
    audience: audienceId,
    workRef: bound?.work?.id,
    recipient: {
      organization: org?.id ?? textOf(org?.name),
      name: org?.id ? undefined : opts.requester?.name,
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

// Someone else's words, cut down to what they agreed to (consent.scope), so that a mapping can't print more:
// highlights: no full text; nameOnly: no words; anonymous: nothing that names them or where they worked.
function limitToConsent(item) {
  const scope = item.consent?.scope ?? "full";
  if (scope === "highlights" || scope === "nameOnly") delete item.text;
  if (scope === "nameOnly") delete item.highlights;
  if (scope === "anonymous") {
    if (item.authorAt) item.authorAt = item.authorAt.title ? { title: item.authorAt.title } : undefined;
    delete item.source;
    delete item.credential;
  }
}

export class ReleaseRefusedError extends Error {
  constructor(reason) { super(`Release refused: ${reason}`); this.name = "ReleaseRefusedError"; this.reason = reason; }
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

const ORG_KEYS = ["organization", "client", "institution", "issuer", "awarder", "publisher", "employerOfRecord"];
function collectRefs(items, bound) {
  const refs = { orgs: new Set(), places: new Set(), sources: new Set() };
  if (bound?.organization?.id) refs.orgs.add(bound.organization.id);
  const walk = (v, key) => {
    if (typeof v === "string") {
      if (ORG_KEYS.includes(key)) refs.orgs.add(v);
      else if (key === "location" || key === "place" || key === "places") refs.places.add(v);
      else if (key === "source") refs.sources.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  items.forEach((i) => walk(i));
  return refs;
}
// Identifiers kept for an audience are re-labelled like every other released item.
const relabel = (o) => (o.identifiers ? { ...o, identifiers: o.identifiers.map((i) => ({ ...i, visibility: SCOPED })) } : o);
const pick = (map, ids) => Object.fromEntries(Object.entries(map ?? {}).filter(([id]) => ids.has(id)));

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
