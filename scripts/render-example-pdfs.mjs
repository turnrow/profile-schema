// Render every example as a résumé PDF, in the variants worth checking, into a folder.
// CI validates what this writes with veraPDF; reviewers use the same files for the manual pass.
//   node scripts/render-example-pdfs.mjs <out-folder> [--typst <path>]
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderResumePdf } from "../index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const typstAt = args.indexOf("--typst");
const typst = typstAt >= 0 ? args.splice(typstAt, 2)[1] : undefined;
const outDir = resolve(args[0] ?? "pdf-out");
const ON = "2026-11-07"; // the date the committed example outputs are made for

// name: [profile, options]. Each variant exercises something a validator or a reader could trip on.
export const VARIANTS = {
  "sample": ["examples/sample.profile.json", {}],
  "sample-one-page-compact": ["examples/sample.profile.json", { pages: "1", density: "compact" }],
  "sample-es-a4": ["examples/sample.profile.json", { locale: "es", paper: "a4" }],
  "sample-network": ["examples/sample.profile.json", { visibility: ["public", "network"] }],
  "history": ["examples/history.profile.json", {}],
  "employee": ["examples/employee.profile.json", {}],
  "employee-academic": ["examples/employee.profile.json", { layout: "academic" }],
  "recommended": ["examples/recommended", {}],
  "recommended-photo": ["examples/recommended", { photo: true }],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, [src, options]] of Object.entries(VARIANTS)) {
    const isBundle = !src.endsWith(".json");
    const profile = JSON.parse(readFileSync(join(root, src, isBundle ? "profile.json" : ""), "utf8"));
    const out = join(outDir, `${name}.pdf`);
    renderResumePdf(profile, { out, on: ON, typst, bundleDir: isBundle ? join(root, src) : undefined, ...options });
    console.log(`wrote ${out}`);
  }
}
