import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProfile, convert, loadMapping } from "../index.mjs";
import { nameAt, roleAt, currentImage } from "../lib/people.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const ON = "2026-11-07";
const has = (list, re) => list.some((x) => re.test(x));

export function withPeople() {
  const p = read("../examples/employee.profile.json");
  p.schemaVersion = "2.6.0";
  p.organizations.globex = { name: "Globex", kind: "company" };
  p.people = {
    "maria-chen": {
      name: "Maria Chen",
      names: [
        { full: "Maria Lopez", type: "birth", to: "2019-05" },
        { full: "Maria Chen", type: "preferred", from: "2019-06" },
      ],
      identifiers: [{ scheme: "linkedin", value: "https://www.linkedin.com/in/mariachen" }],
      roles: [
        { title: "Engineering Manager", organization: "acme", from: "2021-02", to: "2024-08" },
        { title: "Director of Engineering", organization: "globex", from: "2024-09" },
      ],
      contacts: [
        { type: "email", value: "maria@acme.example", from: "2021-02", to: "2024-08" },
        { type: "email", value: "maria.chen@globex.example", from: "2024-09" },
      ],
      images: [
        { url: "https://example.com/maria-2021.jpg", asOf: "2021-03" },
        { url: "https://example.com/maria-2025.jpg", asOf: "2025-01" },
      ],
    },
  };
  return p;
}

test("a valid people registry validates", () => {
  const r = validateProfile(withPeople());
  assert.equal(r.valid, true, r.errors.join("\n"));
});

test("unknown people refs and unknown organizations in roles are errors", () => {
  const p = withPeople();
  p.references = [{ id: "ref-1", name: "Someone", person: "nobody" }];
  p.people["maria-chen"].roles[0].organization = "initech";
  const e = validateProfile(p).errors;
  assert.ok(has(e, /references\/ref-1: unknown person "nobody"/));
  assert.ok(has(e, /people\/maria-chen\.roles\[0\]: unknown organization "initech"/));
});

test("roleAt returns the role in force; between roles, nothing", () => {
  const m = withPeople().people["maria-chen"];
  assert.deepEqual(roleAt(m, "2023-01-15"), { title: "Engineering Manager", organization: "acme" });
  assert.deepEqual(roleAt(m, "2025-01-01"), { title: "Director of Engineering", organization: "globex" });
  assert.equal(roleAt({ ...m, roles: [m.roles[0]] }, "2025-01-01"), undefined);
});

test("nameAt uses dated names, falling back to the display name", () => {
  const m = withPeople().people["maria-chen"];
  assert.equal(nameAt(m, "2018-01-01"), "Maria Lopez");
  assert.equal(nameAt(m, "2022-01-01"), "Maria Chen");
  assert.equal(nameAt({ name: "X" }, "2022-01-01"), "X");
});

test("currentImage is the newest asOf", () => {
  assert.equal(currentImage(withPeople().people["maria-chen"]).url, "https://example.com/maria-2025.jpg");
});

test("contacts default private and never reach an output", () => {
  const p = withPeople();
  for (const m of ["jsonresume", "schemaorg", "linkedin", "brief", "timeline", "verification", "scim"]) {
    const { text } = convert(p, loadMapping(m), { on: ON, visibility: ["public", "network"] });
    assert.ok(!/globex\.example|acme\.example\b.*maria/.test(text) && !text.includes("maria.chen@"), m);
  }
});

test("a contact explicitly marked public is still a third party's: validation warns", () => {
  const p = withPeople();
  p.people["maria-chen"].contacts[1].visibility = "public";
  assert.ok(has(validateProfile(p).warnings, /people\/maria-chen\.contacts\[1\] is public/));
});
