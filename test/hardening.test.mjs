import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateProfile, convert, loadMapping, buildRelease, applyWriteBack, fromJsonResume } from "../index.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const sample = () => read("../examples/sample.profile.json");
const employee = () => read("../examples/employee.profile.json");
const history = () => read("../examples/history.profile.json");
const ON = "2026-11-07";
const ACME = { domain: "acme.example", method: "oidc" };

// ---------- security ----------

test("JSON-LD output can't break out of a <script> element", () => {
  const p = sample();
  p.person.shortBio = "Hi </script><script>alert(1)</script> & more";
  const { text, output } = convert(p, loadMapping("schemaorg"));
  assert.ok(!/[<>]/.test(text), "no raw angle brackets");
  assert.ok(text.includes("\\u003c/script\\u003e"));
  assert.equal(JSON.parse(text).mainEntity.description, output.mainEntity.description, "still valid JSON with the same content");
});

test("only http(s) links are accepted; media and images may also be bundle paths", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x", "example.com"]) {
    const p = sample();
    p.person.profiles.push({ network: "X", url: bad });
    assert.equal(validateProfile(p).valid, false, bad);
  }
  const p = sample();
  p.media[0].url = "bundle:media/site.png";
  p.person.image.url = "bundle:media/me.jpg";
  assert.equal(validateProfile(p).valid, true);
  p.media[0].url = "javascript:alert(1)";
  assert.equal(validateProfile(p).valid, false);
});

test("imported links that aren't web addresses are dropped", () => {
  const prof = fromJsonResume({ basics: { name: "x", url: "javascript:alert(1)", profiles: [{ network: "X", url: "javascript:x" }] }, work: [{ name: "A", position: "B", url: "data:x" }] });
  assert.deepEqual(validateProfile(prof).errors, []);
  assert.ok(!JSON.stringify(prof).includes("javascript:"));
});

test("a bundle file that links outside the bundle is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  const outside = join(mkdtempSync(join(tmpdir(), "outside-")), "secret.txt");
  writeFileSync(outside, "secret");
  mkdirSync(join(dir, "media"));
  symlinkSync(outside, join(dir, "media", "cv.pdf"));
  const p = { schemaVersion: "2.4.0", meta: { defaultLocale: "en" }, person: { name: "x" }, media: [{ id: "m", title: "t", url: "bundle:media/cv.pdf" }] };
  assert.match(validateProfile(p, { bundleDir: dir }).errors.join("\n"), /links outside the bundle/);
});

test("write-back rejects malformed values and never returns an invalid profile", () => {
  const scim = read("../examples/acme-writeback.scim.json");
  const ext = scim["urn:turnrow:params:scim:schemas:extension:profile:2.0:User"];
  ext.hireDate = "2026-13-45";
  ext.startDate = "yesterday";
  scim.title = "x".repeat(400);
  const { profile, changes } = applyWriteBack(employee(), "current-employer", scim, { requester: ACME, on: ON });
  assert.deepEqual(validateProfile(profile).errors, []);
  const rejected = Object.fromEntries(changes.filter((c) => c.action === "rejected").map((c) => [c.field, c.reason]));
  assert.match(rejected["employerRecord.hireDate"], /not a date/);
  assert.match(rejected.startDate, /not a date/);
  assert.match(rejected["employerRecord.officialTitle"], /longer than 300/);
  assert.equal(changes.find((c) => c.field === "employerRecord.department").action, "accepted", "valid fields still apply");
});

// ---------- privacy ----------

test("person fields can be kept off public outputs", () => {
  const p = employee();
  p.work[0].confidence = "high";
  p.person.visibility = { location: "private", pronouns: "network", image: "private" };
  const pub = convert(p, loadMapping("schemaorg"), { on: ON }).output.mainEntity;
  assert.equal(pub.homeLocation, undefined);
  assert.equal(pub.image, undefined);
  const li = convert(p, loadMapping("linkedin"), { on: ON }).text;
  assert.ok(!li.includes("Austin, Texas") || !/^Location: Austin/m.test(li), "private location not on LinkedIn");
  assert.doesNotMatch(li, /^Location: /m);
});

test("a grant to an audience still shares a field hidden from the public", () => {
  const p = employee();
  p.person.visibility = { pronouns: "private", image: "private" };
  const { payload } = buildRelease(p, "current-employer", loadMapping("scim"), { requester: ACME, on: ON });
  assert.equal(payload["urn:turnrow:params:scim:schemas:extension:profile:2.0:User"].pronouns, "she/her");
  assert.ok(payload.photos?.length, "the directory audience was granted the image");
});

test("sensitive entries are flagged when public", () => {
  const p = employee();
  p.timeline[0].reason = "health";
  p.credentials.push({ id: "clearance", status: "approved", name: "Secret clearance", kind: "clearance" });
  const w = validateProfile(p).warnings.join("\n");
  assert.match(w, /career break for health reasons is public/);
  assert.match(w, /security clearance is public/);
});

// ---------- localization ----------

test("dates and output phrases follow the locale", () => {
  const es = convert(sample(), loadMapping("linkedin"), { locale: "es", on: ON }).text;
  assert.match(es, /Dates: mar 2024 – Actualidad/);
  const de = convert(history(), loadMapping("linkedin"), { locale: "de", on: ON }).output.Experience.find((e) => e["Company at the time"] === "EDS");
  assert.deepEqual(de["Changes while there"], ["Übernommen von HP (Aug. 2008)", "Umbenannt in HP Enterprise Services (Sept. 2009)"]);
  const fr = convert(history(), loadMapping("jsonresume"), { locale: "fr", on: ON }).output.work.find((w) => w.position === "Associate");
  assert.equal(fr.name, "Coopers & Lybrand (aujourd’hui PwC)");
});

test("English output is unchanged by the localization work", () => {
  const en = convert(history(), loadMapping("linkedin"), { on: ON }).output.Experience.find((e) => e["Company at the time"] === "EDS");
  assert.deepEqual(en["Changes while there"], ["Acquired by HP (Aug 2008)", "Renamed HP Enterprise Services (Sep 2009)"]);
});

test("numbers follow the locale", () => {
  const p = history();
  p.work[0].metrics = [{ id: "users", label: "users", value: 12500 }];
  const de = convert(p, loadMapping("jsonresume"), { locale: "de", on: ON }).output.work.find((w) => w.position === "Solutions Architect");
  assert.ok(de.highlights.some((h) => h.startsWith("12.500 users")));
});

// ---------- data model ----------

test("verification lists the names used during each job", () => {
  const p = employee();
  p.work.find((w) => w.id === "northwind-devex").audiences = ["former-employers"];
  const { payload } = buildRelease(p, "former-employers", loadMapping("verification"), { requester: { domain: "northwind.example", method: "oidc" }, on: ON });
  assert.deepEqual(payload.employment[0].namesUsed.sort(), ["Samantha Inés Cole", "Samantha Inés Rivera Cole"]);
});

test("career breaks, pronunciation, patents and licence jurisdictions are modelled", () => {
  const p = employee();
  p.credentials.push({ id: "pe", status: "approved", confidence: "high", name: "Professional Engineer", kind: "license", jurisdiction: "US-TX", compactStates: ["US-OK"] });
  assert.deepEqual(validateProfile(p).errors, []);
  const li = convert(p, loadMapping("linkedin"), { on: ON }).output;
  assert.equal(li["Career breaks"][0].Type, "caregiving");
  assert.equal(li["Name pronunciation"], "SAM ree-VAIR-uh");
  p.publications[0].doi = "not-a-doi";
  assert.equal(validateProfile(p).valid, false);
});
