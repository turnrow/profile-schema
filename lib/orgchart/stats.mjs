// The shape of an organization, in numbers: on one day, and over a range of days.
// Everything is counted from stateOn, so the numbers and the chart can't disagree.
// Budget figures are counted only when asked for (options.budget).

import { stateOn, compareDates, holderText } from "./index.mjs";
import { mdEscape as esc, mdTable } from "../review.mjs";
import { CHANGE } from "./views.mjs";

const round = (n) => Math.round(n * 100) / 100;
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const fteOf = (p) => p.holders.reduce((n, h) => n + h.fte, 0);

/**
 * The organization on one day.
 * @returns {{ on, totals, units: object[], spans: object[], span: object, layers: object[] }}
 *   totals: { posts, filled, vacant, planned, people, fte }
 *   units: per unit { id, name, filled, vacant, planned, fte } (+ budgetFte, budgetCost, filledCost with budget)
 *   spans: each post with direct reports { post, title, holder, reports, filledReports }
 *   span: { managers, average, median, largest, smallest }
 *   layers: per depth { layer, posts, filled }
 */
export function orgStats(org, options = {}) {
  const state = stateOn(org, options);
  const live = state.posts.filter((p) => p.status !== "planned");
  const byId = new Map(state.posts.map((p) => [p.id, p]));
  const totals = {
    posts: live.length, filled: live.filter((p) => p.status === "filled").length, vacant: live.filter((p) => p.status === "vacant").length,
    planned: state.posts.length - live.length, people: live.reduce((n, p) => n + p.holders.length, 0), fte: round(live.reduce((n, p) => n + fteOf(p), 0)),
  };
  const unitRows = new Map();
  for (const p of state.posts) {
    const key = p.unit ?? "";
    const u = unitRows.get(key) ?? { id: key || undefined, name: p.unitName ?? "(no unit)", filled: 0, vacant: 0, planned: 0, fte: 0, ...(options.budget ? { budgetFte: 0, budgetCost: {}, filledCost: {} } : {}) };
    u[p.status]++;
    u.fte = round(u.fte + fteOf(p));
    if (options.budget && p.budget && p.status !== "planned") {
      u.budgetFte = round(u.budgetFte + (p.budget.fte ?? 1));
      const c = p.budget.annualCost;
      if (c) { u.budgetCost[c.currency] = (u.budgetCost[c.currency] ?? 0) + c.amount; if (p.status === "filled") u.filledCost[c.currency] = (u.filledCost[c.currency] ?? 0) + c.amount; }
    }
    unitRows.set(key, u);
  }
  const units = [...unitRows.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Span of control counts line reports that exist today: a planned post is not yet a report.
  const spans = live.map((p) => { const reports = p.reports.map((id) => byId.get(id)).filter((r) => r.status !== "planned"); return { post: p.id, title: p.title, holder: holderText(p), reports: reports.length, filledReports: reports.filter((r) => r.status === "filled").length }; })
    .filter((s) => s.reports > 0).sort((a, b) => b.reports - a.reports || a.title.localeCompare(b.title));
  const counts = spans.map((s) => s.reports);
  const span = { managers: spans.length, average: counts.length ? round(counts.reduce((a, b) => a + b, 0) / counts.length) : 0, median: median(counts), largest: counts.length ? Math.max(...counts) : 0, smallest: counts.length ? Math.min(...counts) : 0 };
  const depth = new Map();
  for (const p of live) { const l = depth.get(p.depth) ?? { layer: p.depth, posts: 0, filled: 0 }; l.posts++; if (p.status === "filled") l.filled++; depth.set(p.depth, l); }
  return { on: state.on, totals, units, spans, span, layers: [...depth.values()].sort((a, b) => a.layer - b.layer) };
}

/** The first day of each month from one date to another, with both ends included. */
export function monthStarts(from, to) {
  const days = new Set([from]);
  let [y, m] = from.split("-").map(Number);
  for (;;) { m++; if (m > 12) { m = 1; y++; } const d = `${y}-${String(m).padStart(2, "0")}-01`; if (d >= to) break; days.add(d); }
  days.add(to);
  return [...days].sort();
}

/**
 * Headcount over time: filled and vacant posts, in all and per unit, at the start of each month.
 * @returns {{ from, to, units: string[], points: { on, filled, vacant, fte, units: Record<string, number> }[], changes: object[] }}
 */
export function orgSeries(org, { from, to, ...options }) {
  if (!(from < to)) throw new Error(`the range runs from ${from} to ${to}: the first date must be before the second`);
  const names = new Set();
  const points = monthStarts(from, to).map((on) => {
    const s = orgStats(org, { ...options, on, budget: false });
    for (const u of s.units) if (u.filled) names.add(u.name);
    return { on, filled: s.totals.filled, vacant: s.totals.vacant, fte: s.totals.fte, units: Object.fromEntries(s.units.map((u) => [u.name, u.filled])) };
  });
  return { from, to, units: [...names].sort(), points, changes: compareDates(org, from, to, options).changes };
}

const cost = (c) => Object.entries(c).map(([cur, n]) => `${n.toLocaleString("en-US")} ${cur}`).join(" + ") || "none";

/** The analysis as a Markdown document. */
export function statsMarkdown(org, options = {}) {
  const s = orgStats(org, options);
  const out = [`# ${esc(org.meta.name)}: the organization in numbers on ${s.on}`, ""];
  if (options.budget) out.push("**Internal.** This report includes budget figures.", "");
  out.push([
    `- **Posts:** ${s.totals.posts} (${s.totals.filled} filled, ${s.totals.vacant} vacant), and ${s.totals.planned} planned.`,
    `- **People:** ${s.totals.people}, making ${s.totals.fte} full-time equivalents.`,
    `- **Layers:** ${s.layers.length}, counted from the posts that report to nobody.`,
    `- **Managers:** ${s.span.managers}. Span of control: ${s.span.average} on average, ${s.span.median} at the median, from ${s.span.smallest} to ${s.span.largest}.`,
  ].join("\n"), "");
  out.push("## By unit", "", mdTable(["Unit", "Filled", "Vacant", "Planned", "FTE", ...(options.budget ? ["Budgeted FTE", "Budgeted cost", "Cost of filled posts"] : [])],
    s.units.map((u) => [esc(u.name), String(u.filled), String(u.vacant), String(u.planned), String(u.fte), ...(options.budget ? [String(u.budgetFte), cost(u.budgetCost), cost(u.filledCost)] : [])])), "");
  if (options.budget) out.push("Budget counts only posts that carry budget figures and exist on this date; a planned post is not yet budgeted here. A post's cost is the seat's, not a person's pay.", "");
  out.push("## Span of control", "", s.spans.length ? mdTable(["Post", "Held by", "Direct reports", "Of which filled"], s.spans.map((x) => [esc(x.title), esc(x.holder), String(x.reports), String(x.filledReports)])) : "Nobody has direct reports on this date.", "");
  out.push("Direct reports are line reports that exist on this date. Dotted lines and planned posts are not counted.", "");
  out.push("## Layers", "", mdTable(["Layer", "Posts", "Filled"], s.layers.map((l) => [String(l.layer), String(l.posts), String(l.filled)])), "");
  if (options.from && options.to) {
    const series = orgSeries(org, options);
    out.push(`## Headcount from ${series.from} to ${series.to}`, "", "Filled posts at the start of each month.", "",
      mdTable(["Date", "Filled", "Vacant", "FTE", ...series.units.map(esc)], series.points.map((p) => [p.on, String(p.filled), String(p.vacant), String(p.fte), ...series.units.map((u) => String(p.units[u] ?? 0))])), "");
    out.push("## What changed", "", series.changes.length ? mdTable(["Change", "Post", "Detail"], series.changes.map((c) => [CHANGE[c.kind], esc(c.title), esc(c.detail)])) : "Nothing changed.", "");
  }
  return out.join("\n").trimEnd() + "\n";
}
