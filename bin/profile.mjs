#!/usr/bin/env node
// turnrow-profile: validate, convert and import Turnrow Profiles.
//
//   turnrow-profile validate <profile.json | bundle-folder>
//   turnrow-profile convert  <profile.json | bundle-folder> <mapping-name | mapping.json> [--locale xx] [--out file] [--allow-rule-violations]
//   turnrow-profile import   <resume.json> [--locale xx] [--out file]
//   turnrow-profile open     <profile.json | bundle-folder>      list items waiting on confirmation

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateProfile, convert, fromJsonResume, loadMapping, RuleViolationError } from "../index.mjs";

const argv = process.argv.slice(2);
const takeFlag = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const takeBool = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const locale = takeFlag("--locale");
const out = takeFlag("--out");
const allow = takeBool("--allow-rule-violations");
const [command, ...rest] = argv;

function loadProfile(path) {
  const p = resolve(path);
  if (existsSync(p) && statSync(p).isDirectory()) {
    return { profile: JSON.parse(readFileSync(join(p, "profile.json"), "utf8")), bundleDir: p };
  }
  return { profile: JSON.parse(readFileSync(p, "utf8")), bundleDir: undefined };
}
function emit(text) { if (out) writeFileSync(out, text); else process.stdout.write(text); }
function usage(code = 2) {
  console.error("usage: turnrow-profile <validate|convert|import|open> … (see README)");
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
      console.log(`✓ ${rest[0]} is valid.` + (r.openItems.length ? ` ${r.openItems.length} item(s) waiting on confirmation (run "open").` : ""));
      break;
    }
    case "open": {
      if (!rest[0]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      if (!r.openItems.length) console.log("Nothing waiting on confirmation.");
      for (const o of r.openItems) console.log(`- [${o.status}] ${o.id}: ${o.question ?? "(no question recorded)"}`);
      break;
    }
    case "convert": {
      if (!rest[0] || !rest[1]) usage();
      const { profile, bundleDir } = loadProfile(rest[0]);
      const r = validateProfile(profile, { bundleDir });
      if (!r.valid) { console.error("Profile is not valid; run validate first.\n  " + r.errors.join("\n  ")); process.exit(1); }
      const mapping = rest[1].endsWith(".json") ? JSON.parse(readFileSync(rest[1], "utf8")) : loadMapping(rest[1]);
      const { text, violations } = convert(profile, mapping, { locale, allowRuleViolations: allow });
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
    default:
      usage(command ? 2 : 0);
  }
} catch (err) {
  if (err instanceof RuleViolationError) { console.error(err.message); process.exit(3); }
  throw err;
}
