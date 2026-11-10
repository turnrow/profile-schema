#!/usr/bin/env node
// Writes examples/orgchart/acme.org.json: the fictional Acme Example Corp, built twice from its
// directory (January and November 2026) so that it has a history, then given the parts no directory
// knows about: a vacancy, a planned post, budgets and the company above its departments.
// Everything comes from this script and scripts/make-directory-example.mjs; nothing is edited by hand.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTORY_CONNECTORS, readProfileFolder, buildOrganization, validateOrganization } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scim = DIRECTORY_CONNECTORS.scim;
const ENT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const requester = { domain: "acme.example", method: "oidc" };
const profiles = readProfileFolder(join(root, "examples/directory/people"));
const november = JSON.parse(readFileSync(join(root, "examples/directory/acme-users.scim.json"), "utf8"));

// January: Sam was one grade lower, and Morgan Diaz (who has since left) ran support.
const january = structuredClone(november);
january.Resources.find((u) => u.id === "u-1001").title = "Senior Software Engineer I";
january.Resources.push({
  id: "u-0990", externalId: "E-100950", userName: "morgan.diaz@acme.example", name: { givenName: "Morgan", familyName: "Diaz" }, displayName: "Morgan Diaz",
  title: "Support Team Lead", emails: [{ value: "morgan.diaz@acme.example", type: "work", primary: true }], [ENT]: { employeeNumber: "E-100950", department: "Customer Support" },
});

const build = (doc, on, base) => buildOrganization({ profiles, users: scim.readExport(JSON.stringify(doc)), connector: scim, requester, name: "Acme Example Corp", on, now: `${on}T00:00:00.000Z`, base }).org;
const org = build(november, "2026-11-07", build(january, "2026-01-05"));

org.meta.notes = "FICTIONAL SAMPLE made by scripts/make-orgchart-example.mjs; do not edit by hand.";
org.sources["plan-2027"] = { kind: "manual", title: "2027 headcount plan (fictional)", date: "2026-11-07" };
org.units = { acme: { name: "Acme Example Corp", kind: "company" }, ...org.units };
for (const [id, u] of Object.entries(org.units)) if (id !== "acme") u.parent = "acme";
const director = org.posts.find((p) => p.title === "Director of Engineering").id;
const sam = org.posts.find((p) => p.title === "Senior Software Engineer II").id;
org.posts.push(
  {
    id: "engineering-manager-platform", title: "Engineering Manager, Platform", unit: "platform-engineering", from: "2026-09-01", source: "plan-2027",
    reportsTo: [{ post: director, kind: "line", from: "2026-09-01", source: "plan-2027" }],
    vacancy: { status: "open", reason: "new", targetDate: "2026-12-15", requisition: "REQ-2041" },
    budget: { costCenter: "CC-410", band: "M2", fte: 1, annualCost: { amount: 210000, currency: "USD" } },
  },
  {
    id: "staff-platform-engineer", title: "Staff Platform Engineer", unit: "platform-engineering", from: "2027-01-01", source: "plan-2027",
    reportsTo: [{ post: director, kind: "line", from: "2027-01-01", source: "plan-2027" }, { post: sam, kind: "dotted", from: "2027-01-01", source: "plan-2027" }],
    vacancy: { status: "planned", reason: "new", targetDate: "2027-03-01" },
    budget: { costCenter: "CC-410", band: "IC5", fte: 1, annualCost: { amount: 235000, currency: "USD" } },
  },
);

const check = validateOrganization(org);
if (!check.valid) { console.error(check.errors.join("\n")); process.exit(1); }
mkdirSync(join(root, "examples/orgchart"), { recursive: true });
writeFileSync(join(root, "examples/orgchart/acme.org.json"), JSON.stringify(org, null, 2) + "\n");
console.error("wrote examples/orgchart/acme.org.json");
