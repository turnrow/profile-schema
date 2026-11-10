// Building an organization file from a directory export and a folder of profiles.
//  - The export gives the seats: a post per user, its title, its unit, its line manager.
//  - The profiles give the names: a person is named only through their release to this employer,
//    exactly as in directory sync. Without one, the seat is filled and the person is not shown.
//  - With a base file, nothing is deleted: what is gone is ended on the day of the run, and what is
//    new starts on it. Running the builder again and again is how the history accumulates.

import { diffDirectory } from "../directory/index.mjs";
import { inEffect, validateOrganization } from "./index.mjs";

const EXT = "urn:turnrow:params:scim:schemas:extension:profile:2.0:User";
const slug = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const unique = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; };

/**
 * @param {object} args
 * @param {object[]} args.profiles  from readProfileFolder
 * @param {object[]} args.users  directory users in neutral fields, from a connector's readExport
 * @param {object} args.connector
 * @param {{ domain: string, method: string }} args.requester
 * @param {string} args.name  the organization's name (used when there is no base file)
 * @param {string} [args.on]  the day of the run (yyyy-mm-dd, default today)
 * @param {string} [args.now]  the time to stamp releases with
 * @param {string} [args.audience]
 * @param {object} [args.base]  an existing organization file to carry forward
 * @param {string} [args.exportSha256]
 * @returns {{ org: object, report: { opened: string[], ended: string[], replaced: string[], named: number, notNamed: number, kept: number, refusals: object[] } }}
 */
export function buildOrganization({ profiles, users, connector, requester, name, on = new Date().toISOString().slice(0, 10), now, audience, base, exportSha256 }) {
  if (base) { const v = validateOrganization(base); if (!v.valid) throw new Error(`the base file is not valid: ${v.errors[0]}`); }
  const org = structuredClone(base ?? { orgSchemaVersion: "1.0.0", meta: { name }, units: {}, posts: [], people: {}, sources: {} });
  org.units ??= {}; org.people ??= {}; org.sources ??= {}; org.posts ??= [];
  org.meta.updated = on;
  if (requester?.domain && !(org.meta.domains ?? []).includes(requester.domain)) org.meta.domains = [...(org.meta.domains ?? []), requester.domain];
  const yesterday = dayBefore(on);
  const report = { opened: [], ended: [], replaced: [], named: 0, notNamed: 0, kept: 0, history: 0, refusals: [] };

  const exportSource = `export-${on}`, profileSource = `profiles-${on}`;
  org.sources[exportSource] = { kind: "directoryExport", title: `${connector.label ?? connector.id} export`, date: on, ...(exportSha256 ? { sha256: exportSha256 } : {}) };

  // Who may be named: the same releases directory sync makes.
  const diff = diffDirectory({ profiles, users, connector: { ...connector, fields: {} }, requester, audience, on, now });
  report.refusals = diff.changeSet.refusals;
  const releasedBy = new Map(diff.released.map((r) => [r.user, r]));
  if (releasedBy.size) org.sources[profileSource] = { kind: "profile", title: "Profiles released to this employer", date: on };

  const postIds = new Set(org.posts.map((p) => p.id)), personIds = new Set(Object.keys(org.people));
  const open = (x) => inEffect(x, on) || (x.from && x.from > on);
  const liveByUser = new Map(org.posts.filter((p) => p.directoryId != null && inEffect(p, on)).map((p) => [p.directoryId, p]));
  const personByKey = new Map(Object.entries(org.people).map(([id, p]) => [p.employeeNumber ?? p.email ?? id, id]));

  const unitFor = (department) => {
    if (!department) return undefined;
    const id = slug(department);
    org.units[id] ??= { name: department, kind: "department", from: on, source: exportSource };
    return id;
  };

  // 1. A post per directory user.
  const postOf = new Map(), created = new Set();
  for (const u of users) {
    const title = u.title ?? "(no title in the directory)";
    const unit = unitFor(u.department);
    let post = liveByUser.get(u.id);
    if (post && (post.title !== title || post.unit !== unit)) {
      // The seat's title or unit changed: the old post ends and a new one takes its place, so the change is kept.
      post.to = yesterday;
      for (const x of [...(post.holders ?? []), ...(post.reportsTo ?? [])]) if (open(x)) x.to = yesterday;
      const next = { id: unique(slug(`${title}-${u.employeeNumber ?? u.id}`), postIds), title, ...(unit ? { unit } : {}), from: on, source: exportSource, directoryId: u.id, succeeds: post.id, ...(post.level ? { level: post.level } : {}), ...(post.budget ? { budget: post.budget } : {}) };
      org.posts.push(next);
      report.replaced.push(`${post.title} → ${title}${post.unit !== unit ? ` (${org.units[post.unit]?.name ?? "no unit"} → ${org.units[unit]?.name ?? "no unit"})` : ""}`);
      post = next;
    } else if (!post) {
      post = { id: unique(slug(`${title}-${u.employeeNumber ?? u.id}`), postIds), title, ...(unit ? { unit } : {}), from: on, source: exportSource, directoryId: u.id };
      org.posts.push(post);
      created.add(post.id);
      report.opened.push(title);
    } else report.kept++;
    postOf.set(u.id, post);
  }

  // 2. Who holds each, named only where a release allows.
  for (const u of users) {
    const post = postOf.get(u.id);
    const rel = releasedBy.get(u.id);
    let person;
    if (rel) {
      const key = u.employeeNumber ?? u.primaryEmail ?? u.id;
      person = personByKey.get(key) ?? unique(slug(rel.payload.displayName ?? rel.payload.name?.formatted), personIds);
      personByKey.set(key, person);
      const ext = rel.payload[EXT] ?? {};
      const photo = rel.payload.photos?.[0]?.value;
      org.people[person] = {
        name: rel.payload.displayName ?? rel.payload.name?.formatted,
        ...(ext.pronouns ? { pronouns: ext.pronouns } : {}), ...(ext.preferredTitle ? { preferredTitle: ext.preferredTitle } : {}),
        ...(rel.payload.emails?.[0]?.value ? { email: rel.payload.emails[0].value } : {}), ...(u.employeeNumber ? { employeeNumber: u.employeeNumber } : {}),
        ...(/^https:\/\/\S+$/.test(photo ?? "") ? { photoUrl: photo } : {}), profile: rel.profile, release: rel.release,
      };
      report.named++;
    } else report.notNamed++;
    post.holders ??= [];
    const current = post.holders.filter((h) => inEffect(h, on));
    if (current.length === 1 && current[0].person === person) continue;
    for (const h of current) h.to = yesterday;
    // A seat first seen in this run, held by someone whose profile dates their positions in this job:
    // the seat and its holder start when the profile says the current position did, and each earlier
    // position becomes an ended post that the next one succeeds. This history is the person's own
    // account, so its source is their profile.
    let since = on;
    if (person && created.has(post.id) && rel.positions.length) {
      const earlier = rel.positions.filter((x) => x.to && x.to < on && x.from <= x.to);
      const now = rel.positions.filter((x) => !x.to || x.to >= on).at(-1);
      if (now && now.from < on) { since = now.from; post.from = now.from; }
      let before;
      for (const x of earlier) {
        const past = { id: unique(slug(`${x.title}-${u.employeeNumber ?? u.id}`), postIds), title: x.title, from: x.from, to: x.to, source: profileSource, ...(before ? { succeeds: before } : {}), holders: [{ person, from: x.from, to: x.to, source: profileSource }] };
        org.posts.push(past);
        before = past.id;
        report.history = (report.history ?? 0) + 1;
      }
      if (before) post.succeeds = before;
    }
    post.holders.push({ ...(person ? { person } : {}), from: since, source: person ? profileSource : exportSource });
  }

  // 3. Line managers, from the directory's manager link (an id, an e-mail address or a DN).
  const byRef = new Map();
  for (const u of users) for (const ref of [u.id, u.primaryEmail, ...(u.emails ?? [])]) if (ref) byRef.set(String(ref).toLowerCase(), u.id);
  for (const u of users) {
    const post = postOf.get(u.id);
    const boss = u.managerId ? postOf.get(byRef.get(String(u.managerId).toLowerCase())) : undefined;
    post.reportsTo ??= [];
    const current = post.reportsTo.filter((l) => (l.kind ?? "line") === "line" && inEffect(l, on));
    if (current.length === 1 && current[0].post === boss?.id) continue;
    for (const l of current) l.to = yesterday;
    if (boss && boss.id !== post.id) post.reportsTo.push({ post: boss.id, kind: "line", from: on, source: exportSource });
    if (!post.reportsTo.length) delete post.reportsTo;
  }

  // 4. Seats the directory no longer has are ended, not deleted. Hand-written posts (no directoryId) are left alone.
  const inExport = new Set(users.map((u) => u.id));
  for (const post of org.posts) {
    if (post.directoryId == null || inExport.has(post.directoryId) || !inEffect(post, on) || post.from === on) continue;
    post.to = yesterday;
    for (const x of [...(post.holders ?? []), ...(post.reportsTo ?? [])]) if (open(x)) x.to = yesterday;
    report.ended.push(post.title);
  }
  // A line to a post that has ended ends with it.
  const ended = new Map(org.posts.filter((p) => p.to && p.to < on).map((p) => [p.id, p.to]));
  for (const post of org.posts) for (const l of post.reportsTo ?? []) if (ended.has(l.post) && open(l)) l.to = ended.get(l.post);

  for (const k of ["units", "people"]) if (!Object.keys(org[k]).length) delete org[k];
  const check = validateOrganization(org);
  if (!check.valid) throw new Error(`the organization file that was built is not valid: ${check.errors[0]}`);
  return { org, report };
}
