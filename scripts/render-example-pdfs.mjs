// Render every example as a résumé PDF, in the variants worth checking, into a folder.
// CI validates what this writes with veraPDF; reviewers use the same files for the manual pass.
//   node scripts/render-example-pdfs.mjs <out-folder> [--typst <path>]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderResumePdf } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const typstAt = args.indexOf("--typst");
const typst = typstAt >= 0 ? args.splice(typstAt, 2)[1] : undefined;
const outDir = resolve(args[0] ?? "pdf-out");
const ON = "2026-11-07"; // the date the committed example outputs are made for

// Why the Arabic variants are left out of the text-order check (they are still rendered and validated).
const ARABIC_TEXT = "Arabic text does not come back out of the PDF intact: lam-alef pairs come out reversed and vowel marks doubled (issue #60), so its order can't be read from extracted text";

// name: [profile, options, why the text-order check is skipped (rarely)]. Each variant exercises
// something a validator or a reader could trip on.
export const VARIANTS = {
  "sample": ["examples/sample.profile.json", {}],
  "sample-one-page-compact": ["examples/sample.profile.json", { pages: "1", density: "compact" }],
  "sample-es-a4": ["examples/sample.profile.json", { locale: "es", paper: "a4" }],
  "sample-network": ["examples/sample.profile.json", { visibility: ["public", "network"] }],
  "history": ["examples/history.profile.json", {}],
  "employee": ["examples/employee.profile.json", {}],
  "employee-academic": ["examples/employee.profile.json", { layout: "academic" }],
  "sample-two-column": ["examples/sample.profile.json", { layout: "two-column" }],
  "employee-two-column": ["examples/employee.profile.json", { layout: "two-column" }],
  "rtl-arabic": ["examples/rtl.profile.json", {}, ARABIC_TEXT],
  "rtl-arabic-two-column": ["examples/rtl.profile.json", { layout: "two-column" }, ARABIC_TEXT],
  "sample-hebrew-headings": ["examples/sample.profile.json", { locale: "he" }],
  "recommended": ["examples/recommended", {}],
  "recommended-photo": ["examples/recommended", { photo: true }],
};

/** The headings of a résumé view in the order they should be read: name, summary, then each section and its entries. */
export function readingOrder(view) {
  const out = [view.person.name];
  if (view.summary?.text) out.push(view.summary.heading);
  for (const s of view.sections ?? []) {
    out.push(s.heading);
    // A job with several titles is headed by its employer; everything else by its own title.
    for (const e of s.entries) out.push((e.positions?.length ?? 0) > 1 ? e.organization ?? e.title : e.title);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, [src, options, skipOrder]] of Object.entries(VARIANTS)) {
    const isBundle = !src.endsWith(".json");
    const profile = JSON.parse(readFileSync(join(root, src, isBundle ? "profile.json" : ""), "utf8"));
    const out = join(outDir, `${name}.pdf`);
    const { view } = renderResumePdf(profile, { out, on: ON, typst, bundleDir: isBundle ? join(root, src) : undefined, ...options });
    // What a reader should meet, in order; scripts/check-reading-order.mjs holds the PDF's text to it.
    // Kept in a subfolder so the folder of PDFs holds nothing but PDFs for the validator.
    mkdirSync(join(outDir, "order"), { recursive: true });
    writeFileSync(join(outDir, "order", `${name}.json`), JSON.stringify(skipOrder ? { skip: skipOrder, order: readingOrder(view) } : readingOrder(view), null, 2) + "\n");
    console.log(`wrote ${out}`);
  }
}
