# Org chart (3.0): design

**Status:** written 2026-11-10 without a live brainstorm, like the directory-sync design. The questions issue #39 lists are decided here on a recommendation and gathered under [Decisions to confirm](#decisions-to-confirm).

**Asked for (issue #39):** a schema for a robust, time-based org chart of people and selected pieces of their work information; a tool that reads it and shows it, starting with today; vacant and anticipated roles, for recruiting and for planning; and help seeing how the organization's shape changed over time.

## The idea: seats, not people

The chart is made of **posts**: seats that exist whether or not anyone sits in them. A person *holds* a post for a time. A post *reports to* another post for a time. That one choice gives everything asked for:

- a **vacancy** is a post with no holder on a given day;
- a **planned role** is a post that starts in the future;
- **history** is the same file read on an earlier date, because every post, holder and reporting line carries its dates.

This is the W3C Organization Ontology's model (`org:Post`, `org:holds`, `org:reportsTo`, `org:OrganizationalUnit`, memberships dated with intervals), which also maps to schema.org `OrganizationRole` and to HR Open position data. The file is plain JSON with those names in mind, not RDF.

## The organization file

One file per organization: `<name>.org.json`, checked by `schema/organization.schema.json`.

```
orgSchemaVersion   "1.0.0"
meta               name, the organization (name, domains), updated, notes
units              id → { name, kind, parent, from, to, costCenter }          the tree of divisions, departments, teams
posts[]            { id, title, unit, from, to, level, location,
                     reportsTo[]  { post, kind: line | dotted, from, to },
                     holders[]    { person, from, to, fte, acting, source },
                     vacancy      { status: open | approved | planned | frozen, reason: new | backfill, targetDate, requisition },
                     budget       { costCenter, band, fte, annualCost { amount, currency } } }
people             id → { name, pronouns, preferredTitle, email, employeeNumber, photoUrl, profile, release }
sources            id → { kind: profile | directoryExport | hris | manual, title, date, sha256 }
```

Rules the validator enforces:

- every reference (unit, parent, post, person, source) resolves;
- dates are `yyyy`, `yyyy-mm` or `yyyy-mm-dd`, and `from` is not after `to`;
- a post has at most one holder at a time per unit of FTE (two half-time holders are fine; two full-time holders overlap is an error) and at most one **line** manager at a time; dotted lines are unlimited;
- reporting lines make no loop on any date;
- a unit's parent exists while the unit does;
- every post, holder and line names a source, so each can be traced to where it came from.

**Status is worked out, not stored.** On a date, a post is *filled*, *vacant* (it exists, nobody holds it), *planned* (it starts later) or *closed* (it has ended). `vacancy` adds what recruiting needs for a vacant or planned post. Storing a status as well would let the file contradict itself.

## People and privacy

**A person appears only as a release allows.** The builder takes each person's details from the same release directory sync uses (their `employeeDirectory` audience, for this employer): name, pronouns, preferred title, photo, if granted. So:

- a person who has **not consented**, or has no such audience, is **not named**. Their post still exists, because the seat is the organization's fact, and shows as "filled (person not shown)";
- the employer's facts about the seat (title, unit, reporting line) come from the directory export or the HR system, which are the employer's to use;
- nothing from a profile that its audience does not grant can reach the chart.

**Budget figures are a separate grant.** `budget` (band, cost) is the organization's planning data, not a person's. It is left out of every view and analysis unless asked for with `--budget`, and a published chart (HTML, PDF) never carries it unless built with that flag. A post's budget is the seat's, never a person's pay.

## Building one

```
turnrow-profile orgchart build <folder> --against <export> --target <connector>
                               --domain … --method … [--base <existing.org.json>] --out <file.org.json>
```

- **From the directory export:** a post per user (title, department as unit, manager link as a line to the manager's post), dated from the run's date when the export gives no dates.
- **From the profiles:** who holds each post (matched as in directory sync: employee number, then e-mail), and, where a profile's job has dated `positions`, the history of that person's posts.
- **With `--base`:** an existing file is carried forward. Posts and lines that are gone from the export are **ended on the run's date, not deleted**; new ones start on it. Running the builder each month is how history accumulates. Hand-written parts (planned posts, vacancies, budgets, units) are kept.
- It writes the file and a short report of what changed. It never writes to a directory or a profile.

Vacancies and planned roles are written by hand (or by a later HR-system reader): no directory knows about a seat nobody holds.

## Reading one

```
turnrow-profile orgchart show <file.org.json> [--on <date>] [--compare <date>] [--format html | table | csv | pdf] [--budget]
turnrow-profile orgchart stats <file.org.json> [--on <date>] [--from <date> --to <date>] [--budget]
```

**The view (#41).**

- `html`: one self-contained page, no network requests. The chart is a nested list with tree semantics: arrow keys move, Enter expands, a screen reader hears "level 3, 2 of 5, vacant". Light and dark from the brand tokens, which pass 7:1.
- Vacant and planned posts are marked **in words and by a border pattern**, never by color alone.
- `--compare <date>`: what was added, ended, moved or changed hands between two dates, in words on each post and as a list.
- `table` and `csv`: the same view as an accessible table (one row per post: title, holder, unit, reports to, status, level in the tree).
- `pdf`: a tagged PDF of the same list, through the résumé's Typst route and checked by veraPDF in CI.

**The analysis (#42).** On a date: headcount and vacancies per unit, span of control per manager (line reports only), the number of layers. Over a range: headcount by unit at each month, and a change log (posts opened, closed, filled, vacated, moved). With `--budget`: planned against actual FTE and cost per unit.

## Decisions to confirm

1. **Posts are the unit, and status is worked out from dates.** The alternative, a chart of people with a status field, cannot show an empty seat.
2. **A person who has not consented is not named, but their seat is shown.** The alternative, leaving the seat out, would make the chart wrong (spans and headcount would be off). Recommended as written.
3. **Budget is off unless asked for**, and is the seat's, never a person's pay.
4. **The builder never deletes; it ends.** History is the point.
5. **One line manager at a time; any number of dotted lines.**
6. **Vacancies and planned roles are written by hand in 3.0.** Reading them from an applicant-tracking or HR system comes later, if wanted.
7. **The file is JSON, modelled on the W3C Organization Ontology, not RDF.** An RDF export is a mapping away if anyone needs it.
8. **The interactive chart is a tree you move through, not a drawing of boxes and lines.** A box-and-line drawing is what people expect of an org chart, and it is the part hardest to make work with a keyboard, a screen reader, 200% zoom and a small screen. The tree meets the issue's WCAG AAA requirement outright; a drawn view can be added on top of the same data later.

## Not in 3.0

- Reading an HR system or an applicant-tracking system.
- Matrix organizations beyond dotted lines (a post in two units).
- Pay, performance or any personal HR data.
- Editing the file in a browser.
