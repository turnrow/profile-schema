// The veraPDF report checker. The reports here are written by hand in the shape of veraPDF's
// machine-readable report; the real thing is produced, and judged by the same code, in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReport, judge } from "../scripts/check-pdfua.mjs";
import { VARIANTS } from "../scripts/render-example-pdfs.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const job = (name, body) => `<job><item size="1"><name>${name}</name></item>${body}<duration start="1" finish="2">00:00:00.100</duration></job>`;
const pass = (name) => job(name, `<validationReport jobEndStatus="normal" profileName="PDF/UA-1 validation profile" statement="PDF file is compliant with Validation Profile requirements." isCompliant="true"><details passedRules="106" failedRules="0" passedChecks="900" failedChecks="0"></details></validationReport>`);
const fail = (name) => job(name, `<validationReport jobEndStatus="normal" profileName="PDF/UA-1 validation profile" statement="PDF file is not compliant with Validation Profile requirements." isCompliant="false"><details passedRules="104" failedRules="2" passedChecks="880" failedChecks="3">
<rule specification="ISO 14289-1:2014" clause="7.3" testNumber="1" status="failed" failedChecks="2"><description>Figure tags shall include an alternative representation or replacement text that represents the contents marked with the Figure tag as noted in ISO 32000-1:2008, 14.7.2, Table 323</description><object>SEFigure</object><test>Alt != null || ActualText != null</test></rule>
<rule specification="ISO 14289-1:2014" clause="7.1" testNumber="10" status="failed" failedChecks="1"><description>The document catalog dictionary shall include a ViewerPreferences dictionary containing a DisplayDocTitle key, whose value shall be true</description></rule>
<rule specification="ISO 14289-1:2014" clause="5" testNumber="1" status="passed" passedChecks="1"><description>The PDF/UA version shall be specified</description></rule>
</details></validationReport>`);
const broken = (name) => job(name, `<taskException type="PARSE" isExecuted="true" isSuccess="false"><exceptionMessage>Exception: Couldn&apos;t parse stream caused by exception: can&apos;t locate xref</exceptionMessage></taskException>`);
const report = (...jobs) => `<?xml version="1.0" encoding="utf-8"?>\n<report><buildInformation><releaseDetails id="core" version="1.30.3"></releaseDetails></buildInformation><jobs>${jobs.join("")}</jobs><batchSummary totalJobs="${jobs.length}"></batchSummary></report>`;

test("a report where every file conforms passes", () => {
  const r = readReport(report(pass("/data/sample.pdf"), pass("/data/history.pdf")));
  assert.deepEqual(r.files.map((f) => [f.name, f.compliant]), [["/data/sample.pdf", true], ["/data/history.pdf", true]]);
  const j = judge(r, 2);
  assert.equal(j.ok, true);
  assert.match(j.lines[0], /^PASS {2}\/data\/sample\.pdf {2}\(PDF\/UA-1 validation profile\)$/);
});

test("a failing file fails the run, and the failed rules are named (passed ones are not)", () => {
  const j = judge(readReport(report(pass("/data/a.pdf"), fail("/data/b.pdf"))), 2);
  assert.equal(j.ok, false);
  const text = j.lines.join("\n");
  assert.match(text, /FAIL {2}\/data\/b\.pdf/);
  assert.match(text, /clause 7\.3, test 1 \(2 places\): Figure tags shall include an alternative/);
  assert.match(text, /clause 7\.1, test 10 \(1 place\): The document catalog/);
  assert.doesNotMatch(text, /PDF\/UA version shall be specified/);
});

test("a file veraPDF could not read is a failure, with the reason", () => {
  const j = judge(readReport(report(pass("/data/a.pdf"), broken("/data/b.pdf"))), 2);
  assert.equal(j.ok, false);
  assert.match(j.lines.join("\n"), /FAIL {2}\/data\/b\.pdf\n {6}Exception: Couldn't parse stream/);
});

test("fewer validations than PDFs rendered is a failure, and so is an empty report", () => {
  const short = judge(readReport(report(pass("/data/a.pdf"))), 3);
  assert.equal(short.ok, false);
  assert.match(short.lines.at(-1), /1 file\(s\) were validated, but 3 were rendered/);
  assert.equal(judge(readReport(""), 8).ok, false);
  assert.equal(judge(readReport("docker: command not found"), undefined).ok, false);
});

test("the command exits 1 on a failure and 0 on a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "turnrow-vera-"));
  const run = (xml, ...args) => { const f = join(dir, "r.xml"); writeFileSync(f, xml); return spawnSync(process.execPath, [join(root, "scripts", "check-pdfua.mjs"), f, ...args], { encoding: "utf8" }); };
  assert.equal(run(report(pass("/data/a.pdf")), "--expect", "1").status, 0);
  const bad = run(report(fail("/data/a.pdf")), "--expect", "1");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /do not exempt a file/);
  assert.equal(run(report(pass("/data/a.pdf")), "--expect", "2").status, 1);
});

test("the rendered variants cover a photo, another language, A4, one page and network visibility", () => {
  const all = Object.values(VARIANTS).map(([, o]) => o);
  assert.ok(all.some((o) => o.photo));
  assert.ok(all.some((o) => o.locale && o.paper === "a4"));
  assert.ok(all.some((o) => o.pages === "1"));
  assert.ok(all.some((o) => o.visibility?.includes("network")));
  assert.ok(Object.keys(VARIANTS).length >= 8);
});
