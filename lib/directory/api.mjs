// Directory connectors that call a directory's own API, and the one executor that applies a change
// set through any of them. Design: docs/superpowers/specs/2026-11-10-directory-sync-design.md
// ("Approving and applying").
//
// What a connector here is: a table of attribute paths and three small functions. It builds
// requests; it never sends one. applyChangeSet sends them, and only when told to.
//
// Credentials: an access token, read from an environment variable by the command line and passed
// in. It is sent as a header and written nowhere: not to the log, not to the rollback file.

import { createHash } from "node:crypto";

export const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
  return obj;
}
const norm = (v) => (v == null ? "" : String(v).normalize("NFC").replace(/\s+/g, " ").trim());

/**
 * Add an administrator's own attributes to a connector: "pronouns=extensionAttribute1,nickname=…".
 * Only fields the connector lists as mappable may be mapped, and only to a plain attribute name.
 */
export function withMap(connector, mapText) {
  if (!mapText) return connector;
  if (!connector.custom) throw new Error(`--map is not used by ${connector.id}`);
  const fields = { ...connector.fields }, writable = [...(connector.writable ?? [])];
  for (const pair of String(mapText).split(",").map((s) => s.trim()).filter(Boolean)) {
    const [field, name] = pair.split("=").map((s) => s?.trim());
    if (!connector.custom.fields.includes(field)) throw new Error(`--map: ${connector.id} can map ${connector.custom.fields.join(", ")} (got ${field})`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name ?? "")) throw new Error(`--map: "${name}" is not an attribute name (letters, digits and _)`);
    fields[field] = connector.custom.path(name);
    if (!writable.includes(field)) writable.push(field);
  }
  return { ...connector, fields, writable };
}

/** The requests a change set would send: one per person with changes. Nothing is sent. */
export function planRequests(changeSet, connector, env = {}) {
  return changeSet.changes.filter((c) => c.fields.length).map((c) => {
    const body = {};
    for (const f of c.fields) setPath(body, f.attribute, f.to);
    return { user: c.user, person: c.person, release: c.release.id, fields: c.fields, ...connector.write(c.user, connector.body ? connector.body(body) : body, env) };
  });
}

export class ApplyRefusedError extends Error {
  constructor(message) { super(message); this.name = "ApplyRefusedError"; }
}

/**
 * Apply a change set through a connector's API.
 *  - Refused unless `approved` is the change set's sha256 (the one in the report the approver read),
 *    and unless the change set is no older than maxAgeDays.
 *  - Each user is read again first. A field is sent only if the directory still holds the value the
 *    approver saw; otherwise it is skipped and reported.
 *  - It stops at the first error from the directory, leaving the rest unapplied.
 *  - Every step is logged (no tokens, no headers), and the inverse of what was applied is returned
 *    as a rollback change set: rolling back is applying that.
 * @param {object} args
 * @param {string} args.text  the change set file, exactly as written by "directory diff"
 * @param {object} args.connector  an API connector (one with read and write)
 * @param {string} args.approved  the sha256 the approver names
 * @param {string} args.token  the access token
 * @param {(url: string, init: object) => Promise<{ ok: boolean, status: number, json: () => Promise<any>, text: () => Promise<string> }>} args.fetch
 * @param {object} [args.env]  connector settings (an organization's address, say)
 * @param {string} [args.today]  yyyy-mm-dd, default today
 * @param {number} [args.maxAgeDays]  default 7
 * @param {() => string} [args.clock]  the time to stamp log lines with
 * @returns {Promise<{ applied: number, skipped: number, stoppedAt?: string, log: object[], rollback: object }>}
 */
export async function applyChangeSet({ text, connector, approved, token, fetch, env = {}, today = new Date().toISOString().slice(0, 10), maxAgeDays = 7, clock = () => new Date().toISOString() }) {
  const sha = createHash("sha256").update(text).digest("hex");
  if (!approved || approved.toLowerCase() !== sha) throw new ApplyRefusedError(`this is not the change set that was approved (its sha256 is ${sha}); pass the hash from the report you read with --approved`);
  const changeSet = JSON.parse(text);
  if (changeSet.changeSetVersion !== 1) throw new ApplyRefusedError(`change set version ${changeSet.changeSetVersion} is not one this version applies`);
  if (changeSet.target !== connector.id) throw new ApplyRefusedError(`this change set was made for ${changeSet.target}, not ${connector.id}`);
  if (!connector.read || !connector.write) throw new ApplyRefusedError(`${connector.id} works by file: apply its file by hand`);
  const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${changeSet.madeFor}T00:00:00Z`)) / 86400000);
  if (!(age >= 0 && age <= maxAgeDays)) throw new ApplyRefusedError(`the change set was made for ${changeSet.madeFor}, ${age} days from today; run "directory diff" again (the limit is ${maxAgeDays} days)`);
  if (!token) throw new ApplyRefusedError("no access token was given");

  const headers = { authorization: `${connector.auth ?? "Bearer"} ${token}`, accept: "application/json" };
  const log = [], undone = [];
  let applied = 0, skipped = 0, stoppedAt;
  const say = (entry) => log.push({ time: clock(), ...entry });

  for (const c of changeSet.changes.filter((x) => x.fields.length)) {
    const who = c.user.primaryEmail ?? c.user.id;
    const get = connector.read(c.user, env);
    const res = await fetch(get.url, { method: "GET", headers });
    if (!res.ok) { say({ user: who, step: "read", status: res.status, result: "error" }); stoppedAt = who; break; }
    const current = connector.parse(await res.json());
    const send = [];
    for (const f of c.fields) {
      const now = getPath(current.raw, f.attribute) ?? current[f.field];
      if (norm(now) === norm(f.to)) { skipped++; say({ user: who, field: f.field, result: "already done" }); continue; }
      if (norm(now) !== norm(f.from)) { skipped++; say({ user: who, field: f.field, result: "skipped: the directory no longer holds the value that was approved", approved: f.from, found: now ?? null }); continue; }
      send.push(f);
    }
    if (!send.length) continue;
    const body = {};
    for (const f of send) setPath(body, f.attribute, f.to);
    const put = connector.write(c.user, connector.body ? connector.body(body) : body, env);
    const out = await fetch(put.url, { method: put.method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(put.body) });
    if (!out.ok) {
      let detail = ""; try { detail = (await out.text()).slice(0, 300); } catch { /* no body */ }
      for (const f of send) say({ user: who, field: f.field, from: f.from, to: f.to, release: c.release.id, status: out.status, result: "error", detail });
      stoppedAt = who;
      break;
    }
    for (const f of send) say({ user: who, field: f.field, from: f.from, to: f.to, release: c.release.id, status: out.status, result: "applied" });
    applied += send.length;
    undone.push({ ...c, fields: send.map((f) => ({ ...f, from: f.to, to: f.from })).filter((f) => f.to != null && f.to !== ""), notes: [] });
  }
  // What can be put back is put back; a field that was empty before can't be emptied again by a sync.
  const rollback = { ...changeSet, rollbackOf: sha, madeFor: today, changes: undone.filter((c) => c.fields.length), refusals: [] };
  return { applied, skipped, stoppedAt, log, rollback };
}

// ---------------------------------------------------------------------------------------------
// The connectors. Each confirms its API from the vendor's documentation (read 2026-11-10); the
// sources are in docs/superpowers/plans/2026-11-10-2.9-directory-sync.md.

const list = (doc, key) => {
  const l = Array.isArray(doc) ? doc : doc?.[key];
  if (!Array.isArray(l)) throw new Error(`the export is not a list of users (an array, or an object with "${key}")`);
  return l;
};
const parseJson = (bytes) => { try { return JSON.parse(String(bytes).replace(/^﻿/, "")); } catch (err) { throw new Error(`the export is not JSON: ${err.message}`); } };
const neutral = (connector, raw, extra) => {
  const u = { raw, ...extra };
  for (const [field, path] of Object.entries(connector.fields)) u[field] ??= getPath(raw, path);
  return u;
};
const strip = (users) => users.map(({ raw, ...u }) => u);

// Google Workspace: Admin SDK Directory API.
//   PATCH https://admin.googleapis.com/admin/directory/v1/users/{userKey}
//   scope https://www.googleapis.com/auth/admin.directory.user
// Patch cannot clear repeated fields and a patch of a repeated field replaces the whole list, so
// phones, organizations and relations are read and never written. Fields Google lacks go in a
// custom schema (default "TurnrowProfile"), which an administrator creates once.
const primaryOf = (l) => (l ?? []).find((x) => x.primary) ?? (l ?? [])[0];
export const google = {
  id: "google", label: "Google Workspace (Directory API)", tokenEnv: "GOOGLE_DIRECTORY_TOKEN",
  fields: {
    givenName: "name.givenName", familyName: "name.familyName", displayName: "name.displayName",
    pronouns: "customSchemas.TurnrowProfile.pronouns", nickname: "customSchemas.TurnrowProfile.nickname",
    preferredTitle: "customSchemas.TurnrowProfile.preferredTitle", headline: "customSchemas.TurnrowProfile.headline", shortBio: "customSchemas.TurnrowProfile.shortBio",
    title: "organizations.title", department: "organizations.department", costCenter: "organizations.costCenter", workLocation: "organizations.location",
    employeeNumber: "externalIds.organization", managerId: "relations.manager", phone: "phones.work",
  },
  writable: ["givenName", "familyName", "displayName", "pronouns", "nickname", "preferredTitle", "headline", "shortBio"],
  parse(raw) {
    const org = primaryOf(raw.organizations) ?? {};
    return neutral(this, raw, {
      id: String(raw.id), primaryEmail: raw.primaryEmail, emails: [raw.primaryEmail, ...(raw.aliases ?? []), ...(raw.emails ?? []).map((e) => e.address)].filter(Boolean),
      title: org.title, department: org.department, costCenter: org.costCenter, workLocation: org.location,
      employeeNumber: (raw.externalIds ?? []).find((x) => x.type === "organization")?.value,
      managerId: (raw.relations ?? []).find((x) => x.type === "manager")?.value,
      phone: ((raw.phones ?? []).find((x) => x.type === "work") ?? primaryOf(raw.phones))?.value,
    });
  },
  readExport(bytes) { return strip(list(parseJson(bytes), "users").map((u) => { if (u?.id == null) throw new Error("a user in the export has no id"); return this.parse(u); })); },
  read: (user) => ({ url: `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(user.id)}?projection=full` }),
  write: (user, body) => ({ method: "PATCH", url: `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(user.id)}`, body }),
};

// Microsoft Entra ID: Microsoft Graph v1.0.
//   PATCH https://graph.microsoft.com/v1.0/users/{id}   → 204 No Content
//   least-privileged application permission: User.ReadUpdate.All (User-Phone.ReadWrite.All for phones)
// Entra has no attribute for pronouns, a nickname or a preferred title: map them to extension
// attributes with --map (onPremisesExtensionAttributes.extensionAttribute1…15, cloud-only users).
export const entra = {
  id: "entra", label: "Microsoft Entra ID (Microsoft Graph)", tokenEnv: "ENTRA_GRAPH_TOKEN",
  fields: {
    givenName: "givenName", familyName: "surname", displayName: "displayName",
    title: "jobTitle", department: "department", employeeNumber: "employeeId", workLocation: "officeLocation",
    managerId: "manager.id", managerName: "manager.displayName", phone: "businessPhones.0",
  },
  writable: ["givenName", "familyName", "displayName"],
  custom: { fields: ["pronouns", "nickname", "preferredTitle", "headline", "shortBio"], path: (name) => `onPremisesExtensionAttributes.${name}` },
  parse(raw) { return neutral(this, raw, { id: String(raw.id), primaryEmail: raw.mail ?? raw.userPrincipalName, emails: [raw.mail, raw.userPrincipalName, ...(raw.otherMails ?? []), ...(raw.proxyAddresses ?? []).filter((p) => /^smtp:/i.test(p)).map((p) => p.slice(5))].filter(Boolean) }); },
  readExport(bytes) { return strip(list(parseJson(bytes), "value").map((u) => { if (u?.id == null) throw new Error("a user in the export has no id"); return this.parse(u); })); },
  read: (user) => ({ url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.id)}?$select=id,givenName,surname,displayName,jobTitle,department,employeeId,officeLocation,businessPhones,mail,userPrincipalName,onPremisesExtensionAttributes` }),
  write: (user, body) => ({ method: "PATCH", url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.id)}`, body }),
};

// Okta: Users API.
//   POST https://{org}/api/v1/users/{id}  with { profile: { … } }: a partial update (PUT would null the rest)
//   OAuth 2.0 scope okta.users.manage
const orgUrl = (env, name) => {
  const v = String(env[name] ?? "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(v)) throw new Error(`set ${name} to your organization's address, such as https://example.okta.com`);
  return v;
};
export const okta = {
  id: "okta", label: "Okta (Users API)", tokenEnv: "OKTA_TOKEN", env: ["OKTA_ORG_URL"],
  fields: {
    givenName: "profile.firstName", familyName: "profile.lastName", displayName: "profile.displayName", nickname: "profile.nickName", phone: "profile.primaryPhone",
    title: "profile.title", department: "profile.department", division: "profile.division", costCenter: "profile.costCenter",
    employeeNumber: "profile.employeeNumber", managerId: "profile.managerId", managerName: "profile.manager",
  },
  writable: ["givenName", "familyName", "displayName", "nickname", "phone"],
  custom: { fields: ["pronouns", "preferredTitle", "headline", "shortBio"], path: (name) => `profile.${name}` },
  parse(raw) { return neutral(this, raw, { id: String(raw.id), primaryEmail: raw.profile?.email ?? raw.profile?.login, emails: [raw.profile?.email, raw.profile?.login, raw.profile?.secondEmail].filter(Boolean) }); },
  readExport(bytes) { return strip(list(parseJson(bytes), "users").map((u) => { if (u?.id == null) throw new Error("a user in the export has no id"); return this.parse(u); })); },
  read: (user, env) => ({ url: `${orgUrl(env, "OKTA_ORG_URL")}/api/v1/users/${encodeURIComponent(user.id)}` }),
  write: (user, body, env) => ({ method: "POST", url: `${orgUrl(env, "OKTA_ORG_URL")}/api/v1/users/${encodeURIComponent(user.id)}`, body }),
};

// OneLogin: Users API v2.
//   PUT https://{subdomain}.onelogin.com/api/2/users/{id}: only the fields sent are changed
//   a bearer token from API credentials with the "Manage users" scope
// Custom attributes must already exist in the account; map fields to them with --map.
export const onelogin = {
  id: "onelogin", label: "OneLogin (Users API v2)", tokenEnv: "ONELOGIN_TOKEN", env: ["ONELOGIN_URL"],
  fields: {
    givenName: "firstname", familyName: "lastname", phone: "phone",
    title: "title", department: "department", employeeNumber: "external_id", managerId: "manager_user_id",
  },
  writable: ["givenName", "familyName", "phone"],
  custom: { fields: ["pronouns", "nickname", "preferredTitle", "headline", "shortBio", "displayName"], path: (name) => `custom_attributes.${name}` },
  parse(raw) { return neutral(this, raw, { id: String(raw.id), primaryEmail: raw.email, emails: [raw.email, /@/.test(raw.username ?? "") ? raw.username : undefined].filter(Boolean), managerId: raw.manager_user_id == null ? undefined : String(raw.manager_user_id) }); },
  readExport(bytes) { return strip(list(parseJson(bytes), "data").map((u) => { if (u?.id == null) throw new Error("a user in the export has no id"); return this.parse(u); })); },
  read: (user, env) => ({ url: `${orgUrl(env, "ONELOGIN_URL")}/api/2/users/${encodeURIComponent(user.id)}` }),
  write: (user, body, env) => ({ method: "PUT", url: `${orgUrl(env, "ONELOGIN_URL")}/api/2/users/${encodeURIComponent(user.id)}`, body }),
};

export const API_CONNECTORS = { google, entra, okta, onelogin };
