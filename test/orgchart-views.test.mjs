// The org chart's other views: the numbers, the web page and the PDF. All are made from the same
// rows as the table, so they can't say different things.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { orgStats, orgSeries, statsMarkdown, monthStarts, orgHtml, orgPdfView, renderOrgPdf, orgRows } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const FILE = join(root, "examples/orgchart/acme.org.json");
const acme = () => JSON.parse(readFileSync(FILE, "utf8"));
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin/profile.mjs"), ...args], { encoding: "utf8" });
const NOV = "2026-11-07", JAN = "2026-01-05";
const hasTypst = spawnSync("typst", ["--version"]).status === 0;

test("the numbers on a day: posts, people, units, span of control, layers", () => {
  const s = orgStats(acme(), { on: NOV });
  assert.deepEqual(s.totals, { posts: 5, filled: 4, vacant: 1, planned: 1, people: 4, fte: 4 });
  const unit = (name) => s.units.find((u) => u.name === name);
  assert.deepEqual([unit("Platform Engineering").filled, unit("Platform Engineering").vacant, unit("Platform Engineering").planned], [1, 1, 1]);
  assert.deepEqual(s.spans, [{ post: s.spans[0].post, title: "Director of Engineering", holder: "Filled (person not shown)", reports: 2, filledReports: 1 }], "a planned post and a dotted line are not reports");
  assert.deepEqual(s.span, { managers: 1, average: 2, median: 2, largest: 2, smallest: 2 });
  assert.deepEqual(s.layers, [{ layer: 1, posts: 3, filled: 3 }, { layer: 2, posts: 2, filled: 1 }]);
  assert.equal(s.units.reduce((n, u) => n + u.filled, 0), s.totals.filled, "units add up to the total");
  const empty = orgStats(acme(), { on: "2020-01-01" });
  assert.deepEqual(empty.span, { managers: 0, average: 0, median: 0, largest: 0, smallest: 0 });
});

test("budget is counted only when asked for, and is the seat's", () => {
  assert.doesNotMatch(JSON.stringify(orgStats(acme(), { on: NOV })), /budget|210000/);
  const u = orgStats(acme(), { on: NOV, budget: true }).units.find((x) => x.name === "Platform Engineering");
  assert.deepEqual([u.budgetFte, u.budgetCost, u.filledCost], [1, { USD: 210000 }, {}], "the open post is budgeted and not yet filled; the planned one is not yet counted");
  const later = orgStats(acme(), { on: "2027-02-01", budget: true }).units.find((x) => x.name === "Platform Engineering");
  assert.deepEqual(later.budgetCost, { USD: 445000 });
  assert.doesNotMatch(statsMarkdown(acme(), { on: NOV }), /Budget|210,000|Internal/);
  assert.match(statsMarkdown(acme(), { on: NOV, budget: true }), /\*\*Internal\.\*\*[\s\S]*\| Platform Engineering \| 1 \| 1 \| 1 \| 1 \| 1 \| 210,000 USD \| none \|/);
});

test("headcount over time, month by month, with what changed", () => {
  assert.deepEqual(monthStarts("2026-01-05", "2026-03-10"), ["2026-01-05", "2026-02-01", "2026-03-01", "2026-03-10"]);
  assert.deepEqual(monthStarts("2026-11-01", "2027-01-01"), ["2026-11-01", "2026-12-01", "2027-01-01"]);
  const s = orgSeries(acme(), { from: JAN, to: NOV });
  assert.equal(s.points[0].filled, 5);
  assert.equal(s.points.at(-1).filled, 4);
  assert.equal(s.points.find((p) => p.on === "2026-09-01").vacant, 1, "the vacancy opened on 1 September");
  assert.equal(s.points[0].units["Customer Support"], 1);
  assert.equal(s.points.at(-1).units["Customer Support"] ?? 0, 0);
  assert.ok(s.changes.some((c) => c.kind === "closed" && c.title === "Support Team Lead"));
  assert.throws(() => orgSeries(acme(), { from: NOV, to: JAN }), /must be before/);
  const md = statsMarkdown(acme(), { on: NOV, from: JAN, to: NOV });
  assert.match(md, /## Headcount from 2026-01-05 to 2026-11-07/);
  assert.match(md, /\| 2026-11-07 \| 4 \| 1 \| 4 \| 0 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.equal(md, readFileSync(join(root, "examples/out/orgchart/acme.stats.md"), "utf8"), "the committed example is current");
});

const page = (o = {}) => orgHtml(acme(), { on: NOV, compare: JAN, ...o });

test("the web page is one file: nothing fetched, nothing outside it", () => {
  const html = page();
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">/);
  assert.doesNotMatch(html, /<(img|link|iframe|object|embed|audio|video|form)\b/i);
  assert.doesNotMatch(html, /\b(src|href|action)\s*=/i, "no address of any kind");
  assert.doesNotMatch(html, /https?:\/\//, "not even in text: a photo's address is not written");
  assert.equal(html, readFileSync(join(root, "examples/out/orgchart/acme.html"), "utf8"), "the committed example is current");
});

test("without scripting the chart is a nested list of every post, in the table's order", () => {
  const html = page();
  const list = html.slice(html.indexOf('<ul class="chart"'), html.indexOf("<h2>The same, as a table"));
  const titles = [...list.matchAll(/<span class="t">(?:<span class="twist" aria-hidden="true"><\/span>)?([^<]+)<\/span>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  assert.deepEqual(titles, orgRows(acme(), { on: NOV }).rows.map((r) => r.title));
  assert.doesNotMatch(list, /role=/, "roles are added by the script, so a page without it is not a broken tree");
  assert.equal((list.match(/<ul>/g) ?? []).length, 1, "one nested list: the director's reports");
  assert.match(html, /<div class="bar" hidden>/);
  assert.match(html, /id="keys" class="muted" hidden/);
});

test("vacant and planned are said in words and drawn with their own border, never by color alone", () => {
  const html = page();
  assert.match(html, /class="post vacant"[^>]*>.*?<span class="tag">Vacant \(open, new post\), wanted by 2026-12-15<\/span>/s);
  assert.match(html, /class="post planned"[^>]*>.*?<span class="tag">Planned \(new post\), from 2027-01-01<\/span>/s);
  assert.match(html, /\.post\.vacant\{border-style:dashed/);
  assert.match(html, /\.post\.planned\{border-style:dotted/);
  assert.doesNotMatch(html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/:root\{[^}]*\}|@media \(prefers-color-scheme:dark\)\{:root\{[^}]*\}\}/g, ""), /#[0-9a-f]{3,6}\b/i, "every color is a brand token");
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /:focus-visible\{outline:3px solid var\(--focus-ring\)/);
});

test("the tables have captions and header cells; the tree script follows the ARIA tree pattern", () => {
  const html = page();
  assert.equal((html.match(/<caption>/g) ?? []).length, 2);
  assert.match(html, /<th scope="col">Level<\/th><th scope="col">Post<\/th>/);
  assert.match(html, /<th scope="row">Engineering Manager, Platform<\/th>/);
  const levels = [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
  assert.equal(levels[0], 1);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] - levels[i - 1] <= 1);
  for (const needle of ["'role','tree'", "'role','treeitem'", "'role','group'", "aria-expanded", "aria-level", "aria-setsize", "aria-posinset", "aria-labelledby", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]) assert.ok(html.includes(needle), needle);
  assert.match(html, /<span class="sep">: <\/span>/, "a post's name is read with pauses between its parts");
});

test("text from the file is escaped; budget appears only when asked for", () => {
  const o = acme();
  o.meta.name = 'Acme <script>alert(1)</script> & "Co"';
  o.posts.find((p) => p.title === "Data Analyst I").title = "<img src=x onerror=alert(1)>";
  const html = orgHtml(o, { on: NOV });
  assert.doesNotMatch(html, /<script>alert|<img/);
  assert.match(html, /Acme &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Co&quot;/);
  assert.doesNotMatch(page(), /210,000|band M2|Internal/);
  assert.match(page({ budget: true }), /<strong>Internal\.<\/strong>[\s\S]*band M2 · 210,000 USD/);
  assert.match(orgHtml(acme(), { on: "2020-01-01", planned: false }), /<p>No posts on this date\.<\/p>/);
});

test("the PDF prints the same rows, with the level in figures", () => {
  const view = orgPdfView(acme(), { on: NOV, compare: JAN });
  assert.equal(view.title, "Acme Example Corp: organization on 2026-11-07");
  assert.deepEqual(view.head, ["Level", "Post", "Held by", "Unit", "Reports to", "Status"]);
  assert.deepEqual(view.rows.map((r) => r[1]), orgRows(acme(), { on: NOV }).rows.map((r) => r.title));
  assert.ok(view.rows.every((r) => r.length === 6 && r.every((c) => typeof c === "string")));
  assert.equal(view.changes.rows.length, 5);
  assert.equal(orgPdfView(acme(), { on: NOV }).changes, null);
  assert.equal(orgPdfView(acme(), { on: NOV, budget: true }).head.length, 9);
});

test("the PDF is built (needs Typst)", { skip: hasTypst ? false : "Typst is not installed" }, () => {
  const out = join(mkdtempSync(join(tmpdir(), "org-pdf-")), "chart.pdf");
  renderOrgPdf(acme(), { out, on: NOV, compare: JAN });
  assert.equal(readFileSync(out).subarray(0, 5).toString(), "%PDF-");
  const viaCli = join(mkdtempSync(join(tmpdir(), "org-pdf-")), "c.pdf");
  const r = cli("orgchart", "show", FILE, "--on", NOV, "--format", "pdf", "--out", viaCli);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(viaCli));
});

test("the commands: stats, and show as a web page", () => {
  const stats = cli("orgchart", "stats", FILE, "--on", NOV, "--from", JAN, "--to", NOV);
  assert.equal(stats.status, 0, stats.stderr);
  assert.equal(stats.stdout, readFileSync(join(root, "examples/out/orgchart/acme.stats.md"), "utf8"));
  const json = JSON.parse(cli("orgchart", "stats", FILE, "--on", NOV, "--format", "json").stdout);
  assert.equal(json.totals.filled, 4);
  assert.equal(json.series, undefined);
  assert.equal(cli("orgchart", "stats", FILE, "--from", JAN).status, 2);
  assert.equal(cli("orgchart", "stats", FILE, "--from", NOV, "--to", JAN).status, 2);
  assert.equal(cli("orgchart", "stats", FILE, "--format", "csv").status, 2);
  const html = cli("orgchart", "show", FILE, "--on", NOV, "--compare", JAN, "--format", "html");
  assert.equal(html.stdout, readFileSync(join(root, "examples/out/orgchart/acme.html"), "utf8"));
  assert.equal(cli("orgchart", "show", FILE, "--format", "pdf").status, 2, "a PDF needs --out");
});
