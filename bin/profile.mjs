#!/usr/bin/env node
// turnrow-profile: validate, convert and import Turnrow Profiles. Run "turnrow-profile help" for the full list.
//
//   turnrow-profile validate <profile.json | bundle-folder>... [--json]
//   turnrow-profile convert  <profile.json | bundle-folder> <mapping-name | mapping.json> [--locale xx] [--out file] [--allow-rule-violations]
//                            [--visibility public[,network]] [--media-base https://example.com/profile/] [--on yyyy-mm-dd]
//   turnrow-profile pdf      <profile.json | bundle-folder> --out resume.pdf [--pages 1|auto] [--photo] [--density compact] [--paper a4]
//                            [--min-priority n] [--locale xx] [--on yyyy-mm-dd] [--typst path]   (needs Typst: https://typst.app)
//   turnrow-profile import   <resume.json> [--locale xx] [--out file]
//   turnrow-profile open     <profile.json | bundle-folder>      list items waiting on confirmation
//   turnrow-profile review   <profile.json | bundle-folder> [--on yyyy-mm-dd] [--locale xx] [--out review.md]   the whole profile, for checking (internal)
//   turnrow-profile release  <profile> <audience> [--format scim] --domain acme.com --method oidc [--application name] [--recipient "Fund name"]
//                            [--out payload.json] [--receipt receipt.json] [--record]   (--record appends to profile.releases)
//   turnrow-profile media add <bundle> <file> --id <id> --alt "<text>" [--kind headshot] [--purpose primary] [--from yyyy-mm] [--strip-gps]
//   turnrow-profile badges import <bundle> <file | url> [--id <id>] [--fetch]   (Open Badges 2.0/3.0, baked PNG/SVG, JWT)
//   turnrow-profile writeback <profile> <audience> <scim-user.json> --domain acme.com --method oidc [--out updated.json]

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve, extname, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readImageInfo, stripGps } from "../lib/media.mjs";
import { parseBadge } from "../lib/badges.mjs";
import { reviewMarkdown } from "../lib/review.mjs";
import { renderResumePdf, PdfError } from "../lib/pdf.mjs";
import { gedzip, gedzipMedia, readBundleMedia, GEDZIP_MEDIA } from "../lib/gedcom.mjs";
import { bundleFileReader } from "../lib/ob3.mjs";
import { CONNECTORS, readProfileFolder, diffDirectory, changeReport, userFileName } from "../lib/directory/index.mjs";
import { withMap, planRequests, applyChangeSet, ApplyRefusedError } from "../lib/directory/api.mjs";
import { googleAccessToken, schemaRequest, SCOPE_USER, SCOPE_SCHEMA } from "../lib/directory/google-auth.mjs";
import { validateOrganization } from "../lib/orgchart/index.mjs";
import { buildOrganization } from "../lib/orgchart/build.mjs";
import { orgMarkdown, orgCsv } from "../lib/orgchart/views.mjs";
import { orgHtml, orgSvg } from "../lib/orgchart/html.mjs";
import { renderOrgPdf } from "../lib/orgchart/pdf.mjs";
import { statsMarkdown, orgStats, orgSeries } from "../lib/orgchart/stats.mjs";
import { validateProfile, convert, fromJsonResume, loadMapping, RuleViolationError, buildRelease, applyWriteBack, ReleaseRefusedError, BUNDLED_MAPPINGS, resolveMapping } from "../index.mjs";

const HELP = `turnrow-profile: validate, convert and share Turnrow Profiles.

Commands
  validate  <profile | bundle>...          check one or more files; --json prints the result as JSON
  open      <profile | bundle>             list what is still waiting on confirmation
  review    <profile | bundle>             write the whole profile as a Markdown file for checking (internal:
                                           it includes drafts, private entries, notes and other people's details)
  convert   <profile | bundle> <mapping>   write an output: ${BUNDLED_MAPPINGS.join(", ")},
                                           or the path to your own mapping .json
  pdf       <profile | bundle> --out <file>   write an accessible résumé PDF (PDF/UA-1); needs Typst installed
  import    <resume.json>                  start a profile from a JSON Resume (everything arrives as a draft)
  release   <profile> <audience>           build an audience's payload and consent receipt
  writeback <profile> <audience> <scim-user.json>   take an employer's corrections as claims
  media add <bundle> <image>               add a photo to a bundle, hashed and versioned
  badges import <bundle> <file | url>      add an Open Badge (2.0 or 3.0) to a bundle
  directory diff <folder> --against <export> --target <connector> --out <folder>
                                           compare a folder of profiles with a directory export and write the
                                           changes, a report to approve and who was left out (changes nothing)
  directory apply <change-set.json>        show the requests an approved change set would send to a directory API;
                                           with --apply, --approved <sha256> and --out <folder>, send them and keep a log
  orgchart validate <file.org.json>        check an organization file (posts, holders and reporting lines, all dated)
  orgchart build <folder> --against <export> --target <connector> --out <file.org.json>
                                           build or carry forward an organization file from a directory export
                                           and a folder of profiles; people are named only as they have released
  orgchart show <file.org.json>            the organization on a date: a table, CSV, a web page or a PDF
  orgchart stats <file.org.json>           headcount, vacancies, span of control and layers; with --from and --to,
                                           headcount month by month and what changed
  help, version

A profile is a .json file; a bundle is a folder holding profile.json and its media/ and badges/.

Options
  --out <file>               write the output to a file instead of the screen
  --locale <tag>             language of the output, as a BCP 47 tag (es, pt-BR)
  --on <yyyy-mm-dd>          the date the output is made for (default: today, UTC)
  --json                     validate: machine-readable result on standard output
  convert:    --visibility public[,network[,private]]   --media-base <https://…/>   --allow-rule-violations
              --gedzip (with gedcom7: write a .gdz archive holding the file and its media)
  release:    --method <oidc|saml|dnsTxt|wellKnown|signedRequest|emailDomain> --domain <domain> | --recipient <name>
              --format <mapping> (default scim)   --application <name>   --receipt <file>   --record
  writeback:  --method <…> --domain <domain>
  media add:  --id <id> --alt <text>   --kind <kind>   --purpose <purpose>   --from <yyyy-mm>   --strip-gps
  badges import:  --id <id>   --fetch (needed before a URL is fetched)
  directory diff: --target <${Object.keys(CONNECTORS).join("|")}>   --method <…> --domain <the employer's domain>
              --audience <id> (default: each profile's directory audience)   --record (add each release to its profile)
              --map <field=attribute,…> (your own attributes, for entra, okta and onelogin)
  directory apply: --approved <the sha256 of the change set, from the report>   --apply   --out <folder>   --max-age <days> (default 7)
              The access token is read from an environment variable (GOOGLE_DIRECTORY_TOKEN, ENTRA_GRAPH_TOKEN, OKTA_TOKEN,
              ONELOGIN_TOKEN), never from the command line. Okta and OneLogin also need OKTA_ORG_URL or ONELOGIN_URL.
              Google can instead use a service account: GOOGLE_APPLICATION_CREDENTIALS (the key file) and
              GOOGLE_DIRECTORY_SUBJECT (the administrator it acts as).
  directory setup google: prints the request that creates the custom schema; --apply sends it
  orgchart build: --method <…> --domain <domain>   --name <organization> | --base <existing.org.json>   --audience <id>
  orgchart show:  --on <date>   --compare <date>   --format <table|csv|html|pdf|svg>   --budget (include budget figures: internal)
              --dates <date,date,…> (html: several dates in one page, each compared with the one before)
  orgchart stats: --on <date>   --from <date> --to <date>   --format <table|json>   --budget
  pdf:        --pages <1|auto>   --photo | --no-photo (default: no photo)   --density <comfortable|compact>
              --paper <us-letter|a4>   --min-priority <0-100>   --layout <classic|academic|two-column>   --typst <path to typst>

Exit codes
  0 success   1 invalid profile, or an error   2 wrong usage   3 output breaks a content rule   4 release refused

Set TURNROW_DEBUG=1 to see a stack trace with an error. Full guide: README.md.
`;

const MAX_BADGE_BYTES = 10 * 1024 * 1024;
function fail(message, code = 1) { console.error(`error: ${message}`); process.exit(code); }

// Flags are declared here so that a misspelled one is refused instead of silently ignored.
const VALUE_FLAGS = ["--locale", "--out", "--format", "--domain", "--method", "--application", "--receipt", "--on", "--recipient",
  "--visibility", "--media-base", "--id", "--alt", "--kind", "--purpose", "--from",
  "--pages", "--density", "--paper", "--min-priority", "--layout", "--typst", "--against", "--target", "--audience", "--approved", "--max-age", "--map", "--base", "--name", "--compare", "--to", "--dates"];
const BOOL_FLAGS = ["--allow-rule-violations", "--record", "--strip-gps", "--fetch", "--json", "--help", "--version", "--photo", "--no-photo", "--gedzip", "--apply", "--budget"];
const flags = {};
const argv = [];
{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "-h") { flags["--help"] = true; continue; }
    if (!arg.startsWith("--") || arg === "--") { argv.push(arg); continue; }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg : arg.slice(0, eq);
    if (BOOL_FLAGS.includes(name) && eq < 0) flags[name] = true;
    else if (VALUE_FLAGS.includes(name)) {
      const value = eq < 0 ? raw[++i] : arg.slice(eq + 1);
      // "--out --record" is a forgotten value, not a file named "--record".
      const isOption = eq < 0 && [...VALUE_FLAGS, ...BOOL_FLAGS].includes(String(value).split("=")[0]);
      if (value === undefined || value === "" || isOption) fail(`${name} needs a value (run "turnrow-profile help")`, 2);
      flags[name] = value;
    } else fail(`unknown option ${name} (run "turnrow-profile help")`, 2);
  }
}
const takeFlag = (name) => flags[name];
const takeBool = (name) => flags[name] === true;
const locale = takeFlag("--locale");
const out = takeFlag("--out");
const allow = takeBool("--allow-rule-violations");
const format = takeFlag("--format") ?? "scim";
const domain = takeFlag("--domain");
const method = takeFlag("--method");
const application = takeFlag("--application");
const receiptOut = takeFlag("--receipt");
const recordIt = takeBool("--record");
const on = takeFlag("--on");
const recipient = takeFlag("--recipient");
const visibilityFlag = takeFlag("--visibility");
const mediaBaseUrl = takeFlag("--media-base");
const mediaId = takeFlag("--id");
const altText = takeFlag("--alt");
const kind = takeFlag("--kind");
const purpose = takeFlag("--purpose");
const fromDate = takeFlag("--from");
const stripGpsFlag = takeBool("--strip-gps");
const fetchFlag = takeBool("--fetch");
const asJson = takeBool("--json");
const against = takeFlag("--against");
const targetFlag = takeFlag("--target");
const audienceFlag = takeFlag("--audience");
const approved = takeFlag("--approved");
const maxAge = takeFlag("--max-age");
const mapFlag = takeFlag("--map");
const applyFlag = takeBool("--apply");
const baseFlag = takeFlag("--base");
const nameFlag = takeFlag("--name");
const compareFlag = takeFlag("--compare");
const budgetFlag = takeBool("--budget");
const toDate = takeFlag("--to");
const datesFlag = takeFlag("--dates");
const visibility = visibilityFlag ? visibilityFlag.split(",").map((v) => v.trim()) : undefined;
if (visibility && visibility.some((v) => !["public", "network", "private"].includes(v))) {
  fail(`--visibility takes public, network and/or private (got ${visibilityFlag})`, 2);
}
// Dates are compared as text, so anything but a real calendar date would give wrong answers quietly.
if (on !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(on) && !Number.isNaN(Date.parse(`${on}T00:00:00Z`)))) {
  fail(`--on takes a date as yyyy-mm-dd (got ${on})`, 2);
}
if (mediaBaseUrl !== undefined && !/^https?:\/\/\S+$/.test(mediaBaseUrl)) fail(`--media-base takes an http(s) URL (got ${mediaBaseUrl})`, 2);
if (locale !== undefined) {
  try { new Intl.Locale(locale); } catch { fail(`--locale takes a BCP 47 language tag such as es or pt-BR (got ${locale})`, 2); }
}
const requester = domain || method || recipient ? { domain, method, application, name: recipient } : undefined;
const [command, ...rest] = argv;

// Read a JSON file, saying plainly what is wrong when it can't be read.
function readJson(path, what = "file") {
  if (!existsSync(path)) fail(`no such ${what}: ${path}`);
  if (statSync(path).isDirectory()) fail(`${path} is a folder; a ${what} is expected here`);
  const bytes = readFileSync(path);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) fail(`${path} is a zip archive: unzip it and pass the folder`);
  // Windows editors often put a byte-order mark at the start of a file; JSON.parse refuses it.
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  try { return JSON.parse(text); } catch (err) { return fail(`${path} is not valid JSON: ${err.message}`); }
}
function loadProfile(path) {
  const p = resolve(path);
  if (!existsSync(p)) fail(`no such file or folder: ${path}`);
  const file = statSync(p).isDirectory() ? join(p, "profile.json") : p;
  if (!existsSync(file)) fail(`${path} is a folder without a profile.json`);
  return { profile: readJson(file, "profile"), file, bundleDir: file === p ? undefined : p };
}
const loadMappingArg = (arg) => (arg.endsWith(".json") ? readJson(arg, "mapping file") : loadMapping(arg));
// The schema's id pattern: an id becomes a file name in the bundle, so nothing else may pass.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
function checkId(id) { if (!ID_RE.test(id ?? "")) fail(`"${id}" is not a valid id: use lowercase letters, digits and hyphens`, 2); }
// Write a new file in the bundle, never over an existing one.
function writeNew(path, bytes, what) {
  if (existsSync(path)) fail(`${what} already exists; choose another --id (nothing was changed)`, 2);
  writeFileSync(path, bytes, { flag: "wx" });
}
function writeOut(path, text) { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, text); }
function emit(text) { if (out) writeOut(out, text); else process.stdout.write(text); }
function usage() {
  console.error(`usage: turnrow-profile <validate|open|review|convert|pdf|import|release|writeback|media add|badges import|directory diff|directory apply|directory setup google|orgchart validate|orgchart build|orgchart show|orgchart stats> …\nRun "turnrow-profile help" for the commands and options.`);
  process.exit(2);
}
if (flags["--version"] || command === "version") {
  console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  process.exit(0);
}
if (flags["--help"] || command === "help" || !command) { process.stdout.write(HELP); process.exit(0); }

try {
  switch (command) {
    case "validate": {
      if (!rest.length) usage();
      // Every file named is checked: a shell glob (validate profiles/*.json) must not pass on the first file alone.
      const results = rest.map((path) => {
        const { profile, bundleDir } = loadProfile(path);
        return { file: path, ...validateProfile(profile, { bundleDir }) };
      });
      if (asJson) {
        emit(JSON.stringify(rest.length === 1 ? results[0] : results, null, 2) + "\n");
      } else {
        for (const r of results) {
          for (const w of r.warnings) console.error(`warning: ${rest.length > 1 ? `${r.file}: ` : ""}${w}`);
          if (!r.valid) { console.error(`✗ ${r.file}\n  ` + r.errors.join("\n  ")); continue; }
          const waiting = r.openItems.filter((o) => o.status !== "question").length;
          const questions = r.openItems.length - waiting;
          const notes = [waiting && `${waiting} item(s) waiting on confirmation`, questions && `${questions} open question(s) on approved items`].filter(Boolean);
          console.log(`✓ ${r.file} is valid.` + (notes.length ? ` ${notes.join("; ")} (run "open").` : ""));
        }
      }
      const bad = results.filter((r) => !r.valid).length;
      if (bad && rest.length > 1 && !asJson) console.error(`${bad} of ${rest.length} files are not valid.`);
      if (bad) process.exit(1);
      break;
    }
    case "open": {
      if (!rest[0]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      // An invalid file stops validation early, so "nothing open" would be a false all-clear.
      if (!r.valid) { console.error(`✗ ${rest[0]} is not valid; fix it first:\n  ` + r.errors.join("\n  ")); process.exit(1); }
      if (!r.openItems.length) console.log("Nothing waiting on confirmation.");
      const order = { disputed: 0, pending: 1, question: 2 };
      for (const o of [...r.openItems].sort((a, b) => order[a.status] - order[b.status])) {
        console.log(`- [${o.status}] ${o.id}: ${o.question ?? "(no question recorded)"}`);
      }
      break;
    }
    case "review": {
      if (!rest[0]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      // An invalid profile still gets its review file: the errors head it, and the rest shows what is there.
      emit(reviewMarkdown(profile, { on, locale, bundleDir, source: rest[0] }));
      if (out) console.error(`Wrote ${out}. It holds private data: keep it out of public repositories and shared folders.`);
      break;
    }
    case "convert": {
      if (!rest[0] || !rest[1]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      if (!r.valid) { console.error("Profile is not valid; run validate first.\n  " + r.errors.join("\n  ")); process.exit(1); }
      const mapping = loadMappingArg(rest[1]);
      const asGedzip = takeBool("--gedzip");
      if (asGedzip && resolveMapping(mapping).format !== "gedcom7") fail("--gedzip goes with the gedcom7 output (GEDZip is a GEDCOM 7 format)", 2);
      if (asGedzip && !out) fail("--gedzip needs --out <file.gdz>: an archive can't be printed to the screen", 2);
      // In a GEDZip the media travel inside the archive, so bundle: links become paths in it.
      // Outputs that carry original files (badge credentials) read them from the bundle, with its guards and hash check.
      const readBundleFile = bundleDir ? bundleFileReader(bundleDir) : undefined;
      const { text, output, violations } = convert(profile, mapping, { locale, allowRuleViolations: allow, on, visibility, mediaBaseUrl: asGedzip ? GEDZIP_MEDIA : mediaBaseUrl, readBundleFile });
      for (const v of violations) console.error(`warning: rule ${v.rule} matched "${v.match}"`);
      if (asGedzip) {
        const paths = gedzipMedia(output);
        if (paths.length && !bundleDir) fail("--gedzip needs a bundle folder to take the media from", 2);
        const media = paths.length ? readBundleMedia(bundleDir, paths) : [];
        mkdirSync(dirname(resolve(out)), { recursive: true });
        writeFileSync(out, gedzip(text, media));
        console.error(`Wrote ${out}: gedcom.ged and ${media.length} media file${media.length === 1 ? "" : "s"}.`);
        break;
      }
      emit(text);
      break;
    }
    case "pdf": {
      if (!rest[0]) usage();
      if (!out) fail("pdf needs --out <file.pdf>: a PDF can't be printed to the screen", 2);
      if (flags["--photo"] && flags["--no-photo"]) fail("--photo and --no-photo can't both be given", 2);
      const minPriority = flags["--min-priority"] === undefined ? 0 : Number(flags["--min-priority"]);
      if (!Number.isInteger(minPriority) || minPriority < 0 || minPriority > 100) fail(`--min-priority takes a whole number from 0 to 100 (got ${flags["--min-priority"]})`, 2);
      const { profile, bundleDir } = loadProfile(rest[0]);
      const v = validateProfile(profile, { bundleDir });
      if (!v.valid) { console.error("Profile is not valid; run validate first.\n  " + v.errors.join("\n  ")); process.exit(1); }
      const r = renderResumePdf(profile, {
        out, bundleDir, on, locale, visibility, minPriority, photo: takeBool("--photo"),
        layout: flags["--layout"], pages: flags["--pages"], density: flags["--density"], paper: flags["--paper"], typst: flags["--typst"],
      });
      console.error(`Wrote ${out} (PDF/UA-1, ${r.typstVersion}). Check it with a screen reader before sending it widely.`);
      break;
    }
    case "import": {
      if (!rest[0]) usage();
      const resume = readJson(rest[0], "JSON Resume file");
      if (!resume || typeof resume !== "object" || Array.isArray(resume)) fail(`${rest[0]} is not a JSON Resume: it should be an object with "basics", "work" and so on`);
      if (resume.schemaVersion && resume.person) fail(`${rest[0]} is already a Turnrow Profile; there is nothing to import`, 2);
      emit(JSON.stringify(fromJsonResume(resume, { locale }), null, 2) + "\n");
      break;
    }
    case "release": {
      if (!rest[0] || !rest[1]) usage();
      if (!requester?.method || (!requester?.domain && !requester?.name)) fail("release needs --method and --domain (or --recipient for an open audience): what your application verified", 2);
      const { profile, bundleDir, file } = loadProfile(rest[0]);
      const v = validateProfile(profile, { bundleDir });
      if (!v.valid) { console.error("Profile is not valid; run validate first.\n  " + v.errors.join("\n  ")); process.exit(1); }
      const mapping = loadMappingArg(format);
      const r = buildRelease(profile, rest[1], mapping, { requester, on, locale });
      emit(r.text);
      if (receiptOut) writeOut(receiptOut, JSON.stringify(r.receipt, null, 2) + "\n");
      if (recordIt) {
        profile.releases = [...(profile.releases ?? []), r.record];
        // For a bundle folder the record goes into its profile.json, not onto the folder path.
        writeFileSync(file, JSON.stringify(profile, null, 2) + "\n");
        console.error(`Recorded ${r.record.id} in ${file}`);
      }
      break;
    }
    case "directory": {
      // A token for a connector: the one in its environment variable, or, for Google, one made on the
      // spot from a service account key (GOOGLE_APPLICATION_CREDENTIALS) acting as an administrator
      // (GOOGLE_DIRECTORY_SUBJECT). The key is read from its file and kept nowhere.
      const tokenFor = async (conn, scopes) => {
        if (process.env[conn.tokenEnv]) return process.env[conn.tokenEnv];
        const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS, subject = process.env.GOOGLE_DIRECTORY_SUBJECT;
        if (conn.id === "google" && keyFile) {
          if (!subject) fail("set GOOGLE_DIRECTORY_SUBJECT to the administrator the service account acts as (an e-mail address)", 2);
          try { return await googleAccessToken({ key: readJson(keyFile, "service account key"), subject, scopes, fetch: (url, init) => fetch(url, { ...init, redirect: "error" }) }); }
          catch (err) { fail(err.message); }
        }
        return fail(`set ${conn.tokenEnv} to an access token for ${conn.label}${conn.id === "google" ? ", or GOOGLE_APPLICATION_CREDENTIALS to a service account key file and GOOGLE_DIRECTORY_SUBJECT to the administrator it acts as" : ""} (read from the environment so that it is never on a command line)`, 2);
      };
      if (rest[0] === "setup") {
        if (rest[1] !== "google") fail("directory setup takes google: it creates the custom schema that connector keeps pronouns, nickname, preferred title, headline, bio and the photo hash in", 2);
        let req;
        try { req = schemaRequest(process.env.GOOGLE_CUSTOMER_ID || undefined); } catch (err) { fail(err.message, 2); }
        if (!applyFlag) {
          emit(JSON.stringify(req, null, 2) + "\n");
          console.error("This request would be sent. Nothing was sent. To send it: --apply (once per Google Workspace account).");
          break;
        }
        const token = await tokenFor(CONNECTORS.google, [SCOPE_SCHEMA]);
        const res = await fetch(req.url, { method: req.method, redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(req.body) });
        if (!res.ok) { let detail = ""; try { detail = (await res.text()).slice(0, 300); } catch { /* no body */ } fail(`Google answered ${res.status}${res.status === 409 ? ": the schema already exists, so there is nothing to do" : ""}${detail ? `\n${detail}` : ""}`); }
        console.error("Created the TurnrowProfile custom schema.");
        break;
      }
      if (rest[0] === "apply") {
        if (!rest[1]) usage();
        if (!existsSync(rest[1]) || statSync(rest[1]).isDirectory()) fail(`no such change set: ${rest[1]}`);
        const text = readFileSync(rest[1], "utf8");
        let changeSet;
        try { changeSet = JSON.parse(text); } catch (err) { fail(`${rest[1]} is not valid JSON: ${err.message}`); }
        const conn = CONNECTORS[changeSet.target];
        if (!conn) fail(`${rest[1]} was made for "${changeSet.target}", which this version does not know`);
        if (!conn.write) fail(`${conn.id} works by file: apply its file by hand (see the report)`, 2);
        if (maxAge !== undefined && !/^\d+$/.test(maxAge)) fail(`--max-age takes a number of days (got ${maxAge})`, 2);
        if (!applyFlag) {
          // The default: show what would be sent, and send nothing.
          let plan;
          try { plan = planRequests(changeSet, conn, process.env); } catch (err) { fail(err.message, 2); }
          emit(JSON.stringify(plan.map(({ method, url, body, person }) => ({ person, method, url, body })), null, 2) + "\n");
          console.error(`${plan.length} request${plan.length === 1 ? "" : "s"} would be sent. Nothing was sent. To send them: --apply --approved <sha256 from the report> --out <folder>.`);
          break;
        }
        if (!approved) fail("directory apply --apply needs --approved <sha256>: the hash of the change set, from the report you read", 2);
        if (!out) fail("directory apply --apply needs --out <folder> for the log and the rollback file", 2);
        const token = await tokenFor(conn, [SCOPE_USER]);
        let result;
        try { result = await applyChangeSet({ text, connector: conn, approved, token, fetch: (url, init) => fetch(url, { ...init, redirect: "error" }), env: process.env, maxAgeDays: maxAge === undefined ? undefined : Number(maxAge), today: on }); }
        catch (err) { if (err instanceof ApplyRefusedError) fail(err.message, 4); throw err; }
        writeOut(join(out, "apply-log.jsonl"), result.log.map((l) => JSON.stringify(l)).join("\n") + (result.log.length ? "\n" : ""));
        writeOut(join(out, "rollback-change-set.json"), JSON.stringify(result.rollback, null, 2) + "\n");
        console.error(`${result.applied} field${result.applied === 1 ? "" : "s"} changed, ${result.skipped} skipped.${result.stoppedAt ? ` Stopped at ${result.stoppedAt}: the directory answered with an error, and nothing after it was sent.` : ""}`);
        console.error(`The log and the rollback change set are in ${out}. They hold personal data.`);
        if (result.stoppedAt) process.exit(1);
        break;
      }
      if (rest[0] !== "diff" || !rest[1]) usage();
      let connector = CONNECTORS[targetFlag ?? ""];
      if (connector) { try { connector = withMap(connector, mapFlag); } catch (err) { fail(err.message, 2); } }
      if (!connector) fail(`directory diff needs --target: one of ${Object.keys(CONNECTORS).join(", ")}`, 2);
      if (!against) fail("directory diff needs --against <export>: the directory's own export of its users", 2);
      if (!out) fail("directory diff needs --out <folder> for the change set, the report and the receipts", 2);
      if (!requester?.method || !requester?.domain) fail("directory diff needs --method and --domain: the employer's domain, and how you verified it", 2);
      const folder = resolve(rest[1]);
      if (!existsSync(folder) || !statSync(folder).isDirectory()) fail(`${rest[1]} is not a folder of profiles`);
      if (!existsSync(against) || statSync(against).isDirectory()) fail(`no such export file: ${against}`);
      if (existsSync(out) && !statSync(out).isDirectory()) fail(`--out ${out} is a file; a folder is expected`, 2);
      const exportBytes = readFileSync(against);
      let users;
      try { users = connector.readExport(exportBytes); } catch (err) { fail(`${against}: ${err.message}`); }
      const profiles = readProfileFolder(folder);
      if (!profiles.length) fail(`${rest[1]} holds no profiles (files named *.profile.json, or bundle folders)`);
      // With --on the run is reproducible: releases are stamped with that day, not with the clock.
      const result = diffDirectory({ profiles, users, connector, requester, audience: audienceFlag, on, now: on ? `${on}T00:00:00.000Z` : undefined, exportSha256: createHash("sha256").update(exportBytes).digest("hex") });
      let files = connector.render ? connector.render(result.changeSet) : [];
      // An API connector has no file to upload: applying is a separate command, which shows its requests first.
      if (connector.write) files = [{ name: undefined, how: `run "directory apply ${join(out, "change-set.json")}" to see the requests; add --apply --approved ${result.sha256} --out <folder> to send them` }];
      const put = (name, text) => writeOut(join(out, name), text);
      put("change-set.json", result.text);
      put("refusals.json", JSON.stringify(result.changeSet.refusals, null, 2) + "\n");
      for (const c of result.changeSet.changes) put(join("changes", `${userFileName(c.user)}.json`), JSON.stringify(c, null, 2) + "\n");
      for (const r of result.receipts) put(join("receipts", `${userFileName(result.changeSet.changes.find((c) => c.user.id === r.user).user)}.json`), JSON.stringify(r.receipt, null, 2) + "\n");
      for (const f of files) if (f.name) put(f.name, f.data);
      put("report.md", changeReport(result.changeSet, { sha256: result.sha256, files: files.map((f) => f.how) }));
      if (recordIt) {
        for (const r of result.records) {
          const p = profiles.find((x) => x.name === r.name);
          p.profile.releases = [...(p.profile.releases ?? []), r.record];
          writeFileSync(p.file, JSON.stringify(p.profile, null, 2) + "\n");
        }
      }
      const changed = result.changeSet.changes.filter((c) => c.fields.length);
      console.error(`${changed.length} ${changed.length === 1 ? "person has" : "people have"} changes, ${result.changeSet.changes.length - changed.length} up to date, ${result.changeSet.refusals.length} left out. Nothing was changed in the directory.`);
      console.error(`Read ${join(out, "report.md")} before applying. It holds personal data: keep it out of public repositories and shared folders.`);
      break;
    }
    case "orgchart": {
      const sub = rest[0];
      const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "") && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
      const loadOrg = (path) => {
        const org = readJson(path, "organization file");
        const v = validateOrganization(org);
        return { org, v };
      };
      if (sub === "validate") {
        if (!rest[1]) usage();
        const { v } = loadOrg(rest[1]);
        for (const w of v.warnings) console.error(`warning: ${w}`);
        if (!v.valid) { console.error(`${rest[1]} is not a valid organization file:\n  ${v.errors.join("\n  ")}`); process.exit(1); }
        console.log(`${rest[1]} is valid.`);
        break;
      }
      if (sub === "show") {
        if (!rest[1]) usage();
        const fmt = flags["--format"] === undefined ? "table" : format;
        if (!["table", "csv", "html", "pdf", "svg"].includes(fmt)) fail(`orgchart show --format takes table, csv, html, pdf or svg (got ${fmt})`, 2);
        const dates = datesFlag === undefined ? undefined : datesFlag.split(",").map((d) => d.trim());
        if (dates && fmt !== "html") fail("--dates goes with --format html: several dates in one page, to switch between", 2);
        if (dates && (dates.length < 2 || !dates.every(isDate))) fail(`--dates takes two or more dates as yyyy-mm-dd, separated by commas (got ${datesFlag})`, 2);
        if (compareFlag !== undefined && !isDate(compareFlag)) fail(`--compare takes a date as yyyy-mm-dd (got ${compareFlag})`, 2);
        const { org, v } = loadOrg(rest[1]);
        if (!v.valid) { console.error(`${rest[1]} is not a valid organization file; run orgchart validate first.\n  ${v.errors.join("\n  ")}`); process.exit(1); }
        const opts = { on, compare: compareFlag, budget: budgetFlag, dates };
        if (fmt === "svg") { emit(orgSvg(org, { on, standalone: true })); break; }
        if (fmt === "pdf") {
          if (!out) fail("orgchart show --format pdf needs --out <file.pdf>", 2);
          try { renderOrgPdf(org, { ...opts, out, paper: flags["--paper"], typst: flags["--typst"] }); }
          catch (err) { if (err instanceof PdfError) fail(err.message); throw err; }
          console.error(`Wrote ${out}`);
          break;
        }
        emit(fmt === "csv" ? orgCsv(org, opts) : fmt === "html" ? orgHtml(org, opts) : orgMarkdown(org, opts));
        if (budgetFlag && out) console.error(`${out} includes budget figures: keep it internal.`);
        break;
      }
      if (sub === "stats") {
        if (!rest[1]) usage();
        const fmt = flags["--format"] === undefined ? "table" : format;
        if (!["table", "json"].includes(fmt)) fail(`orgchart stats --format takes table or json (got ${fmt})`, 2);
        if ((fromDate === undefined) !== (toDate === undefined)) fail("orgchart stats takes --from and --to together", 2);
        for (const [flag, d] of [["--from", fromDate], ["--to", toDate]]) if (d !== undefined && !isDate(d)) fail(`${flag} takes a date as yyyy-mm-dd (got ${d})`, 2);
        if (fromDate && !(fromDate < toDate)) fail("--from must be before --to", 2);
        const { org, v } = loadOrg(rest[1]);
        if (!v.valid) { console.error(`${rest[1]} is not a valid organization file; run orgchart validate first.\n  ${v.errors.join("\n  ")}`); process.exit(1); }
        const opts = { on: on ?? toDate, budget: budgetFlag, from: fromDate, to: toDate };
        emit(fmt === "json" ? JSON.stringify({ ...orgStats(org, opts), ...(fromDate ? { series: orgSeries(org, opts) } : {}) }, null, 2) + "\n" : statsMarkdown(org, opts));
        break;
      }
      if (sub !== "build" || !rest[1]) usage();
      let connector = CONNECTORS[targetFlag ?? ""];
      if (!connector) fail(`orgchart build needs --target: one of ${Object.keys(CONNECTORS).join(", ")}`, 2);
      if (!against) fail("orgchart build needs --against <export>: the directory's own export of its users", 2);
      if (!out) fail("orgchart build needs --out <file.org.json>", 2);
      if (!requester?.method || !requester?.domain) fail("orgchart build needs --method and --domain: the employer's domain, and how you verified it", 2);
      if (!baseFlag && !nameFlag) fail("orgchart build needs --name <the organization's name>, or --base <an existing organization file> to carry forward", 2);
      const folder = resolve(rest[1]);
      if (!existsSync(folder) || !statSync(folder).isDirectory()) fail(`${rest[1]} is not a folder of profiles`);
      if (!existsSync(against) || statSync(against).isDirectory()) fail(`no such export file: ${against}`);
      const exportBytes = readFileSync(against);
      let users;
      try { users = connector.readExport(exportBytes); } catch (err) { fail(`${against}: ${err.message}`); }
      const base = baseFlag ? readJson(baseFlag, "organization file") : undefined;
      let built;
      try { built = buildOrganization({ profiles: readProfileFolder(folder), users, connector, requester, name: nameFlag, on, now: on ? `${on}T00:00:00.000Z` : undefined, audience: audienceFlag, base, exportSha256: createHash("sha256").update(exportBytes).digest("hex") }); }
      catch (err) { fail(err.message); }
      writeOut(out, JSON.stringify(built.org, null, 2) + "\n");
      const r = built.report;
      console.error(`Wrote ${out}: ${r.opened.length} post${r.opened.length === 1 ? "" : "s"} opened, ${r.ended.length} ended, ${r.replaced.length} changed, ${r.kept} unchanged.`);
      console.error(`${r.named} ${r.named === 1 ? "person is" : "people are"} named, by their own release. ${r.notNamed} ${r.notNamed === 1 ? "seat is" : "seats are"} filled by someone not shown (no profile here, or no consent).`);
      if (r.history) console.error(`${r.history} earlier position${r.history === 1 ? "" : "s"} added from people's own profiles.`);
      for (const t of r.replaced) console.error(`  changed: ${t}`);
      for (const t of r.ended) console.error(`  ended: ${t} (no longer in the directory; if the seat stays open, add it back as a vacancy)`);
      break;
    }
    case "media": {
      if (rest[0] !== "add" || !rest[1] || !rest[2]) usage();
      if (!mediaId || !altText) fail("media add needs --id and --alt (describe the image for people who cannot see it)", 2);
      const { profile, file, bundleDir } = loadProfile(rest[1]);
      if (!bundleDir) fail("media add needs a bundle folder (a folder with profile.json), not a single file", 2);
      checkId(mediaId);
      if (!existsSync(rest[2])) fail(`no such file: ${rest[2]}`);
      let bytes = readFileSync(rest[2]);
      const info = readImageInfo(bytes);
      if (info.unreadable) fail(`${rest[2]} is not a readable image (${info.unreadable})`, 2);
      if (info.uninspected) fail(`${rest[2]} is ${info.mediaType}, which can't be checked for location (GPS) metadata; export it as JPEG or PNG and add that (nothing was changed)`, 2);
      if (info.gps && !stripGpsFlag) fail(`${rest[2]} carries location (GPS) metadata in ${info.gpsWhere.join(" and ")}; re-run with --strip-gps to store a copy without it`, 2);
      if (info.gps) bytes = stripGps(bytes, info.mediaType);
      const after = readImageInfo(bytes);
      if (after.gps || after.unreadable) fail(`could not remove the location metadata from ${rest[2]} cleanly; nothing was changed`, 2);
      // An existing id means a new version of the same asset: the next free <id>-vN, same uuid.
      const media = profile.media ?? [];
      // Only the id itself and its -vN versions count; "head" is not a version of "head-vintage".
      const versionOf = (m) => (m.id === mediaId ? 1 : Number(m.id.match(new RegExp(`^${mediaId}-v(\\d+)$`))?.[1] ?? 0));
      const prior = media.filter((m) => versionOf(m) > 0).sort((a, b) => versionOf(a) - versionOf(b));
      const latest = prior.at(-1);
      const id = latest ? `${mediaId}-v${versionOf(latest) + 1}` : mediaId;
      const ext = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg" }[info.mediaType] ?? extname(rest[2]).toLowerCase()).replace(/[^.a-z0-9]/g, "");
      mkdirSync(join(bundleDir, "media"), { recursive: true });
      writeNew(join(bundleDir, "media", `${id}${ext}`), bytes, `media/${id}${ext}`);
      const entry = {
        id, title: altText, url: `bundle:media/${id}${ext}`, mediaType: after.mediaType, alt: altText,
        ...(kind ? { kind } : {}),
        uuid: latest?.uuid ?? randomUUID(),
        ...(latest ? { version: String(prior.length + 1), supersedes: latest.id } : {}),
        ...(after.width ? { width: after.width, height: after.height } : {}),
        byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        ...(after.metadata ? { metadata: after.metadata } : {}),
        status: "approved", confidence: "high",
      };
      profile.media = [...media, entry];
      if (purpose) profile.person.images = [...(profile.person.images ?? []), { media: id, purpose, ...(fromDate ? { from: fromDate } : {}) }];
      const v = validateProfile(profile, { bundleDir });
      if (!v.valid) { unlinkSync(join(bundleDir, "media", `${id}${ext}`)); fail("adding it would make the profile invalid:\n  " + v.errors.join("\n  ")); }
      writeFileSync(file, JSON.stringify(profile, null, 2) + "\n");
      console.error(`Added ${id} (${after.mediaType}${after.width ? `, ${after.width}×${after.height}` : ""}${info.gps ? ", location metadata removed" : ""})`);
      break;
    }
    case "badges": {
      if (rest[0] !== "import" || !rest[1] || !rest[2]) usage();
      const { profile, file, bundleDir } = loadProfile(rest[1]);
      if (!bundleDir) fail("badges import needs a bundle folder (a folder with profile.json)", 2);
      let bytes;
      if (/^https?:\/\//.test(rest[2])) {
        if (!fetchFlag) fail("a URL needs --fetch (this command never goes to the network unless asked)", 2);
        // A badge is small; a slow or endless response should stop the command, not hang it.
        const res = await fetch(rest[2], { headers: { accept: "application/ld+json, application/json, image/png, image/svg+xml" }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) fail(`could not fetch ${rest[2]}: HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BADGE_BYTES) fail(`${rest[2]} is larger than 10 MB; that is not a badge`);
        bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > MAX_BADGE_BYTES) fail(`${rest[2]} is larger than 10 MB; that is not a badge`);
      } else {
        if (!existsSync(rest[2])) fail(`no such file: ${rest[2]}`);
        bytes = readFileSync(rest[2]);
      }
      if (mediaId) checkId(mediaId);
      const { entry, original, ext } = parseBadge(bytes, { id: mediaId });
      checkId(entry.id);
      if ((profile.badges ?? []).some((b) => b.id === entry.id)) fail(`a badge with id "${entry.id}" already exists; pass --id`, 2);
      mkdirSync(join(bundleDir, "badges"), { recursive: true });
      const rel = `badges/${entry.id}${ext}`;
      writeNew(join(bundleDir, rel), original, rel);
      entry.credential.file = `bundle:${rel}`;
      entry.credential.sha256 = createHash("sha256").update(original).digest("hex");
      profile.badges = [...(profile.badges ?? []), entry];
      const v = validateProfile(profile, { bundleDir });
      if (!v.valid) { unlinkSync(join(bundleDir, rel)); fail("importing it would make the profile invalid:\n  " + v.errors.join("\n  ")); }
      writeFileSync(file, JSON.stringify(profile, null, 2) + "\n");
      console.error(`Imported ${entry.id} (${entry.credential.format}) as a draft; review it, then approve.`);
      break;
    }
    case "writeback": {
      if (!rest[0] || !rest[1] || !rest[2]) usage();
      if (!requester?.domain || !requester?.method) { console.error("writeback needs --domain and --method (what your application verified)"); process.exit(2); }
      const { profile } = loadProfile(rest[0]);
      const scim = readJson(rest[2], "SCIM file");
      const r = applyWriteBack(profile, rest[1], scim, { requester, on });
      for (const c of r.changes) if (c.action !== "unchanged") console.error(`${c.action.padEnd(11)} ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}${c.reason ? ` (${c.reason})` : ""}`);
      for (const sgg of r.suggestions) console.error(`suggestion  ${sgg.field}: ${JSON.stringify(sgg.current)} → ${JSON.stringify(sgg.value)} (yours to decide)`);
      const after = validateProfile(r.profile);
      if (!after.valid) { console.error("Write-back produced an invalid profile:\n  " + after.errors.join("\n  ")); process.exit(1); }
      emit(JSON.stringify(r.profile, null, 2) + "\n");
      break;
    }
    default:
      console.error(`error: unknown command "${command}"`);
      usage();
  }
} catch (err) {
  if (err instanceof RuleViolationError) { console.error(err.message); process.exit(3); }
  if (err instanceof ReleaseRefusedError) { console.error(err.message); process.exit(4); }
  if (err instanceof PdfError) {
    console.error(`error: ${err.message}`);
    if (err.candidates) {
      console.error("To fit one page, leave out the least important entries. Lowest priority first:");
      for (const c of err.candidates) console.error(`  - ${c.section}: "${c.title}" (${c.id}, priority ${c.priority})`);
      console.error(`Ways to do it: --min-priority <n> drops everything below n; "targets": { "resume": { "omit": true } } drops one entry${err.density === "compact" ? "" : "; --density compact fits more on the page"}. Or use --pages auto.`);
    }
    process.exit(1);
  }
  // Anything else is reported plainly; set TURNROW_DEBUG=1 for the stack.
  console.error(`error: ${err.message}`);
  if (process.env.TURNROW_DEBUG) console.error(err.stack);
  process.exit(1);
}
