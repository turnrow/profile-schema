#!/usr/bin/env node
// Writes examples/directory/: a small folder of fictional people at Acme Example Corp and the
// directory's export of its users, for "directory diff". Every file comes from this script, built
// on examples/employee.profile.json, so none is edited by hand. Run: node scripts/make-directory-example.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProfile } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "examples/directory");
const base = () => JSON.parse(readFileSync(join(root, "examples/employee.profile.json"), "utf8"));
const ENT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const EXT = "urn:turnrow:params:scim:schemas:extension:profile:2.0:User";

/** A colleague of Sam's at Acme: the same shape of profile, another person. */
function colleague({ given, family, nickname, pronouns, email, number, title, official, department }, edit = (p) => p) {
  const p = base();
  p.meta.owner = `${given} ${family}`;
  p.meta.notes = "FICTIONAL SAMPLE made by scripts/make-directory-example.mjs; do not edit by hand.";
  p.person = {
    name: `${given} ${family}`,
    names: [{ type: "preferred", full: `${given} ${family}`, given, family }, ...(nickname ? [{ type: "nickname", full: nickname }] : [])],
    pronouns, jobTitle: title,
    contact: { email, emailVisibility: "network" },
  };
  const job = p.work.find((w) => w.id === "acme-platform");
  job.title = title;
  job.employerRecord = { officialTitle: official, department, employeeNumber: number };
  delete job.positions; delete job.responsibilities; delete job.metrics; delete job.highlights; delete job.media;
  p.work = [job];
  for (const k of ["service", "education", "credentials", "awards", "projects", "publications", "skills", "languages", "interests", "references", "media", "timeline", "releases"]) delete p[k];
  return edit(p);
}

const people = {
  // Sam is the example everyone knows; the directory is behind on her name and has no pronouns.
  "sam-rivera": base(),
  // Dana's directory entry is already right.
  "dana-okoye": colleague({ given: "Dana", family: "Okoye", pronouns: "they/them", email: "dana.okoye@acme.example", number: "E-104310", title: "Product Designer", official: "Product Designer II", department: "Design" }),
  // Lee has not consented, so nothing of Lee's is compared or sent.
  "lee-park": colleague({ given: "Lee", family: "Park", pronouns: "he/him", email: "lee.park@acme.example", number: "E-104377", title: "Data Analyst", official: "Data Analyst I", department: "Finance" },
    (p) => { p.meta.subjectConsent = { given: false, note: "Fictional sample." }; return p; }),
  // Jo is not in the directory export at all.
  "jo-reyes": colleague({ given: "Jo", family: "Reyes", nickname: "JR", pronouns: "she/her", email: "jo.reyes@acme.example", number: "E-104401", title: "Support Lead", official: "Support Team Lead", department: "Customer Support" }),
};

const users = [
  {
    id: "u-1001", externalId: "E-104233", userName: "sam.rivera@acme.example",
    name: { givenName: "Samantha", familyName: "Rivera" }, displayName: "Samantha Rivera",
    title: "Senior Software Engineer II", emails: [{ value: "sam.rivera@acme.example", type: "work", primary: true }],
    [ENT]: { employeeNumber: "E-104233", department: "Platform Engineering", manager: { value: "u-1000", displayName: "Avery Chen" } },
  },
  {
    id: "u-1002", externalId: "E-104310", userName: "dana.okoye@acme.example",
    name: { givenName: "Dana", familyName: "Okoye" }, displayName: "Dana Okoye",
    title: "Product Designer II", emails: [{ value: "dana.okoye@acme.example", type: "work", primary: true }],
    [ENT]: { employeeNumber: "E-104310", department: "Design" },
    [EXT]: { pronouns: "they/them", preferredTitle: "Product Designer" },
  },
  {
    id: "u-1003", externalId: "E-104377", userName: "lee.park@acme.example",
    name: { givenName: "Lee", familyName: "Park" }, displayName: "Lee Park",
    title: "Data Analyst I", emails: [{ value: "lee.park@acme.example", type: "work", primary: true }],
    [ENT]: { employeeNumber: "E-104377", department: "Finance" },
  },
  {
    id: "u-1000", externalId: "E-100001", userName: "avery.chen@acme.example",
    name: { givenName: "Avery", familyName: "Chen" }, displayName: "Avery Chen",
    title: "Director of Engineering", emails: [{ value: "avery.chen@acme.example", type: "work", primary: true }],
    [ENT]: { employeeNumber: "E-100001", department: "Engineering" },
  },
];

rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "people"), { recursive: true });
for (const [id, profile] of Object.entries(people)) {
  const check = validateProfile(profile);
  if (!check.valid) { console.error(`${id}:\n${check.errors.join("\n")}`); process.exit(1); }
  writeFileSync(join(dir, "people", `${id}.profile.json`), JSON.stringify(profile, null, 2) + "\n");
}
writeFileSync(join(dir, "acme-users.scim.json"), JSON.stringify({ schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: users.length, Resources: users }, null, 2) + "\n");

// The same four users as Google's Admin console exports them ("Download users"), and as LDIF.
const csvCell = (v) => (/[",\r\n]/.test(v ?? "") ? `"${v.replace(/"/g, '""')}"` : v ?? "");
const header = ["First Name [Required]", "Last Name [Required]", "Email Address [Required]", "Password [Required]", "Password Hash Function [UPLOAD ONLY]", "Org Unit Path [Required]", "New Primary Email [UPLOAD ONLY]", "Work Phone", "Employee ID", "Employee Title", "Department", "Cost Center", "Last Sign In [READ ONLY]"];
const units = { "u-1001": "/Engineering", "u-1002": "/Design", "u-1003": "/Finance", "u-1000": "/Engineering" };
const csv = [header, ...users.map((u) => [u.name.givenName, u.name.familyName, u.userName, "****", "", units[u.id], "", "", u[ENT].employeeNumber, u.title, u[ENT].department, "", "2026/11/01 09:00:00"])];
writeFileSync(join(dir, "acme-users.google.csv"), csv.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n");

const dn = (u) => `CN=${u.displayName},OU=People,DC=acme,DC=example`;
const ldif = ["version: 1", "", "dn: OU=People,DC=acme,DC=example", "objectClass: organizationalUnit", "ou: People", ""];
for (const u of users) {
  ldif.push(`dn: ${dn(u)}`, "objectClass: top", "objectClass: person", "objectClass: organizationalPerson", "objectClass: user",
    `givenName: ${u.name.givenName}`, `sn: ${u.name.familyName}`, `displayName: ${u.displayName}`, `mail: ${u.userName}`,
    `employeeID: ${u[ENT].employeeNumber}`, `title: ${u.title}`, `department: ${u[ENT].department}`,
    ...(u[ENT].manager ? [`manager: ${dn(users.find((x) => x.id === u[ENT].manager.value))}`] : []), "");
}
writeFileSync(join(dir, "acme-users.ldif"), ldif.join("\n"));
console.error(`wrote ${dir}`);
