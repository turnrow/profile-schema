// The time-based org chart: an organization file of posts (seats), who holds each and who each
// reports to, all dated. Design: docs/superpowers/specs/2026-11-10-org-chart-design.md.
//
// Whether a post is filled, vacant, planned or closed on a day is worked out here from its dates;
// it is never stored, so the file can't contradict itself.

import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMA = JSON.parse(readFileSync(new URL("../../schema/organization.schema.json", import.meta.url), "utf8"));
let compiled;
const schemaCheck = () => (compiled ??= addFormats(new Ajv2020({ allErrors: true, strict: false })).compile(SCHEMA));

// A date may be a year, a month or a day. "from" counts from its first day, "to" through its last.
const first = (d) => (d == null ? "0000-00-00" : d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d);
const last = (d) => (d == null ? "9999-12-31" : d.length === 4 ? `${d}-12-31` : d.length === 7 ? `${d}-31` : d);
/** Is something with these dates in effect on a day (yyyy-mm-dd)? */
export const inEffect = (x, on) => first(x?.from) <= on && on <= last(x?.to);
const overlap = (a, b) => first(a.from) <= last(b.to) && first(b.from) <= last(a.to);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Check an organization file: the schema, then what a schema can't say.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateOrganization(org) {
  const errors = [], warnings = [];
  const check = schemaCheck();
  if (!check(org)) {
    for (const e of check.errors) errors.push(`${e.instancePath || "/"} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ""}`);
    return { valid: false, errors, warnings };
  }
  const units = org.units ?? {}, people = org.people ?? {}, sources = org.sources ?? {};
  const posts = new Map();
  const src = (id, at) => { if (!sources[id]) errors.push(`${at}: source "${id}" is not in sources`); };
  const span = (x, at) => { if (x.from && x.to && first(x.from) > last(x.to)) errors.push(`${at}: it ends (${x.to}) before it starts (${x.from})`); };

  for (const [id, u] of Object.entries(units)) {
    span(u, `units.${id}`);
    if (u.source) src(u.source, `units.${id}`);
    if (u.parent && !units[u.parent]) errors.push(`units.${id}: parent "${u.parent}" is not a unit`);
    else if (u.parent && (first(u.from) < first(units[u.parent].from) || last(u.to) > last(units[u.parent].to))) errors.push(`units.${id}: it exists outside the dates of its parent "${u.parent}"`);
    for (let p = u.parent, seen = new Set([id]); p && units[p]; p = units[p].parent) { if (seen.has(p)) { errors.push(`units.${id}: its parents form a loop`); break; } seen.add(p); }
  }
  for (const [i, p] of (org.posts ?? []).entries()) {
    const at = `posts[${i}] (${p.id})`;
    if (posts.has(p.id)) errors.push(`${at}: the id "${p.id}" is used twice`);
    posts.set(p.id, p);
    span(p, at);
    src(p.source, at);
    if (p.unit && !units[p.unit]) errors.push(`${at}: unit "${p.unit}" is not in units`);
    if (p.succeeds && !(org.posts ?? []).some((x) => x.id === p.succeeds)) errors.push(`${at}: it succeeds "${p.succeeds}", which is not a post`);
  }
  for (const p of posts.values()) {
    const at = `post ${p.id}`;
    const holders = p.holders ?? [], lines = p.reportsTo ?? [];
    holders.forEach((h, i) => {
      span(h, `${at}, holder ${i + 1}`);
      src(h.source, `${at}, holder ${i + 1}`);
      if (h.person && !people[h.person]) errors.push(`${at}: holder "${h.person}" is not in people`);
      if (first(h.from) < first(p.from) || last(h.to) > last(p.to)) errors.push(`${at}: holder ${h.person ?? i + 1} holds it outside the dates the post exists`);
    });
    // Two half-time holders can share a seat; more than one full seat's worth at once can't.
    for (const h of holders) {
      const day = first(h.from) > first(p.from) ? first(h.from) : first(p.from);
      const fte = holders.filter((x) => inEffect(x, day)).reduce((n, x) => n + (x.fte ?? 1), 0);
      if (fte > 1 + 1e-9) { errors.push(`${at}: on ${day} its holders add up to ${fte} of one seat`); break; }
    }
    lines.forEach((l, i) => {
      span(l, `${at}, reporting line ${i + 1}`);
      src(l.source, `${at}, reporting line ${i + 1}`);
      if (!posts.has(l.post)) errors.push(`${at}: it reports to "${l.post}", which is not a post`);
      if (l.post === p.id) errors.push(`${at}: it reports to itself`);
    });
    const line = lines.filter((l) => (l.kind ?? "line") === "line");
    for (let a = 0; a < line.length; a++) for (let b = a + 1; b < line.length; b++) {
      if (overlap(line[a], line[b])) errors.push(`${at}: it has two line managers at once (${line[a].post} and ${line[b].post}); make one a dotted line, or date them`);
    }
    if (p.vacancy && !p.vacancy.status) warnings.push(`${at}: its vacancy has no status`);
  }
  // No loop of line managers on any day a line starts.
  if (!errors.length) {
    const days = new Set([today()]);
    for (const p of posts.values()) for (const l of p.reportsTo ?? []) days.add(first(l.from) === "0000-00-00" ? first(p.from) : first(l.from));
    days.delete("0000-00-00");
    outer: for (const day of days) {
      for (const p of posts.values()) {
        const seen = new Set([p.id]);
        for (let m = managerOn(p, day); m; m = managerOn(posts.get(m), day)) {
          if (seen.has(m)) { errors.push(`on ${day} the reporting lines form a loop through ${m}`); break outer; }
          seen.add(m);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

const managerOn = (post, on) => (post?.reportsTo ?? []).find((l) => (l.kind ?? "line") === "line" && inEffect(l, on))?.post;

/**
 * The organization as it is (or is planned to be) on one day.
 * @param {object} org  a valid organization file
 * @param {{ on?: string, budget?: boolean, planned?: boolean }} [options]
 *   on: yyyy-mm-dd (default today); budget: include the seats' budget figures (default no);
 *   planned: include posts that start after the day, marked "planned" (default yes)
 * @returns {{ on: string, posts: object[], roots: string[], units: object[] }}
 *   posts are in reading order (each manager, then their reports, by title); each has
 *   { id, title, status: filled | vacant | planned, holders[], unit, unitName, manager, reports[], dotted[], depth, vacancy?, budget? }
 */
export function stateOn(org, options = {}) {
  const on = options.on ?? today();
  const people = org.people ?? {}, units = org.units ?? {};
  const live = new Map();
  for (const p of org.posts ?? []) {
    const exists = inEffect(p, on), later = first(p.from) > on;
    if (!exists && !(later && options.planned !== false)) continue;
    const holders = exists ? (p.holders ?? []).filter((h) => inEffect(h, on)).map((h) => {
      const who = h.person ? people[h.person] : undefined;
      // Someone who has not agreed to be named still fills their seat; they are just not shown.
      return who ? { shown: true, id: h.person, name: who.name, pronouns: who.pronouns, preferredTitle: who.preferredTitle, photoUrl: who.photoUrl, fte: h.fte ?? 1, acting: h.acting === true, since: h.from }
        : { shown: false, fte: h.fte ?? 1, acting: h.acting === true, since: h.from };
    }) : [];
    const day = exists ? on : first(p.from);
    live.set(p.id, {
      id: p.id, title: p.title, level: p.level, location: p.location,
      status: later ? "planned" : holders.length ? "filled" : "vacant",
      starts: later ? p.from : undefined, ends: p.to,
      holders, unit: p.unit, unitName: p.unit ? units[p.unit]?.name : undefined,
      managerId: managerOn(p, day),
      dotted: (p.reportsTo ?? []).filter((l) => l.kind === "dotted" && inEffect(l, day)).map((l) => l.post),
      vacancy: !holders.length || later ? p.vacancy : undefined,
      ...(options.budget && p.budget ? { budget: p.budget } : {}),
      reports: [],
    });
  }
  for (const p of live.values()) {
    p.manager = p.managerId && live.has(p.managerId) ? p.managerId : undefined;
    delete p.managerId;
    p.dotted = p.dotted.filter((id) => live.has(id));
    if (p.manager) live.get(p.manager).reports.push(p.id);
  }
  const byTitle = (a, b) => live.get(a).title.localeCompare(live.get(b).title) || a.localeCompare(b);
  const roots = [...live.values()].filter((p) => !p.manager).map((p) => p.id).sort(byTitle);
  const ordered = [];
  const walk = (id, depth) => { const p = live.get(id); p.depth = depth; p.reports.sort(byTitle); ordered.push(p); for (const r of p.reports) walk(r, depth + 1); };
  for (const r of roots) walk(r, 1);
  const liveUnits = Object.entries(units).filter(([, u]) => inEffect(u, on)).map(([id, u]) => ({ id, name: u.name, kind: u.kind, parent: u.parent, ...(options.budget && u.costCenter ? { costCenter: u.costCenter } : {}) }));
  return { on, posts: ordered, roots, units: liveUnits };
}

/** A post's holder, in words, as every view says it. */
export function holderText(post) {
  if (post.status === "planned") return "Planned";
  if (!post.holders.length) return "Vacant";
  return post.holders.map((h) => `${h.shown ? h.name : "Filled (person not shown)"}${h.acting ? " (acting)" : ""}${h.fte < 1 ? ` (${Math.round(h.fte * 100)}%)` : ""}`).join(" and ");
}

/**
 * What changed between two days: posts opened and closed, seats filled, vacated or changed hands,
 * and posts that moved to another manager or unit, or were renamed.
 * @returns {{ from: string, to: string, changes: { kind: string, post: string, title: string, detail: string }[] }}
 */
export function compareDates(org, from, to, options = {}) {
  const a = stateOn(org, { ...options, on: from, planned: false }), b = stateOn(org, { ...options, on: to, planned: false });
  const A = new Map(a.posts.map((p) => [p.id, p])), B = new Map(b.posts.map((p) => [p.id, p]));
  const changes = [];
  const add = (kind, p, detail) => changes.push({ kind, post: p.id, title: p.title, detail });
  const title = (state, id) => (id ? state.get(id)?.title ?? id : "nobody");
  // A post that replaced another (its title or unit changed) is compared with the one it replaced.
  const raw = new Map((org.posts ?? []).map((p) => [p.id, p]));
  const replaced = new Map();
  for (const p of b.posts) { const prev = raw.get(p.id)?.succeeds; if (prev && A.has(prev) && !B.has(prev) && !A.has(p.id)) replaced.set(p.id, prev); }
  const gone = new Set(replaced.values());
  for (const p of b.posts) if (!A.has(p.id) && !replaced.has(p.id)) add("opened", p, `a new post, ${!p.holders.length ? "vacant" : p.holders.every((h) => !h.shown) ? "filled (person not shown)" : `held by ${holderText(p)}`}`);
  for (const p of a.posts) if (!B.has(p.id) && !gone.has(p.id)) add("closed", p, `the post ended${!p.holders.length ? "" : p.holders.every((h) => !h.shown) ? " (it was filled; the person is not shown)" : ` (it was held by ${holderText(p)})`}`);
  for (const p of b.posts) {
    const was = A.get(p.id) ?? A.get(replaced.get(p.id));
    if (!was) continue;
    const before = holderText(was), after = holderText(p);
    if (before !== after) add(was.holders.length && !p.holders.length ? "vacated" : !was.holders.length && p.holders.length ? "filled" : "changedHands", p, `${before} → ${after}`);
    const sameSeat = (x, y) => x === y || (replaced.has(y) && replaced.get(y) === x);
    if (!sameSeat(was.manager, p.manager)) add("moved", p, `reports to ${title(B, p.manager)} (was ${title(A, was.manager)})`);
    if (was.unit !== p.unit) add("moved", p, `now in ${p.unitName ?? "no unit"} (was ${was.unitName ?? "no unit"})`);
    if (was.title !== p.title) add("renamed", p, `was "${was.title}"`);
  }
  const order = ["opened", "closed", "filled", "vacated", "changedHands", "moved", "renamed"];
  changes.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || x.title.localeCompare(y.title) || x.post.localeCompare(y.post));
  return { from, to, changes };
}
