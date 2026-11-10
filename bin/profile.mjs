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
import { validateProfile, convert, fromJsonResume, loadMapping, RuleViolationError, buildRelease, applyWriteBack, ReleaseRefusedError, BUNDLED_MAPPINGS } from "../index.mjs";

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
  help, version

A profile is a .json file; a bundle is a folder holding profile.json and its media/ and badges/.

Options
  --out <file>               write the output to a file instead of the screen
  --locale <tag>             language of the output, as a BCP 47 tag (es, pt-BR)
  --on <yyyy-mm-dd>          the date the output is made for (default: today, UTC)
  --json                     validate: machine-readable result on standard output
  convert:    --visibility public[,network[,private]]   --media-base <https://…/>   --allow-rule-violations
  release:    --method <oidc|saml|dnsTxt|wellKnown|signedRequest|emailDomain> --domain <domain> | --recipient <name>
              --format <mapping> (default scim)   --application <name>   --receipt <file>   --record
  writeback:  --method <…> --domain <domain>
  media add:  --id <id> --alt <text>   --kind <kind>   --purpose <purpose>   --from <yyyy-mm>   --strip-gps
  badges import:  --id <id>   --fetch (needed before a URL is fetched)
  pdf:        --pages <1|auto>   --photo | --no-photo (default: no photo)   --density <comfortable|compact>
              --paper <us-letter|a4>   --min-priority <0-100>   --layout <classic>   --typst <path to typst>

Exit codes
  0 success   1 invalid profile, or an error   2 wrong usage   3 output breaks a content rule   4 release refused

Set TURNROW_DEBUG=1 to see a stack trace with an error. Full guide: README.md.
`;

const MAX_BADGE_BYTES = 10 * 1024 * 1024;
function fail(message, code = 1) { console.error(`error: ${message}`); process.exit(code); }

// Flags are declared here so that a misspelled one is refused instead of silently ignored.
const VALUE_FLAGS = ["--locale", "--out", "--format", "--domain", "--method", "--application", "--receipt", "--on", "--recipient",
  "--visibility", "--media-base", "--id", "--alt", "--kind", "--purpose", "--from",
  "--pages", "--density", "--paper", "--min-priority", "--layout", "--typst"];
const BOOL_FLAGS = ["--allow-rule-violations", "--record", "--strip-gps", "--fetch", "--json", "--help", "--version", "--photo", "--no-photo"];
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
  console.error(`usage: turnrow-profile <validate|open|review|convert|pdf|import|release|writeback|media add|badges import> …\nRun "turnrow-profile help" for the commands and options.`);
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
      const { text, violations } = convert(profile, mapping, { locale, allowRuleViolations: allow, on, visibility, mediaBaseUrl });
      for (const v of violations) console.error(`warning: rule ${v.rule} matched "${v.match}"`);
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
