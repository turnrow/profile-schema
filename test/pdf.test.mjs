// The résumé PDF. Preparing the view is tested everywhere; rendering needs Typst, so those tests
// are skipped (and say so) on a machine without it. CI installs a pinned Typst.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, cpSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderResumePdf, resumeViewForPdf, dropCandidates, PdfError } from "../index.mjs";
import { readingOrder } from "../scripts/render-example-pdfs.mjs";
import { inOrder } from "../scripts/check-reading-order.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const sample = () => load("examples/sample.profile.json");
const RECOMMENDED = join(root, "examples", "recommended");
const ON = "2026-11-07";
const tmp = () => mkdtempSync(join(tmpdir(), "turnrow-pdf-test-"));
const cli = (...args) => spawnSync(process.execPath, [join(root, "bin", "profile.mjs"), ...args], { encoding: "utf8" });
const typst = spawnSync("typst", ["--version"], { encoding: "utf8" });
const noTypst = typst.error || typst.status !== 0 ? "Typst is not installed here" : false;
// A profile long enough to need a second page.
const long = () => {
  const p = sample();
  const job = p.work.find((w) => w.id === "harborline-director");
  for (let i = 0; i < 40; i++) p.work.push({ ...job, id: `filler-${i}`, priority: i, title: `Filler role ${i}`, metrics: undefined, claims: undefined, lock: undefined });
  return p;
};

// ---------- the view the template is given (no Typst needed) ----------

test("without --photo the view carries no photo; with it, a bundle photo resolves to a file", () => {
  const p = load("examples/recommended/profile.json");
  assert.equal(resumeViewForPdf(p, { on: ON, bundleDir: RECOMMENDED }).view.person.photo, undefined);
  const { view, photoFile } = resumeViewForPdf(p, { on: ON, bundleDir: RECOMMENDED, photo: true });
  assert.equal(photoFile, join(RECOMMENDED, "media", "headshot.png"));
  assert.equal(typeof view.person.photo.alt, "string");
});

test("--photo is refused plainly when there is no usable photo", () => {
  assert.throws(() => resumeViewForPdf(sample(), { on: ON, photo: true }), (e) => e instanceof PdfError && /web link/.test(e.message));
  const none = sample();
  delete none.person.image;
  assert.throws(() => resumeViewForPdf(none, { on: ON, photo: true }), /no approved, public photo/);
  const p = load("examples/recommended/profile.json");
  assert.throws(() => resumeViewForPdf(p, { on: ON, photo: true }), /needs a bundle folder/);
});

test("a photo can't be read from outside the bundle", () => {
  const dir = join(tmp(), "bundle");
  cpSync(RECOMMENDED, dir, { recursive: true });
  const p = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"));
  const secret = join(tmp(), "secret.png");
  writeFileSync(secret, readFileSync(join(dir, "media", "headshot.png")));
  symlinkSync(secret, join(dir, "media", "link.png"));
  p.media.find((m) => m.id === "headshot").url = "bundle:media/link.png";
  assert.throws(() => resumeViewForPdf(p, { on: ON, bundleDir: dir, photo: true }), /not a file inside the bundle/);
  p.media.find((m) => m.id === "headshot").url = "bundle:media/../../etc/passwd";
  assert.throws(() => resumeViewForPdf(p, { on: ON, bundleDir: dir, photo: true }), /not a file inside the bundle/);
});

test("--min-priority leaves out lower entries, and a section that empties", () => {
  const all = resumeViewForPdf(sample(), { on: ON }).view;
  const top = resumeViewForPdf(sample(), { on: ON, minPriority: 80 }).view;
  assert.ok(top.sections.length < all.sections.length);
  for (const s of top.sections) for (const e of s.entries) assert.ok(e.priority >= 80);
  assert.ok(!top.sections.some((s) => s.id === "languages"), "languages default to 50 and drop out");
});

test("drop candidates are the lowest priority first, later sections first on a tie", () => {
  const { view } = resumeViewForPdf(sample(), { on: ON });
  const c = dropCandidates(view, 5);
  assert.equal(c.length, 5);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].priority >= c[i - 1].priority);
  assert.deepEqual(Object.keys(c[0]), ["section", "id", "title", "priority"]);
  const tied = c.filter((x) => x.priority === c[0].priority).map((x) => x.section);
  const order = view.sections.map((s) => s.heading);
  for (let i = 1; i < tied.length; i++) assert.ok(order.indexOf(tied[i]) <= order.indexOf(tied[i - 1]));
});

test("options are checked before anything is run", () => {
  assert.throws(() => renderResumePdf(sample(), {}), /pass --out/);
  assert.throws(() => renderResumePdf(sample(), { out: "x.pdf", layout: "fancy" }), /unknown layout "fancy": use classic/);
  assert.throws(() => renderResumePdf(sample(), { out: "x.pdf", pages: "2" }), /--pages takes 1 or auto/);
  assert.throws(() => renderResumePdf(sample(), { out: "x.pdf", density: "tiny" }), /--density/);
  assert.throws(() => renderResumePdf(sample(), { out: "x.pdf", paper: "legal" }), /--paper/);
});

test("a missing Typst is explained, with where to get it", () => {
  const out = join(tmp(), "r.pdf");
  assert.throws(() => renderResumePdf(sample(), { out, typst: join(tmp(), "no-such-typst") }), (e) => e instanceof PdfError && /Typst was not found.*typst\.app.*--typst/s.test(e.message));
  assert.ok(!existsSync(out));
  const r = cli("pdf", join(root, "examples", "sample.profile.json"), "--out", out, "--typst", join(tmp(), "no-such-typst"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Typst was not found/);
});

test("the pdf command checks its own options", () => {
  const s = join(root, "examples", "sample.profile.json");
  assert.match(cli("pdf", s).stderr, /pdf needs --out/);
  assert.match(cli("pdf", s, "--out", "x.pdf", "--photo", "--no-photo").stderr, /can't both be given/);
  assert.match(cli("pdf", s, "--out", "x.pdf", "--min-priority", "high").stderr, /whole number from 0 to 100/);
  assert.match(cli("help").stdout, /pdf {7}<profile \| bundle> --out <file>/);
});

test("the academic layout leads with education and publications, and is titled a curriculum vitae", () => {
  const p = sample();
  p.publications.push({ id: "reef-paper", status: "approved", confidence: "high", kind: "paper", title: "Reef recovery after dredging", date: "2004-06", authors: ["I. Calloway", "R. Example"], doi: "10.1234/reef.2004.01", role: "author" });
  const classic = resumeViewForPdf(p, { on: ON }).view;
  const academic = resumeViewForPdf(p, { on: ON, layout: "academic" }).view;
  assert.deepEqual(academic.sections.map((s) => s.id).slice(0, 4), ["education", "experience", "publications", "awards"]);
  assert.equal(classic.sections[0].id, "experience");
  assert.deepEqual([...academic.sections.map((s) => s.id)].sort(), [...classic.sections.map((s) => s.id)].sort(), "the same sections, in another order");
  assert.equal(academic.title, "Ines Calloway: curriculum vitae");
  assert.equal(classic.title, "Ines Calloway: résumé");
  assert.equal(resumeViewForPdf(p, { on: ON, layout: "academic", locale: "fr" }).view.title, "Ines Calloway : curriculum vitæ");
  assert.equal(academic.layout, "academic");
});

test("the two-column layout puts the short lists in a side column, read after the main one", () => {
  const { view } = resumeViewForPdf(sample(), { on: ON, layout: "two-column" });
  const side = view.sections.filter((s) => s.column === "side").map((s) => s.id);
  assert.deepEqual(side, ["skills", "languages", "credentials"]);
  const firstSide = view.sections.findIndex((s) => s.column === "side");
  assert.ok(view.sections.slice(0, firstSide).every((s) => !s.column), "every main section comes before the side column");
  assert.ok(view.sections.slice(firstSide).every((s) => s.column === "side"));
  // The reading order a person should meet: main sections, then the side column.
  const order = readingOrder(view);
  assert.ok(order.indexOf("Awards") < order.indexOf("Skills"));
  assert.ok(order.indexOf("Skills") < order.indexOf("Languages"));
  assert.equal(order[0], "Ines Calloway");
  // With nothing for the side column, or nothing beside it, there is one column.
  assert.ok(resumeViewForPdf(load("examples/history.profile.json"), { on: ON, layout: "two-column" }).view.sections.every((s) => !s.column));
  const onlyLists = sample();
  for (const k of ["work", "education", "projects", "service", "awards", "publications"]) onlyLists[k] = [];
  delete onlyLists.person.summary; delete onlyLists.person.shortBio;
  assert.ok(resumeViewForPdf(onlyLists, { on: ON, layout: "two-column" }).view.sections.every((s) => !s.column));
  assert.ok(resumeViewForPdf(sample(), { on: ON }).view.sections.every((s) => !s.column), "classic has no side column");
});

test("text is in reading order when each expected string follows the one before", () => {
  assert.deepEqual(inOrder("Ines Calloway\nSummary\nExperience\nLicenses and\ncertifications\nSkills", ["Ines Calloway", "Experience", "Licenses and certifications", "Skills"]), { ok: true });
  assert.deepEqual(inOrder("Name Skills Experience", ["Name", "Experience", "Skills"]), { ok: false, missing: "Skills", after: "Experience" });
  assert.deepEqual(inOrder("", ["Name"]), { ok: false, missing: "Name", after: undefined });
  // The same title twice must be found twice, in turn.
  assert.equal(inOrder("Senior Associate x Senior Associate", ["Senior Associate", "Senior Associate"]).ok, true);
  assert.equal(inOrder("Senior Associate", ["Senior Associate", "Senior Associate"]).ok, false);
});

test("right-to-left text is found whichever way an extractor turned the line", () => {
  // As written, with the words in reverse order, or letter by letter in reverse.
  assert.equal(inOrder("ليلى حداد\nنبذة", ["ليلى حداد", "نبذة"]).ok, true);
  assert.equal(inOrder("حداد ليلى\nنبذة", ["ليلى حداد", "نبذة"]).ok, true);
  assert.equal(inOrder("יתקוסעת ןויסינ", ["ניסיון תעסוקתי"]).ok, true);
  // A comma that moved to the next word is not a difference; a missing word is.
  assert.equal(inOrder("الحاسوب علوم ،بكالوريوس", ["بكالوريوس، علوم الحاسوب"]).ok, true);
  assert.equal(inOrder("علوم بكالوريوس", ["بكالوريوس، علوم الحاسوب"]).ok, false);
  // Order still matters between strings.
  assert.equal(inOrder("نبذة\nحداد ليلى", ["ليلى حداد", "نبذة"]).ok, false);
});

// ---------- rendering (needs Typst) ----------

test("renders Arabic and Hebrew with fonts that have the letters", { skip: noTypst }, () => {
  const out = join(tmp(), "ar.pdf");
  renderResumePdf(load("examples/rtl.profile.json"), { out, on: ON });
  const pdf = readFileSync(out).toString("latin1");
  assert.match(pdf, /Vazirmatn/, "the Arabic font is embedded");
  const he = join(tmp(), "he.pdf");
  renderResumePdf(sample(), { out: he, on: ON, locale: "he" });
  assert.match(readFileSync(he).toString("latin1"), /NotoSansHebrew/, "the Hebrew font is embedded");
  renderResumePdf(load("examples/rtl.profile.json"), { out: join(tmp(), "ar2.pdf"), on: ON, layout: "two-column", pages: "1" });
});

test("renders the two-column layout, on one page and across pages", { skip: noTypst }, () => {
  const out = join(tmp(), "two.pdf");
  renderResumePdf(sample(), { out, on: ON, layout: "two-column", pages: "1" });
  assert.ok(readFileSync(out).length > 5000);
  // A long main column runs onto later pages beside a short side column.
  renderResumePdf(long(), { out: join(tmp(), "two-long.pdf"), on: ON, layout: "two-column" });
  assert.throws(() => renderResumePdf(long(), { out: join(tmp(), "x.pdf"), on: ON, layout: "two-column", pages: "1" }), /runs to \d+ pages/);
});


test("renders the academic layout", { skip: noTypst }, () => {
  const out = join(tmp(), "cv.pdf");
  renderResumePdf(load("examples/employee.profile.json"), { out, on: ON, layout: "academic" });
  assert.ok(readFileSync(out).length > 5000);
});


test("renders each example as a tagged PDF with its title and language set", { skip: noTypst }, () => {
  for (const [file, name] of [["examples/sample.profile.json", "Ines Calloway"], ["examples/history.profile.json", "Pat Example"], ["examples/employee.profile.json", "Sam Rivera"]]) {
    const out = join(tmp(), "deep", "resume.pdf");
    const r = renderResumePdf(load(file), { out, on: ON });
    const pdf = readFileSync(out);
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    const text = pdf.toString("latin1");
    assert.match(text, /pdfuaid:part>1<|pdfuaid:part="1"/, `${file}: declares PDF/UA-1`);
    assert.ok(text.includes(`${name}: résumé`) || /dc:title/.test(text), `${file}: has a title`);
    assert.match(r.typstVersion, /typst/);
  }
});

test("renders in another language and on A4, compact", { skip: noTypst }, () => {
  const out = join(tmp(), "cv.pdf");
  renderResumePdf(sample(), { out, on: ON, locale: "es", paper: "a4", density: "compact" });
  assert.ok(readFileSync(out).length > 5000);
});

test("renders a bundle's photo with its alt text", { skip: noTypst }, () => {
  const out = join(tmp(), "photo.pdf");
  const without = join(tmp(), "plain.pdf");
  const p = load("examples/recommended/profile.json");
  renderResumePdf(p, { out, on: ON, bundleDir: RECOMMENDED, photo: true });
  renderResumePdf(p, { out: without, on: ON, bundleDir: RECOMMENDED });
  assert.ok(readFileSync(out).length > readFileSync(without).length, "the photo is embedded");
  assert.ok(readFileSync(out).toString("latin1").includes("/Alt"), "the image carries alternative text");
});

test("one page is a hard limit: the build fails, writes nothing and names what to drop", { skip: noTypst }, () => {
  const out = join(tmp(), "one.pdf");
  assert.throws(() => renderResumePdf(long(), { out, on: ON, pages: "1" }), (e) => {
    assert.ok(e instanceof PdfError);
    assert.match(e.message, /runs to \d+ pages, and one was asked for/);
    assert.ok(e.pages > 1);
    assert.equal(e.candidates[0].id, "filler-0");
    assert.equal(e.candidates[0].priority, 0);
    return true;
  });
  assert.ok(!existsSync(out), "no PDF is left behind");
  // The same profile fits once the filler is dropped by priority, and builds freely with --pages auto.
  renderResumePdf(long(), { out, on: ON, pages: "1", minPriority: 41 });
  assert.ok(existsSync(out));
  renderResumePdf(long(), { out: join(tmp(), "many.pdf"), on: ON, pages: "auto" });
});

test("the command line reports an overflow with the entries to drop", { skip: noTypst }, () => {
  const dir = tmp();
  const file = join(dir, "long.profile.json");
  writeFileSync(file, JSON.stringify(long()));
  const r = cli("pdf", file, "--out", join(dir, "one.pdf"), "--pages", "1", "--on", ON);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /runs to \d+ pages/);
  assert.match(r.stderr, /Experience: "Filler role 0" \(filler-0, priority 0\)/);
  assert.match(r.stderr, /--min-priority <n>/);
  const ok = cli("pdf", join(root, "examples", "sample.profile.json"), "--out", join(dir, "ok.pdf"), "--pages", "1", "--on", ON);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /PDF\/UA-1/);
});
