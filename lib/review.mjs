// The review file: one Markdown document of the whole profile for the people who check it.
// It is internal. It shows what outputs hide (drafts, private entries, notes, disputes, other
// people's details) so that a reviewer can see every fact, where it came from and where it will appear.
// It is not a mapping: it needs logic, and it must never be published.

import { readFileSync, readdirSync } from "node:fs";
import { validateProfile, SECTIONS } from "./validate.mjs";
import { convert, inclusion, sectionsRead, resolveMapping, DEFAULT_INCLUDE } from "./convert.mjs";
import { resolveAudience } from "./audience.mjs";

const SECTION_TITLES = {
  work: "Work", service: "Service", education: "Education", credentials: "Credentials", awards: "Awards", projects: "Projects",
  publications: "Publications", timeline: "Timeline", media: "Media", skills: "Skills", languages: "Languages", interests: "Interests",
  references: "References", recommendations: "Recommendations", endorsements: "Endorsements", badges: "Badges",
};
// Sections that hold other people's words or details; they are reported under "Other people's data".
const THIRD_PARTY = new Set(["references", "recommendations", "endorsements"]);
const OPEN_ORDER = { disputed: 0, pending: 1, question: 2 };
const NONE = "none";

function bundledMappings() {
  const dir = new URL("../mappings/", import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
}

/**
 * Write the review file for a profile.
 * @param {object} profile  a Turnrow Profile (it need not be valid: problems are listed at the top)
 * @param {{ on?: string, locale?: string, bundleDir?: string, mappings?: object[], source?: string }} [options]
 *   on: the date outputs are made for (yyyy-mm-dd, default today); mappings: the outputs to report on
 *   (default: the bundled ones); source: the file name to show in the heading.
 * @returns {string} Markdown
 */
export function reviewMarkdown(profile, options = {}) {
  const on = options.on ?? new Date().toISOString().slice(0, 10);
  const locale = options.locale ?? profile.meta?.defaultLocale ?? "en";
  const mappings = (options.mappings ?? bundledMappings()).map(resolveMapping);
  const validation = validateProfile(profile, { bundleDir: options.bundleDir });
  const sources = profile.sources ?? {};
  const orgs = profile.organizations ?? {};
  const people = profile.people ?? {};

  // ---------- text ----------
  const text = (v) => {
    if (v == null) return undefined;
    if (typeof v !== "object" || Array.isArray(v)) return v;
    const def = profile.meta?.defaultLocale ?? "en";
    return v[locale] ?? v[locale.split("-")[0]] ?? v[def] ?? v[def.split("-")[0]] ?? Object.values(v)[0];
  };
  // Profile text is data, not Markdown: characters that would start markup or break a table are escaped.
  const esc = (v) => String(v ?? "").replace(/\s+/g, " ").trim().replace(/[\\`*_[\]<>|#]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : `\\${c}`));
  const cell = (v) => { const s = Array.isArray(v) ? v.filter(Boolean).join("; ") : v; return s == null || s === "" ? NONE : String(s); };
  const table = (headers, rows) => [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
  const date = (d) => {
    if (d == null) return undefined;
    if (typeof d === "string") return d;
    if (d.between) return `between ${d.between[0]} and ${d.between[1]}`;
    return d.qualifier && d.qualifier !== "calculated" ? `${d.qualifier} ${d.value}` : d.value;
  };
  const range = (e) => {
    const start = date(e.startDate), end = e.current ? "present" : date(e.endDate);
    const one = date(e.date ?? e.issued ?? e.awarded ?? e.published ?? e.releaseDate);
    return start || end ? [start ?? "?", end ?? "?"].join(" to ") : one;
  };
  const orgName = (ref) => (ref == null ? undefined : typeof ref === "string" ? text(orgs[ref]?.name) ?? ref : text(ref.name));
  const personName = (id) => (id == null ? undefined : people[id]?.name ?? id);
  const value = (v) => (v == null ? "(empty)" : typeof v === "object" ? (v.value !== undefined || v.between ? date(v) : JSON.stringify(text(v) ?? v)) : String(v));

  // ---------- what an entry says ----------
  function says(section, e) {
    const head = text(e.title ?? e.name ?? e.role ?? e.position ?? e.language ?? e.studyType ?? e.achievement?.name ?? e.label);
    const org = orgName(e.organization ?? e.institution ?? e.issuer ?? e.awarder ?? e.publisher ?? e.client);
    const parts = [];
    if (section === "recommendations" || section === "endorsements") {
      parts.push(`${section === "recommendations" ? "Recommendation" : "Endorsement"} by ${personName(e.author)}`);
      if (section === "endorsements") parts.push(`for ${e.target}`);
    } else if (section === "references") {
      parts.push(`Reference: ${text(e.name) ?? personName(e.person) ?? "unnamed"}`);
    } else if (section === "education") {
      parts.push([text(e.studyType), text(e.area)].filter(Boolean).join(", ") || head);
      if (e.completed === false) parts.push("not completed");
    } else if (head) parts.push(head);
    if (org && section !== "recommendations") parts.push(org);
    const when = range(e);
    if (when) parts.push(when);
    const summary = text(e.summary ?? e.description);
    if (!parts.length && summary) parts.push(summary);
    return parts.length ? esc(parts.join(", ")) : esc(e.id);
  }

  // ---------- columns ----------
  const quality = (c) => c.quality ?? sources[c.source]?.defaultQuality ?? "selfReported";
  const sourceCell = (cits) => (cits ?? []).map((c) => {
    const src = sources[c.source];
    const title = esc(text(src?.title) ?? c.source);
    const linked = /^https?:\/\/\S+$/.test(src?.url ?? "") ? `[${title}](${src.url.replace(/[()\s]/g, encodeURIComponent)})` : title;
    return `${linked}${c.locator ? `, ${esc(c.locator)}` : ""} (${quality(c)})`;
  });
  const codeCell = (e) => [...(e.occupations ?? []), ...(e.codes ?? [])].map((c) => `${esc(c.system)} ${esc(c.code)}${c.match && c.match !== "primary" ? ` (${c.match})` : ""}`);
  const noteCell = (e) => [e.note && esc(text(e.note)), e.openQuestion && `Open question: ${esc(text(e.openQuestion))}`, e.lock && `Locked${e.lock.by ? ` by ${esc(e.lock.by)}` : ""}${e.lock.on ? ` on ${esc(e.lock.on)}` : ""}`];
  const visibilityCell = (e, inherited) => {
    const v = e.visibility ?? inherited ?? "public";
    return e.audiences?.length ? `${v}; also shared with ${e.audiences.map(esc).join(", ")}` : v;
  };

  // Which outputs show an entry, by each mapping's own filter. `parent` lends status, confidence and
  // visibility to parts of an entry (positions, figures), which outputs never filter on priority.
  const targets = mappings.map((m) => ({ target: m.target, follows: [...(m.followsTargets ?? []), m.target], include: { ...DEFAULT_INCLUDE, ...m.include }, reads: sectionsRead(m) }));
  function outputsCell(section, e, parent) {
    const subject = parent ? { visibility: parent.visibility, status: parent.status, confidence: parent.confidence, ...e } : e;
    const shown = [], hidden = [], unused = [];
    for (const t of targets) {
      if (!t.reads.has(section)) { unused.push(t.target); continue; }
      const parentVerdict = parent ? inclusion(parent, t.include, t.follows) : { shown: true };
      const verdict = parentVerdict.shown ? inclusion(subject, t.include, t.follows, { ignorePriority: !!parent }) : { shown: false, reason: `its entry is hidden: ${parentVerdict.reason}` };
      if (verdict.shown) shown.push(t.target); else hidden.push(`${t.target} (${verdict.reason})`);
    }
    return [
      shown.length ? `Shown in: ${shown.join(", ")}` : "Shown in: no output",
      hidden.length && `Hidden from: ${hidden.join(", ")}`,
      unused.length && `Not used by: ${unused.join(", ")}`,
    ].filter(Boolean).join(". ") + ".";
  }

  const HEADERS = ["Id", "What it says", "Status", "Confidence", "Visibility", "Sources", "Codes", "Notes", "Outputs"];
  const row = (section, id, what, e, parent) => [
    esc(id), what, e.status ?? parent?.status ?? "draft", e.confidence ?? parent?.confidence ?? "medium", visibilityCell(e, parent?.visibility),
    sourceCell(e.citations), codeCell(e), noteCell(e), outputsCell(section, e, parent),
  ];
  const figure = (m) => esc(`${m.qualifier ? `${m.qualifier} ` : ""}${text(m.value) ?? ""}${m.unit ? ` ${m.unit}` : ""} ${text(m.label) ?? ""}`.trim());
  function rowsFor(section, e) {
    const rows = [row(section, e.id, says(section, e), e)];
    for (const p of e.positions ?? []) rows.push(row(section, `${e.id} › position ${p.id}`, esc([text(p.title), range(p)].filter(Boolean).join(", ")), p, e));
    for (const r of e.responsibilities ?? []) {
      rows.push(row(section, `${e.id} › responsibility ${r.id}`, esc(text(r.summary) ?? r.id), r, e));
      for (const m of [...(r.scope ?? []), ...(r.metrics ?? [])]) rows.push(row(section, `${e.id} › responsibility ${r.id} › figure ${m.id}`, figure(m), m, { ...e, ...r, priority: e.priority }));
    }
    for (const m of e.metrics ?? []) rows.push(row(section, `${e.id} › figure ${m.id}`, figure(m), m, e));
    return rows;
  }

  // ---------- counts ----------
  const entries = SECTIONS.flatMap((s) => (profile[s] ?? []).map((e) => ({ section: s, e })));
  const tally = (pick, order) => {
    const counts = new Map(order.map((k) => [k, 0]));
    for (const { e } of entries) { const k = pick(e); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts].filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ") || NONE;
  };

  // ---------- rule hits, per output ----------
  const ruleHits = [];
  const outputErrors = [];
  if (validation.valid) {
    for (const m of mappings) {
      try {
        for (const v of convert(profile, m, { on, locale: options.locale, allowRuleViolations: true }).violations) ruleHits.push([m.target, esc(v.rule), esc(v.match), esc(v.reason)]);
      } catch (err) { outputErrors.push(`${m.target}: ${esc(err.message)}`); }
    }
  }

  // ---------- the document ----------
  const out = [];
  const add = (...lines) => out.push(...lines, "");
  const name = profile.person?.name ?? "(no name)";
  add(`# Review file: ${esc(name)}`);
  add("**Internal. Do not publish or forward.** This file shows everything in the profile, including drafts, private entries, internal notes and other people's details, so that it can be checked.");
  add([
    options.source && `- Profile: ${esc(options.source)}`,
    `- Schema version: ${esc(profile.schemaVersion ?? "not stated")}`,
    `- Outputs judged as of: ${on}`,
    `- Outputs compared: ${targets.map((t) => t.target).join(", ") || NONE}`,
  ].filter(Boolean).join("\n"));

  add("## Summary");
  const consent = profile.meta?.subjectConsent;
  add([
    `- **Subject's consent:** ${consent?.given === true ? `recorded${consent.on ? ` on ${esc(date(consent.on))}` : ""}` : "not recorded. Nothing public should be published, and no release can be made, until it is."}`,
    `- **Validation:** ${validation.valid ? "valid" : `not valid (${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"})`}; ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.`,
    `- **Entries:** ${entries.length} in ${new Set(entries.map((x) => x.section)).size} sections.`,
    `- **By status:** ${tally((e) => e.status ?? "draft", ["approved", "pending", "disputed", "draft", "retired"])}.`,
    `- **By confidence:** ${tally((e) => e.confidence ?? "medium", ["high", "medium", "low"])}.`,
    `- **By visibility:** ${tally((e) => e.visibility ?? "public", ["public", "network", "private"])}.`,
    `- **Open items:** ${validation.openItems.length}.`,
    `- **Content rule hits:** ${validation.valid ? ruleHits.length : "not checked, because the profile is not valid"}.`,
  ].join("\n"));

  if (!validation.valid) {
    add("### Validation errors");
    add("The profile is not valid, so the checks that depend on a valid file (open items, rule hits) are incomplete. Fix these first.");
    add(validation.errors.map((e) => `- ${esc(e)}`).join("\n"));
  }
  if (validation.warnings.length) {
    add("### Validation warnings");
    add(validation.warnings.map((w) => `- ${esc(w)}`).join("\n"));
  }

  add("### Open items");
  if (validation.openItems.length) {
    add("Disputed first, then pending, then questions on items that are otherwise settled.");
    add(table(["Kind", "Where", "Question"], [...validation.openItems].sort((a, b) => OPEN_ORDER[a.status] - OPEN_ORDER[b.status])
      .map((o) => [o.status, esc(o.id), o.question ? esc(text(o.question)) : "no question recorded"])));
  } else add(validation.valid ? "Nothing is waiting on confirmation." : "Not listed, because the profile is not valid.");

  add("### Content rule hits");
  if (ruleHits.length) {
    add("Each of these stops the output from being written until the text or the rule changes.");
    add(table(["Output", "Rule", "Matched text", "Why the rule exists"], ruleHits));
  } else add(validation.valid ? "No output breaks a content rule." : "Not checked, because the profile is not valid.");
  if (outputErrors.length) add("These outputs could not be produced:", "", outputErrors.map((e) => `- ${e}`).join("\n"));
  if ((profile.rules ?? []).length) {
    add(table(["Rule", "Kind", "Forbids", "Applies to", "Reason"], profile.rules.map((r) => [
      esc(r.id), esc(r.kind), [...(r.phrases ?? []).map((p) => `"${esc(p)}"`), r.pattern && `pattern \`${String(r.pattern).replace(/`/g, "'").replace(/\|/g, "\\|")}\``, r.statement && esc(text(r.statement))],
      (r.appliesTo ?? ["every output"]).join(", "), esc(text(r.reason)),
    ])));
  }

  // ---------- the person ----------
  add("## The person");
  const person = profile.person ?? {};
  const hiddenFields = person.visibility ?? {};
  const personRows = [];
  const personRow = (field, v) => { if (v != null && v !== "") personRows.push([field, esc(typeof v === "object" ? JSON.stringify(text(v)) : v), hiddenFields[field] ?? "public"]); };
  for (const f of ["name", "pronouns", "headline", "jobTitle", "industry", "shortBio", "summary"]) personRow(f, text(person[f]));
  if (person.location) personRow("location", typeof person.location === "string" ? text(profile.places?.[person.location]?.label) ?? person.location : text(person.location.label) ?? JSON.stringify(person.location));
  const contact = person.contact ?? {};
  if (contact.email) personRows.push(["contact.email", esc(contact.email), contact.emailVisibility ?? "private"]);
  if (contact.phone) personRows.push(["contact.phone", esc(contact.phone), contact.phoneVisibility ?? "private"]);
  if (contact.website) personRows.push(["contact.website", esc(contact.website), hiddenFields.website ?? "public"]);
  add(table(["Field", "Value", "Visibility"], personRows));
  if ((person.names ?? []).length) {
    add("### Names");
    add(table(["Name", "Type", "From", "To", "Visibility"], person.names.map((n) => [esc(n.full), n.type, date(n.from), date(n.to), n.visibility ?? "public"])));
  }

  // ---------- sections ----------
  add("## Entries by section");
  add("The Outputs column applies each output's own filter (visibility, status, confidence and priority). An output can still leave an entry out through its own limits, such as showing only the first five. The scim and verification outputs normally go out through a release, where the audience's grants take the place of the visibility filter; the Audiences section lists those grants.");
  let any = false;
  for (const section of SECTIONS) {
    const list = profile[section] ?? [];
    if (!list.length) continue;
    any = true;
    add(`### ${SECTION_TITLES[section] ?? section}`);
    add(table(HEADERS, list.flatMap((e) => rowsFor(section, e))));
  }
  if (!any) add("The profile has no entries yet.");

  // ---------- claims ----------
  add("## Claims and disputes");
  const claimRows = [];
  const collect = (where, item) => {
    const byField = new Map();
    for (const c of item.claims ?? []) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
    for (const [field, claims] of byField) {
      const current = field.split(".").reduce((acc, k) => (Array.isArray(acc?.metrics) && acc.metrics.some((m) => m.id === k) ? acc.metrics.find((m) => m.id === k) : acc?.[k] ?? (k === "metrics" ? acc : undefined)), item);
      for (const c of claims) {
        claimRows.push([esc(where), esc(field), esc(value(current)), esc(value(c.value)), c.accepted ? "accepted" : "not accepted", sourceCell(c.citations), c.rationale && esc(text(c.rationale))]);
      }
    }
  };
  for (const { section, e } of entries) {
    collect(`${section}/${e.id}`, e);
    for (const m of e.metrics ?? []) collect(`${section}/${e.id} › figure ${m.id}`, m);
    for (const r of e.responsibilities ?? []) collect(`${section}/${e.id} › responsibility ${r.id}`, r);
  }
  if (claimRows.length) {
    add("Each row is what one source says. The profile's own value is beside it, so a disagreement can be read across the row.");
    add(table(["Where", "Field", "Profile says", "This source says", "Decision", "Sources", "Reason"], claimRows));
  } else add("No competing claims are recorded.");

  // ---------- other people's data ----------
  add("## Other people's data");
  add("Details and words that belong to someone else. Check each person's consent before anything here is shared.");
  const consentCell = (c) => (c?.given === true ? `given${c.on ? ` on ${esc(date(c.on))}` : ""}; scope: ${c.scope ?? "full"}${c.by ? `; how: ${esc(c.by)}` : ""}` : "not recorded");
  if (Object.keys(people).length) {
    add("### People");
    add(table(["Id", "Name", "Roles", "Contacts held", "Identifiers held", "Named by"], Object.entries(people).map(([id, who]) => [
      esc(id), esc(who.name),
      (who.roles ?? []).map((r) => esc([text(r.title), orgName(r.organization), [date(r.from), date(r.to)].filter(Boolean).join(" to ")].filter(Boolean).join(", "))),
      (who.contacts ?? []).length ? `${who.contacts.length} (${[...new Set(who.contacts.map((c) => `${esc(c.type ?? c.kind ?? "contact")}: ${c.visibility ?? "private"}`))].join(", ")})` : NONE,
      (who.identifiers ?? []).map((i) => esc(i.scheme)),
      entries.filter(({ e }) => e.author === id || e.person === id).map(({ section, e }) => esc(`${section}/${e.id}`)),
    ])));
  }
  const written = [...(profile.recommendations ?? []).map((e) => ["recommendations", e]), ...(profile.endorsements ?? []).map((e) => ["endorsements", e])];
  if (written.length) {
    add("### Words written by others");
    add(table(["Id", "Author", "Date", "Their consent", "Status", "Visibility", "Outputs"], written.map(([section, e]) => [
      esc(`${section}/${e.id}`), esc(personName(e.author)), date(e.date), consentCell(e.consent), e.status ?? "draft", visibilityCell(e), outputsCell(section, e),
    ])));
  }
  if ((profile.references ?? []).length) {
    add("### References");
    add(table(["Id", "Who", "Consent to publish", "Status", "Visibility"], profile.references.map((e) => [
      esc(e.id), esc(text(e.name) ?? personName(e.person)), e.consentToPublish === true ? "given" : "not recorded", e.status ?? "draft", visibilityCell(e),
    ])));
  }
  if (!Object.keys(people).length && !written.length && !(profile.references ?? []).length) add("The profile holds no one else's data.");

  // ---------- audiences and releases ----------
  if (Object.keys(profile.audiences ?? {}).length) {
    add("## Audiences");
    add(table(["Audience", "Kind", "Purpose", "Person fields granted", "Sections granted", `Active on ${on}`], Object.entries(profile.audiences).map(([id, a]) => {
      let active;
      try { const r = resolveAudience(profile, id, { on }); active = r.active ? "yes" : `no: ${esc(r.reason)}`; } catch (err) { active = `could not be worked out: ${esc(err.message)}`; }
      return [esc(id), esc(a.kind), esc(a.purpose), (a.person ?? []).map(esc), (a.sections ?? []).map(esc), active];
    })));
  }
  if ((profile.releases ?? []).length) {
    add("## Releases made");
    add(table(["Release", "Audience", "Recipient", "Issued", "Status"], profile.releases.map((r) => [
      esc(r.id), esc(r.audience), esc(r.recipient?.name ?? r.recipient?.organization ?? r.recipient?.domain), esc(r.issued), r.revoked ? `stopped ${esc(r.revoked)}` : r.expires ? `active; expires ${esc(r.expires)}` : "active",
    ])));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
