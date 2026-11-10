// LDAP and on-premises Active Directory, by file: LDIF (RFC 2849). It reads an LDIF export of
// people and writes "changetype: modify" records. Applying them is ldapmodify's job (or ldifde's):
// this tool opens no connection and holds no bind password.
//
// The attribute map (settled for issue #37):
//   givenName → givenName      familyName → sn            displayName → displayName
//   phone → telephoneNumber    title → title              department → department (AD) or departmentNumber (inetOrgPerson)
//   division → division        employeeNumber → employeeNumber (inetOrgPerson) or employeeID (AD)
//   managerId → manager (a DN) workLocation → physicalDeliveryOfficeName
// A sync writes only the first four: the rest are the employer's and are compared, not changed.
// Photos (jpegPhoto, thumbnailPhoto) are not written yet: a release carries a photo's address, and
// these attributes need its bytes.

export const id = "ldif";
export const label = "LDAP / Active Directory (LDIF)";

/** Neutral field → LDAP attribute. department and employeeNumber follow what the export uses. */
export const fields = {
  givenName: "givenName",
  familyName: "sn",
  displayName: "displayName",
  phone: "telephoneNumber",
  title: "title",
  department: "department",
  division: "division",
  employeeNumber: "employeeNumber",
  managerId: "manager",
  workLocation: "physicalDeliveryOfficeName",
};
export const writable = ["givenName", "familyName", "displayName", "phone"];
const WRITABLE = writable;
const PEOPLE = new Set(["person", "organizationalperson", "inetorgperson", "user"]);

/** The entries of an LDIF file: [{ dn, attrs: { lowercased name: [values] } }]. */
export function parseLdif(text) {
  // Unfold: a line that starts with one space continues the line before it.
  const lines = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n /g, "").split("\n");
  const entries = [];
  let cur;
  for (const line of lines) {
    if (line === "") { cur = undefined; continue; }
    if (line.startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z0-9;-]*)(::?|:<)\s*(.*)$/.exec(line);
    if (!m) { if (line === "-") continue; throw new Error(`not an LDIF line: ${line.slice(0, 40)}`); }
    const name = m[1].toLowerCase().split(";")[0];
    if (m[2] === ":<") continue; // a value kept in another file is not followed
    const value = m[2] === "::" ? Buffer.from(m[3], "base64").toString("utf8") : m[3];
    if (name === "version" && !cur) continue;
    if (name === "dn") { cur = { dn: value, attrs: {} }; entries.push(cur); continue; }
    if (!cur) throw new Error(`"${m[1]}" comes before any dn`);
    (cur.attrs[name] ??= []).push(value);
  }
  return entries;
}

/** @returns {object[]} the people in an LDIF export, in neutral fields */
export function readExport(bytes) {
  const entries = parseLdif(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes);
  const one = (e, ...names) => { for (const n of names) { const v = e.attrs[n.toLowerCase()]?.[0]; if (v != null && v !== "") return v; } return undefined; };
  const seen = new Set();
  return entries.filter((e) => (e.attrs.objectclass ?? []).some((c) => PEOPLE.has(c.toLowerCase()))).map((e) => {
    if (seen.has(e.dn.toLowerCase())) throw new Error(`${e.dn} is in the export twice`);
    seen.add(e.dn.toLowerCase());
    const proxies = (e.attrs.proxyaddresses ?? []).filter((p) => /^smtp:/i.test(p)).map((p) => p.slice(5));
    return {
      id: e.dn,
      primaryEmail: one(e, "mail"),
      emails: [...(e.attrs.mail ?? []), ...proxies, ...(e.attrs.mailalternateaddress ?? [])],
      employeeNumber: one(e, "employeeNumber", "employeeID"),
      givenName: one(e, "givenName"), familyName: one(e, "sn"), displayName: one(e, "displayName"),
      phone: one(e, "telephoneNumber"), title: one(e, "title"), department: one(e, "department", "departmentNumber"), division: one(e, "division"),
      managerId: one(e, "manager"), workLocation: one(e, "physicalDeliveryOfficeName"),
    };
  });
}

// RFC 2849: a value is written as it is only when it is "safe"; anything else is base64.
const SAFE = /^[\x01-\x09\x0b\x0c\x0e-\x1f\x21-\x39\x3b\x3d-\x7f][\x01-\x09\x0b\x0c\x0e-\x7f]*$/;
const fold = (line) => { const out = [line.slice(0, 76)]; for (let i = 76; i < line.length; i += 75) out.push(` ${line.slice(i, i + 75)}`); return out.join("\n"); };
const attr = (name, value) => { const v = String(value); return fold(v !== "" && SAFE.test(v) && !v.endsWith(" ") ? `${name}: ${v}` : `${name}:: ${Buffer.from(v, "utf8").toString("base64")}`); };

/** The changes as LDIF modify records: one record per person, one "replace" per attribute. */
export function render(changeSet) {
  const out = ["version: 1", ""];
  for (const c of changeSet.changes) {
    const mods = c.fields.filter((f) => WRITABLE.includes(f.field));
    if (!mods.length) continue;
    out.push(fold(`# ${String(c.person).replace(/[\r\n]+/g, " ")}`), attr("dn", c.user.id), "changetype: modify");
    for (const f of mods) out.push(`replace: ${fields[f.field]}`, attr(fields[f.field], f.to), "-");
    out.push("");
  }
  return [{ name: "directory-changes.ldif", data: out.join("\n") + (out.at(-1) === "" ? "" : "\n"), how: "apply directory-changes.ldif with ldapmodify (or ldifde -i on Active Directory), after a dry run with ldapmodify -n" }];
}
