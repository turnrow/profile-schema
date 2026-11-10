#!/usr/bin/env node
// Builds examples/recommended/: the 2.6 fixture bundle (people, recommendations, endorsements,
// badges, a headshot). Every file in it comes from this script, so none is hand-edited;
// CI regenerates it and fails on any difference. Everything here is fictional; .example
// domains are reserved for documentation.
//
//   node scripts/make-fixtures.mjs [--out <folder>]   (default: examples/)

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync, crc32 } from "node:zlib";
import { parseBadge } from "../lib/badges.mjs";
import { validateProfile } from "../lib/validate.mjs";

const args = process.argv.slice(2);
const outRoot = resolve(args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1] : new URL("../examples", import.meta.url).pathname);
const dir = join(outRoot, "recommended");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// ---------- small, deterministic PNGs ----------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, "latin1"), data, u32(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])))]);
function png(width, height, pixel, extra = []) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    for (let x = 0; x < width; x++) rows.push(...pixel(x, y));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])])),
    ...extra,
    chunk("IDAT", deflateSync(Buffer.from(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const itxt = (keyword, text) => chunk("iTXt", Buffer.concat([Buffer.from(`${keyword}\0\0\0\0\0`, "latin1"), Buffer.from(text, "utf8")]));

// A placeholder portrait: a circle on a plain background. No camera, no location metadata.
const headshot = png(64, 64, (x, y) => ((x - 32) ** 2 + (y - 28) ** 2 < 300 ? [196, 140, 110] : y > 50 ? [40, 90, 120] : [226, 232, 238]));

// ---------- badges, as an issuer would send them ----------
const OB3 = {
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"],
  id: "https://badges.example/credentials/harbor-ops-118",
  type: ["VerifiableCredential", "OpenBadgeCredential"],
  issuer: { id: "https://badges.example/issuers/maritime-academy", type: ["Profile"], name: "Example Maritime Academy" },
  validFrom: "2024-03-01T00:00:00Z",
  name: "Harbor Operations Planner",
  credentialSubject: {
    type: ["AchievementSubject"],
    achievement: {
      id: "https://badges.example/achievements/harbor-ops",
      type: ["Achievement"],
      achievementType: "Badge",
      name: "Harbor Operations Planner",
      description: "Plans berth, crane and yard operations for a container terminal.",
      criteria: { narrative: "Passed the practical planning assessment." },
      alignment: [{ type: ["Alignment"], targetName: "Logisticians", targetUrl: "https://www.onetonline.org/link/summary/13-1081.00", targetFramework: "O*NET", targetCode: "13-1081.00" }],
    },
  },
};
const OB2 = {
  "@context": "https://w3id.org/openbadges/v2", type: "Assertion", id: "https://badges.example/assertions/safety-7",
  recipient: { type: "email", hashed: true, identity: "sha256$0000000000000000000000000000000000000000000000000000000000000000" },
  issuedOn: "2021-06-01T00:00:00Z", expires: "2031-06-01T00:00:00Z",
  verification: { type: "hosted" },
  badge: {
    type: "BadgeClass", id: "https://badges.example/badges/site-safety", name: "Site Safety Lead",
    description: "Leads site safety on a working port.", criteria: { narrative: "Completed 40 supervised hours." },
    image: "https://badges.example/badges/site-safety.png", tags: ["safety"],
    issuer: { type: "Issuer", id: "https://badges.example/issuers/builders-guild", name: "Example Builders Guild" },
  },
};
const ob3Bytes = Buffer.from(JSON.stringify(OB3, null, 2) + "\n");
const bakedBytes = png(16, 16, () => [20, 110, 160], [itxt("openbadges", JSON.stringify(OB2))]);

function badge(bytes, id, edit) {
  const { entry, original, ext } = parseBadge(bytes, { id });
  const file = `badges/${id}${ext}`;
  return { file, original, entry: edit({ ...entry, status: "approved", confidence: "high",
    credential: { ...entry.credential, file: `bundle:${file}`, sha256: sha256(original) } }) };
}
const harbor = badge(ob3Bytes, "harbor-ops-badge", (b) => ({ ...b, issuer: "maritime-academy", awardedFor: "port-planning", priority: 80 }));
const safety = badge(bakedBytes, "site-safety-badge", (b) => ({ ...b, issuer: "builders-guild" }));

// ---------- the profile ----------
const BODY = "Ines rebuilt our harbor planning program from nothing. She is the most careful planner I know, and the crews trusted her completely.";
const SAM = "Ines turned a three-day berth schedule into a three-hour one. Every shift lead now plans with the tool she built, and our crane idle time fell by a third in her first year.";
const consent = (scope) => ({ given: true, on: "2026-11-02", scope, by: "email" });

const profile = {
  $schema: "../../schema/profile.schema.json",
  schemaVersion: "2.6.0",
  meta: {
    defaultLocale: "en-US",
    updated: "2026-11-07T00:00:00Z",
    owner: "Ines Ortega",
    canonicalUrl: "https://ines-ortega.example/",
    mediaBaseUrl: "https://ines-ortega.example/files/",
    subjectConsent: { given: true, on: "2026-11-02" },
    notes: "FICTIONAL SAMPLE made by scripts/make-fixtures.mjs; do not edit by hand. Shows people, recommendations (full and highlights-only consent), an endorsement, two badges (Open Badges 3.0 JSON-LD and a baked Open Badges 2.0 PNG) and a bundled headshot.",
  },
  person: {
    name: "Ines Ortega",
    names: [{ type: "preferred", full: "Ines Ortega", given: "Ines", family: "Ortega" }],
    pronouns: "she/her",
    headline: "Port operations planner | Berth and yard scheduling",
    jobTitle: "Senior Operations Planner",
    shortBio: "Plans the moves that keep a container terminal running: berths, cranes and yard space.",
    location: { label: "Long Beach, California", locality: "Long Beach", region: "CA", countryCode: "US" },
    images: [{ media: "headshot", purpose: "primary", from: "2024-01" }],
  },
  organizations: {
    "port-example": { name: "Port of Example", kind: "government", url: "https://port.example" },
    "harbor-logistics": { name: "Harbor Logistics Example", kind: "company", url: "https://harbor-logistics.example" },
    "maritime-academy": { name: "Example Maritime Academy", kind: "school", url: "https://badges.example/issuers/maritime-academy" },
    "builders-guild": { name: "Example Builders Guild", kind: "nonprofit" },
  },
  people: {
    "maria-chen": {
      name: "Maria Chen",
      names: [{ full: "Maria Lopez", type: "birth", to: "2019-05" }, { full: "Maria Chen", type: "preferred", from: "2019-06" }],
      identifiers: [{ scheme: "linkedin", value: "https://www.linkedin.com/in/example-maria-chen" }],
      roles: [
        { title: "Director of Terminal Operations", organization: "port-example", from: "2018-01", to: "2024-08" },
        { title: "Chief Operating Officer", organization: "harbor-logistics", from: "2024-09" },
      ],
      contacts: [
        { type: "email", value: "maria.chen@port.example", from: "2018-01", to: "2024-08" },
        { type: "email", value: "maria@harbor-logistics.example", from: "2024-09" },
      ],
      images: [{ url: "https://ines-ortega.example/files/people/maria-chen.jpg", asOf: "2025-01" }],
    },
    "sam-okafor": {
      name: "Sam Okafor",
      roles: [{ title: "Shift Lead", organization: "port-example", from: "2017-04" }],
      contacts: [{ type: "phone", value: "+1-555-0100" }],
    },
    "priya-raman": {
      name: "Priya Raman",
      roles: [{ title: "Account Director", organization: "harbor-logistics", from: "2020-02" }],
    },
  },
  work: [{
    id: "port-planning", status: "approved", confidence: "high", priority: 90,
    organization: "port-example", title: "Senior Operations Planner", employmentType: "fullTime",
    startDate: "2019-03", current: true,
    summary: "Plans berth, crane and yard operations for the container terminal.",
    metrics: [{ id: "crane-idle", label: "less crane idle time", value: "33%", from: "2020-01", to: "2020-12" }],
    occupations: [{ system: "soc", code: "13-1081" }, { system: "onetSoc", code: "13-1081.00" }],
  }],
  skills: [
    { id: "berth-planning", status: "approved", confidence: "high", name: "Berth planning", pinned: true, priority: 90 },
    { id: "yard-scheduling", status: "approved", confidence: "high", name: "Yard scheduling", priority: 80 },
  ],
  media: [{
    id: "headshot", title: "Ines Ortega, headshot", url: "bundle:media/headshot.png", mediaType: "image/png",
    alt: "Illustrated placeholder portrait of Ines Ortega", kind: "headshot",
    uuid: "6f1c2a52-3b7e-4c1a-9d4e-2a7b5c8e9f01", width: 64, height: 64,
    byteSize: headshot.length, sha256: sha256(headshot), capturedOn: "2024-01",
    license: "CC0-1.0", status: "approved", confidence: "high",
  }],
  recommendations: [
    {
      id: "rec-maria", status: "approved", confidence: "high", priority: 85,
      author: "maria-chen", date: "2023-05-02T14:30:00-07:00",
      relationship: { type: "manager", work: "port-planning", description: "Managed Ines directly" },
      authorAt: { title: "Director of Terminal Operations", organization: "port-example" },
      text: BODY,
      highlights: [{ id: "h1", text: "She is the most careful planner I know, and the crews trusted her completely.", featured: true }],
      source: { platform: "linkedin", url: "https://www.linkedin.com/in/example-ines-ortega/details/recommendations/", retrievedOn: "2026-11-01" },
      consent: consent("full"),
    },
    {
      id: "rec-sam", status: "approved", confidence: "high",
      author: "sam-okafor", date: "2024-02-12",
      relationship: { type: "peer", work: "port-planning" },
      text: SAM,
      highlights: [{ id: "h1", text: "Every shift lead now plans with the tool she built", featured: true }],
      source: { platform: "email", retrievedOn: "2026-11-01" },
      consent: consent("highlights"),
    },
  ],
  endorsements: [{
    id: "end-priya-berth", status: "approved", confidence: "medium",
    author: "priya-raman", target: "berth-planning", date: "2025-03-04",
    relationship: { type: "client" }, text: "Her berth plans held up through peak season.",
    consent: consent("full"),
  }],
  badges: [harbor.entry, safety.entry],
};

const check = validateProfile(profile, { bundleDir: undefined });
if (!check.valid) { console.error(check.errors.join("\n")); process.exit(1); }

rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "media"), { recursive: true });
mkdirSync(join(dir, "badges"), { recursive: true });
writeFileSync(join(dir, "media", "headshot.png"), headshot);
writeFileSync(join(dir, harbor.file), harbor.original);
writeFileSync(join(dir, safety.file), safety.original);
writeFileSync(join(dir, "profile.json"), JSON.stringify(profile, null, 2) + "\n");

const bundled = validateProfile(profile, { bundleDir: dir });
if (!bundled.valid) { console.error(bundled.errors.join("\n")); process.exit(1); }
console.error(`wrote ${dir}`);
