// The file connectors: Google Workspace's bulk-update CSV and LDIF. Each reads the directory's own
// export and writes a file a person applies; neither opens a connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTORY_CONNECTORS, DIRECTORY_FIELDS, readProfileFolder, diffDirectory, changeReport } from "../index.mjs";
import { parseCsv } from "../lib/directory/google-csv.mjs";
import { parseLdif } from "../lib/directory/ldif.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PEOPLE = join(root, "examples/directory/people");
const ON = "2026-11-07";
const requester = { domain: "acme.example", method: "oidc" };
const google = DIRECTORY_CONNECTORS["google-csv"], ldif = DIRECTORY_CONNECTORS.ldif;
const GOOGLE = readFileSync(join(root, "examples/directory/acme-users.google.csv"), "utf8");
const LDIF = readFileSync(join(root, "examples/directory/acme-users.ldif"), "utf8");
const run = (connector, users, profiles = readProfileFolder(PEOPLE)) => diffDirectory({ profiles, users, connector, requester, on: ON, now: `${ON}T00:00:00.000Z` });
const edited = (name, edit) => readProfileFolder(PEOPLE).map((p) => (p.name === `${name}.profile.json` ? { ...p, profile: edit(structuredClone(p.profile)) } : p));
const sam = (r) => r.changeSet.changes.find((c) => c.person === "Sam Rivera");

test("every connector has the same shape and only known fields", () => {
  for (const c of Object.values(DIRECTORY_CONNECTORS)) {
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.equal(typeof c.label, "string");
    assert.equal(typeof c.readExport, "function");
    assert.equal(typeof (c.render ?? c.write), "function", "a file to apply, or requests to send");
    for (const f of [...Object.keys(c.fields), ...(c.writable ?? [])]) assert.ok(DIRECTORY_FIELDS.some((x) => x.field === f), `${c.id}: ${f}`);
    for (const f of c.writable ?? []) assert.ok(c.fields[f], `${c.id} names the attribute it writes ${f} to`);
  }
});

test("CSV: quoted fields, doubled quotes, line breaks in quotes, a byte-order mark", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",\n'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", ""]]);
  assert.deepEqual(parseCsv("a,b"), [["a", "b"]]);
  assert.deepEqual(parseCsv("a\n\n\nb\n"), [["a"], ["b"]]);
  assert.throws(() => parseCsv('a,"open'), /never closed/);
});

test("Google: the export is read by its headers, whatever their case or bracketed note", () => {
  const users = google.readExport(GOOGLE);
  assert.equal(users.length, 4);
  const u = users.find((x) => x.primaryEmail === "sam.rivera@acme.example");
  assert.deepEqual([u.givenName, u.familyName, u.employeeNumber, u.title, u.department], ["Samantha", "Rivera", "E-104233", "Senior Software Engineer II", "Platform Engineering"]);
  assert.deepEqual(u.keep, { givenName: "Samantha", familyName: "Rivera", orgUnitPath: "/Engineering" });
  const relabelled = GOOGLE.replace("First Name [Required]", "first name").replace("Employee ID", "Employee ID [READ ONLY]");
  assert.equal(google.readExport(relabelled).find((x) => x.employeeNumber === "E-104233").givenName, "Samantha");
  assert.throws(() => google.readExport("Name,Email\nA,a@x.example\n"), /no "Email Address \[Required\]" column/);
  assert.throws(() => google.readExport(GOOGLE + GOOGLE.split("\r\n")[1] + "\r\n"), /in the export twice/);
  assert.throws(() => google.readExport(""), /empty/);
});

test("Google: one row per changed user, with what Google requires and nothing it should not touch", () => {
  const r = run(google, google.readExport(GOOGLE));
  assert.deepEqual(sam(r).fields.map((f) => f.field), ["givenName"], "only what the file can carry is called a change");
  const [file] = google.render(r.changeSet);
  assert.equal(file.name, "google-bulk-update.csv");
  const rows = parseCsv(file.data);
  assert.deepEqual(rows, [
    ["First Name [Required]", "Last Name [Required]", "Email Address [Required]", "Password [Required]", "Org Unit Path [Required]"],
    ["Sam", "Rivera", "sam.rivera@acme.example", "****", "/Engineering"],
  ]);
  assert.doesNotMatch(file.data, /New Primary Email|New Status|New Licenses|Password Hash/, "no column that renames, suspends or licenses a user");
  assert.ok(file.data.endsWith("\r\n"));
  assert.equal(file.data.charCodeAt(0) === 0xfeff, false, "plain ASCII needs no byte-order mark");
});

test("Google: what the file cannot carry is reported, not promised", () => {
  const r = run(google, google.readExport(GOOGLE));
  const md = changeReport(r.changeSet, { sha256: r.sha256 });
  assert.match(md, /\| Sam Rivera \| department \| Platform Engineering \| Engineering \| the employer is the authority \|/);
  assert.doesNotMatch(md, /pronouns|nickname/, "fields Google's file has no column for are not mentioned as changes");
  // A job with no official title: the title is the person's own, and Google's file still does not write it.
  const own = run(google, google.readExport(GOOGLE), edited("sam-rivera", (p) => { delete p.work.find((w) => w.id === "acme-platform").employerRecord.officialTitle; return p; }));
  const note = sam(own).notes.find((n) => n.field === "title");
  assert.match(note.reason, /does not write this field/);
  assert.equal(sam(own).fields.some((f) => f.field === "title"), false);
});

test("Google: a phone the audience grants gets its column; other text gets a byte-order mark", () => {
  const profiles = edited("sam-rivera", (p) => {
    p.person.contact.phoneVisibility = "network";
    p.audiences["current-employer"].person.push("phone");
    p.person.names.find((n) => n.type === "preferred").given = "Samanta-Inés";
    return p;
  });
  const r = run(google, google.readExport(GOOGLE), profiles);
  const [file] = google.render(r.changeSet);
  assert.equal(file.data.charCodeAt(0), 0xfeff);
  const rows = parseCsv(file.data);
  assert.equal(rows[0].at(-1), "Work Phone");
  assert.deepEqual(rows[1], ["Samanta-Inés", "Rivera", "sam.rivera@acme.example", "****", "/Engineering", "+1-555-0142"]);
});

test("Google: a name a spreadsheet would run, or one too long, stops the file", () => {
  const bad = (given) => run(google, google.readExport(GOOGLE), edited("sam-rivera", (p) => { p.person.names.find((n) => n.type === "preferred").given = given; return p; }));
  assert.throws(() => google.render(bad("=HYPERLINK(1)").changeSet), /spreadsheet/);
  assert.throws(() => google.render(bad("@sum").changeSet), /spreadsheet/);
  assert.throws(() => google.render(bad("x".repeat(61)).changeSet), /60 characters/);
  const noUnit = google.readExport(GOOGLE).map((u) => ({ ...u, keep: { ...u.keep, orgUnitPath: undefined } }));
  assert.throws(() => google.render(run(google, noUnit).changeSet), /organizational unit/);
});

test("LDIF: folded lines, base64 values, comments and several values are read", () => {
  const entries = parseLdif("version: 1\n# a comment\ndn: CN=Zoë,DC=x\nobjectClass: person\nsn:: WsO2ZQ==\ndescription: a long\n  line\nmail: a@x.example\nmail: b@x.example\n\ndn:: Q049w4ksREM9eA==\nobjectClass: person\n");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].attrs.sn[0], "Zöe");
  assert.equal(entries[0].attrs.description[0], "a long line");
  assert.deepEqual(entries[0].attrs.mail, ["a@x.example", "b@x.example"]);
  assert.equal(entries[1].dn, "CN=É,DC=x");
  assert.throws(() => parseLdif("sn: x\n"), /before any dn/);
  assert.throws(() => parseLdif("dn: x\nnot a line\n"), /not an LDIF line/);
});

test("LDIF: people are read with either directory's attribute names; other entries are skipped", () => {
  const users = ldif.readExport(LDIF);
  assert.equal(users.length, 4, "the organizational unit is not a person");
  const u = users.find((x) => x.primaryEmail === "sam.rivera@acme.example");
  assert.equal(u.id, "CN=Samantha Rivera,OU=People,DC=acme,DC=example");
  assert.equal(u.employeeNumber, "E-104233", "employeeID, as Active Directory names it");
  assert.equal(u.managerId, "CN=Avery Chen,OU=People,DC=acme,DC=example");
  const open = ldif.readExport("dn: uid=pat,ou=people,dc=x\nobjectClass: inetOrgPerson\nemployeeNumber: 7\ndepartmentNumber: Ops\nmail: pat@x.example\nproxyAddresses: smtp:p@x.example\nproxyAddresses: X500:/o=x\n");
  assert.deepEqual([open[0].employeeNumber, open[0].department, open[0].emails], ["7", "Ops", ["pat@x.example", "p@x.example"]]);
});

test("LDIF: modify records that replace only the person's own attributes", () => {
  const r = run(ldif, ldif.readExport(LDIF));
  assert.deepEqual(sam(r).fields.map((f) => f.field), ["givenName", "displayName"]);
  assert.ok(sam(r).notes.some((n) => n.field === "department"));
  const [file] = ldif.render(r.changeSet);
  assert.equal(file.name, "directory-changes.ldif");
  assert.equal(file.data, [
    "version: 1", "",
    "# Sam Rivera",
    "dn: CN=Samantha Rivera,OU=People,DC=acme,DC=example",
    "changetype: modify",
    "replace: givenName", "givenName: Sam", "-",
    "replace: displayName", "displayName: Sam Rivera", "-",
    "",
  ].join("\n"));
  assert.doesNotMatch(file.data, /changetype: (add|delete|modrdn|moddn)|^delete:|^add:/m, "nothing is added, deleted or renamed");
  const back = parseLdif(file.data);
  assert.equal(back[0].attrs.changetype[0], "modify");
});

test("LDIF: values that are not plain ASCII are base64, long lines are folded, and they read back", () => {
  const long = "Zoë " + "Mariana ".repeat(12).trim();
  const r = run(ldif, ldif.readExport(LDIF), edited("sam-rivera", (p) => { p.person.name = long; p.person.names.find((n) => n.type === "preferred").full = long; p.person.names.find((n) => n.type === "preferred").given = " Sam"; return p; }));
  const [file] = ldif.render(r.changeSet);
  assert.match(file.data, /^displayName:: /m);
  assert.ok(file.data.split("\n").every((l) => l.length <= 76), "no line is longer than 76 characters");
  const entry = parseLdif(file.data)[0];
  assert.equal(entry.attrs.displayname[0], long);
  assert.match(file.data, /^givenName: Sam$/m, "a stray space around a value is not sent");
});
