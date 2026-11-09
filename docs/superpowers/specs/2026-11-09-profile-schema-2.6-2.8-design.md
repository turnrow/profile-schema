# Profile Schema 2.6–2.8: photos, badges, recommendations, review and PDF outputs, and the major exchange formats

**Status:** design. Brainstormed 2026-11-09. The principal chose: Typst + veraPDF for the PDF; GEDCOM 7.0 and 5.5.1 together; Open Badges 3.0 / CLR 2.0, Europass, HR Open and a plain-text ATS résumé in the first export milestone; execution to start as soon as the issues exist (so that answer stands in for review of this spec and the plan). **Base:** `codes-2.5` (PR #6), schema 2.5.0, 128 tests. **Tracking:** GitHub issues in `turnrow/profile-schema`, milestones 2.6, 2.7 and 2.8.

## 1. What was asked, and what this assumes

**Said by the principal (2026-11-09):**
- **Photos.** The schema must hold the primary person's photo references: URL or file name, alt text, and a version or unique identifier (a UUID, a hash, extracted metadata). A photo must be attachable to individual position entries.
- **Badges.** Badges use a canonical, preferably open-source schema, so integrations with the major badging systems are easy.
- **Endorsements and recommendations from others.** Each carries:
  - the full text and highlighted statements;
  - the date and time, and the relationship type;
  - the person's name, title and company *at the time*, and their unique identifier;
  - their contact information, possibly several entries that change over time the way a company's name does;
  - their current image URL.
- **Tools:**
  1. a review-worthy Markdown file of a person's whole profile;
  2. a beautiful, fully accessible résumé PDF, in one layout first, with one-page, multi-page and photo/no-photo variants planned;
  3. output to each major format, including GEDCOM.
- **Process.** The work is planned and run through GitHub issues, in the superpowers way, drawing on the practice's repositories and the tsg-corpus.

**Assumed (correct any of these):**
- The person whose profile it is controls it. Recommenders are third parties, so their details default to private and nothing they wrote is published without their recorded consent.
- **Badges.** "Canonical" means we store the badge in Open Badges 3.0 terms and keep the issuer's original credential file untouched. We never re-sign or alter an issuer's credential.
- **Formats.** "Major formats" means the export targets listed in §6, plus the four existing outputs (JSON Resume, schema.org, LinkedIn, brief).
- **US English** in all docs and outputs (the TravelWell project preference; the README still has British spellings, which a 2.6 issue fixes).

**Success:**
- David McCallister's real profile (Travelwell-world/tww-company#419) validates on 2.8 with his headshot versioned, any badges and recommendations he has, a review file the team can mark up, a PDF that passes veraPDF PDF/UA-1, and a GEDCOM file that imports into a 7.0 reader and a 5.5.1 reader.
- Every new output is regenerated and diffed in CI.

## 2. What the practice's own knowledge adds

Recalled from tsg-corpus on 2026-11-09. Every node below is `status: proposed` (a hypothesis, not yet how the practice works) unless noted otherwise.

- **`dia-bld-02` (maturity 1):** generated files are marked and sourced, never hand-edited, and CI regenerates and diffs them. Applied: `data/` is now built by `scripts/build-code-lists.mjs`, which records each input's hash, and every new output gets a regenerate-and-diff step in CI.
- **`dia-ui-05` (maturity 1)** and **`task-run-the-accessibility-aaa-review` (maturity 1):** WCAG 2.2 AA everywhere, AAA contrast where tokens guarantee it. The review includes manual screen-reader and reading-order passes that automation can't cover. Applied to the PDF (§5): the brand tokens already hold AAA 7:1, and veraPDF covers PDF/UA but not reading level or reading order, so the PDF issue carries a manual checklist.
- **`ref-onet-15-1212-00` and its siblings (maturity 3):** the corpus works from O*NET **31.0** (August 2026). 2.5 had bundled 30.3, so the lists were rebuilt from 31.0 on PR #6 (identical codes and names; checked file by file).
- **The superpowers convention in `turnrow/tsg-corpus`:** specs go in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, and each plan has Global Constraints, a file structure, tasks with checkboxes, and a definition of done. This spec and its plans follow it.

## 3. Decomposition

Four sub-projects, each its own milestone, plan and PRs. They depend on each other in this order:

| Milestone | Sub-project | Depends on |
|---|---|---|
| **2.6** | **Model:** media assets and dated person images; a people registry; recommendations; skill endorsements; badges on Open Badges 3.0; badge import; the existing outputs extended to the new sections; release and consent rules for third-party data; US English | 2.5 (PR #6) |
| **2.7** | **Review and PDF:** the `review` Markdown file; the résumé view model; the Typst "classic" layout (one page and multi-page, with or without a photo); veraPDF in CI; the AAA checklist | 2.6 (photos, recommendations and badges appear in both) |
| **2.8** | **Exports:** GEDCOM 7.0 + GEDZip; GEDCOM 5.5.1; Open Badges 3.0 / CLR 2.0 presentation; Europass; HR Open; plain-text ATS | 2.6; the ATS text shares 2.7's view model |
| — | **Dogfood:** David's profile on each release | each milestone |

## 4. Model (2.6)

### 4.1 Media assets and dated images
`media[]` grows from "a link with alt text" into an asset record:
- **Identity and versions.** `uuid` (RFC 9562; stable across re-crops and re-encodes of the same photograph), `sha256` (already present; identifies one exact file, so it doubles as the version id), `version` (a label), `supersedes` (the media id this replaces), and `capturedOn` (fuzzy date).
- **What it is.** `kind` (headshot, portrait, banner, logo, photo, document, video, audio), `mediaType`, `width`, `height`, `byteSize`, and `focalPoint {x, y}` (0–1, so any crop keeps the face).
- **Renditions.** `renditions[]`, each with `url`, `width`, `height`, `sha256` and a `purpose` (square, banner, print, thumbnail). Every rendition is a crop or resize of the same asset.
- **Rights and provenance.** `credit`, `copyrightHolder`, `license` (URL or SPDX-style id), `consent` (for photos of anyone but the subject), and `contentCredentials` (a C2PA manifest's URL, or "embedded").
- **Extracted metadata.** A small, named set (`metadata.dateTimeOriginal`, `metadata.make`, `metadata.model`, `metadata.software`) kept so a re-export can be matched to its original. **Location metadata is never stored.** The validator errors on a bundle JPEG or PNG that still carries GPS tags (EXIF GPS IFD, XMP `exif:GPS*`). `profile media add` strips them, or refuses, before the file enters a bundle.
- **Accessible text.** `alt` (translatable, required for images) and `longDescription` (optional).

**Associations:**
- `person.images[]`: `{ media, purpose (primary | headshot | banner), from, to }`. These are dated portraits. Outputs choose the one in force on `--on`. `person.image` stays for older files and is read as a primary image with no dates.
- `media: [ids]` is allowed on positions and responsibilities, not just on entries. The LinkedIn sheet and the PDF can then show the photo or document that belongs to one role. The `imageFor(entry|position)` helper uses the position's own media, else the job's, else the person's image in force at the position's start.

### 4.2 People registry
`people{ id: … }` sits beside `organizations`. Recommenders, endorsers, references and managers become first-class, with dated facts:
- **Names:** `names[]` with `type`, `from` and `to`, like the subject's own names.
- **Identifiers:** `identifiers[]` with `scheme` (linkedin, orcid, email, did, wikidata, url, other), `value`, `from`, `to` and `verified`. The id is the stable way to say "the same person" across name and employer changes.
- **Roles:** `roles[]` with `title`, `organization` (orgRef, so the organization's own dated names apply), `from` and `to`.
- **Contacts:** `contacts[]` with `type` (email, phone, url, postal), `value`, `label`, `from`, `to` and `visibility`, defaulting to **private**. A recipient sees a contact only through an audience grant (`personContacts`).
- **Images:** `images[]` with `url`, `sha256` and `asOf`. "Current image" is the newest one.
- **Linked records:** `relationshipTo` (work or service ids), `note`, `citations`.

`references[]` gains an optional `person` ref, so a reference and a recommendation by the same person share one record. The existing inline fields stay valid.

### 4.3 Recommendations
`recommendations[]` (an entry section) holds:
- **Who and when:** `author` (people id), `date` (date-time, time zone required when a time is given) and `relationship`:
  - `type`: manager, directReport, peer, client, vendor, mentor, mentee, teacher, student, boardMember, investor, colleague or other;
  - `work` or `service`: the shared job, as an entry id;
  - `description`.
- **The author at the time:** `authorAt { title, organization, organizationName }`. This snapshot is what the author was when they wrote it. It is checked against `people.roles` on that date (a warning when they disagree), and organization names resolve through dated names.
- **What they wrote:**
  - `text`: translatable, the full recommendation, verbatim;
  - `highlights[] { id, text, featured }`: each `text` must be a verbatim substring of `text`, and the validator errors otherwise, so a highlight can't drift from what was said;
  - `language`.
- **Where it came from:** `source { platform (linkedin, email, letter, other), url, retrievedOn, capture (a media id: a screenshot or PDF of the original) }`.
- **Consent:** `consent { given, on, scope (full | highlights | nameOnly | anonymous), by }`, from the author. A public or network recommendation needs `given: true`, and the output honors `scope`. With `anonymous`, the author is shown only as `authorAt.title`.
- **Standard entry fields:** visibility, status, confidence and citations.

### 4.4 Skill endorsements
`endorsements[]` holds: `author` (people id), `target` (a skills, credentials or badges id), `date`, optional `text`, `relationship` and `credential` (the URL of an Open Badges 3.0 `EndorsementCredential`, when one exists). It has the same consent rule as recommendations. Counts can be shown ("12 endorsements"), but they are never rendered as a list of names without consent.

### 4.5 Badges (Open Badges 3.0 canonical)
`badges[]` is an entry section whose shape follows Open Badges 3.0, the 1EdTech standard built on the W3C Verifiable Credentials Data Model v2.0:
- **`achievement`:** `id` (URI), `achievementType` (the OB 3.0 vocabulary: Badge, Certificate, Certification, License, MicroCredential and others), `name`, `description` and `criteria { id, narrative }`.
  - `image { id, caption }` is a media id or a URL.
  - `alignment[] { targetName, targetUrl, targetFramework, targetCode, targetType }` is where O*NET, ESCO and SOC codes go, so the codes from 2.5 carry through.
  - `tag[]`.
- **The issuer and the award:** `issuer` (orgRef, plus `issuerId`, the issuer profile's URI or DID), `validFrom`, `validUntil` and `awardedFor` (an entry id: the job, course or project).
- **`credential`:** what the subject actually holds, never altered.
  - `format`: ob3-jsonld, ob3-jwt, ob2-hosted, ob2-signed or ob2-baked;
  - `url` and `file` (a `bundle:` path to the original JSON or image), and `sha256`;
  - `platform`: credly, canvas-credentials, accredible, parchment or other.
- **`verification`:** `status` (verified, unverified, failed, revoked or expired), `method` and `checkedAt`. `verify` sets these; a person can't set "verified" by hand on a 2.6 file.
- **`credentialRef`:** links to a `credentials[]` entry when the badge represents a license or certificate already listed, so it's counted once.
- **Import:** `profile badges import <file|url>` reads OB 2.0 assertions (hosted JSON, a signed JWS, or a baked PNG `iTXt openbadges` / SVG `openbadges:assertion`) and OB 3.0 (JSON-LD, or VC-JWT). It writes the entry and keeps the original in the bundle.
- **Verifying:** OB 2.0 hosted assertions are checked by fetching and comparing. OB 3.0 Data Integrity proofs (eddsa-rdfc-2022) and VC-JWT are checked with a JSON-LD/VC library behind an interface, so the core stays free of network calls. Verification never runs during `validate`.

### 4.6 Outputs of the new sections (2.6)
- **LinkedIn sheet:** recommendations (to request or reuse; LinkedIn has no recommendation import, so the sheet shows the text and the author with consent applied), badges under Licenses & certifications with the credential URL, and photo choices per entry.
- **schema.org:**
  - recommendations become `Recommendation` (a subtype of `Review`) with `author` as a `Person` and `reviewBody`;
  - badges become `EducationalOccupationalCredential` (`credentialCategory: badge`, `recognizedBy`);
  - `image` uses the dated image and renditions.
- **JSON Resume:** `references` from recommendations (the `reference` text is the featured highlight, or the full text if consent allows) and `certificates` from badges.
- **brief:** one featured highlight.
- **Releases:** new grants `recommendations`, `endorsements`, `badges` and `personContacts`. Third-party contacts never travel without `personContacts`.

### 4.7 Validation
- **Errors:**
  - unknown people refs;
  - a highlight that isn't verbatim;
  - a public or network recommendation or endorsement without author consent;
  - a bundle image with GPS tags;
  - a badge whose `credential.file` hash doesn't match;
  - a `verification.status` of `verified` with no `checkedAt` and `method`.
- **Warnings:**
  - an `authorAt` that disagrees with `people.roles` on that date;
  - an image without `alt`;
  - a person image whose dated range overlaps another of the same purpose;
  - a `validUntil` in the past on an approved badge shown as current.

## 5. Review file and PDF (2.7)

### 5.1 `review`
`turnrow-profile review <profile> [--on] [--out review.md]` writes an internal review file. It isn't a mapping: it needs logic and shows what outputs hide. It contains:
- **The summary:** consent status, counts by status, confidence and visibility, open items (disputed, then pending, then questions) and rule hits.
- **Each section** as a table with id, what it says, status, confidence, visibility, sources (with quality), codes, notes (internal, shown here because the file is internal) and **which outputs show it**. The last column is computed by running each mapping's filter, so a reviewer sees "public: LinkedIn, JSON-LD; hidden from brief (priority 40 < 80)".
- **Claims and disputes** side by side, with their citations.
- **Third-party data** (people, contacts, recommendations) in its own section, with consent per item.
- **Accessible Markdown:** one H1, no skipped heading levels, tables with header rows, meaning never carried by color or emoji alone, and links with descriptive text.

### 5.2 Résumé PDF
- **View model:** a `resume` mapping produces a neutral JSON view: sections, entries, dates already formatted for the locale, the chosen photo and rendition, and counts. Typst reads it with `json()`, so layout code holds no business logic.
- **Template:** `templates/resume/classic.typ`, with options `pages: 1 | auto`, `photo: true | false` and `density: comfortable | compact`. One page is a hard target: the build fails if the result exceeds one page, then reports which entries to drop by priority.
- **Type and color:** Atkinson Hyperlegible Next (OFL), from the brand. Typst needs TTF or OTF, so the fonts are added from the upstream release, with their license. Colors come from `brand/design-system/tokens.json`, light theme, all text at AAA 7:1.
- **Accessibility:**
  - Typst's tagged output with `--pdf-standard ua-1` (UA-2 once Typst ships it);
  - document title and language set, headings real and in order;
  - the photo with alt text, or marked as an artifact when decorative;
  - link text descriptive, reading order equal to visual order;
  - widows and orphans prevented (Typst's paragraph costs);
  - no text in images.
- **Validation:** veraPDF validates every PDF in CI (PDF/UA-1 profile). A manual checklist in the PR template covers what veraPDF can't: screen-reader pass, reading order and the plain-language check.
- **Commands:**
  - `turnrow-profile pdf <profile> [--layout classic] [--pages 1|auto] [--photo|--no-photo] [--locale] [--on] [--out]`;
  - the Typst binary is found on PATH, or set with `--typst`, and pinned in CI;
  - `pdf` fails with a plain message when Typst is missing.
- **Later layouts** (issues, not in 2.7): a two-column layout (only if it can keep a single reading order), "academic CV" (publications first), right-to-left scripts, and A4/Letter variants.

## 6. Exports (2.8)

| Target | What it produces | Notes |
|---|---|---|
| **GEDCOM 7.0** (`gedcom7`) | `HEAD` (GEDC VERS 7.0, SCHMA for extension tags) plus one `INDI` and its source and media records | <ul><li>`NAME` per dated name (TYPE and a NOTE with the range: GEDCOM has no name dates)</li><li>`OCCU` per position: DATE `FROM … TO …`, PLAC, AGNC = the employer's name at the time, NOTE = the summary; `EDUC`, `RESI`, `EVEN` with TYPE for timeline events and military service</li><li>`OBJE` for dated images; `SOUR` and `SOUR`-with-PAGE citations, with QUAY from evidence quality (primary 3, secondary 2, selfReported 1, hearsay 0)</li><li>Dates: ABT, BEF, AFT, BET…AND, EST</li><li>Public and approved entries only by default; never notes or third-party contacts</li></ul> |
| **GEDZip** (`--gedzip`) | `.gdz`: `gedcom.ged` plus the bundle's media | A small store-only zip writer (Node's `zlib.crc32`), so no new dependency |
| **GEDCOM 5.5.1** (`gedcom551`) | The same individual | <ul><li>HEAD with GEDC VERS 5.5.1 FORM LINEAGE-LINKED, CHAR UTF-8, a required SUBM record</li><li>`CONC`/`CONT` at 255 characters; OBJE FILE/FORM in 5.5.1 shape</li><li>Extension tags dropped (they're kept as NOTEs, so nothing is lost silently)</li></ul> |
| **Open Badges 3.0 / CLR 2.0** (`ob3`) | A Verifiable Presentation (unsigned) carrying the subject's original, issuer-signed credentials, plus a CLR 2.0 `ClrCredential` *template* the subject or an institution can sign | We never sign as an issuer. Holder signing (did:key) is a later issue. |
| **Europass** (`europass`) | The current Europass CV import format, plus ELM v3 learning-achievement objects for education and credentials, with ESCO codes where present | The first task confirms the format the Europass CV editor accepts today (it changed with the ELM v3 move) before writing the mapping. |
| **HR Open Standards** (`hropen`) | HR-JSON Candidate / Résumé | The first task confirms the current HR Open release and schema URLs. |
| **Plain-text ATS** (`ats`) | UTF-8 text: one column, standard headings, MM/YYYY dates, no tables, no columns, no graphics | It shares 2.7's view model, so it says what the PDF says. |

Every target gets a mapping or a module, golden-file tests on the three examples, and a CI regenerate-and-diff step. Where a validator exists offline (the GEDCOM 7 test files, OB 3.0 JSON Schemas, HR Open JSON Schemas), it runs in the tests.

## 7. Error handling, privacy and testing (all milestones)

- **The same contracts:** `validate` errors stop `convert`, `pdf` and every export. Rule violations exit 3, a refused release exits 4, and errors are one plain line. Releases need consent; notes and rationales never render.
- **Third-party data:**
  - private by default;
  - consent per item;
  - contacts only through `personContacts`;
  - never in GEDCOM, JSON-LD or the ATS text unless both visibility and consent allow it.
- **TDD per the superpowers skill:** each task starts with a failing test.
  - Fixtures cover the three examples plus a new `examples/recommended.profile.json` (a fictional person with people, recommendations, endorsements and badges, including an OB 2.0 baked PNG and an OB 3.0 JSON-LD credential made for the test).
  - Every output is regenerated and diffed in CI.
  - The PDF has veraPDF and a page-count assertion.

## 8. Out of scope

- Issuing or signing credentials as an issuer.
- Live calls to Credly or other platforms in core code. Import and verify take files or URLs through an injectable fetcher; platform APIs are later issues.
- A web renderer: the reference HTML page stays on the roadmap.
- Two-column and right-to-left PDF layouts.
- GEDCOM X.
- Automatic photo cropping.
