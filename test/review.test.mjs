// The review file: everything in a profile, as accessible Markdown, with where each entry will appear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewMarkdown, inclusion, sectionsRead, loadMapping, DEFAULT_INCLUDE } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const recommended = () => load("examples/recommended/profile.json");
const ON = "2026-11-07";
const review = (p, opts = {}) => reviewMarkdown(p, { on: ON, ...opts });
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin", "profile.mjs"), ...args], { encoding: "utf8" });
// The cells of the table row whose first cell is `id` (escaped pipes stay inside their cell).
const rowOf = (md, id) => md.split("\n").find((l) => l.startsWith(`| ${id} |`))?.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());

test("inclusion says why a mapping leaves an entry out", () => {
  const brief = { ...DEFAULT_INCLUDE, ...loadMapping("brief").include };
  assert.deepEqual(inclusion({ id: "a", status: "approved", confidence: "high", priority: 90 }, brief, "brief"), { shown: true });
  assert.equal(inclusion({ id: "a", status: "approved", confidence: "high", priority: 40 }, brief, "brief").reason, "priority 40 is below 80");
  assert.equal(inclusion({ id: "a", status: "approved", confidence: "high", priority: 40 }, brief, "brief", { ignorePriority: true }).shown, true);
  assert.equal(inclusion({ id: "a", confidence: "high" }, brief, "brief").reason, "status is draft");
  assert.equal(inclusion({ id: "a", status: "approved", confidence: "high", visibility: "private" }, brief, "brief").reason, "visibility is private");
  assert.equal(inclusion({ id: "a", status: "approved" }, brief, "brief").reason, "confidence is medium");
  assert.match(inclusion({ id: "a", status: "approved", confidence: "high", priority: 90, targets: { brief: { omit: true } } }, brief, "brief").reason, /left out/);
  assert.equal(inclusion({ url: "https://x.example", visibility: "private" }, brief, "brief").shown, false);
});

test("sectionsRead finds the lists a mapping uses", () => {
  const read = sectionsRead(loadMapping("timeline"));
  assert.ok(read.has("work") && read.has("timeline"));
  assert.ok(!read.has("skills"));
});

test("the review file is accessible Markdown: one H1, no skipped levels, tables with header rows", () => {
  for (const p of [sample(), recommended(), load("examples/employee.profile.json"), load("examples/history.profile.json")]) {
    const md = review(p);
    const lines = md.split("\n");
    const headings = lines.filter((l) => /^#+ /.test(l)).map((l) => l.match(/^#+/)[0].length);
    assert.equal(headings.filter((h) => h === 1).length, 1, "one H1");
    assert.equal(headings[0], 1);
    for (let i = 1; i < headings.length; i++) assert.ok(headings[i] <= headings[i - 1] + 1, `heading ${i} skips a level`);
    // Every table: a header row, a separator row, and the same number of cells in every row.
    const cells = (l) => l.split(/(?<!\\)\|/).length;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("|") || (i > 0 && lines[i - 1].startsWith("|"))) continue;
      assert.match(lines[i + 1] ?? "", /^\| (--- \| )*--- \|$/, `table at line ${i + 1} has a header separator`);
      for (let j = i; lines[j]?.startsWith("|"); j++) assert.equal(cells(lines[j]), cells(lines[i]), `row ${j + 1} matches its header`);
    }
    assert.doesNotMatch(md, /undefined|\[object Object\]|NaN/);
    // Meaning is in words: no emoji or symbols standing in for a status.
    assert.doesNotMatch(md, /[✅❌⚠✓✗\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(md, /(?<!\\)\]\((?!https?:\/\/)/, "links go to http(s) only");
    assert.doesNotMatch(md, /\[(here|link|click here)\]/i);
  }
});

test("the summary gives consent, counts, open items in order and rule hits", () => {
  const md = review(sample());
  assert.match(md, /\*\*Subject's consent:\*\* recorded on 2026-11-01/);
  assert.match(md, /\*\*By status:\*\* 26 approved, 1 pending, 1 retired\./);
  assert.match(md, /\*\*Open items:\*\* 2\./);
  assert.ok(md.indexOf("| disputed |") < md.indexOf("| pending |"), "disputed before pending");
  assert.match(md, /No output breaks a content rule\./);

  const p = sample();
  delete p.meta.subjectConsent;
  p.person.headline = "A guaranteed safe pair of hands";
  const bad = review(p);
  assert.match(bad, /\*\*Subject's consent:\*\* not recorded/);
  assert.match(bad, /\| linkedin \| no-safe \| .*safe/i);
});

test("each entry says which outputs show it, and why the others don't", () => {
  const p = sample();
  p.work[0].priority = 40;
  const md = review(p);
  const row = rowOf(md, p.work[0].id);
  assert.equal(row.length, 9);
  assert.match(row[8], /Shown in: [a-z0-9, ]*linkedin/);
  assert.match(row[8], /Hidden from: .*brief \(priority 40 is below 80\)/);
  assert.match(row[8], /Not used by: [a-z0-9, ]*scim/);
  const pending = rowOf(md, "consulting-gap");
  assert.equal(pending[2], "pending");
  assert.match(pending[7], /Open question: Was this paid work/);
  assert.match(pending[8], /Shown in: no output\. Hidden from: .*brief \(status is pending\)/);
});

test("positions and figures follow their entry: hidden when it is, never by priority", () => {
  const p = load("examples/history.profile.json");
  const job = p.work.find((w) => w.positions?.length);
  job.priority = 10;
  job.confidence = "high";
  const md = review(p);
  assert.match(rowOf(md, job.id)[8], /Hidden from: .*brief \(priority 10 is below 80\)/);
  assert.match(rowOf(md, `${job.id} › position ${job.positions[0].id}`)[8], /brief \(its entry is hidden: priority 10 is below 80\)/);
});

test("sources carry their quality; codes, notes and named audiences are shown", () => {
  const md = review(sample());
  assert.match(md, /Harborline offer letter \(primary\)/);
  assert.match(md, /Ines Calloway CV, 2024, p1 \(selfReported\)/);
  const p = recommended();
  p.work[0].note = "Check the end date with HR | before publishing";
  p.work[0].audiences = [];
  const out = review(p);
  assert.match(rowOf(out, p.work[0].id)[7], /Check the end date with HR \\\| before publishing/);
  const coded = load("examples/history.profile.json");
  assert.match(review(coded), /soc 15-1244/);
  const emp = load("examples/employee.profile.json");
  assert.match(review(emp), /also shared with /);
});

test("claims are laid side by side with the profile's own value", () => {
  const md = review(sample());
  const rows = md.split("\n").filter((l) => l.startsWith("| work/harborline-director | title |"));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /\| Director of Development \| Director of Development \| accepted \| Harborline offer letter \(primary\)/);
  assert.match(rows[1], /\| Director of Development \| VP Development \| not accepted \| The Harbor Gazette/);
  assert.match(md, /figure marina-slips \| value \| 120 \| 140 \| not accepted/);
});

test("other people's data has its own section, with consent per item", () => {
  const md = review(recommended());
  const section = md.slice(md.indexOf("## Other people's data"));
  assert.match(section, /### People/);
  assert.match(section, /\| maria-chen \| Maria Chen \|/);
  assert.match(section, /2 \(email: private\)/);
  assert.match(section, /\| recommendations\/rec-sam \| Sam Okafor \| 2024-02-12 \| given on 2026-11-02; scope: highlights; how: email \|/);
  // Contact values themselves stay out: the file says they are held, not what they are.
  const p = recommended();
  const contact = Object.values(p.people).flatMap((w) => w.contacts ?? [])[0].value;
  assert.ok(!md.includes(contact));
  p.recommendations[0].consent = { given: false };
  assert.match(review(p), /\| recommendations\/rec-maria \| Maria Chen \| [^|]+ \| not recorded \|/);
});

test("profile text can't inject Markdown or break a table", () => {
  const p = sample();
  p.work[0].title = "Chief | of <script>alert(1)</script> [x](javascript:alert(1)) *bold*\n# Heading";
  const md = review(p);
  const row = rowOf(md, p.work[0].id);
  assert.equal(row.length, 9);
  assert.doesNotMatch(md, /<script>/);
  // The brackets are escaped, so "[x](javascript:…)" is plain text, not a link.
  assert.doesNotMatch(md, /(?<!\\)\]\(javascript:/);
  assert.match(md, /\\\[x\\\]\(javascript:/);
  assert.equal(md.split("\n").filter((l) => /^# /.test(l)).length, 1);
});

test("an invalid profile still gets a review file, headed by its errors", () => {
  const p = sample();
  p.work[0].organization = "no-such-org";
  const md = review(p);
  assert.match(md, /\*\*Validation:\*\* not valid \(1 error\)/);
  assert.match(md, /### Validation errors/);
  assert.match(md, /unknown organization "no-such-org"/);
  assert.match(md, /Not checked, because the profile is not valid\./);
  assert.match(md, /### Work/);
});

test("the review command writes the file, and the committed sample is current", () => {
  const out = join(mkdtempSync(join(tmpdir(), "turnrow-review-")), "deep", "review.md");
  const r = cli("review", join(root, "examples", "sample.profile.json"), "--on", ON, "--out", out);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /holds private data/);
  assert.ok(existsSync(out));
  assert.equal(readFileSync(out, "utf8"), review(sample(), { source: join(root, "examples", "sample.profile.json") }));
  assert.equal(readFileSync(join(root, "examples", "out", "sample.review.md"), "utf8"), review(sample(), { source: "examples/sample.profile.json" }));
  const bundle = cli("review", join(root, "examples", "recommended"), "--on", ON);
  assert.equal(bundle.status, 0);
  assert.match(bundle.stdout, /^# Review file: Ines Ortega/);
  assert.match(cli("help").stdout, /review {4}<profile \| bundle>/);
});
