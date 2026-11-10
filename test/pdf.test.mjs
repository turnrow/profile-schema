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

// ---------- rendering (needs Typst) ----------

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
