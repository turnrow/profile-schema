// The résumé template: one column, or a main column with a narrower one beside it. Layout only.
// Either way there is one reading order: the header, the main column from top to bottom, then
// the side column. Content is never read row by row across the columns. (Past one page, the page's
// own text order puts the side column after the first page's part of the main column; a two-column
// résumé is best kept to one page.)
// Everything it prints comes from the résumé view (mappings/resume.json): which entries appear,
// their order, wording, dates and headings are decided there, not here.
//
// Inputs (typst compile --input key=value):
//   view     path to the résumé view JSON, relative to --root
//   pages    "auto" (default) or "1": with "1" the build fails if the résumé runs past one page
//   density  "comfortable" (default) or "compact"
//   paper    "us-letter" (default) or "a4"
// The photo is shown when the view's person.photo has a "path" (a local file under --root).
// A section whose "column" is "side" goes in the side column; when none is, there is one column.

#let view = json(sys.inputs.at("view", default: "view.json"))
#let one-page = sys.inputs.at("pages", default: "auto") == "1"
#let compact = sys.inputs.at("density", default: "comfortable") == "compact"
#let paper = sys.inputs.at("paper", default: "us-letter")

// Brand colors, light theme (brand/design-system/tokens.json). Each passes WCAG AAA (7:1) on white.
#let ink = rgb("#023341")
#let ink-muted = rgb("#2f4b55")
#let link-color = rgb("#00524c")
#let rule-color = rgb("#5f7a82")

#let base = if compact { 9.5pt } else { 10.5pt }
#let gap = if compact { 0.5em } else { 0.7em }
#let has(d, key) = key in d and d.at(key) != none and d.at(key) != ""
#let person = view.person
// Punctuation between parts comes from the view, in the output's language (Arabic has its own comma).
#let sep = view.at("separators", default: (list: ", ", item: "; "))
#let locale = view.at("locale", default: "en").split("-")

#set document(title: view.title, author: person.name)
#set page(paper: paper, margin: if compact { (x: 0.65in, y: 0.6in) } else { (x: 0.8in, y: 0.75in) })
#set text(
  // Atkinson Hyperlegible Next has no Arabic or Hebrew letters; Vazirmatn and Noto Sans Hebrew supply them.
  font: ("Atkinson Hyperlegible Next", "Vazirmatn", "Noto Sans Hebrew"), size: base, fill: ink,
  lang: locale.at(0), region: if locale.len() > 1 and locale.at(1).len() == 2 { locale.at(1) } else { none },
  dir: if view.at("direction", default: "ltr") == "rtl" { rtl } else { ltr },
  // No line of a paragraph is left alone at the top or bottom of a page.
  costs: (widow: 100%, orphan: 100%),
)
#set par(leading: 0.6em, spacing: gap, justify: false)
#set list(indent: 0.4em, body-indent: 0.5em, spacing: 0.5em, marker: [•])
// Links are underlined as well as colored, so they never depend on color alone.
#show link: it => underline(offset: 2pt, text(fill: link-color, it))

#show heading.where(level: 1): it => block(below: 0.45em, text(size: base * 2.1, weight: 700, it.body))
#show heading.where(level: 2): it => block(above: if compact { 1.0em } else { 1.3em }, below: 0.6em, {
  text(size: base * 1.2, weight: 700, it.body)
  // The rule under a section heading is decoration; a screen reader skips it.
  pdf.artifact(block(above: 0.3em, below: 0pt, line(length: 100%, stroke: 0.6pt + rule-color)))
})
#show heading.where(level: 3): it => block(above: gap * 1.3, below: 0.4em, text(size: base * 1.05, weight: 700, it.body))

// Text on the start side, dates on the end side of the same line: read in that order.
// In the narrow column there is no room beside the text, so the dates go on the next line.
#let with-dates(body, d, narrow: false) = block(above: 0.4em, below: 0.4em, {
  body
  if has(d, "dates") {
    if narrow { if body != [] { linebreak() } } else { h(1fr) }
    text(fill: ink-muted, d.dates)
  }
})
#let bullets(d) = if has(d, "bullets") { list(..d.bullets.map(b => [#b])) }
#let join-nonempty(parts, sep) = parts.filter(p => p != none and p != "").join(sep)

// ---------- header ----------
#let contact = (
  if has(person, "location") { [#person.location] },
  if has(person, "email") { link("mailto:" + person.email)[#person.email] },
  if has(person, "phone") { [#person.phone] },
  if has(person, "website") { link(person.website)[#person.website.replace(regex("^https?://"), "").trim("/", at: end)] },
  ..person.at("links", default: ()).map(l => link(l.url)[#l.label]),
).filter(x => x != none)

#let photo = person.at("photo", default: (:))
#let header = {
  heading(level: 1, person.name)
  if has(person, "headline") { block(below: 0.6em, text(size: base * 1.1, fill: ink-muted, person.headline)) }
  if contact.len() > 0 { block(contact.join([ #sym.dot.c ])) }
}
#if has(photo, "path") {
  grid(columns: (1fr, auto), column-gutter: 1.2em, align: (start + horizon, end + top),
    header,
    box(clip: true, radius: 4pt, image(photo.path, width: 0.95in, alt: photo.at("alt", default: person.name))),
  )
} else { header }

// ---------- sections ----------
// An entry with nothing but a name (a skill, a language) is set inline; the rest get a block each.
#let is-brief(e) = not (has(e, "dates") or has(e, "organization") or has(e, "summary") or has(e, "bullets") or has(e, "positions") or has(e, "url"))
#let brief(e) = {
  let extra = join-nonempty((e.at("detail", default: none), if has(e, "keywords") { e.keywords.join(sep.list) }), sep.item)
  if extra != none { [#e.title (#extra)] } else { [#e.title] }
}
#let entry(e, narrow: false) = {
  let positions = e.at("positions", default: ())
  let place = e.at("location", default: none)
  if positions.len() > 1 {
    // Several titles at one employer: the employer heads the entry, and each title follows with its dates.
    heading(level: 3, e.at("organization", default: e.title))
    with-dates(if place != none { [#place] } else { [] }, e, narrow: narrow)
    for p in positions {
      block(above: gap, with-dates(text(weight: 600, p.title), p, narrow: narrow))
      if has(p, "summary") { par(p.summary) }
      bullets(p)
    }
  } else {
    heading(level: 3, if has(e, "url") { link(e.url)[#e.title] } else { e.title })
    let line2 = join-nonempty((e.at("organization", default: none), e.at("detail", default: none), place), sep.list)
    if line2 != none { with-dates([#line2], e, narrow: narrow) }
    // With nothing else on the line, the date sits at the start, under the title.
    else if has(e, "dates") { block(above: 0.4em, below: 0.4em, text(fill: ink-muted, e.dates)) }
    let only = if positions.len() == 1 { positions.first() } else { e }
    if has(only, "summary") { par(only.summary) }
    bullets(only)
    if has(e, "keywords") { par(text(fill: ink-muted, e.keywords.join(sep.list))) }
  }
}

// In the narrow column, names are a real list (one per line); in the wide one they run on a line.
#let sections-of(sections, narrow: false) = for s in sections {
  heading(level: 2, s.heading)
  if s.entries.all(is-brief) {
    if narrow { list(marker: none, indent: 0pt, body-indent: 0pt, ..s.entries.map(brief)) } else { par(s.entries.map(brief).join(sep.item)) }
  } else {
    for e in s.entries { entry(e, narrow: narrow) }
  }
}

#let all-sections = view.at("sections", default: ())
#let side = all-sections.filter(s => s.at("column", default: "main") == "side")
#let main = all-sections.filter(s => s.at("column", default: "main") != "side")
#let summary = if "summary" in view and has(view.summary, "text") {
  heading(level: 2, view.summary.heading)
  par(view.summary.text)
}

#if side.len() == 0 {
  summary
  sections-of(main)
} else {
  // Two cells in one row: the whole main column comes first in the document, then the side column.
  block(above: 1.1em, grid(columns: (1fr, 31%), column-gutter: 1.8em,
    { summary; sections-of(main) },
    sections-of(side, narrow: true),
  ))
}

// One page is a hard limit when asked for: fail with a marker the pdf command turns into advice.
#context if one-page and counter(page).final().first() > 1 {
  panic("TURNROW-OVERFLOW pages=" + str(counter(page).final().first()))
}
