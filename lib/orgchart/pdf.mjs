// The org chart as a tagged PDF, through Typst, as the résumé PDF is made (lib/pdf.mjs).

import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PdfError } from "../pdf.mjs";
import { orgRows, CHANGE } from "./views.mjs";
import { compareDates } from "./index.mjs";

const TEMPLATE = fileURLToPath(new URL("../../templates/orgchart/chart.typ", import.meta.url));
const FONTS = fileURLToPath(new URL("../../brand/fonts/", import.meta.url));

/** What the PDF prints, and the order a reader should meet it in. */
export function orgPdfView(org, options = {}) {
  const { state, rows } = orgRows(org, options);
  const count = (s) => state.posts.filter((p) => p.status === s).length;
  const view = {
    title: `${org.meta.name}: organization on ${state.on}`,
    organization: org.meta.name,
    lang: options.lang ?? "en",
    internal: options.budget === true,
    summary: `${count("filled")} filled, ${count("vacant")} vacant, ${count("planned")} planned. One row per post, each manager followed by their reports. Level 1 reports to nobody in this chart.`,
    head: ["Level", "Post", "Held by", "Unit", "Reports to", "Status", ...(options.budget ? ["Band", "FTE", "Annual cost"] : [])],
    rows: rows.map((r) => [String(r.level), r.title, r.holder + (r.pronouns ? ` (${r.pronouns})` : ""), r.unit, r.reportsTo + (r.dotted ? ` (dotted line to ${r.dotted})` : ""), r.status, ...(options.budget ? [r.band, String(r.fte), r.annualCost] : [])]),
    changes: null,
  };
  if (options.compare) {
    const [from, to] = [options.compare, state.on].sort();
    view.changes = { heading: `What changed from ${from} to ${to}`, rows: compareDates(org, from, to, options).changes.map((c) => [CHANGE[c.kind], c.title, c.detail]) };
  }
  return view;
}

/**
 * @param {object} org  a valid organization file
 * @param {{ out: string, on?: string, compare?: string, budget?: boolean, paper?: "us-letter"|"a4", typst?: string }} options
 * @returns {{ out: string, view: object }}
 */
export function renderOrgPdf(org, options) {
  const { out, paper = "us-letter", typst = "typst" } = options;
  if (!out) throw new PdfError("the PDF needs somewhere to go: pass --out chart.pdf");
  if (!["us-letter", "a4"].includes(paper)) throw new PdfError(`--paper takes us-letter or a4 (got ${paper})`);
  const probe = spawnSync(typst, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) throw new PdfError(`Typst was not found (tried "${typst}"). Install it from https://typst.app/open-source/ or point to it with --typst <path>.`);
  const view = orgPdfView(org, options);
  const build = mkdtempSync(join(tmpdir(), "turnrow-org-"));
  try {
    copyFileSync(TEMPLATE, join(build, "chart.typ"));
    writeFileSync(join(build, "view.json"), JSON.stringify(view));
    const pdf = join(build, "chart.pdf");
    const run = spawnSync(typst, ["compile", "--root", build, "--font-path", FONTS, "--ignore-system-fonts", "--pdf-standard", "ua-1", "--input", "view=view.json", "--input", `paper=${paper}`, join(build, "chart.typ"), pdf], { encoding: "utf8" });
    if (run.status !== 0 || !existsSync(pdf)) throw new PdfError(`Typst could not build the PDF:\n${`${run.stderr ?? ""}${run.stdout ?? ""}`.trim()}`);
    const target = resolve(out);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(pdf, target);
    return { out: target, view };
  } finally { rmSync(build, { recursive: true, force: true }); }
}
