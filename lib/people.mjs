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
