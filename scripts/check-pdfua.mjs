// Read a veraPDF report and fail unless every PDF conforms.
//   node scripts/check-pdfua.mjs <report.xml> [--expect <number of PDFs>]
// veraPDF's exit codes are not documented, so the report is the evidence: each file must have a
// validation report that says isCompliant="true", and there must be as many as were rendered
// (a file veraPDF could not open has no report, and must not count as a pass).
import { readFileSync } from "node:fs";

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/**
 * @param {string} xml  a veraPDF machine-readable report (the default --format)
 * @returns {{ files: { name: string, compliant: boolean, profile?: string, failures: { clause: string, test: string, description: string, count: string }[] , error?: string }[] }}
 */
export function readReport(xml) {
  const files = [];
  for (const job of xml.match(/<job>[\s\S]*?<\/job>/g) ?? []) {
    const name = unescape(job.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? "(unnamed)");
    const open = job.match(/<validationReport\b[^>]*>/)?.[0];
    if (!open) {
      const why = job.match(/<exceptionMessage>([\s\S]*?)<\/exceptionMessage>/)?.[1] ?? "veraPDF produced no validation report for it";
      files.push({ name, compliant: false, failures: [], error: unescape(why.trim()) });
      continue;
    }
    const failures = [];
    for (const rule of job.match(/<rule\b[^>]*status="failed"[^>]*>[\s\S]*?<\/rule>/g) ?? []) {
      const tag = rule.match(/<rule\b[^>]*>/)[0];
      failures.push({
        clause: attr(tag, "clause") ?? "?", test: attr(tag, "testNumber") ?? "?", count: attr(tag, "failedChecks") ?? "?",
        description: unescape(rule.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? ""),
      });
    }
    files.push({ name, compliant: attr(open, "isCompliant") === "true", profile: attr(open, "profileName"), failures });
  }
  return { files };
}

/** Lines to print, and whether everything passed. `expect`: how many PDFs should have been validated. */
export function judge(report, expect) {
  const lines = [];
  let ok = report.files.length > 0;
  if (!report.files.length) lines.push("FAIL  the report lists no files: veraPDF validated nothing");
  for (const f of report.files) {
    if (f.compliant) { lines.push(`PASS  ${f.name}${f.profile ? `  (${f.profile})` : ""}`); continue; }
    ok = false;
    lines.push(`FAIL  ${f.name}`);
    if (f.error) lines.push(`      ${f.error}`);
    for (const x of f.failures) lines.push(`      clause ${x.clause}, test ${x.test} (${x.count} place${x.count === "1" ? "" : "s"}): ${x.description}`);
    if (!f.error && !f.failures.length) lines.push("      veraPDF says it does not conform but lists no failed rule; read the report");
  }
  if (expect != null && report.files.length !== expect) {
    ok = false;
    lines.push(`FAIL  ${report.files.length} file(s) were validated, but ${expect} were rendered`);
  }
  return { ok, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--expect");
  const expect = at >= 0 ? Number(args.splice(at, 2)[1]) : undefined;
  if (!args[0]) { console.error("usage: node scripts/check-pdfua.mjs <report.xml> [--expect <number of PDFs>]"); process.exit(2); }
  const { ok, lines } = judge(readReport(readFileSync(args[0], "utf8")), expect);
  console.log(lines.join("\n"));
  if (!ok) { console.error("\nPDF/UA-1 validation failed. Fix the template; do not exempt a file to get a green build."); process.exit(1); }
  console.log("\nEvery PDF conforms to PDF/UA-1 as far as veraPDF can check. The manual checks in the pull request template still apply.");
}
