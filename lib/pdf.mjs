// The résumé PDF: the résumé view (mappings/resume.json) laid out by a Typst template and written
// as tagged PDF/UA-1. This module prepares a build folder, runs Typst and explains its failures.
// Typst is an outside program (https://typst.app): it is found on PATH, or named with `typst`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "./convert.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(HERE, "..", "templates", "resume");
const FONTS = resolve(HERE, "..", "brand", "fonts");
export const LAYOUTS = Object.freeze(["classic"]);
// Image types Typst can place. A photo in another format is refused by name, not passed along to fail.
const PHOTO_TYPES = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const BUNDLE_SCHEME = "turnrow-bundle://";

/** Something the person running the command can fix: a missing program, a photo, too much text. */
export class PdfError extends Error {
  constructor(message, details = {}) { super(message); this.name = "PdfError"; Object.assign(this, details); }
}

const resumeMapping = () => JSON.parse(readFileSync(new URL("../mappings/resume.json", import.meta.url), "utf8"));

/**
 * The résumé view as the template needs it: entries below `minPriority` left out (and any section
 * that empties), and the photo either resolved to a file in the bundle or removed.
 * @returns {{ view: object, photoFile?: string }}
 */
export function resumeViewForPdf(profile, { bundleDir, on, locale, visibility, photo = false, minPriority = 0 } = {}) {
  // bundle: links are resolved against a marker, so the photo can be found on disk afterwards.
  const { output } = convert(profile, resumeMapping(), { on, locale, visibility, mediaBaseUrl: BUNDLE_SCHEME });
  const view = structuredClone(output);
  view.sections = (view.sections ?? [])
    .map((s) => ({ ...s, entries: s.entries.filter((e) => (e.priority ?? 50) >= minPriority) }))
    .filter((s) => s.entries.length);

  let photoFile;
  const url = view.person?.photo?.url;
  if (!photo) delete view.person.photo;
  else if (!url) throw new PdfError("--photo was asked for, but the profile has no approved, public photo in force on this date");
  else if (!url.startsWith(BUNDLE_SCHEME)) {
    throw new PdfError(`--photo needs a photo stored in the bundle; this one is a web link (${url}). Add it with "turnrow-profile media add".`);
  } else {
    if (!bundleDir) throw new PdfError("--photo needs a bundle folder (a folder with profile.json and media/)");
    const root = resolve(bundleDir);
    const file = resolve(root, decodeURI(url.slice(BUNDLE_SCHEME.length)));
    // The same guards as validation: inside the bundle, and not a link that leads out of it.
    if (!file.startsWith(root + sep) || !existsSync(file) || !realpathSync(file).startsWith(realpathSync(root) + sep)) {
      throw new PdfError(`the photo ${url.slice(BUNDLE_SCHEME.length)} is not a file inside the bundle`);
    }
    if (!PHOTO_TYPES.has(extname(file).toLowerCase())) throw new PdfError(`the photo is ${extname(file) || "of an unknown type"}; the PDF can place PNG, JPEG, GIF, SVG or WebP`);
    photoFile = file;
  }
  return { view, photoFile };
}

/** Entries to consider leaving out when a one-page résumé overflows: lowest priority first, later sections first. */
export function dropCandidates(view, limit = 8) {
  return (view.sections ?? [])
    .flatMap((s, si) => s.entries.map((e, ei) => ({ section: s.heading, id: e.id, title: e.title, priority: e.priority ?? 50, si, ei })))
    .sort((a, b) => a.priority - b.priority || b.si - a.si || b.ei - a.ei)
    .slice(0, limit)
    .map(({ section, id, title, priority }) => ({ section, id, title, priority }));
}

/**
 * Render the résumé PDF.
 * @param {object} profile  a valid Turnrow Profile
 * @param {{ out: string, bundleDir?: string, on?: string, locale?: string, visibility?: string[], layout?: string,
 *   pages?: "auto"|"1", photo?: boolean, density?: "comfortable"|"compact", paper?: "us-letter"|"a4",
 *   minPriority?: number, typst?: string, keepBuild?: boolean }} options
 * @returns {{ out: string, view: object, typstVersion: string }}
 * @throws {PdfError} when Typst is missing, the photo can't be used, or one page is asked for and exceeded
 */
export function renderResumePdf(profile, options) {
  const { out, layout = "classic", pages = "auto", density = "comfortable", paper = "us-letter", typst = "typst" } = options;
  if (!out) throw new PdfError("the PDF needs somewhere to go: pass --out resume.pdf");
  if (!LAYOUTS.includes(layout)) throw new PdfError(`unknown layout "${layout}": use ${LAYOUTS.join(", ")}`);
  if (!["auto", "1"].includes(String(pages))) throw new PdfError(`--pages takes 1 or auto (got ${pages})`);
  if (!["comfortable", "compact"].includes(density)) throw new PdfError(`--density takes comfortable or compact (got ${density})`);
  if (!["us-letter", "a4"].includes(paper)) throw new PdfError(`--paper takes us-letter or a4 (got ${paper})`);

  const probe = spawnSync(typst, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    throw new PdfError(`Typst was not found (tried "${typst}"). Install it from https://typst.app/open-source/ or point to it with --typst <path>.`);
  }
  const typstVersion = probe.stdout.trim();

  const { view, photoFile } = resumeViewForPdf(profile, options);
  // Typst reads only inside its root, so the template, the view and the photo go into one folder.
  const build = mkdtempSync(join(tmpdir(), "turnrow-pdf-"));
  try {
    copyFileSync(join(TEMPLATES, `${layout}.typ`), join(build, "resume.typ"));
    if (photoFile) {
      const name = `photo${extname(photoFile).toLowerCase()}`;
      copyFileSync(photoFile, join(build, name));
      view.person.photo = { ...view.person.photo, path: name };
      delete view.person.photo.url;
    }
    writeFileSync(join(build, "view.json"), JSON.stringify(view));
    const target = resolve(out);
    mkdirSync(dirname(target), { recursive: true });
    const pdf = join(build, "resume.pdf");
    const run = spawnSync(typst, [
      "compile", "--root", build, "--font-path", FONTS, "--ignore-system-fonts", "--pdf-standard", "ua-1",
      "--input", "view=view.json", "--input", `pages=${pages}`, "--input", `density=${density}`, "--input", `paper=${paper}`,
      join(build, "resume.typ"), pdf,
    ], { encoding: "utf8" });
    if (run.status !== 0 || !existsSync(pdf)) {
      const log = `${run.stderr ?? ""}${run.stdout ?? ""}`;
      const overflow = log.match(/TURNROW-OVERFLOW pages=(\d+)/);
      if (overflow) {
        throw new PdfError(`the résumé runs to ${overflow[1]} pages, and one was asked for`, { pages: Number(overflow[1]), candidates: dropCandidates(view), density });
      }
      throw new PdfError(`Typst could not build the PDF:\n${log.trim()}`);
    }
    copyFileSync(pdf, target);
    return { out: target, view, typstVersion };
  } finally {
    if (!options.keepBuild) rmSync(build, { recursive: true, force: true });
  }
}
