// Directory sync: a folder of profiles compared with a directory export. Every update is a release;
// fields the employer is the authority for are compared, never pushed; nothing is applied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, cpSync, readdirSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DIRECTORY_CONNECTORS, DIRECTORY_FIELDS, readProfileFolder, matchUser, diffDirectory, changeReport, validateProfile } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PEOPLE = join(root, "examples/directory/people");
const EXPORT = join(root, "examples/directory/acme-users.scim.json");
const scim = DIRECTORY_CONNECTORS.scim;
const ON = "2026-11-07";
const requester = { domain: "acme.example", method: "oidc" };
const users = () => scim.readExport(readFileSync(EXPORT));
const run = (over = {}) => diffDirectory({ profiles: readProfileFolder(PEOPLE), users: users(), connector: scim, requester, on: ON, now: `${ON}T00:00:00.000Z`, ...over });
const change = (r, person) => r.changeSet.changes.find((c) => c.person === person);
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin/profile.mjs"), ...args], { encoding: "utf8" });
const edited = (name, edit) => readProfileFolder(PEOPLE).map((p) => (p.name === `${name}.profile.json` ? { ...p, profile: edit(structuredClone(p.profile)) } : p));

test("the folder reader takes profiles and bundles, and follows no links", () => {
  const dir = mkdtempSync(join(tmpdir(), "dir-"));
  cpSync(join(PEOPLE, "sam-rivera.profile.json"), join(dir, "sam.profile.json"));
  mkdirSync(join(dir, "ines"));
  cpSync(join(root, "examples/recommended/profile.json"), join(dir, "ines/profile.json"));
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "README.md"), "not a profile");
  writeFileSync(join(dir, "other.json"), "{}");
  writeFileSync(join(dir, "broken.profile.json"), "{ not json");
  try { symlinkSync(join(PEOPLE, "dana-okoye.profile.json"), join(dir, "linked.profile.json")); } catch { /* no links on this system */ }
  const found = readProfileFolder(dir);
  assert.deepEqual(found.map((p) => p.name), ["broken.profile.json", "ines", "sam.profile.json"]);
  assert.match(found[0].error, /not valid JSON/);
  assert.equal(found[1].bundleDir, join(dir, "ines"));
});

test("a person's own fields become changes; the employer's are only noted", () => {
  const sam = change(run(), "Sam Rivera");
  assert.equal(sam.matchedBy, "employee number");
  assert.deepEqual(sam.fields.map((f) => f.field), ["givenName", "displayName", "nickname", "pronouns", "preferredTitle", "photoUrl", "shortBio"]);
  assert.deepEqual(sam.fields[0], { field: "givenName", attribute: "name.givenName", from: "Samantha", to: "Sam" });
  assert.deepEqual(sam.notes.map((n) => n.field), ["department", "workLocation"]);
  assert.equal(sam.notes[0].directory, "Platform Engineering");
  assert.equal(sam.notes[0].profile, "Engineering");
  const pushed = new Set(run().changeSet.changes.flatMap((c) => c.fields.map((f) => f.field)));
  for (const f of ["title", "department", "division", "costCenter", "employeeNumber", "managerId", "managerName"]) assert.equal(pushed.has(f), false, `${f} is the employer's`);
});

test("someone already up to date has no changes, and still has a receipt", () => {
  const r = run();
  assert.deepEqual(change(r, "Dana Okoye").fields, []);
  assert.equal(r.receipts.length, 2);
  assert.equal(r.receipts[0].receipt.subject.length > 0, true);
  assert.equal(r.changeSet.usersWithoutProfile, 2);
});

test("people are left out, with the reason: no consent, no user, no audience, wrong employer, not valid", () => {
  const r = run();
  assert.deepEqual(r.changeSet.refusals.map((x) => [x.profile, x.code]), [["jo-reyes.profile.json", "noMatchingUser"], ["lee-park.profile.json", "noConsent"]]);
  assert.equal(JSON.stringify(r.changeSet.changes).includes("Lee Park"), false, "nothing of a person who has not consented is compared or kept");

  const other = diffDirectory({ profiles: readProfileFolder(PEOPLE), users: users(), connector: scim, requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  assert.equal(other.changeSet.changes.length, 0, "another employer's administrator gets nothing");
  assert.ok(other.changeSet.refusals.every((x) => ["notGranted", "noConsent"].includes(x.code)));

  const weak = diffDirectory({ profiles: readProfileFolder(PEOPLE), users: users(), connector: scim, requester: { domain: "acme.example", method: "emailDomain" }, on: ON });
  assert.equal(weak.changeSet.changes.length, 0, "a method the audience does not accept is refused");

  const none = run({ profiles: edited("sam-rivera", (p) => { p.audiences["current-employer"].purpose = "onboarding"; return p; }) });
  assert.equal(none.changeSet.refusals.find((x) => x.profile === "sam-rivera.profile.json").code, "noAudience");
  const invalid = run({ profiles: edited("sam-rivera", (p) => { p.work[0].status = "nonsense"; return p; }) });
  assert.equal(invalid.changeSet.refusals.find((x) => x.profile === "sam-rivera.profile.json").code, "invalidProfile");
  const named = run({ audience: "former-employers" });
  assert.equal(named.changeSet.changes.length, 0, "a named audience that does not cover this employer today gives nothing");
});

test("a job that has ended ends the sync for that employer", () => {
  const gone = run({ profiles: edited("sam-rivera", (p) => { const w = p.work.find((x) => x.id === "acme-platform"); w.current = false; w.endDate = "2026-10-31"; return p; }) });
  const refusal = gone.changeSet.refusals.find((x) => x.profile === "sam-rivera.profile.json");
  assert.equal(refusal.code, "notGranted");
  assert.match(refusal.reason, /ended|qualif/);
});

test("matching: employee number, then e-mail, never a name; two candidates is a refusal", () => {
  const list = [
    { id: "1", primaryEmail: "a@x.example", emails: ["a@x.example", "alias@x.example"], employeeNumber: "E1", displayName: "Pat Lee" },
    { id: "2", primaryEmail: "b@x.example", emails: ["b@x.example"], employeeNumber: "E2", displayName: "Pat Lee" },
  ];
  assert.equal(matchUser({ employeeNumber: "E2", primaryEmail: "a@x.example" }, list).user.id, "2", "the employee number wins");
  assert.equal(matchUser({ primaryEmail: "A@X.example" }, list).user.id, "1");
  assert.equal(matchUser({ primaryEmail: "alias@x.example" }, list).by, "another e-mail address");
  assert.equal(matchUser({ displayName: "Pat Lee" }, list).code, "noMatchingUser");
  assert.equal(matchUser({ employeeNumber: "E1" }, [...list, { id: "3", employeeNumber: "E1" }]).code, "ambiguousUser");
  const twins = run({ profiles: [...readProfileFolder(PEOPLE), { ...readProfileFolder(PEOPLE).find((p) => p.name.startsWith("sam")), name: "sam-again.profile.json" }] });
  assert.match(twins.changeSet.refusals.find((x) => x.profile === "sam-again.profile.json").reason, /already matched/);
});

test("a value the release does not carry never clears the directory's", () => {
  const list = users();
  list.find((u) => u.id === "u-1002").headline = "Old headline";
  list.find((u) => u.id === "u-1002").phone = "+1 555 0100";
  const dana = change(run({ users: list }), "Dana Okoye");
  assert.deepEqual(dana.fields, []);
  assert.equal(dana.notes.some((n) => n.field === "phone"), false);
});

test("an audience can hand the person a field that is the employer's by default", () => {
  const r = run({ profiles: edited("sam-rivera", (p) => { p.audiences["current-employer"].writeBack.authority.unshift({ field: "employerRecord.workLocation", authority: "subject" }); return p; }) });
  assert.equal(validateProfile(edited("sam-rivera", (p) => { p.audiences["current-employer"].writeBack.authority.unshift({ field: "employerRecord.workLocation", authority: "subject" }); return p; }).find((p) => p.name.startsWith("sam")).profile).valid, true);
  assert.ok(change(r, "Sam Rivera").fields.some((f) => f.field === "workLocation"));
});

test("the same run gives the same change set and hash; the hash changes with the content", () => {
  const a = run(), b = run();
  assert.equal(a.text, b.text);
  assert.equal(a.sha256, b.sha256);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(run({ on: "2026-11-08", now: "2026-11-08T00:00:00.000Z" }).sha256, a.sha256);
  assert.equal(a.changeSet.changeSetVersion, 1);
  assert.equal(a.changeSet.target, "scim");
});

test("the report says what will change, what will not, and who was left out; it is safe Markdown", () => {
  const r = run();
  const md = changeReport(r.changeSet, { sha256: r.sha256, files: ["send scim-bulk.json"] });
  assert.match(md, /^# Directory change report\n\n\*\*Internal\.\*\*/);
  assert.match(md, new RegExp(r.sha256));
  assert.match(md, /Nothing has been changed/);
  assert.match(md, /\| givenName \| name\.givenName \| Samantha \| Sam \|/);
  assert.match(md, /\| Sam Rivera \| department \| Platform Engineering \| Engineering \|/);
  assert.match(md, /\| lee-park\.profile\.json \| Lee Park \| the subject has not given consent/);
  const headings = md.split("\n").filter((l) => /^#+ /.test(l)).map((l) => l.match(/^#+/)[0].length);
  assert.equal(headings[0], 1);
  for (let i = 1; i < headings.length; i++) assert.ok(headings[i] - headings[i - 1] <= 1, "no heading level is skipped");
  const hostile = run({ profiles: edited("sam-rivera", (p) => { p.person.pronouns = "she|her <b>*x*</b>"; return p; }) });
  const text = changeReport(hostile.changeSet, { sha256: hostile.sha256 });
  assert.match(text, /she\\\|her &lt;b&gt;\\\*x\\\*&lt;\/b&gt;/);
});

test("the SCIM connector reads a list or an array, and writes one bulk request of replaces", () => {
  assert.equal(scim.readExport(JSON.stringify(JSON.parse(readFileSync(EXPORT, "utf8")).Resources)).length, 4);
  assert.throws(() => scim.readExport("{}"), /not a SCIM list/);
  assert.throws(() => scim.readExport("nope"), /not JSON/);
  assert.throws(() => scim.readExport(JSON.stringify([{ userName: "x" }])), /no id/);
  const [file] = scim.render(run().changeSet);
  const bulk = JSON.parse(file.data);
  assert.equal(file.name, "scim-bulk.json");
  assert.equal(bulk.Operations.length, 1, "only people with changes");
  assert.equal(bulk.Operations[0].path, "/Users/u-1001");
  assert.ok(bulk.Operations[0].data.Operations.every((o) => o.op === "replace" && o.value !== undefined && o.value !== ""));
  for (const f of Object.keys(scim.fields)) assert.ok(DIRECTORY_FIELDS.some((x) => x.field === f), `${f} is a known field`);
});

test("the command writes the change set, the report, the receipts and the connector's file, and changes nothing", () => {
  const out = mkdtempSync(join(tmpdir(), "dir-out-"));
  const before = readFileSync(join(PEOPLE, "sam-rivera.profile.json"), "utf8");
  const r = cli("directory", "diff", PEOPLE, "--against", EXPORT, "--target", "scim", "--domain", "acme.example", "--method", "oidc", "--on", ON, "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /1 person has changes, 1 up to date, 2 left out\. Nothing was changed in the directory\./);
  assert.deepEqual(readdirSync(out).sort(), ["change-set.json", "changes", "receipts", "refusals.json", "report.md", "scim-bulk.json"]);
  assert.deepEqual(readdirSync(join(out, "changes")), ["dana.okoye-acme.example.json", "sam.rivera-acme.example.json"]);
  assert.equal(readFileSync(join(out, "change-set.json"), "utf8"), run({ exportSha256: JSON.parse(readFileSync(join(out, "change-set.json"), "utf8")).against.sha256 }).text);
  assert.equal(readFileSync(join(PEOPLE, "sam-rivera.profile.json"), "utf8"), before, "profiles are read-only without --record");
  assert.equal(readFileSync(join(out, "report.md"), "utf8"), readFileSync(join(root, "examples/out/directory/report.md"), "utf8"), "the committed example is current");
});

test("--record adds each release to its profile; wrong usage says what is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "dir-rec-"));
  cpSync(PEOPLE, join(dir, "people"), { recursive: true });
  const r = cli("directory", "diff", join(dir, "people"), "--against", EXPORT, "--target", "scim", "--domain", "acme.example", "--method", "oidc", "--on", ON, "--out", join(dir, "out"), "--record");
  assert.equal(r.status, 0, r.stderr);
  const sam = JSON.parse(readFileSync(join(dir, "people/sam-rivera.profile.json"), "utf8"));
  assert.equal(sam.releases.at(-1).format, "scim");
  assert.equal(validateProfile(sam).valid, true);
  assert.equal(JSON.parse(readFileSync(join(dir, "people/lee-park.profile.json"), "utf8")).releases, undefined);

  const need = (args, re) => { const x = cli("directory", "diff", ...args); assert.equal(x.status, 2, x.stderr); assert.match(x.stderr, re); };
  need([PEOPLE, "--against", EXPORT, "--out", dir, "--domain", "acme.example", "--method", "oidc"], /needs --target: one of scim/);
  need([PEOPLE, "--target", "scim", "--out", dir, "--domain", "acme.example", "--method", "oidc"], /needs --against/);
  need([PEOPLE, "--target", "scim", "--against", EXPORT, "--domain", "acme.example", "--method", "oidc"], /needs --out/);
  need([PEOPLE, "--target", "scim", "--against", EXPORT, "--out", dir], /needs --method and --domain/);
  const empty = mkdtempSync(join(tmpdir(), "dir-empty-"));
  const none = cli("directory", "diff", empty, "--against", EXPORT, "--target", "scim", "--domain", "acme.example", "--method", "oidc", "--out", join(dir, "o2"));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /holds no profiles/);
  assert.equal(existsSync(join(dir, "o2")), false);
});
