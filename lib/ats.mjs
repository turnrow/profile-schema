// The plain-text résumé for applicant tracking systems (ATS): the résumé view as one column of
// UTF-8 text. Parsers read it top to bottom, so there is nothing to misread: no tables, no columns,
// no graphics, plain headings, and dates as MM/YYYY. It says what the PDF says, because both are
// written from the same view (mappings/resume.json).

const nonEmpty = (parts) => parts.filter((p) => p != null && p !== "");
// Text on one line: a parser treats a line break as the end of a field.
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Dates are joined with a typographic dash in the view; a plain hyphen is the safer character here.
const plainDates = (s) => flat(s).replace(/\s*[–—]\s*/g, " - ");

/**
 * @param {object} view  the résumé view (see README, "The résumé view")
 * @returns {string} UTF-8 text, lines ending in "\n"
 */
export function renderAts(view) {
  const sep = view.separators ?? { list: ", ", item: "; " };
  const person = view.person ?? {};
  const out = [];
  const blank = () => { if (out.length && out.at(-1) !== "") out.push(""); };
  const heading = (text) => { blank(); out.push(flat(text).toLocaleUpperCase(view.locale ?? "en")); blank(); };
  const paragraph = (text) => { for (const line of String(text ?? "").split(/\n+/).map(flat).filter(Boolean)) out.push(line); };
  const bullets = (list) => { for (const b of list ?? []) if (flat(b)) out.push(`- ${flat(b)}`); };
  const dates = (d) => (d?.datesNumeric ?? d?.dates ? plainDates(d.datesNumeric ?? d.dates) : undefined);

  out.push(flat(person.name));
  if (person.headline) out.push(flat(person.headline));
  const contact = nonEmpty([person.location, person.email, person.phone, person.website]).map(flat);
  if (contact.length) out.push(contact.join(" | "));
  // A link is written out in full: a parser can't follow a word that only looks like a link.
  for (const l of person.links ?? []) out.push(`${flat(l.label)}: ${l.url}`);

  if (view.summary?.text) { heading(view.summary.heading); paragraph(view.summary.text); }

  const isBrief = (e) => !(e.dates || e.organization || e.summary || e.bullets?.length || e.positions?.length || e.url);
  for (const s of view.sections ?? []) {
    heading(s.heading);
    if (s.entries.every(isBrief)) {
      // Skills, languages: names on one line, each with its level in brackets.
      out.push(s.entries.map((e) => {
        const extra = nonEmpty([e.detail, e.keywords?.length ? e.keywords.join(sep.list) : undefined]).join(sep.item);
        return extra ? `${flat(e.title)} (${extra})` : flat(e.title);
      }).join(sep.item));
      continue;
    }
    for (const e of s.entries) {
      blank();
      const positions = e.positions ?? [];
      if (positions.length > 1) {
        // Several titles at one employer: the employer and the whole span, then each title in turn.
        out.push(nonEmpty([e.organization ?? e.title, e.location]).map(flat).join(sep.list));
        if (dates(e)) out.push(dates(e));
        for (const p of positions) {
          blank();
          out.push(flat(p.title));
          if (dates(p)) out.push(dates(p));
          paragraph(p.summary);
          bullets(p.bullets);
        }
      } else {
        const only = positions[0] ?? e;
        out.push(flat(e.title));
        const line2 = nonEmpty([e.organization, e.detail, e.location]).map(flat).join(sep.list);
        if (line2) out.push(line2);
        if (dates(e)) out.push(dates(e));
        paragraph(only.summary);
        bullets(only.bullets);
        if (e.keywords?.length) out.push(e.keywords.map(flat).join(sep.list));
        if (e.url) out.push(e.url);
      }
    }
  }
  while (out.at(-1) === "") out.pop();
  return out.join("\n") + "\n";
}
