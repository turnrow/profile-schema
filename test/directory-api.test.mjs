// The connectors that call a directory's API, and "directory apply". No test here reaches a real
// directory: requests are checked as data, and applying runs against a stand-in for fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DIRECTORY_CONNECTORS, DIRECTORY_FIELDS, readProfileFolder, diffDirectory } from "../index.mjs";
import { API_CONNECTORS, withMap, planRequests, applyChangeSet, ApplyRefusedError, setPath, getPath } from "../lib/directory/api.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PEOPLE = join(root, "examples/directory/people");
const ON = "2026-11-07";
const requester = { domain: "acme.example", method: "oidc" };
const sha256 = (t) => createHash("sha256").update(t).digest("hex");
const cli = (args, env = {}) => spawnSync(process.execPath, [join(root, "bin/profile.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const run = (connector, exportDoc) => diffDirectory({ profiles: readProfileFolder(PEOPLE), users: connector.readExport(JSON.stringify(exportDoc)), connector, requester, on: ON, now: `${ON}T00:00:00.000Z` });

// Sam and Dana as each directory's API returns a user (shapes from each vendor's reference).
const EXPORTS = {
  google: { users: [
    { id: "1001", primaryEmail: "sam.rivera@acme.example", name: { givenName: "Samantha", familyName: "Rivera", displayName: "Samantha Rivera" }, aliases: ["srivera@acme.example"],
      organizations: [{ primary: true, title: "Senior Software Engineer II", department: "Platform Engineering" }], externalIds: [{ type: "organization", value: "E-104233" }],
      relations: [{ type: "manager", value: "avery.chen@acme.example" }], phones: [{ type: "work", value: "+1 512 555 0100" }] },
    { id: "1002", primaryEmail: "dana.okoye@acme.example", name: { givenName: "Dana", familyName: "Okoye", displayName: "Dana Okoye" }, externalIds: [{ type: "organization", value: "E-104310" }],
      customSchemas: { TurnrowProfile: { pronouns: "they/them", preferredTitle: "Product Designer" } } },
  ] },
  entra: { value: [
    { id: "aaaa-1001", mail: "sam.rivera@acme.example", userPrincipalName: "sam.rivera@acme.example", givenName: "Samantha", surname: "Rivera", displayName: "Samantha Rivera", jobTitle: "Senior Software Engineer II", department: "Platform Engineering", employeeId: "E-104233", businessPhones: [], manager: { id: "aaaa-1000", displayName: "Avery Chen" } },
    { id: "aaaa-1002", mail: "dana.okoye@acme.example", userPrincipalName: "dana.okoye@acme.example", givenName: "Dana", surname: "Okoye", displayName: "Dana Okoye", employeeId: "E-104310", onPremisesExtensionAttributes: { extensionAttribute1: "they/them" } },
  ] },
  okta: [
    { id: "00u1001", status: "ACTIVE", profile: { login: "sam.rivera@acme.example", email: "sam.rivera@acme.example", firstName: "Samantha", lastName: "Rivera", displayName: "Samantha Rivera", title: "Senior Software Engineer II", department: "Platform Engineering", employeeNumber: "E-104233" } },
    { id: "00u1002", status: "ACTIVE", profile: { login: "dana.okoye@acme.example", email: "dana.okoye@acme.example", firstName: "Dana", lastName: "Okoye", displayName: "Dana Okoye", employeeNumber: "E-104310" } },
  ],
  onelogin: [
    { id: 1001, email: "sam.rivera@acme.example", username: "sam.rivera@acme.example", firstname: "Samantha", lastname: "Rivera", title: "Senior Software Engineer II", department: "Platform Engineering", external_id: "E-104233", manager_user_id: 1000, custom_attributes: { pronouns: null } },
    { id: 1002, email: "dana.okoye@acme.example", username: "dana.okoye@acme.example", firstname: "Dana", lastname: "Okoye", external_id: "E-104310", custom_attributes: { pronouns: "they/them" } },
  ],
};
const ENV = { OKTA_ORG_URL: "https://acme.okta.example", ONELOGIN_URL: "https://acme.onelogin.example" };
const sam = (r) => r.changeSet.changes.find((c) => c.person === "Sam Rivera");

test("every API connector has the same shape, known fields, and writes none of the employer's", () => {
  assert.deepEqual(Object.keys(API_CONNECTORS), ["google", "entra", "okta", "onelogin"]);
  const employers = ["title", "department", "division", "costCenter", "employeeNumber", "managerId", "managerName", "workLocation"];
  for (const c of Object.values(API_CONNECTORS)) {
    assert.equal(DIRECTORY_CONNECTORS[c.id], c);
    for (const f of [...Object.keys(c.fields), ...c.writable, ...(c.custom?.fields ?? [])]) assert.ok(DIRECTORY_FIELDS.some((x) => x.field === f), `${c.id}: ${f}`);
    for (const f of c.writable) assert.equal(employers.includes(f), false, `${c.id} never writes ${f}`);
    for (const f of c.custom?.fields ?? []) assert.equal(employers.includes(f), false, `${c.id} can't be mapped to write ${f}`);
    assert.match(c.tokenEnv, /^[A-Z_]+$/);
    assert.equal(c.render, undefined, "an API connector has no file to upload");
  }
});

test("each directory's users are read into the same neutral fields", () => {
  for (const [id, doc] of Object.entries(EXPORTS)) {
    const users = API_CONNECTORS[id].readExport(JSON.stringify(doc));
    const u = users[0];
    assert.deepEqual([u.primaryEmail, u.givenName, u.familyName, u.employeeNumber, u.title, u.department], ["sam.rivera@acme.example", "Samantha", "Rivera", "E-104233", "Senior Software Engineer II", "Platform Engineering"], id);
    assert.equal(typeof u.id, "string", id);
    assert.equal(u.raw, undefined, "the raw record is not kept in the neutral user");
    assert.throws(() => API_CONNECTORS[id].readExport("{}"), /not a list of users/, id);
  }
  assert.ok(API_CONNECTORS.google.readExport(JSON.stringify(EXPORTS.google))[0].emails.includes("srivera@acme.example"));
  assert.equal(API_CONNECTORS.google.readExport(JSON.stringify(EXPORTS.google))[0].managerId, "avery.chen@acme.example");
  assert.equal(API_CONNECTORS.onelogin.readExport(JSON.stringify(EXPORTS.onelogin))[0].managerId, "1000");
});

test("the requests: one per person with changes, the documented method and address, only the person's own fields", () => {
  const expected = {
    google: ["PATCH", "https://admin.googleapis.com/admin/directory/v1/users/1001", { name: { givenName: "Sam", displayName: "Sam Rivera" }, customSchemas: { TurnrowProfile: { nickname: "Sam", pronouns: "she/her", preferredTitle: "Platform Engineering Lead", shortBio: sam(run(API_CONNECTORS.google, EXPORTS.google)).fields.find((f) => f.field === "shortBio").to } } }],
    entra: ["PATCH", "https://graph.microsoft.com/v1.0/users/aaaa-1001", { givenName: "Sam", displayName: "Sam Rivera" }],
    okta: ["POST", "https://acme.okta.example/api/v1/users/00u1001", { profile: { firstName: "Sam", displayName: "Sam Rivera", nickName: "Sam" } }],
    onelogin: ["PUT", "https://acme.onelogin.example/api/2/users/1001", { firstname: "Sam" }],
  };
  for (const [id, [method, url, body]] of Object.entries(expected)) {
    const plan = planRequests(run(API_CONNECTORS[id], EXPORTS[id]).changeSet, API_CONNECTORS[id], ENV);
    assert.equal(plan.length, 1, `${id}: Dana is up to date`);
    assert.deepEqual([plan[0].method, plan[0].url], [method, url], id);
    assert.deepEqual(plan[0].body, body, id);
    assert.doesNotMatch(JSON.stringify(plan[0].body), /Engineer II|department|jobTitle|employee|manager|password|suspend|orgUnit/i, `${id}: nothing of the employer's, nothing about the account`);
  }
  assert.throws(() => planRequests(run(API_CONNECTORS.okta, EXPORTS.okta).changeSet, API_CONNECTORS.okta, {}), /set OKTA_ORG_URL/);
  assert.throws(() => planRequests(run(API_CONNECTORS.okta, EXPORTS.okta).changeSet, API_CONNECTORS.okta, { OKTA_ORG_URL: "http://plain.example/x" }), /set OKTA_ORG_URL/);
});

test("--map sends a person's field to an attribute the administrator names, and no other kind of field", () => {
  const mapped = withMap(API_CONNECTORS.entra, "pronouns=extensionAttribute1, preferredTitle=extensionAttribute2");
  const plan = planRequests(run(mapped, EXPORTS.entra).changeSet, mapped, ENV);
  assert.deepEqual(plan[0].body, { givenName: "Sam", displayName: "Sam Rivera", onPremisesExtensionAttributes: { extensionAttribute1: "she/her", extensionAttribute2: "Platform Engineering Lead" } });
  assert.equal(run(mapped, EXPORTS.entra).changeSet.changes.find((c) => c.person === "Dana Okoye").fields.some((f) => f.field === "pronouns"), false, "Dana's are already there");
  assert.equal(API_CONNECTORS.entra.fields.pronouns, undefined, "the connector itself is not changed");
  assert.throws(() => withMap(API_CONNECTORS.entra, "department=extensionAttribute3"), /can map pronouns/);
  assert.throws(() => withMap(API_CONNECTORS.entra, "pronouns=a.b"), /not an attribute name/);
  assert.throws(() => withMap(API_CONNECTORS.entra, "pronouns=__proto__x y"), /not an attribute name/);
  assert.throws(() => withMap(API_CONNECTORS.google, "pronouns=x"), /--map is not used by google/);
  assert.equal(withMap(API_CONNECTORS.okta, "pronouns=pronouns").fields.pronouns, "profile.pronouns");
  assert.equal(withMap(API_CONNECTORS.onelogin, "pronouns=pronouns").fields.pronouns, "custom_attributes.pronouns");
  assert.deepEqual(setPath({}, "a.b.c", 1), { a: { b: { c: 1 } } });
  assert.equal(getPath({ a: [{ b: 2 }] }, "a.0.b"), 2);
});

/** A stand-in directory: answers GET with a user, records every request, can be told to fail. */
function fakeDirectory(connector, doc, { failOn, drift } = {}) {
  const list = Array.isArray(doc) ? doc : doc.users ?? doc.value ?? doc.data;
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const id = decodeURIComponent(new URL(url).pathname.split("/").pop());
    const user = structuredClone(list.find((u) => String(u.id) === id));
    if (!user) return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
    if (init.method === "GET") { drift?.(user); return { ok: true, status: 200, json: async () => user, text: async () => "" }; }
    if (failOn === id) return { ok: false, status: 403, json: async () => ({}), text: async () => "Insufficient permission for token abc" };
    return { ok: true, status: connector.id === "entra" ? 204 : 200, json: async () => ({}), text: async () => "" };
  };
  return { fetch, calls };
}
const apply = (connector, doc, over = {}, dir) => {
  const r = run(connector, doc);
  const d = dir ?? fakeDirectory(connector, doc);
  return applyChangeSet({ text: r.text, connector, approved: r.sha256, token: "secret-token", fetch: d.fetch, env: ENV, today: ON, clock: () => "2026-11-07T12:00:00.000Z", ...over }).then((result) => ({ result, calls: d.calls, r }));
};

test("apply: reads each user again, sends one request, logs each field against its release, and gives a rollback", async () => {
  for (const id of Object.keys(API_CONNECTORS)) {
    const connector = API_CONNECTORS[id];
    const { result, calls, r } = await apply(connector, EXPORTS[id]);
    const fields = sam(r).fields;
    assert.deepEqual(calls.map((c) => c.method), ["GET", planRequests(r.changeSet, connector, ENV)[0].method], id);
    assert.deepEqual(calls[1].body, planRequests(r.changeSet, connector, ENV)[0].body, id);
    assert.equal(calls[1].headers.authorization, "Bearer secret-token");
    assert.equal(result.applied, fields.length, id);
    assert.equal(result.stoppedAt, undefined);
    assert.ok(result.log.every((l) => l.result === "applied" && l.release === sam(r).release.id && l.time), id);
    assert.doesNotMatch(JSON.stringify(result), /secret-token|authorization/i, "the token is in no log and no file");
    // The rollback puts back what was there; a field that was empty before is not in it.
    const back = result.rollback.changes[0].fields;
    assert.deepEqual(back.find((f) => f.field === "givenName"), { field: "givenName", attribute: connector.fields.givenName, from: "Sam", to: "Samantha" }, id);
    assert.ok(back.every((f) => f.to), id);
    assert.equal(result.rollback.rollbackOf, r.sha256);
    assert.deepEqual(result.rollback.refusals, []);
  }
});

test("apply is refused unless it is the change set that was approved, recent, and for this connector", async () => {
  const c = API_CONNECTORS.google;
  const refused = (over, re) => assert.rejects(apply(c, EXPORTS.google, over), (e) => e instanceof ApplyRefusedError && re.test(e.message));
  await refused({ approved: undefined }, /not the change set that was approved/);
  await refused({ approved: "0".repeat(64) }, /not the change set that was approved/);
  await refused({ today: "2026-11-20" }, /13 days from today/);
  await refused({ today: "2026-11-01" }, /run "directory diff" again/);
  await refused({ token: "" }, /no access token/);
  await refused({ connector: API_CONNECTORS.entra }, /made for google, not entra/);
  const r = run(c, EXPORTS.google);
  const edited = r.text.replace('"Sam"', '"Samuel"');
  await assert.rejects(applyChangeSet({ text: edited, connector: c, approved: r.sha256, token: "t", fetch: async () => { throw new Error("must not be called"); }, today: ON }), /not the change set that was approved/);
  const within = await apply(c, EXPORTS.google, { today: "2026-11-14" });
  assert.equal(within.result.applied > 0, true, "seven days is still inside the limit");
  const scimRun = diffDirectory({ profiles: readProfileFolder(PEOPLE), users: DIRECTORY_CONNECTORS.scim.readExport(readFileSync(join(root, "examples/directory/acme-users.scim.json"))), connector: DIRECTORY_CONNECTORS.scim, requester, on: ON });
  await assert.rejects(applyChangeSet({ text: scimRun.text, connector: DIRECTORY_CONNECTORS.scim, approved: scimRun.sha256, token: "t", fetch: async () => ({}), today: ON }), /works by file/);
});

test("apply changes a field only if the directory still holds what the approver saw", async () => {
  const c = API_CONNECTORS.okta;
  // Since the export, someone corrected the first name by hand, and the display name is already right.
  const dir = fakeDirectory(c, EXPORTS.okta, { drift: (u) => { if (u.id === "00u1001") { u.profile.firstName = "Sami"; u.profile.displayName = "Sam Rivera"; } } });
  const { result, calls } = await apply(c, EXPORTS.okta, {}, dir);
  assert.deepEqual(calls[1].body, { profile: { nickName: "Sam" } }, "only the field that is still as approved");
  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 2);
  assert.match(result.log.find((l) => l.field === "givenName").result, /no longer holds the value that was approved/);
  assert.equal(result.log.find((l) => l.field === "givenName").found, "Sami");
  assert.equal(result.log.find((l) => l.field === "displayName").result, "already done");
  // Nothing left to send: no write at all.
  const all = fakeDirectory(c, EXPORTS.okta, { drift: (u) => { if (u.id === "00u1001") Object.assign(u.profile, { firstName: "Sam", displayName: "Sam Rivera", nickName: "Sam" }); } });
  const none = await apply(c, EXPORTS.okta, {}, all);
  assert.deepEqual(none.calls.map((x) => x.method), ["GET"]);
  assert.deepEqual(none.result.rollback.changes, []);
});

test("apply stops at the first error from the directory and says where", async () => {
  const c = API_CONNECTORS.entra;
  const doc = { value: [...EXPORTS.entra.value.map((u) => (u.id === "aaaa-1002" ? { ...u, givenName: "Dan" } : u))] };
  const first = run(c, doc).changeSet.changes.filter((x) => x.fields.length)[0];
  const dir = fakeDirectory(c, doc, { failOn: first.user.id });
  const { result, calls } = await apply(c, doc, {}, dir);
  assert.equal(result.stoppedAt, first.user.primaryEmail);
  assert.equal(result.applied, 0);
  assert.equal(calls.length, 2, "the second person is not read or written");
  assert.ok(result.log.every((l) => l.result === "error" && l.status === 403));
  assert.deepEqual(result.rollback.changes, []);
  const gone = fakeDirectory(c, { value: [] });
  const missing = await apply(c, doc, {}, { fetch: gone.fetch, calls: gone.calls });
  assert.equal(missing.result.log[0].step, "read");
  assert.equal(missing.result.log[0].status, 404);
});

test("the command: diff needs no credentials; apply shows requests by default and sends only when told", () => {
  const dir = mkdtempSync(join(tmpdir(), "dir-api-"));
  const exportFile = join(dir, "users.json");
  writeFileSync(exportFile, JSON.stringify(EXPORTS.entra));
  const out = join(dir, "run");
  const d = cli(["directory", "diff", PEOPLE, "--against", exportFile, "--target", "entra", "--map", "pronouns=extensionAttribute1", "--domain", "acme.example", "--method", "oidc", "--on", ON, "--out", out], { ENTRA_GRAPH_TOKEN: "" });
  assert.equal(d.status, 0, d.stderr);
  const set = join(out, "change-set.json");
  const hash = sha256(readFileSync(set, "utf8"));
  assert.match(readFileSync(join(out, "report.md"), "utf8"), new RegExp(`--approved ${hash}`));
  assert.match(readFileSync(join(out, "report.md"), "utf8"), /onPremisesExtensionAttributes\.extensionAttribute1 \| \(empty\) \| she\/her/);

  const show = cli(["directory", "apply", set]);
  assert.equal(show.status, 0, show.stderr);
  const plan = JSON.parse(show.stdout);
  assert.deepEqual([plan[0].method, plan[0].url], ["PATCH", "https://graph.microsoft.com/v1.0/users/aaaa-1001"]);
  assert.match(show.stderr, /1 request would be sent\. Nothing was sent\./);

  const need = (args, env, code, re) => { const x = cli(["directory", "apply", set, ...args], env); assert.equal(x.status, code, x.stderr); assert.match(x.stderr, re); };
  need(["--apply"], {}, 2, /needs --approved/);
  need(["--apply", "--approved", hash], {}, 2, /needs --out/);
  need(["--apply", "--approved", hash, "--out", join(dir, "a")], { ENTRA_GRAPH_TOKEN: "" }, 2, /set ENTRA_GRAPH_TOKEN/);
  need(["--apply", "--approved", "f".repeat(64), "--out", join(dir, "a"), "--on", ON], { ENTRA_GRAPH_TOKEN: "x" }, 4, /not the change set that was approved/);
  need(["--apply", "--approved", hash, "--out", join(dir, "a"), "--on", "2027-01-01"], { ENTRA_GRAPH_TOKEN: "x" }, 4, /run "directory diff" again/);
  need(["--max-age", "soon"], {}, 2, /number of days/);
  assert.equal(existsSync(join(dir, "a")), false, "a refused apply writes nothing");

  const byFile = join(root, "examples/out/directory/change-set.json");
  const file = cli(["directory", "apply", byFile]);
  assert.equal(file.status, 2);
  assert.match(file.stderr, /scim works by file/);
  const bad = cli(["directory", "diff", PEOPLE, "--against", exportFile, "--target", "entra", "--map", "department=x", "--domain", "acme.example", "--method", "oidc", "--out", out]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /can map pronouns/);
});
