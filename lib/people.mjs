// Other people: recommenders, endorsers, references, managers. Their names, roles, contacts and
// images change over time, so every fact is dated, and lookups take a date.

const lower = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);
const inForce = (row, on) => {
  const from = lower(row.from), to = lower(row.to);
  return (!from || from <= on.slice(0, from.length) || from <= on) && (!to || on.slice(0, to.length) <= to);
};

/** The name a person went by on a date (dated names first, then the display name). */
export function nameAt(person, on) {
  if (!person) return undefined;
  const dated = (person.names ?? []).filter((n) => (n.from || n.to) && inForce(n, on));
  return dated.at(-1)?.full ?? person.name;
}

/** The role in force on a date: { title, organization } (organization is an id or inline object). */
export function roleAt(person, on) {
  const r = (person?.roles ?? []).filter((x) => inForce(x, on)).at(-1);
  return r ? { title: r.title, organization: r.organization } : undefined;
}

/** The newest image (by asOf), or undefined. */
export function currentImage(person) {
  return [...(person?.images ?? [])].sort((a, b) => String(lower(a.asOf) ?? "").localeCompare(String(lower(b.asOf) ?? ""))).at(-1);
}

/** Cross-reference and privacy checks for the people registry. */
export function checkPeople(profile, errors, warnings) {
  const orgs = new Set(Object.keys(profile.organizations ?? {}));
  for (const [id, person] of Object.entries(profile.people ?? {})) {
    const at = `people/${id}`;
    for (const [i, r] of (person.roles ?? []).entries()) {
      if (typeof r.organization === "string" && !orgs.has(r.organization)) errors.push(`${at}.roles[${i}]: unknown organization "${r.organization}"`);
    }
    for (const [i, c] of (person.contacts ?? []).entries()) {
      if ((c.visibility ?? "private") !== "private") warnings.push(`${at}.contacts[${i}] is ${c.visibility}: it is someone else's contact detail; keep it private and share it with an audience through the personContacts grant`);
    }
  }
}

/** Is this people id defined? */
export const personExists = (profile, id) => typeof id === "string" && !!(profile.people ?? {})[id];

// ---------- recommendations and endorsements ----------

const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * Is `highlight` a verbatim part of `body`? Whitespace runs and Unicode normalization are ignored;
 * wording, punctuation and quote style are not. When it isn't, `at` is the index (in the normalized
 * highlight) of the first character that no longer matches anywhere in the body.
 * @returns {{ ok: boolean, at?: number }}
 */
export function verbatim(highlight, body) {
  const h = norm(highlight), b = norm(body);
  if (b.includes(h)) return { ok: true };
  let lo = 0, hi = h.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b.includes(h.slice(0, mid))) lo = mid; else hi = mid - 1; }
  return { ok: false, at: lo };
}

const textOf = (v, locale) => (v && typeof v === "object" ? v[locale] ?? Object.values(v)[0] : v);

/** Checks for recommendations[] (and endorsements[] when present). */
export function checkRecommendations(profile, { errors, warnings, v26, workIds, serviceIds, mediaIds, orgName }) {
  const strict = v26 ? errors : warnings;
  for (const r of profile.recommendations ?? []) {
    const at = `recommendations/${r.id}`;
    if (!personExists(profile, r.author)) errors.push(`${at}: unknown person "${r.author}"`);
    if (r.relationship?.work && !workIds.has(r.relationship.work)) errors.push(`${at}: relationship.work "${r.relationship.work}" is not a work entry`);
    if (r.relationship?.service && !serviceIds.has(r.relationship.service)) errors.push(`${at}: relationship.service "${r.relationship.service}" is not a service entry`);
    if (r.source?.capture && !mediaIds.has(r.source.capture)) errors.push(`${at} › source.capture: unknown media "${r.source.capture}"`);
    const body = textOf(r.text, profile.meta.defaultLocale);
    for (const h of r.highlights ?? []) {
      const v = verbatim(textOf(h.text, profile.meta.defaultLocale), body);
      if (!v.ok) errors.push(`${at} › highlight ${h.id}: not verbatim from the text (differs at character ${v.at + 1}: "${norm(textOf(h.text, profile.meta.defaultLocale)).slice(v.at, v.at + 24)}…")`);
    }
    checkConsent(r, at, strict);
    const who = profile.people?.[r.author];
    const day = String(r.date).slice(0, 10);
    const then = roleAt(who, day);
    if (who && then && r.authorAt) {
      const titleDiffers = r.authorAt.title && r.authorAt.title !== then.title;
      const orgDiffers = r.authorAt.organization && r.authorAt.organization !== then.organization;
      if (titleDiffers || orgDiffers) {
        warnings.push(`${at}: authorAt says "${r.authorAt.title ?? then.title}" at ${orgName(r.authorAt.organization ?? then.organization)}, but people/${r.author} was "${then.title}" at ${orgName(then.organization)} on ${day}; correct one of them`);
      }
    }
  }
}

/** Public or network items written by someone else need that person's recorded consent. */
export function checkConsent(item, at, findings) {
  const vis = item.visibility ?? "public";
  if (vis !== "private" && item.consent?.given !== true) {
    findings.push(`${at}: ${vis}, but the author's consent is not recorded (consent.given); make it private until they agree`);
  }
}

/** Endorsements that may be counted: approved, and consented (or private-but-counted never). */
export function endorsementCount(profile, targetId) {
  return (profile.endorsements ?? []).filter((e) => e.target === targetId && (e.status ?? "draft") === "approved" && e.consent?.given === true).length;
}

export function checkEndorsements(profile, { errors, warnings, v26, workIds, serviceIds, targetIds }) {
  const strict = v26 ? errors : warnings;
  for (const e of profile.endorsements ?? []) {
    const at = `endorsements/${e.id}`;
    if (!personExists(profile, e.author)) errors.push(`${at}: unknown person "${e.author}"`);
    if (!targetIds.has(e.target)) errors.push(`${at}: target "${e.target}" is not a skill, credential or badge`);
    if (e.relationship?.work && !workIds.has(e.relationship.work)) errors.push(`${at}: relationship.work "${e.relationship.work}" is not a work entry`);
    if (e.relationship?.service && !serviceIds.has(e.relationship.service)) errors.push(`${at}: relationship.service "${e.relationship.service}" is not a service entry`);
    checkConsent(e, at, strict);
  }
}
