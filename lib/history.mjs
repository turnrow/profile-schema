// Organization history and role structure: which name an organization had on a date, which
// domains were live, who it became, and how a job's positions and responsibilities line up.

const lower = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);
const upper = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[1]);
const today = () => new Date().toISOString().slice(0, 10);

/** Compare partial ISO dates at the coarser of the two precisions: "2008" vs "2008-08-26" → equal. */
export function cmpDate(a, b) {
  const n = Math.min(a.length, b.length);
  const x = a.slice(0, n), y = b.slice(0, n);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Is a dated item ({from, to}) in force on a date? Open ends count as in force. */
export function inForce(item, on = today()) {
  const from = lower(item.from), to = upper(item.to);
  if (from && cmpDate(from, on) > 0) return false;
  if (to && cmpDate(to, on) < 0) return false;
  return true;
}

export function orgById(profile, ref) {
  if (ref == null) return undefined;
  if (typeof ref === "string") return profile.organizations?.[ref] ? { id: ref, ...profile.organizations[ref] } : undefined;
  return ref;
}

const NAME_ORDER = { brand: 0, tradeName: 1, abbreviation: 2, legal: 3, localized: 4 };

/**
 * The organization's name on a date. `types` restricts and orders the name types to consider
 * (default: brand, then trade name, abbreviation, legal). Falls back to the display name.
 */
export function nameAt(org, on, types) {
  if (!org) return undefined;
  const order = types ?? ["brand", "tradeName", "abbreviation", "legal"];
  const candidates = (org.names ?? [])
    .filter((n) => order.includes(n.type) && (on ? inForce(n, on) : !n.to))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (NAME_ORDER[a.type] ?? 9) - (NAME_ORDER[b.type] ?? 9));
  return candidates[0]?.name ?? (types && !types.includes("brand") ? undefined : org.name);
}

/** Every distinct name the organization has used (for search and JSON-LD alternateName). */
export function allNames(org) {
  if (!org) return [];
  const seen = new Set();
  const out = [];
  for (const n of [{ name: org.name }, ...(org.names ?? [])]) {
    const key = typeof n.name === "string" ? n.name : JSON.stringify(n.name);
    if (!seen.has(key)) { seen.add(key); out.push(n.name); }
  }
  return out;
}

/** Domains valid on a date. Retired domains never count, whatever their dates. */
export function activeDomains(org, on = today()) {
  return (org?.domains ?? [])
    .map((d) => (typeof d === "string" ? { domain: d } : d))
    .filter((d) => d.status !== "retired" && inForce(d, on))
    .map((d) => d.domain);
}

/** Parents in force on a date, nearest first, following each parent's own parents. */
export function ancestorsAt(profile, orgId, on = today(), seen = new Set()) {
  const org = orgById(profile, orgId);
  const out = [];
  for (const p of org?.parents ?? []) {
    if (!inForce(p, on) || seen.has(p.organization)) continue;
    seen.add(p.organization);
    out.push(p.organization, ...ancestorsAt(profile, p.organization, on, seen));
  }
  return out;
}

const eventInvolves = (e, id) =>
  e.organization === id || e.acquirer === id || e.target === id ||
  (e.predecessors ?? []).includes(id) || (e.successors ?? []).includes(id);

/** Events involving an organization, oldest first, optionally limited to a date range. */
export function eventsFor(profile, orgId, { from, to } = {}) {
  return (profile.organizationEvents ?? [])
    .filter((e) => eventInvolves(e, orgId) && e.status !== "retired")
    .filter((e) => (!from || cmpDate(lower(e.date), from) >= 0) && (!to || cmpDate(lower(e.date), to) <= 0))
    .sort((a, b) => cmpDate(lower(a.date), lower(b.date)));
}

/**
 * Where an organization ended up by a date: follow mergers, splits and dissolutions forward.
 * For a split with several successors, recordsTo decides; without it the chain stops there.
 * @returns {string[]} the organization ids that carry it on (the input id if nothing happened)
 */
export function successorsAt(profile, orgId, on = today(), seen = new Set([orgId])) {
  const next = (profile.organizationEvents ?? [])
    .filter((e) => e.status !== "retired" && (e.predecessors ?? []).includes(orgId) && cmpDate(lower(e.date), on) <= 0)
    .filter((e) => !(e.successors ?? []).includes(orgId))
    .sort((a, b) => cmpDate(lower(a.date), lower(b.date)))[0];
  if (!next) return [orgId];
  const heirs = next.recordsTo ? [next.recordsTo] : next.successors ?? [];
  if (heirs.length !== 1) return heirs.length ? heirs : [orgId];
  if (seen.has(heirs[0])) return [heirs[0]];
  seen.add(heirs[0]);
  return successorsAt(profile, heirs[0], on, seen);
}

/** Who records about this organization sit with now: successors, then the successors' parents. */
export function recordHolders(profile, orgId, on = today()) {
  const out = new Set();
  for (const s of successorsAt(profile, orgId, on)) {
    out.add(s);
    for (const a of ancestorsAt(profile, s, on)) out.add(a);
  }
  return [...out];
}

/** Every organization that may speak for orgId on a date: itself, its parents, and what it became. */
export function relatedOrgs(profile, orgId, on = today()) {
  const out = new Set([orgId, ...ancestorsAt(profile, orgId, on)]);
  for (const r of recordHolders(profile, orgId, on)) out.add(r);
  return [...out];
}

// ---------- positions and responsibilities ----------

const overlaps = (aStart, aEnd, bStart, bEnd) =>
  !(aEnd && bStart && cmpDate(aEnd, bStart) < 0) && !(bEnd && aStart && cmpDate(bEnd, aStart) < 0);

/**
 * Positions of a job in date order, each with the responsibilities that applied to it.
 * A responsibility already held in an earlier position is marked `continuing`.
 * A job without positions is treated as a single position with the job's title and dates.
 */
export function positionsOf(work) {
  const positions = (work.positions?.length ? work.positions : [{
    id: `${work.id}-role`, title: work.title, startDate: work.startDate, endDate: work.endDate, current: work.current, implicit: true,
  }]).slice().sort((a, b) => cmpDate(lower(a.startDate) ?? "0000", lower(b.startDate) ?? "0000"));

  const seen = new Set();
  return positions.map((p, i) => {
    const pStart = lower(p.startDate) ?? (i === 0 ? lower(work.startDate) : undefined);
    const nextStart = lower(positions[i + 1]?.startDate);
    const pEnd = p.current ? undefined : upper(p.endDate) ?? nextStart ?? (work.current ? undefined : upper(work.endDate));
    const resp = (work.responsibilities ?? []).filter((r) => {
      if (r.positions?.length) return p.implicit || r.positions.includes(p.id);
      if (!r.startDate && !r.endDate) return true;
      return overlaps(lower(r.startDate), r.current ? undefined : upper(r.endDate), pStart, pEnd);
    }).map((r) => {
      const continuing = seen.has(r.id);
      seen.add(r.id);
      return { ...r, continuing };
    });
    return {
      ...p,
      startDate: p.startDate ?? (i === 0 ? work.startDate : undefined),
      endDate: p.endDate ?? (p.current ? undefined : pEnd),
      responsibilities: resp, index: i, count: positions.length,
    };
  });
}
