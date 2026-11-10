// The time-based org chart: posts (seats), holders and reporting lines, all dated. Status is worked
// out from the dates; people are named only as they have released; nothing is deleted, only ended.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateOrganization, stateOn, compareDates, holderText, buildOrganization, orgRows, orgMarkdown, orgCsv, DIRECTORY_CONNECTORS, readProfileFolder } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const FILE = join(root, "examples/orgchart/acme.org.json");
const acme = () => JSON.parse(readFileSync(FILE, "utf8"));
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin/profile.mjs"), ...args], { encoding: "utf8" });
const NOV = "2026-11-07", JAN = "2026-01-05";
const post = (state, title) => state.posts.find((p) => p.title === title);
const errors = (edit) => { const o = acme(); edit(o); return validateOrganization(o).errors.join("\n"); };

test("the example is valid, and every post, holder and line names a source", () => {
  const v = validateOrganization(acme());
  assert.equal(v.valid, true, v.errors.join("\n"));
  const o = acme();
  for (const p of o.posts) {
    assert.ok(o.sources[p.source], p.id);
    for (const x of [...(p.holders ?? []), ...(p.reportsTo ?? [])]) assert.ok(o.sources[x.source], p.id);
  }
});

test("status is worked out from the dates: filled, vacant, planned; a closed post is gone", () => {
  const now = stateOn(acme(), { on: NOV });
  assert.equal(post(now, "Senior Software Engineer II").status, "filled");
  assert.equal(post(now, "Engineering Manager, Platform").status, "vacant");
  assert.equal(post(now, "Staff Platform Engineer").status, "planned");
  assert.equal(post(now, "Staff Platform Engineer").starts, "2027-01-01");
  assert.equal(post(now, "Support Team Lead"), undefined, "it ended before November");
  const before = stateOn(acme(), { on: JAN });
  assert.equal(post(before, "Support Team Lead").status, "filled");
  assert.equal(post(before, "Senior Software Engineer I").status, "filled");
  assert.equal(post(before, "Engineering Manager, Platform").status, "planned", "in January it was still to come");
  const later = stateOn(acme(), { on: "2027-02-01" });
  assert.equal(post(later, "Staff Platform Engineer").status, "vacant", "once its start date passes, a post nobody holds is a vacancy");
  assert.equal(stateOn(acme(), { on: NOV, planned: false }).posts.some((p) => p.status === "planned"), false);
  assert.deepEqual(Object.keys(acme().posts[0]).includes("status"), false, "status is never stored");
});

test("reading order follows the reporting lines; dotted lines do not change the tree", () => {
  const s = stateOn(acme(), { on: NOV });
  const director = post(s, "Director of Engineering");
  assert.equal(director.depth, 1);
  assert.deepEqual(director.reports.map((id) => s.posts.find((p) => p.id === id).title), ["Engineering Manager, Platform", "Senior Software Engineer II", "Staff Platform Engineer"]);
  const i = s.posts.indexOf(director);
  assert.deepEqual(s.posts.slice(i + 1, i + 4).map((p) => p.depth), [2, 2, 2]);
  const staff = post(s, "Staff Platform Engineer");
  assert.equal(staff.manager, director.id);
  assert.deepEqual(staff.dotted, [post(s, "Senior Software Engineer II").id]);
  assert.equal(post(s, "Senior Software Engineer II").reports.length, 0, "a dotted line is not a report");
});

test("a person is named only by their own release; a seat without one is still filled", () => {
  const s = stateOn(acme(), { on: NOV });
  assert.equal(holderText(post(s, "Senior Software Engineer II")), "Sam Rivera");
  assert.equal(post(s, "Senior Software Engineer II").holders[0].pronouns, "she/her");
  assert.equal(holderText(post(s, "Data Analyst I")), "Filled (person not shown)");
  assert.equal(post(s, "Data Analyst I").status, "filled", "the headcount is right even when the name is withheld");
  const text = JSON.stringify(acme());
  assert.doesNotMatch(text, /Lee Park|lee\.park/, "Lee has not consented: nothing of Lee's is in the file");
  assert.doesNotMatch(text, /Avery|Morgan/, "nor of anyone with no profile");
  assert.match(acme().people["sam-rivera"].release, /^release-/);
});

test("budget figures stay out unless asked for", () => {
  assert.doesNotMatch(JSON.stringify(stateOn(acme(), { on: NOV })), /annualCost|210000|"band"|CC-410/);
  assert.equal(post(stateOn(acme(), { on: NOV, budget: true }), "Engineering Manager, Platform").budget.annualCost.amount, 210000);
  assert.doesNotMatch(orgMarkdown(acme(), { on: NOV }), /210,000|Band|Internal/);
  assert.match(orgMarkdown(acme(), { on: NOV, budget: true }), /\*\*Internal\.\*\*[\s\S]*\| M2 \| 1 \| 210,000 USD \|/);
  assert.doesNotMatch(orgCsv(acme(), { on: NOV }), /210000|Annual cost/);
});

test("comparing two dates: opened, closed, changed hands, and a retitled seat is one seat", () => {
  const d = compareDates(acme(), JAN, NOV);
  const kinds = (title) => d.changes.filter((c) => c.title === title).map((c) => c.kind);
  assert.deepEqual(kinds("Engineering Manager, Platform"), ["opened"]);
  assert.deepEqual(kinds("Support Team Lead"), ["closed"]);
  assert.match(d.changes.find((c) => c.title === "Support Team Lead").detail, /it was filled; the person is not shown/);
  assert.deepEqual(kinds("Senior Software Engineer II"), ["changedHands", "renamed"], "not one seat closing and another opening");
  assert.equal(d.changes.some((c) => c.title === "Senior Software Engineer I"), false);
  assert.equal(d.changes.some((c) => c.title === "Staff Platform Engineer"), false, "a post still to come has not opened");
  assert.deepEqual(compareDates(acme(), NOV, NOV).changes, []);
});

test("the validator catches what would make a chart wrong", () => {
  assert.match(errors((o) => { o.posts[0].unit = "nowhere"; }), /unit "nowhere" is not in units/);
  assert.match(errors((o) => { o.posts[0].source = "nothing"; }), /source "nothing" is not in sources/);
  assert.match(errors((o) => { o.posts.push({ ...o.posts[0] }); }), /used twice/);
  assert.match(errors((o) => { o.posts[0].from = "2026-12-01"; o.posts[0].to = "2026-01-01"; }), /ends \(2026-01-01\) before it starts/);
  assert.match(errors((o) => { const p = o.posts.find((x) => x.reportsTo?.length); p.reportsTo.push({ post: o.posts.find((x) => x.id !== p.id && x.id !== p.reportsTo[0].post).id, source: p.source }); }), /two line managers at once/);
  assert.match(errors((o) => { const p = o.posts.find((x) => x.holders?.some((h) => !h.to)); p.holders.push({ source: p.source }); }), /add up to 2 of one seat/);
  assert.match(errors((o) => { o.posts[0].reportsTo = [{ post: o.posts[0].id, source: o.posts[0].source }]; }), /reports to itself/);
  assert.match(errors((o) => { o.posts[0].reportsTo = [{ post: "ghost", source: o.posts[0].source }]; }), /"ghost", which is not a post/);
  assert.match(errors((o) => { o.posts[0].holders = [{ person: "nobody", source: o.posts[0].source }]; }), /"nobody" is not in people/);
  assert.match(errors((o) => { o.units.design.parent = "ghost"; }), /parent "ghost" is not a unit/);
  assert.match(errors((o) => { o.posts[0].status = "filled"; }), /additional properties.*status/);
  assert.match(errors((o) => { o.posts[0].budget = { salary: 1 }; }), /additional properties/);
  // A loop: the director reports to her own report.
  assert.match(errors((o) => {
    const dir = o.posts.find((p) => p.title === "Director of Engineering"), sam = o.posts.find((p) => p.title === "Senior Software Engineer II");
    dir.reportsTo = [{ post: sam.id, from: "2026-11-07", source: dir.source }];
  }), /reporting lines form a loop/);
  const halves = acme();
  const seat = halves.posts.find((p) => p.title === "Engineering Manager, Platform");
  seat.holders = [{ fte: 0.5, from: "2026-10-01", source: seat.source }, { fte: 0.5, from: "2026-10-01", source: seat.source }];
  assert.equal(validateOrganization(halves).valid, true, "two half-time holders share a seat");
  assert.equal(holderText(post(stateOn(halves, { on: NOV }), "Engineering Manager, Platform")), "Filled (person not shown) (50%) and Filled (person not shown) (50%)");
});

const scim = DIRECTORY_CONNECTORS.scim;
const exportDoc = () => JSON.parse(readFileSync(join(root, "examples/directory/acme-users.scim.json"), "utf8"));
const build = (doc, on, base) => buildOrganization({ profiles: readProfileFolder(join(root, "examples/directory/people")), users: scim.readExport(JSON.stringify(doc)), connector: scim, requester: { domain: "acme.example", method: "oidc" }, name: "Acme Example Corp", on, now: `${on}T00:00:00.000Z`, base });

test("the builder: a post per directory user, units from departments, lines from manager links", () => {
  const { org, report } = build(exportDoc(), NOV);
  assert.equal(org.posts.length, 4);
  assert.deepEqual(report.opened.length, 4);
  assert.deepEqual([report.named, report.notNamed], [2, 2]);
  assert.deepEqual(Object.keys(org.units).sort(), ["design", "engineering", "finance", "platform-engineering"]);
  const sam = org.posts.find((p) => p.directoryId === "u-1001");
  assert.equal(sam.reportsTo[0].post, org.posts.find((p) => p.directoryId === "u-1000").id);
  assert.equal(sam.holders[0].person, "sam-rivera");
  assert.equal(org.posts.find((p) => p.directoryId === "u-1003").holders[0].person, undefined, "Lee is in the directory and has not consented");
  assert.deepEqual(report.refusals.map((r) => r.code).sort(), ["noConsent", "noMatchingUser"]);
  assert.equal(org.sources[`export-${NOV}`].kind, "directoryExport");
  assert.deepEqual(org.meta.domains, ["acme.example"]);
});

test("the builder carries a base file forward: it ends, it never deletes, and hand-written posts are kept", () => {
  const first = build(exportDoc(), JAN).org;
  const again = build(exportDoc(), NOV, first);
  assert.deepEqual([again.report.opened.length, again.report.ended.length, again.report.replaced.length], [0, 0, 0]);
  assert.equal(again.org.posts.length, 4, "the same export twice changes nothing but the date");
  assert.equal(again.report.kept, 4);

  const changed = exportDoc();
  changed.Resources = changed.Resources.filter((u) => u.id !== "u-1003"); // Lee leaves
  changed.Resources.find((u) => u.id === "u-1002")["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"].manager = { value: "u-1000" }; // Dana moves under the director
  const base = structuredClone(first);
  base.sources.plan = { kind: "manual" };
  base.posts.push({ id: "planned-seat", title: "Planned seat", from: "2027-06-01", source: "plan" });
  const { org, report } = build(changed, NOV, base);
  assert.deepEqual(report.ended, ["Data Analyst I"]);
  const lee = org.posts.find((p) => p.directoryId === "u-1003");
  assert.equal(lee.to, "2026-11-06", "ended the day before the run");
  assert.equal(lee.holders[0].to, "2026-11-06");
  assert.ok(org.posts.find((p) => p.id === "planned-seat"), "a hand-written post is left alone");
  const dana = org.posts.find((p) => p.directoryId === "u-1002");
  assert.equal(dana.reportsTo.at(-1).from, NOV);
  const diff = compareDates(org, JAN, NOV);
  assert.ok(diff.changes.some((c) => c.kind === "moved" && c.title === "Product Designer II" && /reports to Director of Engineering \(was nobody\)/.test(c.detail)));
  assert.ok(diff.changes.some((c) => c.kind === "closed" && c.title === "Data Analyst I"));
  assert.equal(validateOrganization(org).valid, true);
  assert.throws(() => build(exportDoc(), NOV, { orgSchemaVersion: "1.0.0", meta: {}, posts: [] }), /base file is not valid/);
});

test("the table and the CSV say the same thing, in words", () => {
  const { rows } = orgRows(acme(), { on: NOV });
  assert.equal(rows.length, 6);
  const md = orgMarkdown(acme(), { on: NOV, compare: JAN });
  assert.match(md, /^# Acme Example Corp: organization on 2026-11-07\n\n4 filled, 1 vacant, 1 planned\./);
  assert.match(md, /\| 2 \| Engineering Manager, Platform \| Vacant \| Platform Engineering \| Director of Engineering \| Vacant \(open, new post\), wanted by 2026-12-15 \| 0 \|/);
  assert.match(md, /\| Planned \(new post\), from 2027-01-01 \|/);
  assert.match(md, /dotted line to Senior Software Engineer II/);
  assert.match(md, /## What changed from 2026-01-05 to 2026-11-07/);
  assert.equal(md, readFileSync(join(root, "examples/out/orgchart/acme.md"), "utf8"), "the committed example is current");
  const csv = orgCsv(acme(), { on: NOV });
  assert.equal(csv.split("\r\n")[0], "Level,Post,Held by,Unit,Reports to,Status,Direct reports");
  assert.match(csv, /2,"Engineering Manager, Platform",Vacant,/);
  const hostile = acme();
  hostile.posts.find((p) => p.title === "Data Analyst I").title = "=cmd|' /C calc'!A0";
  assert.match(orgCsv(hostile, { on: NOV }), /'=cmd/, "a title a spreadsheet would run is quoted");
  assert.match(orgMarkdown(hostile, { on: NOV }), /=cmd\\\|/);
});

test("the commands: validate, show, build", () => {
  const ok = cli("orgchart", "validate", FILE);
  assert.equal(ok.status, 0, ok.stderr);
  const dir = mkdtempSync(join(tmpdir(), "org-"));
  const bad = acme();
  bad.posts[0].unit = "nowhere";
  writeFileSync(join(dir, "bad.org.json"), JSON.stringify(bad));
  const no = cli("orgchart", "validate", join(dir, "bad.org.json"));
  assert.equal(no.status, 1);
  assert.match(no.stderr, /unit "nowhere"/);
  assert.equal(cli("orgchart", "show", join(dir, "bad.org.json")).status, 1);
  const show = cli("orgchart", "show", FILE, "--on", NOV, "--compare", JAN);
  assert.equal(show.stdout, readFileSync(join(root, "examples/out/orgchart/acme.md"), "utf8"));
  assert.equal(cli("orgchart", "show", FILE, "--on", NOV, "--format", "csv").stdout, readFileSync(join(root, "examples/out/orgchart/acme.csv"), "utf8"));
  assert.equal(cli("orgchart", "show", FILE, "--format", "png").status, 2);
  assert.equal(cli("orgchart", "show", FILE, "--compare", "last year").status, 2);

  const out = join(dir, "built.org.json");
  const args = ["orgchart", "build", join(root, "examples/directory/people"), "--against", join(root, "examples/directory/acme-users.scim.json"), "--target", "scim", "--domain", "acme.example", "--method", "oidc", "--on", JAN, "--out", out];
  const noName = cli(...args);
  assert.equal(noName.status, 2);
  assert.match(noName.stderr, /needs --name/);
  const built = cli(...args, "--name", "Acme Example Corp");
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stderr, /4 posts opened, 0 ended, 0 changed, 0 unchanged\./);
  assert.match(built.stderr, /seats are filled by someone not shown/);
  assert.equal(cli("orgchart", "validate", out).status, 0);
  const next = cli("orgchart", "build", join(root, "examples/directory/people"), "--against", join(root, "examples/directory/acme-users.scim.json"), "--target", "scim", "--domain", "acme.example", "--method", "oidc", "--on", NOV, "--base", out, "--out", out);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stderr, /0 posts opened, 0 ended, 0 changed, 4 unchanged\./);
});

test("a profile's dated positions give the seat its history, sourced to the profile", () => {
  const profiles = readProfileFolder(join(root, "examples/directory/people")).map((p) => {
    if (!p.name.startsWith("sam-")) return p;
    const profile = structuredClone(p.profile);
    const job = profile.work.find((w) => w.id === "acme-platform");
    job.positions = [
      { id: "p1", title: "Software Engineer", startDate: "2022-03", endDate: "2023-12", status: "approved", confidence: "high" },
      { id: "p2", title: "Senior Software Engineer", startDate: "2024-01", endDate: "2025-06", status: "approved", confidence: "high" },
      { id: "p3", title: "Platform Engineering Lead", startDate: "2025-07", current: true, status: "approved", confidence: "high" },
      { id: "p0", title: "Intern", startDate: { value: "2021", qualifier: "about" }, endDate: "2022-02", status: "approved", confidence: "high" },
    ];
    job.startDate = "2022-03";
    return { ...p, profile };
  });
  const { org, report } = buildOrganization({ profiles, users: scim.readExport(JSON.stringify(exportDoc())), connector: scim, requester: { domain: "acme.example", method: "oidc" }, name: "Acme", on: NOV, now: `${NOV}T00:00:00.000Z` });
  assert.equal(report.history, 2, "a position with an inexact start is not turned into a dated post");
  assert.equal(validateOrganization(org).valid, true, validateOrganization(org).errors.join("\n"));
  const current = org.posts.find((p) => p.directoryId === "u-1001");
  assert.equal(current.from, "2025-07");
  assert.equal(current.holders[0].from, "2025-07");
  const past = org.posts.find((p) => p.id === current.succeeds);
  assert.deepEqual([past.title, past.from, past.to, org.sources[past.source].kind], ["Senior Software Engineer", "2024-01", "2025-06", "profile"]);
  assert.equal(org.posts.find((p) => p.id === past.succeeds).title, "Software Engineer");
  assert.equal(holderText(post(stateOn(org, { on: "2023-06-01", planned: false }), "Software Engineer")), "Sam Rivera");
  const changes = compareDates(org, "2024-06-01", NOV).changes.filter((c) => c.post === current.id);
  assert.deepEqual(changes.map((c) => c.kind), ["renamed"], "a promotion reads as one seat retitled");
  // Carried forward, nothing is added twice.
  const again = buildOrganization({ profiles, users: scim.readExport(JSON.stringify(exportDoc())), connector: scim, requester: { domain: "acme.example", method: "oidc" }, on: "2026-12-01", base: org });
  assert.equal(again.report.history, 0);
  assert.equal(again.org.posts.length, org.posts.length);
});
