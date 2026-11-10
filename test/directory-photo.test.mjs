// Photos in directory sync: the image itself, from the person's bundle, only when their audience
// grants it. LDAP takes it in the LDIF file; Google takes it in a request of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DIRECTORY_CONNECTORS, readProfileFolder, diffDirectory, changeReport, validateProfile } from "../index.mjs";
import { releasedPhoto } from "../lib/directory/index.mjs";
import { planRequests, applyChangeSet } from "../lib/directory/api.mjs";
import { parseLdif } from "../lib/directory/ldif.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const ON = "2026-11-07";
const requester = { domain: "acme.example", method: "oidc" };
const sha = (b) => createHash("sha256").update(b).digest("hex");
// The smallest JPEG that says what it is: start, a frame header for 1 by 1, end.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
const PNG = readFileSync(join(root, "examples/recommended/media/headshot.png"));

/** Sam's profile as a bundle with a photo. */
function folder(bytes = JPEG, mediaType = "image/jpeg", edit = (p) => p) {
  const dir = mkdtempSync(join(tmpdir(), "photo-"));
  const bundle = join(dir, "sam-rivera");
  mkdirSync(join(bundle, "media"), { recursive: true });
  const file = mediaType === "image/png" ? "headshot.png" : "headshot.jpg";
  writeFileSync(join(bundle, "media", file), bytes);
  const p = JSON.parse(readFileSync(join(root, "examples/directory/people/sam-rivera.profile.json"), "utf8"));
  p.media = [{ id: "headshot", title: "Sam Rivera, headshot", url: `bundle:media/${file}`, mediaType, kind: "headshot", alt: "Sam Rivera, smiling", sha256: sha(bytes), status: "approved", confidence: "high" }];
  p.person.images = [{ media: "headshot", purpose: "primary", from: "2025-01" }];
  writeFileSync(join(bundle, "profile.json"), JSON.stringify(edit(p), null, 2));
  cpSync(join(root, "examples/directory/people/dana-okoye.profile.json"), join(dir, "dana-okoye.profile.json"));
  return { dir, bundle };
}
const ldif = DIRECTORY_CONNECTORS.ldif, google = DIRECTORY_CONNECTORS.google;
const LDIF = readFileSync(join(root, "examples/directory/acme-users.ldif"), "utf8");
const run = (connector, users, dir) => diffDirectory({ profiles: readProfileFolder(dir), users, connector, requester, on: ON, now: `${ON}T00:00:00.000Z` });
const sam = (r) => r.changeSet.changes.find((c) => c.person === "Sam Rivera");
const photoOf = (r) => sam(r).fields.find((f) => f.field === "photo");

test("the bundle with a photo is a valid profile", () => {
  const { bundle } = folder();
  const v = validateProfile(JSON.parse(readFileSync(join(bundle, "profile.json"), "utf8")), { bundleDir: bundle });
  assert.equal(v.valid, true, v.errors.join("\n"));
});

test("a photo is released only when the audience grants the image, it is approved and visible to it, and unchanged", () => {
  const get = (edit, bytes) => {
    const { dir } = folder(JPEG, "image/jpeg", edit);
    if (bytes) writeFileSync(join(dir, "sam-rivera/media/headshot.jpg"), bytes);
    const p = readProfileFolder(dir).find((x) => x.name === "sam-rivera");
    return releasedPhoto(p, p.profile.audiences["current-employer"], ON);
  };
  assert.equal(get((p) => p).sha256, sha(JPEG));
  assert.equal(get((p) => { p.audiences["current-employer"].person = p.audiences["current-employer"].person.filter((g) => g !== "image"); return p; }), undefined);
  assert.equal(get((p) => { p.media[0].status = "draft"; return p; }), undefined);
  assert.equal(get((p) => { p.media[0].visibility = "private"; return p; }), undefined);
  assert.equal(get((p) => p, Buffer.concat([JPEG, Buffer.from("x")])), undefined, "a file that no longer matches its hash is not sent");
  const plain = readProfileFolder(join(root, "examples/directory/people")).find((x) => x.name.startsWith("sam"));
  assert.equal(releasedPhoto(plain, plain.profile.audiences["current-employer"], ON), undefined, "a profile that is one file has no image to send");
});

test("LDIF: the photo is a jpegPhoto in base64, compared with the directory's by hash", () => {
  const { dir } = folder();
  const r = run(ldif, ldif.readExport(LDIF), dir);
  const f = photoOf(r);
  assert.deepEqual([f.attribute, f.from, f.to, f.mediaType], ["jpegPhoto", null, `sha256:${sha(JPEG)}`, "image/jpeg"]);
  const [file] = ldif.render(r.changeSet);
  assert.match(file.data, new RegExp(`replace: jpegPhoto\\njpegPhoto:: ${JPEG.toString("base64").slice(0, 40)}`));
  assert.ok(file.data.split("\n").every((l) => l.length <= 76));
  const written = file.data.replace(/\n /g, "").match(/jpegPhoto:: (\S+)/)[1];
  assert.deepEqual(Buffer.from(written, "base64"), JPEG, "the bytes are the bundle's, unchanged");
  assert.equal(parseLdif(file.data)[0].attrs.jpegphoto[0], `sha256:${sha(JPEG)}`);
  // The directory already holds this photo: nothing to change.
  const withPhoto = LDIF.replace("mail: sam.rivera@acme.example", `mail: sam.rivera@acme.example\njpegPhoto:: ${JPEG.toString("base64")}`);
  assert.equal(photoOf(run(ldif, ldif.readExport(withPhoto), dir)), undefined);
  // The report shows the hash, never the image.
  const md = changeReport(r.changeSet, { sha256: r.sha256 });
  assert.match(md, /\| photo \| jpegPhoto \| \(empty\) \| sha256:[0-9a-f]{64} \|/);
  assert.equal(md.includes(JPEG.toString("base64").slice(0, 30)), false);
});

test("LDIF: a PNG is not written to jpegPhoto, and the report says why", () => {
  const { dir } = folder(PNG, "image/png");
  const r = run(ldif, ldif.readExport(LDIF), dir);
  assert.equal(photoOf(r), undefined);
  assert.match(sam(r).notes.find((n) => n.field === "photo").reason, /takes image\/jpeg here, and this photo is image\/png/);
  assert.doesNotMatch(ldif.render(r.changeSet)[0].data, /jpegPhoto/);
});

const USERS = { users: [{ id: "1001", primaryEmail: "sam.rivera@acme.example", name: { givenName: "Sam", familyName: "Rivera", displayName: "Sam Rivera" }, externalIds: [{ type: "organization", value: "E-104233" }],
  customSchemas: { TurnrowProfile: { nickname: "Sam", pronouns: "she/her", preferredTitle: "Platform Engineering Lead", shortBio: "Platform engineer who makes other engineers faster: build systems, internal tooling and the paved road from laptop to production." } } }] };

test("Google: the photo goes in its own request, and its hash is recorded for the next run", async () => {
  const { dir } = folder(PNG, "image/png");
  const r = run(google, google.readExport(JSON.stringify(USERS)), dir);
  assert.deepEqual(sam(r).fields.map((f) => f.field), ["photo"]);
  const [plan] = planRequests(r.changeSet, google);
  assert.deepEqual(plan.body, { customSchemas: { TurnrowProfile: { photoSha256: sha(PNG) } } });
  assert.deepEqual(plan.also, [{ method: "PUT", url: "https://admin.googleapis.com/admin/directory/v1/users/1001/photos/thumbnail", body: "(the image)" }]);
  assert.equal(JSON.stringify(plan).includes(PNG.toString("base64").slice(0, 30)), false, "the plan that is printed does not carry the image");

  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }); return { ok: true, status: 200, json: async () => structuredClone(USERS.users[0]), text: async () => "" }; };
  const out = await applyChangeSet({ text: r.text, connector: google, approved: r.sha256, token: "t", fetch, today: ON });
  assert.deepEqual(calls.map((c) => [c.method, c.url.split("/users/")[1]]), [["GET", "1001?projection=full"], ["PUT", "1001/photos/thumbnail"], ["PATCH", "1001"]]);
  assert.equal(calls[1].body.mimeType, "PNG");
  assert.deepEqual(Buffer.from(calls[1].body.photoData.replace(/-/g, "+").replace(/_/g, "/"), "base64"), PNG);
  assert.doesNotMatch(calls[1].body.photoData, /[+/]/, "URL-safe base64, as the API asks");
  assert.equal(out.applied, 1);
  assert.deepEqual(out.rollback.changes, [], "a photo can't be put back: the old one was never read");

  // Next run: the directory records this photo's hash, so there is nothing to do.
  const after = structuredClone(USERS);
  after.users[0].customSchemas.TurnrowProfile.photoSha256 = sha(PNG);
  assert.equal(run(google, google.readExport(JSON.stringify(after)), dir).changeSet.changes.find((c) => c.person === "Sam Rivera").fields.length, 0);
});

test("Google: if the photo request fails, the hash is not recorded", async () => {
  const { dir } = folder(PNG, "image/png");
  const r = run(google, google.readExport(JSON.stringify(USERS)), dir);
  const calls = [];
  const fetch = async (url, init) => { calls.push(init.method); return init.method === "PUT" ? { ok: false, status: 400, json: async () => ({}), text: async () => "Invalid photo" } : { ok: true, status: 200, json: async () => structuredClone(USERS.users[0]), text: async () => "" }; };
  const out = await applyChangeSet({ text: r.text, connector: google, approved: r.sha256, token: "t", fetch, today: ON });
  assert.deepEqual(calls, ["GET", "PUT"]);
  assert.equal(out.applied, 0);
  assert.equal(out.stoppedAt, "sam.rivera@acme.example");
});
