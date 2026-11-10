// The neutral connector: a directory that speaks SCIM 2.0 (RFC 7643, RFC 7644). It reads a list of
// SCIM Users and writes the changes as one SCIM Bulk request of PATCH operations. Vendor connectors
// have the same shape (see the design spec); this one needs no vendor and no account.

const ENT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const EXT = "urn:turnrow:params:scim:schemas:extension:profile:2.0:User";

export const id = "scim";
export const label = "SCIM 2.0";

/** Neutral field → the SCIM attribute path that holds it. */
export const fields = {
  givenName: "name.givenName",
  familyName: "name.familyName",
  displayName: "displayName",
  nickname: "nickName",
  title: "title",
  phone: 'phoneNumbers[type eq "work"].value',
  photoUrl: 'photos[type eq "photo"].value',
  department: `${ENT}:department`,
  division: `${ENT}:division`,
  costCenter: `${ENT}:costCenter`,
  employeeNumber: `${ENT}:employeeNumber`,
  managerId: `${ENT}:manager.value`,
  managerName: `${ENT}:manager.displayName`,
  pronouns: `${EXT}:pronouns`,
  preferredTitle: `${EXT}:preferredTitle`,
  headline: `${EXT}:headline`,
  shortBio: `${EXT}:shortBio`,
  workLocation: `${EXT}:workLocation`,
};

const primary = (list) => (list ?? []).find((x) => x.primary) ?? (list ?? [])[0];

/**
 * A SCIM export: a ListResponse ({ Resources: [...] }) or a plain array of Users.
 * @param {Buffer|string} bytes
 * @returns {object[]} directory users in neutral fields
 */
export function readExport(bytes) {
  let doc;
  try { doc = JSON.parse(String(bytes).replace(/^﻿/, "")); } catch (err) { throw new Error(`the export is not JSON: ${err.message}`); }
  const list = Array.isArray(doc) ? doc : doc?.Resources;
  if (!Array.isArray(list)) throw new Error("the export is not a SCIM list (an array of Users, or an object with Resources)");
  return list.map((u, i) => {
    if (!u || typeof u !== "object" || u.id == null) throw new Error(`user ${i + 1} in the export has no id`);
    const ent = u[ENT] ?? {}, ext = u[EXT] ?? {};
    return {
      id: String(u.id),
      primaryEmail: primary(u.emails)?.value ?? (/@/.test(u.userName ?? "") ? u.userName : undefined),
      emails: [...(u.emails ?? []).map((e) => e.value), /@/.test(u.userName ?? "") ? u.userName : undefined].filter(Boolean),
      employeeNumber: ent.employeeNumber ?? u.externalId,
      givenName: u.name?.givenName, familyName: u.name?.familyName, displayName: u.displayName, nickname: u.nickName,
      title: u.title, phone: primary((u.phoneNumbers ?? []).filter((p) => !p.type || p.type === "work"))?.value, photoUrl: primary(u.photos)?.value,
      department: ent.department, division: ent.division, costCenter: ent.costCenter, managerId: ent.manager?.value, managerName: ent.manager?.displayName,
      pronouns: ext.pronouns, preferredTitle: ext.preferredTitle, headline: ext.headline, shortBio: ext.shortBio, workLocation: ext.workLocation,
    };
  });
}

/**
 * The changes as one SCIM Bulk request (RFC 7644 §3.7): a PATCH per user, a "replace" per field.
 * @returns {{ name: string, data: string, how: string }[]}
 */
export function render(changeSet) {
  const Operations = changeSet.changes.filter((c) => c.fields.length).map((c) => ({
    method: "PATCH",
    path: `/Users/${encodeURIComponent(c.user.id)}`,
    data: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: c.fields.map((f) => ({ op: "replace", path: f.attribute, value: f.to })),
    },
  }));
  const bulk = { schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"], failOnErrors: 1, Operations };
  return [{ name: "scim-bulk.json", data: JSON.stringify(bulk, null, 2) + "\n", how: "send scim-bulk.json to the directory's SCIM /Bulk endpoint" }];
}
