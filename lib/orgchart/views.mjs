// The org chart as text: a table for reading (Markdown) and for spreadsheets (CSV). One row per
// post, in reading order: each manager, then their reports. The same rows feed every other view.

import { stateOn, compareDates, holderText } from "./index.mjs";
import { mdEscape as esc, mdTable } from "../review.mjs";

const STATUS = { filled: "Filled", vacant: "Vacant", planned: "Planned" };
const VACANCY = { open: "open", approved: "approved", planned: "planned", frozen: "frozen" };
// "Vacant (open, new post)"; a planned post does not say "planned" twice.
const vacancyNote = (p) => { const parts = [p.vacancy?.status && !(p.status === "planned" && p.vacancy.status === "planned") ? VACANCY[p.vacancy.status] : undefined, p.vacancy?.reason ? (p.vacancy.reason === "new" ? "new post" : "backfill") : undefined].filter(Boolean); return parts.length ? ` (${parts.join(", ")})` : ""; };
const money = (c) => (c ? `${c.amount.toLocaleString("en-US")} ${c.currency}` : "");

/** One row per post: what every view shows, in words. */
export function orgRows(org, options = {}) {
  const state = stateOn(org, options);
  const title = new Map(state.posts.map((p) => [p.id, p.title]));
  return {
    state,
    rows: state.posts.map((p) => ({
      id: p.id,
      level: p.depth,
      title: p.title,
      holder: holderText(p),
      pronouns: p.holders.filter((h) => h.shown && h.pronouns).map((h) => h.pronouns).join(" and "),
      unit: p.unitName ?? "",
      reportsTo: p.manager ? title.get(p.manager) : "",
      dotted: p.dotted.map((id) => title.get(id)).join("; "),
      status: `${STATUS[p.status]}${vacancyNote(p)}${p.status === "planned" ? `, from ${p.starts}` : ""}${p.vacancy?.targetDate && p.status !== "planned" ? `, wanted by ${p.vacancy.targetDate}` : ""}`,
      reports: p.reports.length,
      ...(options.budget ? { band: p.budget?.band ?? "", fte: p.budget?.fte ?? "", annualCost: money(p.budget?.annualCost) } : {}),
    })),
  };
}

const HEAD = ["Level", "Post", "Held by", "Unit", "Reports to", "Status", "Direct reports"];
const cells = (r, budget) => [r.level, r.title, r.holder + (r.pronouns ? ` (${r.pronouns})` : ""), r.unit, r.reportsTo + (r.dotted ? ` (dotted line to ${r.dotted})` : ""), r.status, r.reports, ...(budget ? [r.band, r.fte, r.annualCost] : [])];
const head = (budget) => [...HEAD, ...(budget ? ["Band", "FTE", "Annual cost"] : [])];

/** The chart as a Markdown document: a summary, the table, and (with compare) what changed. */
export function orgMarkdown(org, options = {}) {
  const { state, rows } = orgRows(org, options);
  const count = (s) => state.posts.filter((p) => p.status === s).length;
  const out = [`# ${esc(org.meta.name)}: organization on ${state.on}`, ""];
  if (options.budget) out.push("**Internal.** This view includes budget figures.", "");
  out.push(`${count("filled")} filled, ${count("vacant")} vacant, ${count("planned")} planned. "Level" is the depth in the reporting lines: 1 reports to nobody in this chart.`, "");
  out.push(rows.length ? mdTable(head(options.budget), rows.map((r) => cells(r, options.budget).map((c) => (typeof c === "number" ? String(c) : esc(c))))) : "No posts on this date.", "");
  if (options.compare) {
    const [from, to] = [options.compare, state.on].sort();
    const diff = compareDates(org, from, to, options);
    out.push(`## What changed from ${from} to ${to}`, "");
    out.push(diff.changes.length ? mdTable(["Change", "Post", "Detail"], diff.changes.map((c) => [CHANGE[c.kind], esc(c.title), esc(c.detail)])) : "Nothing changed.", "");
  }
  return out.join("\n").trimEnd() + "\n";
}
export const CHANGE = { opened: "Opened", closed: "Closed", filled: "Filled", vacated: "Vacated", changedHands: "Changed hands", moved: "Moved", renamed: "Renamed" };

const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The chart as CSV, for a spreadsheet. Text a spreadsheet would run as a formula is quoted. */
export function orgCsv(org, options = {}) {
  const { rows } = orgRows(org, options);
  return [head(options.budget), ...rows.map((r) => cells(r, options.budget))].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
