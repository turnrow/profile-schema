// Hold each rendered PDF's own text order to the order its view was written in.
//   node scripts/check-reading-order.mjs <folder with name.pdf and order/name.json>
// Needs pdftotext (poppler-utils). "-raw" gives the text in the order the PDF holds it, not the order
// a tool guesses from positions on the page. That is the order extraction and copy-and-paste follow,
// and Typst writes its accessibility tags in the same source order. It is a check on the layout
// (above all the two-column one), not a substitute for listening with a screen reader.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Direction marks are dropped: extractors add them around right-to-left runs.
const squash = (s) => s.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
// A PDF holds a right-to-left line in the order it is drawn, left to right, so "-raw" text has the
// line back to front: the words in reverse order (pdftotext mends each word), or every letter.
// For a string in a right-to-left script, any of the three forms counts as found.
const forms = (want) => (RTL.test(want) ? [want, want.split(" ").reverse().join(" "), [...want].reverse().join("")] : [want]);
// Punctuation moves when a right-to-left line is turned around (a comma ends up on the next word),
// so when right-to-left text is involved, letters, digits and spaces are what is compared.
const lettersOnly = (s) => s.replace(/[^\p{L}\p{M}\p{N} ]/gu, "").replace(/ +/g, " ").trim();

/**
 * Do the expected strings appear in the text, each after the one before?
 * @returns {{ ok: boolean, missing?: string, after?: string }}
 */
export function inOrder(text, expected) {
  const rtl = expected.some((e) => RTL.test(e));
  const prepare = (s) => (rtl ? lettersOnly(squash(s)) : squash(s));
  const hay = prepare(text);
  let from = 0, last;
  for (const want of expected.map(prepare)) {
    const hits = forms(want).map((f) => hay.indexOf(f, from)).filter((i) => i >= 0);
    if (!hits.length) return { ok: false, missing: want, after: last };
    from = Math.min(...hits) + want.length;
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
  let failed = 0, skipped = 0;
  for (const name of names) {
    const run = spawnSync("pdftotext", ["-raw", "-enc", "UTF-8", join(dir, `${name}.pdf`), "-"], { encoding: "utf8" });
    if (run.error || run.status !== 0) { console.error(`FAIL  ${name}.pdf: pdftotext could not read it (${run.error?.message ?? run.stderr.trim()})`); failed++; continue; }
    const expected = JSON.parse(readFileSync(join(dir, "order", `${name}.json`), "utf8"));
    // A variant can say why its text can't be held to this check. It is named every time, never passed over quietly.
    if (expected.skip) { skipped++; console.log(`SKIP  ${name}.pdf: ${expected.skip}`); continue; }
    const r = inOrder(run.stdout, expected.order ?? expected);
    if (r.ok) console.log(`PASS  ${name}.pdf`);
    else { failed++; console.error(`FAIL  ${name}.pdf: "${r.missing}" does not come after "${r.after ?? "the start"}" in the PDF's text`); }
  }
  if (failed) { console.error(`\n${failed} PDF(s) are not in reading order.`); process.exit(1); }
  console.log(`\n${names.length - skipped} PDFs hold their text in reading order.${skipped ? ` ${skipped} could not be checked (see SKIP above).` : ""}`);
}
