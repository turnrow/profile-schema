// Directory sync: a folder of profiles becomes a reviewed set of changes to an organization's
// directory. Design: docs/superpowers/specs/2026-11-10-directory-sync-design.md.
//
// The rule everything follows from: a directory update is a release, to an employer, of fields
// the person is the authority for. So every person's update passes through buildRelease (consent,
// an active audience, a verified recipient, a receipt), and fields the employer is the authority
// for (department, manager, official title…) are compared and reported, never pushed.
//
// Nothing here changes a directory. diffDirectory only reads and compares.

import { createHash } from "node:crypto";
import { readdirSync, lstatSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRelease, ReleaseRefusedError } from "../release.mjs";
import { checkRequester, authorityFor } from "../audience.mjs";
import { validateProfile } from "../validate.mjs";
import { readFileSync as read } from "node:fs";
import { mdEscape as esc, mdTable as table } from "../review.mjs";
import * as scimConnector from "./scim.mjs";
import * as googleCsv from "./google-csv.mjs";
import * as ldif from "./ldif.mjs";
import { API_CONNECTORS } from "./api.mjs";

/** The connectors this version ships, by id (--target). */
export const CONNECTORS = { [scimConnector.id]: scimConnector, [googleCsv.id]: googleCsv, [ldif.id]: ldif, ...API_CONNECTORS };

const ENT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const EXT = "urn:turnrow:params:scim:schemas:extension:profile:2.0:User";

/**
 * The neutral fields of a directory user: where each comes from in the SCIM payload of a release,
 * and the profile field whose authority decides whether it may be pushed (see DEFAULT_AUTHORITY).
 * title: the employer's official title when the job has one, else the person's own.
 */
export const FIELDS = [
  { field: "givenName", from: (u) => u.name?.givenName, source: "person.names.preferred.given" },
  { field: "familyName", from: (u) => u.name?.familyName, source: "person.names.preferred.family" },
  { field: "displayName", from: (u) => u.displayName, source: "person.name" },
  { field: "nickname", from: (u) => u.nickName, source: "person.names.nickname" },
  { field: "pronouns", from: (u) => u[EXT]?.pronouns, source: "person.pronouns" },
  { field: "preferredTitle", from: (u) => u[EXT]?.preferredTitle, source: "title" },
  { field: "phone", from: (u) => u.phoneNumbers?.[0]?.value, source: "person.contact.phone", compare: "phone" },
  { field: "photoUrl", from: (u) => u.photos?.[0]?.value, source: "person.image" },
  { field: "headline", from: (u) => u[EXT]?.headline, source: "person.headline" },
  { field: "shortBio", from: (u) => u[EXT]?.shortBio, source: "person.shortBio" },
  { field: "title", from: (u) => u.title, source: (work) => (work?.employerRecord?.officialTitle ? "employerRecord.officialTitle" : "title") },
  { field: "department", from: (u) => u[ENT]?.department, source: "employerRecord.department" },
  { field: "division", from: (u) => u[ENT]?.division, source: "employerRecord.division" },
  { field: "costCenter", from: (u) => u[ENT]?.costCenter, source: "employerRecord.costCenter" },
  { field: "employeeNumber", from: (u) => u[ENT]?.employeeNumber, source: "employerRecord.employeeNumber" },
  { field: "managerId", from: (u) => u[ENT]?.manager?.value, source: "employerRecord.managerId" },
  { field: "managerName", from: (u) => u[ENT]?.manager?.displayName, source: "employerRecord.managerName" },
  { field: "workLocation", from: (u) => u[EXT]?.workLocation, source: "employerRecord.workLocation" },
];
export const FIELD_NAMES = FIELDS.map((f) => f.field);

const EMPLOYER = "the employer is the authority for this field, so it is not changed; correct the profile through write-back, or the directory at its source";
const sha256 = (x) => createHash("sha256").update(x).digest("hex");
const norm = (v) => (v == null ? "" : String(v).normalize("NFC").replace(/\s+/g, " ").trim());
const same = (a, b, how) => (how === "phone" ? norm(a).replace(/\D/g, "") === norm(b).replace(/\D/g, "") : norm(a) === norm(b));
const email = (v) => norm(v).toLowerCase();
const uuidFrom = (...parts) => { const h = sha256(parts.join("\u0000")); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

/**
 * The profiles in a folder: files named *.profile.json and bundle folders (a folder with
 * profile.json), one level deep. Links are not followed, so a folder can't reach outside itself.
 * @returns {{ name: string, file: string, bundleDir?: string, profile?: object, error?: string }[]}
 */
export function readProfileFolder(folder) {
  const out = [];
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    let file, bundleDir;
    if (stat.isDirectory()) { file = join(path, "profile.json"); bundleDir = path; if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue; }
    else if (name.endsWith(".profile.json")) file = path;
    else continue;
    try { out.push({ name, file, bundleDir, profile: JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) }); }
    catch (err) { out.push({ name, file, bundleDir, error: `not valid JSON: ${err.message}` }); }
  }
  return out;
}

/** The person's directory user: by employee number, then primary e-mail, then any other address. Never by name. */
export function matchUser(desired, users) {
  const tries = [
    ["employee number", desired.employeeNumber, (u) => norm(u.employeeNumber) === norm(desired.employeeNumber)],
    ["primary e-mail address", desired.primaryEmail, (u) => email(u.primaryEmail) === email(desired.primaryEmail)],
    ["another e-mail address", desired.primaryEmail, (u) => (u.emails ?? []).some((e) => email(e) === email(desired.primaryEmail))],
  ];
  let ambiguous;
  for (const [by, key, test] of tries) {
    if (!norm(key)) continue;
    const found = users.filter(test);
    if (found.length === 1) return { user: found[0], by };
    if (found.length > 1) ambiguous ??= `${found.length} directory users share this ${by}`;
  }
  return { reason: ambiguous ?? "no directory user has this person's employee number or e-mail address", code: ambiguous ? "ambiguousUser" : "noMatchingUser" };
}

/** The one audience a run uses for a profile: the named one, or its single active directory audience this recipient qualifies for. */
function pickAudience(profile, requester, audienceId, on) {
  if (audienceId) return profile.audiences?.[audienceId] ? { id: audienceId } : { code: "noAudience", reason: `the profile has no audience "${audienceId}"` };
  const ids = Object.entries(profile.audiences ?? {}).filter(([, a]) => a.purpose === "employeeDirectory").map(([id]) => id);
  if (!ids.length) return { code: "noAudience", reason: "the profile has no audience for an employee directory (purpose: employeeDirectory)" };
  const checks = ids.map((id) => ({ id, check: checkRequester(profile, id, requester, { on }) }));
  const ok = checks.filter((c) => c.check.ok);
  if (ok.length === 1) return { id: ok[0].id };
  if (ok.length > 1) return { code: "noAudience", reason: `more than one directory audience fits (${ok.map((c) => c.id).join(", ")}); name one with --audience` };
  return { code: "notGranted", reason: checks[0].check.reason };
}

/**
 * Compare a folder's profiles with a directory's users.
 * @param {object} args
 * @param {{ name: string, profile?: object, bundleDir?: string, error?: string }[]} args.profiles  from readProfileFolder
 * @param {object[]} args.users  directory users, in neutral fields, from a connector's readExport
 * @param {{ id: string, fields: Record<string,string> }} args.connector
 * @param {{ domain: string, method: string, application?: string }} args.requester  what the administrator verified
 * @param {string} [args.audience]  the audience id to use for every profile
 * @param {string} [args.on]  the date the run is made for (yyyy-mm-dd, default today)
 * @param {string} [args.now]  the time to stamp releases with (default: now)
 * @param {string} [args.exportSha256]  the hash of the export file, for the record
 * @returns {{ changeSet: object, sha256: string, text: string, receipts: {user: string, receipt: object}[], records: {name: string, record: object}[] }}
 */
export function diffDirectory({ profiles, users, connector, requester, audience, on = new Date().toISOString().slice(0, 10), now, exportSha256 }) {
  const scim = JSON.parse(read(new URL("../../mappings/scim.json", import.meta.url), "utf8"));
  const changes = [], refusals = [], receipts = [], records = [], released = [];
  const matched = new Map();
  const refuse = (p, code, reason) => refusals.push({ profile: p.name, person: p.profile?.person?.name, code, reason });

  for (const p of profiles) {
    if (p.error) { refuse(p, "invalidProfile", p.error); continue; }
    const v = validateProfile(p.profile, { bundleDir: p.bundleDir });
    if (!v.valid) { refuse(p, "invalidProfile", `the profile is not valid (${v.errors.length} problem${v.errors.length === 1 ? "" : "s"}; first: ${v.errors[0]})`); continue; }
    if (p.profile.meta?.subjectConsent?.given !== true) { refuse(p, "noConsent", "the subject has not given consent (meta.subjectConsent.given is not true)"); continue; }
    const picked = pickAudience(p.profile, requester, audience, on);
    if (!picked.id) { refuse(p, picked.code, picked.reason); continue; }

    let release;
    try { release = buildRelease(p.profile, picked.id, scim, { requester, on, now, id: uuidFrom(p.name, picked.id, now ?? on) }); }
    catch (err) {
      if (!(err instanceof ReleaseRefusedError)) throw err;
      refuse(p, /consent/.test(err.reason) ? "noConsent" : "notGranted", err.reason);
      continue;
    }
    const payload = release.payload;
    const desired = { primaryEmail: payload.emails?.[0]?.value ?? (/@/.test(payload.userName ?? "") ? payload.userName : undefined) };
    for (const f of FIELDS) desired[f.field] = f.from(payload);

    const m = matchUser(desired, users);
    if (!m.user) { refuse(p, m.code, m.reason); continue; }
    if (matched.has(m.user.id)) { refuse(p, "ambiguousUser", `directory user ${m.user.primaryEmail ?? m.user.id} is already matched to ${matched.get(m.user.id)}`); continue; }
    matched.set(m.user.id, p.name);

    const aud = p.profile.audiences[picked.id];
    const work = (p.profile.work ?? []).find((w) => w.id === release.record.workRef);
    const fields = [], notes = [];
    for (const f of FIELDS) {
      const attribute = connector.fields[f.field];
      // A directory attribute is one line of text: stray spaces and line breaks are not sent.
      const to = desired[f.field] == null ? undefined : norm(desired[f.field]);
      if (!attribute || norm(to) === "" || same(m.user[f.field], to, f.compare)) continue; // absent means "not shared", never "clear it"
      const source = typeof f.source === "function" ? f.source(work) : f.source;
      const entry = { field: f.field, attribute, from: m.user[f.field] ?? null, to };
      // A connector that can read a field but not write it (a column a file format does not take) says so.
      if (connector.writable && !connector.writable.includes(f.field)) {
        if (authorityFor(aud, source) === "subject") notes.push({ field: f.field, attribute, directory: m.user[f.field] ?? null, profile: to, reason: `${connector.label ?? connector.id} does not write this field` });
        else notes.push({ field: f.field, attribute, directory: m.user[f.field] ?? null, profile: to, reason: EMPLOYER });
      } else if (authorityFor(aud, source) === "subject") fields.push(entry);
      else notes.push({ field: f.field, attribute, directory: m.user[f.field] ?? null, profile: to, reason: EMPLOYER });
    }
    receipts.push({ user: m.user.id, receipt: release.receipt });
    released.push({ user: m.user.id, profile: p.name, release: release.record.id, payload });
    records.push({ name: p.name, record: release.record });
    changes.push({
      // keep: what a connector must repeat when it writes this user (Google needs the names and the unit on every row).
      user: { id: m.user.id, primaryEmail: m.user.primaryEmail, employeeNumber: m.user.employeeNumber, ...(m.user.keep ? { keep: m.user.keep } : {}) },
      person: p.profile.person.name,
      profile: p.name,
      matchedBy: m.by,
      release: { id: release.record.id, audience: picked.id, payloadSha256: release.record.payloadSha256 },
      fields, notes,
    });
  }

  const changeSet = {
    changeSetVersion: 1,
    target: connector.id,
    madeFor: on,
    recipient: { domain: requester.domain, verifiedBy: requester.method, application: requester.application },
    against: { sha256: exportSha256, users: users.length },
    changes: changes.sort((a, b) => String(a.user.id).localeCompare(String(b.user.id))),
    refusals,
    usersWithoutProfile: users.filter((u) => !matched.has(u.id)).length,
  };
  const text = JSON.stringify(changeSet, null, 2) + "\n";
  return { changeSet, text, sha256: sha256(text), receipts, records, released };
}

/** A file name for a directory user that is safe on every system. */
export const userFileName = (user) => String(user.primaryEmail ?? user.id).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "user";

/**
 * The change report: what will change, for a person to read and approve. It holds personal data.
 * @param {object} changeSet  from diffDirectory
 * @param {{ sha256: string, files?: string[] }} info  the change set's hash; the connector's files, if any
 */
export function changeReport(changeSet, info) {
  const out = [];
  const add = (...lines) => out.push(...lines, "");
  const shown = (v) => (v == null || v === "" ? "(empty)" : esc(v));
  const withChanges = changeSet.changes.filter((c) => c.fields.length);
  const withNotes = changeSet.changes.filter((c) => c.notes.length);
  add("# Directory change report");
  add("**Internal.** This file holds personal data. Keep it out of public repositories and shared folders.");
  add([
    `- Directory: ${esc(changeSet.target)}, for ${esc(changeSet.recipient.domain)} (verified by ${esc(changeSet.recipient.verifiedBy)})`,
    `- Made for: ${esc(changeSet.madeFor)}`,
    `- Compared with an export of ${changeSet.against.users} user${changeSet.against.users === 1 ? "" : "s"}${changeSet.against.sha256 ? ` (sha256 ${changeSet.against.sha256.slice(0, 12)}…)` : ""}`,
    `- Change set: sha256 ${info.sha256}`,
  ].join("\n"));
  add("## Summary");
  add([
    `- **People with changes:** ${withChanges.length} (${withChanges.reduce((n, c) => n + c.fields.length, 0)} field${withChanges.reduce((n, c) => n + c.fields.length, 0) === 1 ? "" : "s"}).`,
    `- **People already up to date:** ${changeSet.changes.length - withChanges.length}.`,
    `- **People left out:** ${changeSet.refusals.length}.`,
    `- **Differences left as they are:** ${withNotes.reduce((n, c) => n + c.notes.length, 0)}.`,
    `- **Directory users with no profile in the folder:** ${changeSet.usersWithoutProfile}. They are not touched.`,
  ].join("\n"));
  add("## Before you approve");
  add("Nothing has been changed. This run only read the folder and the export. Read the changes below. Each one was released by the person it is about, to this employer, and has a consent receipt in the `receipts` folder. A sync never creates, removes or renames a user, never clears a value, and never changes a field the employer is the authority for.");
  if (info.files?.length) add(`To apply: ${info.files.map((f) => `\`${f}\``).join(", ")}.`);

  add("## Changes");
  if (!withChanges.length) add("Nothing to change.");
  for (const c of withChanges) {
    add(`### ${esc(c.person)}`);
    add(`Directory user ${esc(c.user.primaryEmail ?? c.user.id)}, matched by ${esc(c.matchedBy)}. Profile: ${esc(c.profile)}. Release: ${esc(c.release.id)}.`);
    add(table(["Field", "Directory attribute", "Now", "Will be"], c.fields.map((f) => [esc(f.field), esc(f.attribute), shown(f.from), shown(f.to)])));
  }
  add("## Differences left as they are");
  if (!withNotes.length) add("None.");
  else {
    add("These are not changed. Where the employer is the authority for a field: if the directory is right, the profile learns it through write-back; if the profile is right, correct the directory at its source (usually the HR system).");
    add(table(["Person", "Field", "The directory says", "The profile says", "Why it is not changed"], withNotes.flatMap((c) => c.notes.map((n) => [esc(c.person), esc(n.field), shown(n.directory), shown(n.profile), n.reason === EMPLOYER ? "the employer is the authority" : esc(n.reason)]))));
  }
  add("## People left out");
  if (!changeSet.refusals.length) add("Nobody.");
  else add(table(["Profile", "Person", "Why"], changeSet.refusals.map((r) => [esc(r.profile), r.person ? esc(r.person) : "unknown", esc(r.reason)])));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

