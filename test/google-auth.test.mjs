// Google's service-account sign-in and the custom schema request. No test reaches Google.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serviceAccountAssertion, googleAccessToken, schemaRequest, TURNROW_SCHEMA, TOKEN_URL, SCOPE_USER } from "../lib/directory/google-auth.mjs";
import { google } from "../lib/directory/api.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const KEY = { type: "service_account", client_email: "sync@example-project.iam.gserviceaccount.com", private_key: privateKey, private_key_id: "kid-1" };
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());
const cli = (args, env = {}) => spawnSync(process.execPath, [join(root, "bin/profile.mjs"), ...args], { encoding: "utf8", env: { ...process.env, GOOGLE_DIRECTORY_TOKEN: "", GOOGLE_APPLICATION_CREDENTIALS: "", GOOGLE_DIRECTORY_SUBJECT: "", ...env } });

test("the assertion is the JWT Google documents, signed with the key", () => {
  const jwt = serviceAccountAssertion(KEY, { subject: "admin@acme.example", scopes: [SCOPE_USER], now: 1_800_000_000_000 });
  const [head, claims, signature] = jwt.split(".");
  assert.deepEqual(decode(head), { alg: "RS256", typ: "JWT", kid: "kid-1" });
  assert.deepEqual(decode(claims), { iss: KEY.client_email, sub: "admin@acme.example", scope: SCOPE_USER, aud: "https://oauth2.googleapis.com/token", iat: 1_800_000_000, exp: 1_800_000_600 });
  assert.equal(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url")), true);
  assert.throws(() => serviceAccountAssertion({ type: "authorized_user" }, { subject: "a@b.example", scopes: [] }), /not a Google service account key/);
  assert.throws(() => serviceAccountAssertion(KEY, { scopes: [SCOPE_USER] }), /name the administrator/);
});

test("the token request is the documented one, and neither the key nor the assertion is in an error", async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ access_token: "ya29.token", expires_in: 599, token_type: "Bearer" }) }; };
  assert.equal(await googleAccessToken({ key: KEY, subject: "admin@acme.example", scopes: [SCOPE_USER], fetch: ok }), "ya29.token");
  assert.equal(calls[0].url, TOKEN_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(body.get("assertion").split(".").length, 3);
  const refused = async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method" }) });
  await assert.rejects(googleAccessToken({ key: KEY, subject: "admin@acme.example", scopes: [SCOPE_USER], fetch: refused }), (e) => {
    assert.match(e.message, /401: unauthorized_client.*domain-wide delegation/s);
    assert.equal(e.message.includes("PRIVATE KEY") || /eyJ[A-Za-z0-9_-]{10,}\./.test(e.message), false);
    return true;
  });
});

test("the custom schema has a field for everything the connector keeps there", () => {
  const names = TURNROW_SCHEMA.fields.map((f) => f.fieldName);
  for (const path of [...Object.values(google.fields), google.photo.marker]) {
    const m = /^customSchemas\.TurnrowProfile\.(\w+)$/.exec(path);
    if (m) assert.ok(names.includes(m[1]), m[1]);
  }
  assert.ok(TURNROW_SCHEMA.fields.every((f) => f.fieldType === "STRING" && f.displayName));
  assert.equal(TURNROW_SCHEMA.fields.find((f) => f.fieldName === "photoSha256").readAccessType, "ADMINS_AND_SELF");
  assert.equal(schemaRequest().url, "https://admin.googleapis.com/admin/directory/v1/customer/my_customer/schemas");
  assert.equal(schemaRequest("C01abc234").url.endsWith("/customer/C01abc234/schemas"), true);
  assert.throws(() => schemaRequest("../users"), /not a Google customer id/);
});

test("the commands: setup prints by default; apply names both ways to sign in", () => {
  const show = cli(["directory", "setup", "google"]);
  assert.equal(show.status, 0, show.stderr);
  assert.equal(JSON.parse(show.stdout).body.schemaName, "TurnrowProfile");
  assert.match(show.stderr, /Nothing was sent/);
  assert.equal(cli(["directory", "setup", "okta"]).status, 2);
  const none = cli(["directory", "setup", "google", "--apply"]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /GOOGLE_DIRECTORY_TOKEN.*GOOGLE_APPLICATION_CREDENTIALS.*GOOGLE_DIRECTORY_SUBJECT/s);
  const dir = mkdtempSync(join(tmpdir(), "gkey-"));
  writeFileSync(join(dir, "key.json"), JSON.stringify(KEY));
  const noSubject = cli(["directory", "setup", "google", "--apply"], { GOOGLE_APPLICATION_CREDENTIALS: join(dir, "key.json") });
  assert.equal(noSubject.status, 2);
  assert.match(noSubject.stderr, /set GOOGLE_DIRECTORY_SUBJECT/);
  assert.equal(noSubject.stderr.includes("PRIVATE KEY"), false);
});
