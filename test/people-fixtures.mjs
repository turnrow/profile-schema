// Shared fixtures for the people, recommendation and review-fix tests (not a test file itself).
import { readFileSync } from "node:fs";
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

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


export const BODY = "Ines rebuilt our harbor program from nothing.  She is the most “careful” planner I know,\nand the team trusted her completely.";
export function withRec(extra = {}) {
  const p = withPeople();
  p.recommendations = [{
    id: "rec-maria", author: "maria-chen", date: "2023-05-02T14:30:00-05:00",
    relationship: { type: "manager", work: "acme-platform", description: "Managed Ines directly" },
    authorAt: { title: "Engineering Manager", organization: "acme" },
    text: BODY,
    highlights: [{ id: "h1", text: "She is the most “careful” planner I know, and the team trusted her completely.", featured: true }],
    source: { platform: "linkedin", url: "https://www.linkedin.com/in/example/details/recommendations/", retrievedOn: "2026-11-01" },
    consent: { given: true, on: "2026-11-02", scope: "full", by: "email" },
    status: "approved", confidence: "high", citations: [],
    ...extra,
  }];
  return p;
}

