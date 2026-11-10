// Hold each rendered PDF's own text order to the order its view was written in.
//   node scripts/check-reading-order.mjs <folder with name.pdf and order/name.json>
// Needs pdftotext (poppler-utils). "-raw" gives the text in the order the PDF holds it, not the order
// a tool guesses from positions on the page. That is the order extraction and copy-and-paste follow,
// and Typst writes its accessibility tags in the same source order. It is a check on the layout
// (above all the two-column one), not a substitute for listening with a screen reader.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const squash = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * Do the expected strings appear in the text, each after the one before?
 * @returns {{ ok: boolean, missing?: string, after?: string }}
 */
export function inOrder(text, expected) {
  const hay = squash(text);
  let from = 0, last;
  for (const want of expected.map(squash)) {
    const at = hay.indexOf(want, from);
    if (at < 0) return { ok: false, missing: want, after: last };
    from = at + want.length;
    last = want;
  }
  return { ok: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node scripts/check-reading-order.mjs <folder>"); process.exit(2); }
  let names = [];
  try { names = readdirSync(join(dir, "order")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).sort(); } catch { /* reported below */ }
  if (!names.length) { console.error(`FAIL  no order/*.json in ${dir}: nothing was checked`); process.exit(1); }
  let failed = 0;
  for (const name of names) {
    const run = spawnSync("pdftotext", ["-raw", "-enc", "UTF-8", join(dir, `${name}.pdf`), "-"], { encoding: "utf8" });
    if (run.error || run.status !== 0) { console.error(`FAIL  ${name}.pdf: pdftotext could not read it (${run.error?.message ?? run.stderr.trim()})`); failed++; continue; }
    const r = inOrder(run.stdout, JSON.parse(readFileSync(join(dir, "order", `${name}.json`), "utf8")));
    if (r.ok) console.log(`PASS  ${name}.pdf`);
    else { failed++; console.error(`FAIL  ${name}.pdf: "${r.missing}" does not come after "${r.after ?? "the start"}" in the PDF's text`); }
  }
  if (failed) { console.error(`\n${failed} PDF(s) are not in reading order.`); process.exit(1); }
  console.log(`\nAll ${names.length} PDFs hold their text in reading order.`);
}
