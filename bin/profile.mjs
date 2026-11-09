#!/usr/bin/env node
// turnrow-profile: validate, convert and import Turnrow Profiles.
//
//   turnrow-profile validate <profile.json | bundle-folder>
//   turnrow-profile convert  <profile.json | bundle-folder> <mapping-name | mapping.json> [--locale xx] [--out file] [--allow-rule-violations]
//                            [--visibility public[,network]] [--media-base https://example.com/profile/] [--on yyyy-mm-dd]
//   turnrow-profile import   <resume.json> [--locale xx] [--out file]
//   turnrow-profile open     <profile.json | bundle-folder>      list items waiting on confirmation
//   turnrow-profile release  <profile> <audience> [--format scim] --domain acme.com --method oidc [--application name] [--recipient "Fund name"]
//                            [--out payload.json] [--receipt receipt.json] [--record]   (--record appends to profile.releases)
//   turnrow-profile writeback <profile> <audience> <scim-user.json> --domain acme.com --method oidc [--out updated.json]

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateProfile, convert, fromJsonResume, loadMapping, RuleViolationError, buildRelease, applyWriteBack, ReleaseRefusedError } from "../index.mjs";

const argv = process.argv.slice(2);
const takeFlag = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const takeBool = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
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
const visibility = visibilityFlag ? visibilityFlag.split(",").map((v) => v.trim()) : undefined;
if (visibility && visibility.some((v) => !["public", "network", "private"].includes(v))) {
  console.error(`error: --visibility takes public, network and/or private (got ${visibilityFlag})`);
  process.exit(2);
}
const requester = domain || method || recipient ? { domain, method, application, name: recipient } : undefined;
const [command, ...rest] = argv;

function loadProfile(path) {
  const p = resolve(path);
  if (!existsSync(p)) fail(`no such file or folder: ${path}`);
  const file = statSync(p).isDirectory() ? join(p, "profile.json") : p;
  if (!existsSync(file)) fail(`${path} is a folder without a profile.json`);
  let profile;
  try { profile = JSON.parse(readFileSync(file, "utf8")); } catch (err) { fail(`${file} is not valid JSON: ${err.message}`); }
  return { profile, file, bundleDir: file === p ? undefined : p };
}
function fail(message, code = 1) { console.error(`error: ${message}`); process.exit(code); }
function emit(text) { if (out) writeFileSync(out, text); else process.stdout.write(text); }
function usage(code = 2) {
  console.error("usage: turnrow-profile <validate|open|convert|import|release|writeback> … (see README)");
  process.exit(code);
}

try {
  switch (command) {
    case "validate": {
      if (!rest[0]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      for (const w of r.warnings) console.error(`warning: ${w}`);
      if (!r.valid) { console.error(`✗ ${rest[0]}\n  ` + r.errors.join("\n  ")); process.exit(1); }
      const waiting = r.openItems.filter((o) => o.status !== "question").length;
      const questions = r.openItems.length - waiting;
      const notes = [waiting && `${waiting} item(s) waiting on confirmation`, questions && `${questions} open question(s) on approved items`].filter(Boolean);
      console.log(`✓ ${rest[0]} is valid.` + (notes.length ? ` ${notes.join("; ")} (run "open").` : ""));
      break;
    }
    case "open": {
      if (!rest[0]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      if (!r.openItems.length) console.log("Nothing waiting on confirmation.");
      const order = { disputed: 0, pending: 1, question: 2 };
      for (const o of [...r.openItems].sort((a, b) => order[a.status] - order[b.status])) {
        console.log(`- [${o.status}] ${o.id}: ${o.question ?? "(no question recorded)"}`);
      }
      break;
    }
    case "convert": {
      if (!rest[0] || !rest[1]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      if (!r.valid) { console.error("Profile is not valid; run validate first.\n  " + r.errors.join("\n  ")); process.exit(1); }
      const mapping = rest[1].endsWith(".json") ? JSON.parse(readFileSync(rest[1], "utf8")) : loadMapping(rest[1]);
      const { text, violations } = convert(profile, mapping, { locale, allowRuleViolations: allow, on, visibility, mediaBaseUrl });
      for (const v of violations) console.error(`warning: rule ${v.rule} matched "${v.match}"`);
      emit(text);
      break;
    }
    case "import": {
      if (!rest[0]) usage();
      const resume = JSON.parse(readFileSync(rest[0], "utf8"));
      emit(JSON.stringify(fromJsonResume(resume, { locale }), null, 2) + "\n");
      break;
    }
    case "release": {
      if (!rest[0] || !rest[1]) usage();
      if (!requester?.method || (!requester?.domain && !requester?.name)) fail("release needs --method and --domain (or --recipient for an open audience): what your application verified", 2);
      const { profile, bundleDir, file } = loadProfile(rest[0]);
      const v = validateProfile(profile, { bundleDir });
      if (!v.valid) { console.error("Profile is not valid; run validate first.\n  " + v.errors.join("\n  ")); process.exit(1); }
      const mapping = format.endsWith(".json") ? JSON.parse(readFileSync(format, "utf8")) : loadMapping(format);
      const r = buildRelease(profile, rest[1], mapping, { requester, on, locale });
      emit(r.text);
      if (receiptOut) writeFileSync(receiptOut, JSON.stringify(r.receipt, null, 2) + "\n");
      if (recordIt) {
        profile.releases = [...(profile.releases ?? []), r.record];
        // For a bundle folder the record goes into its profile.json, not onto the folder path.
        writeFileSync(file, JSON.stringify(profile, null, 2) + "\n");
        console.error(`Recorded ${r.record.id} in ${file}`);
      }
      break;
    }
    case "writeback": {
      if (!rest[0] || !rest[1] || !rest[2]) usage();
      if (!requester?.domain || !requester?.method) { console.error("writeback needs --domain and --method (what your application verified)"); process.exit(2); }
      const { profile } = loadProfile(rest[0]);
      const scim = JSON.parse(readFileSync(rest[2], "utf8"));
      const r = applyWriteBack(profile, rest[1], scim, { requester, on });
      for (const c of r.changes) if (c.action !== "unchanged") console.error(`${c.action.padEnd(11)} ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}${c.reason ? ` (${c.reason})` : ""}`);
      for (const sgg of r.suggestions) console.error(`suggestion  ${sgg.field}: ${JSON.stringify(sgg.current)} → ${JSON.stringify(sgg.value)} (yours to decide)`);
      const after = validateProfile(r.profile);
      if (!after.valid) { console.error("Write-back produced an invalid profile:\n  " + after.errors.join("\n  ")); process.exit(1); }
      emit(JSON.stringify(r.profile, null, 2) + "\n");
      break;
    }
    default:
      usage(command ? 2 : 0);
  }
} catch (err) {
  if (err instanceof RuleViolationError) { console.error(err.message); process.exit(3); }
  if (err instanceof ReleaseRefusedError) { console.error(err.message); process.exit(4); }
  // Anything else is reported plainly; set TURNROW_DEBUG=1 for the stack.
  console.error(`error: ${err.message}`);
  if (process.env.TURNROW_DEBUG) console.error(err.stack);
  process.exit(1);
}
