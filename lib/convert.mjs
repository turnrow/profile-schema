// Turnrow Profile converter: applies a declarative mapping to a profile.
//
// A mapping is JSON with an `include` filter and an `output` template.
// Template rules (evaluated against the current context; the profile at the top):
//   "$.a.b"        value at path a.b of the current item ("$$.a" reads from the profile root)
//   "literal"      any other string is copied as written
//   { "$each": "$$.work", "$map": tmpl, "$where": {...}, "$sort": "-startDate,order", "$limit": 3 }
//   { "$fn": "helper", "args": [ ... ] }
//   { "$if": expr, "$then": tmpl, "$else": tmpl }
//   { "$literal": value }   passed through unevaluated
// Empty values (null, "", [], {}) are dropped from the output.
// Section entries reached through $each are filtered by include.visibility, include.status,
// include.confidence and include.minPriority, and by their own targets.<target>.omit;
// targets.<target> also overrides fields for this target only.
// After rendering, every applicable rule in profile.rules is checked against the output.

// Schema defaults that matter for ordering when a field is left out.
const SORT_DEFAULTS = { priority: 50, pinned: false, featured: false };

import { identifierShown, withShownIdentifiers } from "./identifiers.mjs";
import { nameAt, allNames, successorsAt, eventsFor, positionsOf, orgById, cmpDate } from "./history.mjs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DEFAULT_INCLUDE = Object.freeze({
  visibility: ["public"],
  status: ["approved"],
  confidence: ["high", "medium"],
  minPriority: 0,
});

export class RuleViolationError extends Error {
  constructor(violations) {
    super(
      "Output breaks content rules:\n" +
        violations.map((v) => `  - [${v.rule}] matched "${v.match}" (${v.reason})`).join("\n")
    );
    this.name = "RuleViolationError";
    this.violations = violations;
  }
}

/**
 * @param {object} profile   a valid Turnrow Profile
 * @param {object} mapping   a mapping file (see mappings/)
 * @param {{locale?: string, allowRuleViolations?: boolean}} [options]
 * @returns {{ output: any, text: string, violations: object[] }}
 */
export function convert(profile, mapping, options = {}) {
  const target = mapping.target;
  const locale = options.locale || mapping.locale || profile.meta.defaultLocale;
  const include = { ...DEFAULT_INCLUDE, ...mapping.include };

  // ---------- filtering ----------
  // Section entries (objects with an id) get the full filter; other objects in a list
  // (profile links, inline places, names) are filtered on visibility only.
  function passes(entry, { ignorePriority = false } = {}) {
    if (entry == null || typeof entry !== "object") return true;
    if (typeof entry.id !== "string") return include.visibility.includes(entry.visibility ?? "public");
    if (entry.targets?.[target]?.omit) return false;
    if (!include.visibility.includes(entry.visibility ?? "public")) return false;
    if (!include.status.includes(entry.status ?? "draft")) return false;
    if (!include.confidence.includes(entry.confidence ?? "medium")) return false;
    if (!ignorePriority && (entry.priority ?? 50) < include.minPriority) return false;
    return true;
  }
  // Metrics inherit their entry's status and confidence unless they set their own.
  const metricPasses = (m, parent) =>
    passes({ visibility: parent?.visibility, status: parent?.status, confidence: parent?.confidence, ...m }, { ignorePriority: true });
  const withOverrides = (entry) => {
    const o = entry?.targets?.[target];
    return o ? { ...entry, ...o } : entry;
  };

  // ---------- resolution ----------
  function localize(v, loc = locale) {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return v;
    const base = loc.split("-")[0];
    const def = profile.meta.defaultLocale;
    return v[loc] ?? v[base] ?? v[def] ?? v[def.split("-")[0]] ?? Object.values(v)[0];
  }
  function resolveOrg(ref) {
    if (ref == null) return undefined;
    if (typeof ref === "string") {
      const org = profile.organizations?.[ref];
      if (!org) throw new Error(`Unknown organization id: ${ref}`);
      return { id: ref, ...org };
    }
    return ref;
  }
  function resolvePlace(ref) {
    if (ref == null) return undefined;
    if (typeof ref === "string") {
      const p = profile.places?.[ref];
      if (!p) throw new Error(`Unknown place id: ${ref}`);
      return { id: ref, ...p };
    }
    return ref;
  }

  // ---------- dates ----------
  const lowerBound = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);
  function fmt(d, format) {
    if (!d) return undefined;
    const [y, m, day] = d.split("-");
    switch (format) {
      case "year": return y;
      case "yearMonth": return m ? `${y}-${m}` : y;
      case "monthYear": return m ? `${MONTHS[+m - 1]} ${y}` : y;
      case "full": return day ? d : m ? `${y}-${m}-01` : `${y}-01-01`;
      default: return d;
    }
  }
  function dateText(d, format = "monthYear") {
    if (d == null) return undefined;
    if (typeof d === "string") return fmt(d, format);
    if (d.between) {
      const [a, b] = d.between.map((x) => fmt(x, format));
      // 1990/91 when both are years in the same century, otherwise 1990/1991
      return /^\d{4}$/.test(a) && /^\d{4}$/.test(b) && a.slice(0, 2) === b.slice(0, 2) ? `${a}/${b.slice(2)}` : `${a}/${b}`;
    }
    const v = fmt(d.value, format);
    return { about: `c. ${v}`, estimated: `c. ${v}`, calculated: v, before: `before ${v}`, after: `after ${v}` }[d.qualifier] ?? v;
  }
  // Exact ISO dates only: a qualified date is not passed to formats that would present it as exact.
  const isoExact = (d) => (typeof d === "string" ? d : d?.qualifier === "calculated" ? d.value : undefined);

  // ---------- helpers ----------
  const nameStyle = mapping.orgNameStyle ?? "both"; // atTheTime | today | both | legal
  const onDate = options.on ?? new Date().toISOString().slice(0, 10);
  const orgId = (ref) => (typeof ref === "string" ? ref : undefined);

  // Name of an organization for a stretch of time, in the mapping's style.
  function employerName(ref, start, end) {
    const org = resolveOrg(ref);
    if (!org) return undefined;
    const at = lowerBound(start) ?? lowerBound(end);
    const id = orgId(ref);
    // If the organization had already merged into another by that date, it is the successor that employed you.
    const heirsThen = id && at ? successorsAt(profile, id, at) : [];
    const thenOrg = heirsThen.length === 1 && heirsThen[0] !== id ? orgById(profile, heirsThen[0]) : org;
    // Without dates there is no "then": use the display name rather than guess from dated names.
    const then = localize(at ? nameAt(thenOrg, at) ?? thenOrg.name : thenOrg.name);
    const heirs = id ? successorsAt(profile, id, onDate) : [];
    const nowOrg = heirs.length === 1 && heirs[0] !== id ? orgById(profile, heirs[0]) : org;
    const now = localize(nameAt(nowOrg, onDate) ?? nowOrg.name);
    switch (nameStyle) {
      case "atTheTime": return then;
      case "today": return now;
      case "legal": {
        const legal = localize(nameAt(thenOrg, at, ["legal"]));
        return legal && legal !== then ? `${legal} (doing business as ${then})` : then;
      }
      default: return then === now ? then : `${then} (now ${now})`;
    }
  }

  // Does a dated figure apply during a position? Undated figures always do.
  const overlapsPeriod = (m, p) => {
    const ps = lowerBound(p.startDate), pe = p.current ? undefined : lowerBound(p.endDate);
    if (m.to && ps && cmpDate(m.to, ps) < 0) return false;
    if (m.from && pe && cmpDate(m.from, pe) > 0) return false;
    return true;
  };
  const pick3 = (x) => ({ visibility: x.visibility, status: x.status, confidence: x.confidence });

  // Positions of a work entry, inheriting the entry's status and visibility, with their responsibilities.
  function positionsFor(work) {
    if (!work) return [];
    const inherit = (x) => ({ visibility: work.visibility, status: work.status, confidence: work.confidence, ...x });
    return positionsOf(work)
      .filter((p) => passes(inherit(p), { ignorePriority: true }))
      .map((p) => ({
        id: p.id,
        ...pick3(inherit(p)),
        title: localize(p.title),
        // A job without positions takes its official title from the employer's record.
        officialTitle: localize(p.officialTitle ?? (p.implicit ? work.employerRecord?.officialTitle : undefined)),
        change: p.change,
        startDate: p.startDate,
        endDate: p.endDate,
        current: p.current ?? (p.index === p.count - 1 ? work.current : false),
        // Figures recorded for the job as a whole belong to its latest position, not to every one.
        jobMetrics: p.index === p.count - 1 ? HELPERS.metricText(work.metrics, work) : [],
        // The job's own summary belongs to its latest position unless that position has one.
        summary: localize(p.summary) ?? (p.index === p.count - 1 ? localize(work.summary) : undefined),
        responsibilities: p.responsibilities
          .filter((r) => passes(inherit(r), { ignorePriority: true }))
          .map((r) => ({
            id: r.id,
            text: localize(r.summary),
            continuing: r.continuing,
            scope: HELPERS.metricText((r.scope ?? []).filter((m) => overlapsPeriod(m, p)), inherit(r)),
            outcomes: (r.outcomes ?? []).map(localize),
          })),
      }));
  }

  const HELPERS = {
    text: (v) => localize(v),
    org: (ref, field = "name") => { const o = resolveOrg(ref); return o ? localize(o[field]) : undefined; },
    orgObj: (ref) => withShownIdentifiers(resolveOrg(ref), { visibilities: include.visibility, audienceId: profile._release?.audience }),
    // Identifiers of an organization this output may show, optionally limited to some schemes.
    orgIdentifiers: (ref, ...schemes) => (resolveOrg(ref)?.identifiers ?? [])
      .filter((i) => !schemes.length || schemes.includes(i.scheme))
      .filter((i) => identifierShown(i, { visibilities: include.visibility, audienceId: profile._release?.audience })),
    // The identifier in force on a date (default: the output date), so a retired DUNS isn't presented as current.
    orgIdentifier: (ref, scheme, on) => {
      const day = lowerBound(on) ?? onDate;
      return (resolveOrg(ref)?.identifiers ?? [])
        .filter((i) => i.scheme === scheme && identifierShown(i, { visibilities: include.visibility, audienceId: profile._release?.audience }))
        .filter((i) => i.status !== "revoked")
        // An inactive or replaced id without an end date can't be placed in time, so it is never "in force".
        .filter((i) => !["inactive", "replaced"].includes(i.status) || i.to)
        .filter((i) => (!i.from || cmpDate(lowerBound(i.from), day) <= 0) && (!i.to || cmpDate(lowerBound(i.to), day) >= 0))[0]?.value;
    },
    orgClassification: (ref, system) => (resolveOrg(ref)?.classifications ?? []).find((c) => c.system === system && (c.primary ?? true))?.code,
    employer: (ref, start, end) => employerName(ref, start, end),
    orgNameAt: (ref, date, ...types) => localize(nameAt(resolveOrg(ref), lowerBound(date), types.length ? types : undefined)),
    orgNow: (ref) => {
      const id = orgId(ref);
      const heirs = id ? successorsAt(profile, id, onDate) : [];
      const o = heirs.length === 1 ? orgById(profile, heirs[0]) : resolveOrg(ref);
      return localize(nameAt(o, onDate) ?? o?.name);
    },
    orgAlternateNames: (ref) => allNames(resolveOrg(ref)).map(localize).filter((n, i, a) => a.indexOf(n) === i),
    // Ownership and name changes that happened while you were there: "Acquired by HP (Aug 2008)".
    tenureNotes: (ref, start, end, current) => {
      const id = orgId(ref);
      if (!id) return [];
      return eventsFor(profile, id, { from: lowerBound(start), to: current ? undefined : lowerBound(end) })
        .filter((e) => passes(e, { ignorePriority: true }))
        .map((e) => {
          const when = dateText(e.date);
          const other = (x) => localize(nameAt(orgById(profile, x), lowerBound(e.date)) ?? orgById(profile, x)?.name);
          switch (e.type) {
            case "acquisition": return e.target === id ? `Acquired by ${other(e.acquirer)} (${when})` : `Acquired ${other(e.target)} (${when})`;
            case "merger": return `Merged into ${(e.successors ?? []).map(other).join(", ")} (${when})`;
            case "spinOff": case "splitOff": return e.target === id ? `Became independent (${when})` : `Spun off ${other(e.target)} (${when})`;
            case "split": return `Split into ${(e.successors ?? []).map(other).join(" and ")} (${when})`;
            case "rename": case "rebrand": case "tradeName": return `Renamed ${localize(e.name)} (${when})`;
            default: return `${e.type} (${when})`;
          }
        });
    },
    positions: (work) => positionsFor(work),
    // One flat row per position, for formats with no nested positions (JSON Resume, timelines).
    flatPositions: (works) => (works ?? []).filter((w) => passes(w)).map(withOverrides).flatMap((w) =>
      positionsFor(w).map((p) => ({ ...p, priority: w.priority, work: w, organization: w.organization, location: w.location }))),
    responsibilityLines: (p) => (p?.responsibilities ?? []).map((r) =>
      `${r.continuing ? "Continued: " : ""}${r.text}${r.scope?.length ? ` (${r.scope.join("; ")})` : ""}`),
    place: (ref, field = "label") => { const p = resolvePlace(ref); return p ? localize(p[field]) : undefined; },
    placeObj: (ref) => resolvePlace(ref),
    placeGeo: (ref) => {
      const p = resolvePlace(ref);
      return p?.geo ? { lat: p.geo.lat, lon: p.geo.lon } : undefined;
    },
    placeIdUri: (ref) => {
      const p = resolvePlace(ref);
      if (p?.ids?.wikidata) return `https://www.wikidata.org/entity/${p.ids.wikidata}`;
      if (p?.ids?.geonames) return `https://sws.geonames.org/${p.ids.geonames}/`;
      return undefined;
    },
    name: (type, part = "full") => (profile.person.names ?? []).find((n) => n.type === type && include.visibility.includes(n.visibility ?? "public"))?.[part],
    names: (...types) => (profile.person.names ?? [])
      .filter((n) => types.includes(n.type) && include.visibility.includes(n.visibility ?? "public"))
      .map((n) => n.full),
    date: (d, format = "iso") => (format === "iso" ? isoExact(d) : fmt(lowerBound(d), format)),
    isoExact: (d) => isoExact(d),
    isoLoose: (d) => lowerBound(d),
    dateText: (d, format) => dateText(d, format),
    dateRangeText: (start, end, current) => [dateText(start), current ? "Present" : dateText(end)].filter(Boolean).join(" – "),
    concatLists: (...lists) => lists.flatMap((l) => (Array.isArray(l) ? l : l == null ? [] : [l])),
    joinLines: (...parts) => parts.flatMap((p) => (Array.isArray(p) ? p : [p])).map(localize).filter(Boolean).join("\n"),
    join: (list, sep = ", ") => (Array.isArray(list) ? list.map(localize).filter(Boolean).join(sep) : list),
    concat: (...parts) => parts.map(localize).filter((p) => p != null && p !== "").join(""),
    coalesce: (...vals) => vals.find((v) => v != null && v !== ""),
    visible: (value, vis = "private") => (include.visibility.includes(vis) ? value : undefined),
    lookup: (ids, section, field = "name") =>
      (ids ?? []).map((id) => (profile[section] ?? []).find((e) => e.id === id))
        .filter((e) => passes(e, { ignorePriority: true })).map((e) => localize(withOverrides(e)[field])).filter(Boolean),
    money: (m) => {
      if (!m) return undefined;
      const sym = { USD: "$", EUR: "€", GBP: "£" }[m.currency] ?? `${m.currency} `;
      const n = m.amount >= 1e6 ? `${(m.amount / 1e6).toLocaleString("en-US")}M` : m.amount.toLocaleString("en-US");
      return `${m.approximate ? "~" : ""}${sym}${n}`;
    },
    enumMap: (value, table) => (value == null ? undefined : table[value] ?? value),
    truncate: (v, n) => { const s = localize(v); return s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; },
    metricText: (metrics, parent) => (metrics ?? []).filter((m) => metricPasses(m, parent)).map((m) => {
      const pre = { approx: "~", atMost: "≤" }[m.qualifier] ?? "";
      const post = m.qualifier === "atLeast" ? "+" : "";
      const val = typeof m.value === "number" ? m.value.toLocaleString("en-US") : m.value;
      const period = m.from || m.to ? ` (${[m.from, m.to].filter(Boolean).map((d) => fmt(d, "monthYear")).join("–")}${m.from && !m.to ? " on" : ""})` : "";
      return `${pre}${val}${post}${m.unit ? " " + m.unit : ""} ${localize(m.label)}${period}`;
    }),
    locale: () => locale,
    now: () => new Date().toISOString(),
  };

  // ---------- evaluator ----------
  function getPath(ctx, path) {
    const [root, rest] = path.startsWith("$$") ? [profile, path.slice(2)] : [ctx, path.slice(1)];
    if (!rest || rest === ".") return root;
    return rest.replace(/^\./, "").split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), root);
  }
  const truthy = (v) => !(v == null || v === false || v === "" || (Array.isArray(v) && v.length === 0));
  const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
  const prune = (v) => {
    if (Array.isArray(v)) return v.filter((x) => !isEmpty(x));
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!isEmpty(x)) o[k] = x;
    return o;
  };
  function sortBy(list, spec) {
    const keys = spec.split(",").map((s) => s.trim());
    const val = (e, f) => {
      if (f === "startDate") return e.current ? "9999" : lowerBound(e.startDate) ?? "";
      if (f === "endDate") return e.current ? "9999" : lowerBound(e.endDate) ?? "";
      const v = e[f] ?? SORT_DEFAULTS[f];
      return typeof v === "boolean" ? Number(v) : v ?? "";
    };
    return [...list].sort((a, b) => {
      for (const k of keys) {
        const desc = k.startsWith("-");
        const f = desc ? k.slice(1) : k;
        const av = val(a, f), bv = val(b, f);
        if (av < bv) return desc ? 1 : -1;
        if (av > bv) return desc ? -1 : 1;
      }
      return 0;
    });
  }
  function evalT(t, ctx) {
    if (typeof t === "string") return t.startsWith("$") ? getPath(ctx, t) : t;
    if (Array.isArray(t)) return prune(t.map((x) => evalT(x, ctx)));
    if (t && typeof t === "object") {
      if ("$literal" in t) return t.$literal;
      if ("$each" in t) {
        let list = evalT(t.$each, ctx) ?? [];
        list = list.filter((e) => passes(e)).map(withOverrides);
        if (t.$where) list = list.filter((e) => Object.entries(t.$where).every(([k, v]) => {
          const actual = e[k] ?? null; // null in a $where list also matches a missing field
          return Array.isArray(v) ? v.includes(actual) : actual === v;
        }));
        if (t.$sort) list = sortBy(list, t.$sort);
        if (t.$limit) list = list.slice(0, t.$limit);
        return prune(list.map((e) => evalT(t.$map ?? "$", e)));
      }
      if ("$fn" in t) {
        const fn = HELPERS[t.$fn];
        if (!fn) throw new Error(`Unknown helper: ${t.$fn}`);
        return fn(...(t.args ?? []).map((a) => evalT(a, ctx)));
      }
      if ("$if" in t) return truthy(evalT(t.$if, ctx)) ? evalT(t.$then, ctx) : evalT(t.$else, ctx);
      const out = {};
      for (const [k, v] of Object.entries(t)) out[k] = evalT(v, ctx);
      return prune(out);
    }
    return t;
  }

  const output = evalT(mapping.output, profile);
  const text = mapping.format === "text" ? renderText(output) : JSON.stringify(output, null, 2) + "\n";
  const violations = checkRules(profile, stringsOf(output), include.visibility);
  if (violations.length && !options.allowRuleViolations) throw new RuleViolationError(violations);
  return { output, text, violations };
}

/** Every string in a rendered output (keys excluded), joined so no two values run together. */
export function stringsOf(value) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out.join("\n");
}

/**
 * Check rendered text against profile.rules that apply to these visibilities.
 * Pass plain text (use stringsOf for structured output): checking serialized JSON would
 * miss matches next to escape sequences such as \n.
 */
export function checkRules(profile, text, visibilities) {
  const found = [];
  for (const rule of profile.rules ?? []) {
    const applies = !rule.appliesTo || rule.appliesTo.some((v) => visibilities.includes(v));
    if (!applies) continue;
    const regexes = [];
    if (rule.pattern) regexes.push(new RegExp(rule.pattern, "giu"));
    for (const p of rule.phrases ?? []) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      regexes.push(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"));
    }
    for (const re of regexes) for (const m of text.matchAll(re)) found.push({ rule: rule.id, match: m[0], reason: rule.reason });
  }
  return found;
}

/** Render { section: [ { field: value } ] } as indented plain text for paste-ready targets. */
export function renderText(obj) {
  const lines = [];
  const walk = (v, depth) => {
    const pad = "  ".repeat(depth);
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x && typeof x === "object") { lines.push(`${pad}- (${i + 1})`); walk(x, depth + 1); }
        else lines.push(`${pad}- ${x}`);
      });
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (x && typeof x === "object") { lines.push(`${pad}${k}:`); walk(x, depth + 1); }
        else lines.push(`${pad}${k}: ${String(x).replace(/\n/g, `\n${pad}  `)}`);
      }
    }
  };
  walk(obj, 0);
  return lines.join("\n") + "\n";
}
