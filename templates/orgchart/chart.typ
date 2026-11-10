// The org chart as a tagged PDF (PDF/UA-1): a heading, a summary, and one table with a header row
// that repeats on each page. Depth in the reporting lines is a "Level" column, in figures, so it
// never depends on indentation. Vacant and planned are words in the Status column.
// Everything it prints comes from view.json (lib/orgchart/pdf.mjs); nothing is decided here.

#let view = json(sys.inputs.at("view", default: "view.json"))
#let paper = sys.inputs.at("paper", default: "us-letter")

// Brand colors, light theme (brand/design-system/tokens.json). Each passes WCAG AAA (7:1) on white.
#let ink = rgb("#023341")
#let ink-muted = rgb("#2f4b55")
#let rule-color = rgb("#5f7a82")
#let head-fill = rgb("#e3eeec")

#set document(title: view.title, author: view.organization)
#set page(paper: paper, flipped: true, margin: (x: 0.6in, y: 0.6in), numbering: "1", number-align: center)
#set text(font: ("Atkinson Hyperlegible Next", "Vazirmatn", "Noto Sans Hebrew"), size: 9.5pt, fill: ink, lang: view.lang)
#set par(leading: 0.6em)
#show heading.where(level: 1): it => block(below: 0.5em, text(size: 17pt, weight: 700, it.body))
#show heading.where(level: 2): it => block(above: 1.4em, below: 0.6em, text(size: 12.5pt, weight: 700, it.body))

= #view.title

#if view.internal [*Internal.* This document includes budget figures.]

#view.summary

#let cols = view.head.len()
#table(
  columns: (auto, 2.2fr, 2fr, 1.5fr, 2fr, 2.2fr) + range(cols - 6).map(_ => auto),
  stroke: 0.6pt + rule-color,
  inset: (x: 5pt, y: 4pt),
  align: left + top,
  table.header(..view.head.map(x => table.cell(fill: head-fill, text(weight: 700, x)))),
  ..view.rows.flatten().map(x => [#x]),
)

#if view.changes != none [
  == #view.changes.heading

  #if view.changes.rows.len() == 0 [Nothing changed.] else {
    table(
      columns: (auto, 2fr, 3fr),
      stroke: 0.6pt + rule-color,
      inset: (x: 5pt, y: 4pt),
      align: left + top,
      table.header(..("Change", "Post", "Detail").map(x => table.cell(fill: head-fill, text(weight: 700, x)))),
      ..view.changes.rows.flatten().map(x => [#x]),
    )
  }
]
