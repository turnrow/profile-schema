# Changelog

## Unreleased (2.8): exports

### Plain-text ATS résumé
- **`convert <profile | bundle> ats`** writes the résumé view as one column of UTF-8 text for applicant tracking systems: plain capital headings, `MM/YYYY` dates with a plain hyphen, links written out, `- ` bullets, and no tables, columns, tabs or graphics.
- It says what the PDF says: `ats` extends `resume` and follows its per-entry choices (`"followsTargets"`, new), so an entry left out of or reworded for the résumé is treated the same.
- `examples/out/*.ats.txt` are generated and checked in CI.
- Fix (from #66): a résumé entry with no title of its own is titled by its organization, which no longer crashes the PDF.

### GEDCOM 5.5.1
- **`convert <profile | bundle> gedcom551`** writes the same individual for programs that don't read 7.0: `GEDC VERS 5.5.1`, `FORM LINEAGE-LINKED`, `CHAR UTF-8`, a required `SUBM` record, languages by name, 5.5.1-shaped `OBJE` records, every `@` doubled, and lines within 255 bytes continued with `CONC` and `CONT`.
- **Nothing is dropped silently.** A date's phrase, the confidence, and the title of a residence or event become notes; a value too long for its field is cut there and kept whole in a note.
- **`"extends"` in a mapping.** `gedcom551` extends `gedcom7` and only changes how it is written, so the two can't drift apart.
- **Checked against the specification's grammar,** extracted from its text into `upstream/gedcom551/`. Two limits are passed on purpose (30-character file references; a format list older than PNG) and a test says so.
- `examples/out/*.551.ged` are generated and checked in CI.

### GEDCOM 7.0 and GEDZip
- **`convert <profile | bundle> gedcom7`** writes a FamilySearch GEDCOM 7.0 file with one individual: `NAME` per name (with type, and a note for when it was in use), `OCCU` per title held (dates, place, and the employer's name at the time as `AGNC`), `EDUC`, `RESI`, `EVEN` with a `TYPE` for timeline events and service, `SOUR` citations with `PAGE` and `QUAY`, and `OBJE` for approved public media.
- **Dates keep their doubt:** `ABT`, `EST`, `CAL`, `BEF`, `AFT`, `BET … AND`; spans are `FROM … TO` periods with a `PHRASE` when an end is uncertain.
- **`--gedzip`** writes a `.gdz` archive with `gedcom.ged` and the bundle's media. The zip writer stores files uncompressed and adds no dependency; media are taken only from inside the bundle.
- **One extension tag,** `_CONF` (confidence), declared in `HEAD.SCHMA`.
- Public, approved entries only; notes, contacts, source locations and other people are never written.
- **Checked against the standard:** FamilySearch's structure tables and test files are vendored in `upstream/gedcom7/` (Apache 2.0), and the tests hold every example's output to them.
- A mapping can now set `"format": "gedcom7"`. New helpers: `gedcomDate`, `gedcomPeriod`, `gedcomPeriodPhrase`, `sources`.
- `examples/out/*.ged` are generated and checked in CI.

## Unreleased (2.7): review file, résumé view and accessible PDF

### Résumé PDF
- **Right-to-left output (experimental).** Arabic and Hebrew profiles are laid out right to left, with bundled fonts that have the letters (Vazirmatn and Noto Sans Hebrew, both SIL Open Font License), translated headings and each language's own punctuation. `examples/rtl.profile.json` is a fictional Arabic profile; CI renders and validates it.
  - **Known defect:** Arabic text extracted from the PDF has lam-alef pairs reversed and vowel marks doubled, so a screen reader may misread it. Hebrew extracts correctly. The Arabic variants are named as skipped in the text-order check, with this reason.
  - The Arabic and Hebrew wording was written by an AI and awaits a fluent reader.
- **Fix: dates are always Gregorian.** A Persian or Thai locale printed a 2024 date as 1402 or 2567.
- The résumé view carries `separators`, the punctuation between parts in the output's language.
- **`--layout two-column`:** a main column with skills, languages and credentials in a narrower column beside it. There is one reading order: the header, the main column, then the side column. With nothing for the side column, it is one column.
- **Reading order is checked in CI.** Each rendered PDF's own text order (`pdftotext -raw`) is held to the order of its view: name, summary, then every section heading and entry in turn. `scripts/check-reading-order.mjs` does the same outside CI.
- **`--layout academic`:** an academic CV. Education first, then experience and publications; the document is titled a curriculum vitae. It arranges the same view and uses the same one-column template, and is validated in CI like the rest.
- **Publications in the résumé view** now name their authors or inventors, carry a patent or report number, and link a DOI when there is no other link.
- **veraPDF in CI.** A new job renders every example in eight variants and validates each against PDF/UA-1 with veraPDF (pinned by version and digest). Any violation, a file veraPDF can't read, or fewer validations than PDFs fails the build. The PDFs and the report are kept as the `resume-pdfs` artifact.
- **A pull request template** with the accessibility checks a tool can't make: screen reader, reading order, plain language, meaning not by appearance alone, contrast and zoom. A failing rule is fixed, never exempted.
- `scripts/render-example-pdfs.mjs` and `scripts/check-pdfua.mjs` do the same outside CI.
- **`pdf <profile | bundle> --out resume.pdf`** lays out the résumé view with a Typst template (`templates/resume/classic.typ`) and writes a tagged PDF that declares PDF/UA-1. Typst is found on `PATH` or named with `--typst`; without it the command says where to get it.
- **`--pages 1`** is a hard limit: when the résumé runs longer, nothing is written and the least important entries are listed. `--min-priority`, `--density compact` and `--paper a4` adjust the fit.
- **`--photo`** shows the photo in force with its alt text. It is off by default and takes only a photo stored in the bundle, with the same path guards as validation.
- Document title and language, real headings in order, one reading order, underlined and named links, decorative rules marked as decoration, no widows or orphans.
- Atkinson Hyperlegible Next is added as TrueType (`brand/fonts/*.ttf`, SIL Open Font License) because Typst does not read WOFF2.
- CI installs a pinned Typst so the rendering tests run; on a machine without Typst they are skipped.
- From code: `renderResumePdf`, `resumeViewForPdf`, `dropCandidates`, `PdfError`.

### Résumé view
- **`resume` mapping:** a neutral JSON view for résumé templates. It holds the document title, language and direction, the person (with the photo in force and its alt text), a summary, and ordered sections whose entries all share one shape. Templates only lay out.
- Dates are given twice, in the reader's language and as `MM/YYYY`. Every entry carries its `priority`.
- New mapping helpers: `label` (a fixed phrase in the output's language), `labelFor` (a translated enum value), `section` (drops itself when empty), `count`, `direction`, `onDate`. `dateRangeText` takes a format, and `numeric` is a new date format.
- Section headings, the document title and language and skill levels are translated (en, es, fr, de, pt). A test now requires every supported language to translate every phrase.
- A mapping can set `ruleExemptKeys` so content rules don't read identifiers as prose; the résumé view exempts entry ids (`state-u-ms` was matching the forbidden "MS").
- `examples/out/*.resume.json` are generated and checked in CI.

### Review file

- **`review <profile | bundle> [--on] [--locale] [--out review.md]`** writes the whole profile as one Markdown file for checking: a summary (consent, counts, open items, rule hits), every entry with its status, confidence, visibility, sources, codes, notes and **which outputs show it**, claims beside the profile's own value, other people's data with consent per item, and audiences and releases.
- "Which outputs show it" uses each mapping's own filter and gives the reason an entry is hidden ("priority 40 is below 80").
- The file is internal. `.gitignore` now leaves out `review.md` and `*.review.md`.
- The Markdown is accessible: one H1, no skipped heading levels, header rows on every table, no meaning carried by color or symbols.
- From code: `reviewMarkdown`, plus `inclusion` (a mapping's verdict on an entry, with the reason) and `sectionsRead` (the lists a mapping uses).
- `examples/out/sample.review.md` is generated and checked in CI.

## 2.6.1 (2026-11-10): fixes from a review of the tools and of the 2.5 and 2.6 work

No schema changes: files keep `schemaVersion` 2.6.0, and every existing file remains valid, with one exception noted under Privacy.

### Privacy
- **Photos that can't be checked for location are no longer treated as clean.** WebP, HEIC, AVIF and TIFF files were read as "no GPS", so a phone photo kept its coordinates. `media add` now refuses them and asks for a JPEG or PNG. In a bundle they are an error for a 2.6.0 file and a warning for an older one.
- **A release holds only what a recommender agreed to.** The released profile used to carry the full text and the author's record whatever the consent scope, so a custom mapping could print them. Now `highlights` drops the full text, `nameOnly` drops every word, and `anonymous` drops the name, employer, source and identifiers, keeping only dated titles.
- **Endorsement counts** leave out endorsements the output may not show.

### Command line
- **`help`, `--help`, `-h` and `version`.** Help lists every command, option and exit code. It used to be one line that left out `media add` and `badges import`.
- **`validate` checks every file it is given.** `validate profiles/*.json` used to check the first file and report success. `--json` prints the result for scripts and CI.
- **Misspelled options are refused.** `--recrod` used to be ignored, so a release went unrecorded without a word. An option missing its value is refused too. `--name=value` is accepted.
- **`--on` and `--locale` are checked.** `--on tomorrow` used to be compared as text and give wrong answers quietly.
- **Files from Windows editors load.** A leading byte-order mark no longer makes a profile "not valid JSON".
- **Plain explanations** for a zip passed as a bundle, a missing file, an unknown mapping name (the bundled ones are listed) and an `import` of something that isn't a JSON Resume.
- **`--out` and `--receipt` create the folder they need.**
- **A forgotten value is caught.** `--out --record` used to write a file named `--record`.
- **`--media-base` works without its closing slash** (it used to produce `…/memedia/photo.jpg`) and must be an http(s) URL.
- **`badges import --fetch`** stops after 30 seconds or 10 MB.

### Messages
- **Schema errors say what is wrong.** An unexpected field is named (`"organisation" is not a known field here`) and a bad value lists the allowed ones. Repeated errors are reported once.
- **Spanish, French, German and Portuguese** gain the two phrases they lacked ("{title} at {org}", "A colleague"), which were falling back to English inside translated outputs.

### Fixes
- **The schema's `$id`** pointed at a `master` branch that doesn't exist; it now points at `main`, so the URL resolves for editors.
- **`loadMapping`** accepts only the mappings in `mappings/` (listed in `BUNDLED_MAPPINGS`) and says which they are.
- **A photo dated by month is found for a job dated by year.** A portrait from `2019-03` was skipped for a job that started in `2019`.

### Docs
- README: a command reference with exit codes, editor and CI setup, and a table of common messages. It no longer says the tools read zipped bundles; they read folders.

## 2.6.0 (2026-11-09): photos, other people, recommendations, endorsements and badges

Earlier files remain valid. A file that declares 2.6.0 is held to stricter checks, listed under each heading below.

### Photos
- **Media entries** gain:
  - `uuid`, `version` and `supersedes` (versions of one asset);
  - `kind`, `width`, `height`, `byteSize` and `focalPoint`;
  - `renditions`, `capturedOn` and `metadata`;
  - `credit`, `copyrightHolder`, `license`, `consent`, `contentCredentials` and `longDescription`.
- **`person.images`** dates which photo is in force. Jobs, positions and responsibilities can name their own photos (`media`). Outputs use the photo in force on their date.
- **`profile media add`** copies, hashes and measures a photo. Location metadata is refused unless `--strip-gps` blanks it in place.
- **Stricter in 2.6.0:** a bundled image with GPS coordinates is an error (a warning before). An image without alt text warns. Overlapping `person.images` for one purpose warn.

### People, recommendations and endorsements
- **`people`**: recommenders, endorsers, references and managers. Their names, roles, identifiers, contacts and photos are dated. Contacts are private by default and never rendered. `references[].person` links a reference to a people entry.
- **`recommendations`** hold:
  - the verbatim text, and highlights checked to be verbatim;
  - a date or date-time (with an offset);
  - the relationship, linked to the job or service;
  - `authorAt`, the source and the author's consent.

  `authorAt` is checked against the author's dated roles.
- **`endorsements`** of a skill, credential or badge, with an optional Open Badges 3.0 EndorsementCredential.
- **Consent scope** (`full`, `highlights`, `nameOnly`, `anonymous`) is applied in every output. An item without the author's consent is never rendered.
- **Stricter in 2.6.0:** a non-private recommendation or endorsement without `consent.given` is an error (a warning before).

### Badges
- **`badges`**, described in Open Badges 3.0 terms:
  - achievement, type, criteria and alignments;
  - issuer and validity;
  - the issuer's original credential kept byte for byte, with its hash;
  - verification status;
  - `credentialRef` and `awardedFor`.
- **`profile badges import`** reads Open Badges 3.0 (JSON-LD, VC-JWT), Open Badges 2.0 (hosted, signed) and baked PNG and SVG. A URL is fetched only with `--fetch`.
- **`verifyBadge`** re-fetches Open Badges 2.0 hosted assertions, and only when given a fetcher. Signature checks for the other formats are not implemented yet and say so.
- Alignments to O*NET and SOC are checked like occupation codes.
- **Stricter in 2.6.0:** "verified" needs the method and the time it was checked.

### Outputs and releases
- **schema.org:** `ProfilePage.review` (Recommendation). Badges appear as `EducationalOccupationalCredential` with `credentialCategory: "badge"`.
- **JSON Resume:** recommendations go to `references` and badges to `certificates`. The output still validates against the upstream schema.
- **LinkedIn sheet:** badges under Licenses & certifications, and a Credential URL for credentials too. A Recommendations list.
- **brief:** up to two featured quotes and three badges.
- **Audiences:** new section grants `recommendations`, `endorsements` and `badges`, and a new person grant `personContacts`. A release carries only the people its items refer to, without their contacts or email identifiers unless that grant is present.
- A date-time formats as its date in every output.

### Hardening (from the whole-branch review)
- `media add` and `badges import` refuse an id that isn't a plain id, and never overwrite or delete a file they didn't create.
- `media add` versions only `<id>` and `<id>-vN`, so "head" is no longer taken for a version of "head-vintage".
- The anonymous scope shows the author's title alone, without the employer.
- A private or draft photo is never used as the output's image.
- Bundle links on other people's photos and on badge images are checked: existence, escape, hash and GPS.
- Damaged PNG and JPEG files are reported as unreadable instead of crashing validation. Stripping GPS never writes outside the EXIF block, and the result is re-checked.
- A recommendation or endorsement shared with a named audience needs the author's consent too. Releases leave out any recommendation or endorsement without consent, so the consent receipt lists only what was sent.

### Repository
- `examples/recommended/`: a fictional bundle made entirely by `scripts/make-fixtures.mjs`. CI regenerates it and its outputs and fails on any difference.
- US English throughout the documentation and the schema's descriptions.

## 2.5.0 (2026-11-09): occupation, industry and skill codes; fixes from building a real profile

Built while modeling a real founder's record (a CV, a newspaper article, his own account, a pitch deck and a live LinkedIn profile). Earlier files remain valid. A file that declares 2.5.0 is held to one stricter check: high confidence can't rest on self-reported evidence alone.

### Codes
- **Occupation codes** (`occupations`) on work, service, positions and responsibilities: U.S. SOC (kept by the Bureau of Labor Statistics), O*NET-SOC, ISCO, ESCO, NOC, ANZSCO, with `match` (primary, secondary, related) and an internal `rationale`.
- **Skill codes** (`codes`) on skills: O*NET content-model elements (skills, knowledge, software), ESCO, Lightcast. `escoUri` still works.
- **Industry codes:** organizations' existing NAICS `classifications` are now checked.
- **Bundled lists** in `data/`: SOC 2018, O*NET-SOC and O*NET 31.0 (August 2026) elements (CC BY 4.0), NAICS 2022, built by `scripts/build-code-lists.mjs`, which records the SHA-256 of each input file in the output. Unknown codes are errors; group-level SOC codes, wrong titles, two primaries and mismatched O*NET/SOC pairs are warnings; other editions are accepted unchecked.
- **Outputs:** schema.org `occupationalCategory` and coded `knowsAbout` terms; SOC codes per job in the `verification` mapping.

### Privacy and consent
- **Releases need consent.** `release` refuses, and `buildRelease` throws `ReleaseRefusedError`, unless `meta.subjectConsent.given` is true. Before, a profile its subject hadn't approved could be released to a third party; only a warning was shown.
- **Internal notes:** `note` on entries, positions, responsibilities, metrics and organizations. Never rendered or released. Rulings like "show without dates, per the subject" no longer have to be stored as open questions or citation notes.
- **Self-reported evidence is capped at medium confidence** in 2.5.0 files (an error, a warning in older files). The schema.org mapping now takes medium confidence too: a profile page is the person's own account.
- **JSON Resume is public-only by default** (it was public and network); usually it ends up on a public site.

### Audiences
- `organizations`: several fixed recipients, any one of which qualifies.
- `recipients: "anyVerified"`: anyone who passes the audience's verification methods, with the recipient named on the release (`--recipient`). New verification method `invitation`. An email address alone never qualifies.

### Outputs
- **Uncertain dates** read "between Oct 2025 and Dec 2025" (translated) instead of "Oct 2025/Dec 2025".
- **`bundle:` links** are rewritten against `meta.mediaBaseUrl` (or `--media-base`) or left out. Before, the bundle path was written into public JSON-LD and JSON Resume.
- **Organization alternate names** no longer repeat the name shown.
- **LinkedIn sheet:**
  - adds Projects, Publications, Languages, and press about you under Featured;
  - lists military service under Experience, with highlights, instead of under Volunteering;
  - adds a "Before you paste" list of what LinkedIn will refuse: a missing start date, an uncertain date, a year without a month, military service without a title, credentials without an issuer, press without a link.
- **`--visibility`** on `convert` (and `visibility` in `convert()` options) replaces a mapping's visibility filter.

### Command line
- Errors are one plain line (`error: …`; `TURNROW_DEBUG=1` for the stack). A refused release exits 4.
- `release --record` on a bundle folder writes the record into its `profile.json`. Before, it tried to write to the folder path and failed.
- `open` also lists open questions on approved entries (as `question`), and `validate` counts them separately. `open` on an invalid file now reports the errors; before, it said "Nothing waiting on confirmation".

## 2.4.0 (2026-11-07): review hardening, localization and model gaps

A critical review of 2.0–2.3 from several angles: security, privacy, localization, coverage of real careers, and release hygiene. Backwards compatible: earlier files remain valid, except links that weren't http(s), which are now refused (see Security).

### Security
- **schema.org output is HTML-safe.** `<`, `>`, `&`, U+2028 and U+2029 are escaped, so the JSON-LD can sit in a `<script>` element. Before, profile text containing `</script>` could break out of the element and inject script into the page. Any mapping can opt in with `htmlSafe: true`.
- **Links must be http(s).** Every URL field rejects `javascript:`, `data:` and other schemes; media, images and pronunciation audio may also be `bundle:` paths. The JSON Resume importer drops links that aren't web addresses.
- **Symbolic links can't escape a bundle.** Bundle files are checked after resolving symbolic links, so a link inside the bundle can't make the validator read a file elsewhere.
- **Write-back checks incoming values.** Malformed dates, oversized text, control characters and unknown statuses are rejected one by one (action `rejected`, with a reason), and a write-back never returns a profile that fails validation.

### Privacy
- `person.visibility` sets the visibility of individual person fields: headline, job title, summary, short bio, image, location, pronouns, industry, website and profiles. Hidden fields are removed before any mapping reads them. A grant to a named audience still shares the field with that audience.
- Warnings when a career break for health reasons, or a security clearance, is public.
- JSON-LD objects left with nothing but `@type` (because their content was hidden) are dropped instead of rendered empty.

### Localization
- Dates and numbers are formatted with `Intl` in the output's locale ("mar 2024", "März 2024", "12.500").
- The fixed words in outputs ("Present", "c.", "before", "(now …)", "doing business as", "Continued:", "Acquired by …" and the rest) come from translation tables for English, Spanish, French, German and Portuguese, falling back to English. English output is unchanged.

### Model
- **Dated names:** `names[].from` and `to`, for names changed by marriage or legal change. The `verification` mapping lists the names used during each job (`namesUsed`).
- **Name pronunciation:** `names[].pronunciation` (respelling, IPA, audio), shown on the LinkedIn sheet and in the SCIM profile extension.
- **Career breaks:** a `careerBreak` timeline type with a reason (caregiving, parental leave, education, travel, health, relocation, layoff, sabbatical, military, volunteering, personal). Listed on the LinkedIn sheet.
- **Credentials by jurisdiction:** `jurisdiction` (a Texas PE license, a state bar) and `compactStates`.
- **Publications:** kinds `patent`, `patentApplication`, `dataset`, `software`, `thesis` and `report`, plus `doi`, `isbn`, `number`, `authors` and `role` (author, co-author, inventor…).

### Project
- `SECURITY.md` explains how to report a vulnerability or a privacy problem. `ROADMAP.md` lists what the review found but this release doesn't do.
- Git tags and GitHub releases for every version.
- 13 new tests (106 total).

## 2.3.0 (2026-11-07): registry and tax identifiers

Backwards compatible: earlier files remain valid.

### Added
- **Identifier schemes, with a format check for each:**
  - US federal: EIN, UEI (SAM.gov), D-U-N-S, CAGE/NCAGE, SEC CIK, NPI, IPEDS.
  - State: entity number (Secretary of State file, charter or UBI), state tax id (taxpayer number, Oregon BIN…) and other state business ids. These must name their state (`jurisdiction: "US-TX"`), because formats vary state by state; `label` records what the state calls it.
  - International: LEI, VAT, ABN, Canada BN, SIREN, SIRET, and national company numbers (which need a jurisdiction).
  - Reference: Wikidata, ROR, OpenCorporates, ticker, ISIN, FIGI.
- Identifiers carry `jurisdiction`, `label`, `issuer`, `url`, `status`, dates, `visibility` and `audiences`.
- **Privacy defaults:** EINs and state tax ids are private unless their visibility says otherwise or they name an audience (an employment-verification audience, say). Registry ids are public. Releases carry only the identifiers the audience may see.
- **Checks beyond the formats:**
  - LEI check digits (ISO 7064 MOD 97-10);
  - a warning when the same identifier appears on two organizations (probably one entity: merge them and use names and events);
  - a warning when an EIN is made public.
- `organizations[].classifications`: NAICS, SIC, NACE, ISIC and ANZSIC codes.
- **Personal government ids are refused:** `person.identifiers` rejects keys like ssn, itin, passport or driver's license. A profile is meant to be shared, and those numbers don't belong in it.
- `mappings/verification.json`, for employment-verification releases. Each job gives:
  - the employer's legal name at the time, its trading name and today's name;
  - its EIN and DUNS as of the job's start, today's UEI, and state entity numbers;
  - the employer of record, dates and official titles.
- schema.org output: the current employer gets `leiCode`, `duns`, `naics`, `taxID` (only if public) and other ids as `PropertyValue` identifiers.
- Converter helpers: `orgIdentifiers`, `orgIdentifier` (the id in force on a date, defaulting to the output date), `orgClassification`.

### Fixed
- A job without positions now takes its official title from the employer's record.
- Releases resolve "now" (current names, identifiers in force) on the release date, not the clock date.

## 2.2.0 (2026-11-07): organization history, positions and responsibilities

Backwards compatible: 2.0.0 and 2.1.0 files remain valid.

### Added
- **Organization history.** An organization keeps one id while everything else about it changes:
  - `names` with dates and types (legal, brand, trade name, abbreviation, localized);
  - `domains` with dates and a status (primary, redirect, retired);
  - `identifiers` with dates (Wikidata, LEI, D-U-N-S, SEC CIK, company number, ticker…);
  - `parents` with dates (subsidiary, division, business unit, member firm);
  - `locations` with roles; `founded` and `dissolved`.
- **`organizationEvents`**: mergers, acquisitions, spin-offs, split-offs, splits, division transfers, renames, rebrands, trade names, reincorporations and dissolutions. Each lists the organizations before and after, and `recordsTo` says which successor of a split holds employment records. Events carry citations, status and confidence like any other fact.
- **Employer names in each output's style** (`orgNameStyle` on a mapping):
  - `atTheTime` — the name when you were there, following any merger that had already happened;
  - `today` — following events to the current successor;
  - `both` — "Coopers & Lybrand (now PwC)";
  - `legal` — "CSI (doing business as Buchanan Associates)", for background checks.
- **Positions** (`work[].positions`): titles within one job, with how each began (hire, promotion, re-title, lateral move, transfer, reorganization, acquisition, merger, demotion, return), official title, level, unit and manager.
- **Responsibilities** (`work[].responsibilities`): duties that apply by date or by named positions, so they carry through promotions and re-titles. Outputs mark them "Continued". `scope` figures carry `from` and `to` dates and appear only for the positions they applied to.
- `work[].employerOfRecord`, for staffing agencies, PEOs and parent companies.
- `metric.from` / `metric.to`; `source.url`.
- Converter helpers: `employer`, `orgNameAt`, `orgNow`, `orgAlternateNames`, `tenureNotes` ("Acquired by HP (Aug 2008)"), `positions`, `flatPositions`, `responsibilityLines`, `joinLines`, `concatLists`.
- `examples/history.profile.json`: a fictional person at three real companies (EDS → HP → HPE → DXC; Coopers & Lybrand → PwC; Buchanan), with company histories cited to public sources.

### Changed
- **Audiences follow history.** A requester qualifies if its domain is live on the request date for the bound organization, for a parent that owns it on that date, or for its successor. DXC can verify EDS employment today, HP could in 2012, and nobody can through the retired `eds.com`. Retired domains never qualify.
- Releases carry the history (events, parents, successors) of the organizations they mention, so names resolve the same way for the recipient.
- JSON Resume, schema.org and timeline outputs list one entry per position. LinkedIn groups positions under the company, with "Company at the time", the company to search LinkedIn for, and "Changes while there".
- `convert` and the CLI take an `on` date, so "now" names are reproducible.
- 20 new tests (78 total).

## 2.1.0 (2026-11-07): audiences, employer releases and write-back

Backwards compatible: 2.0.0 files remain valid.

### Added
- **Audiences** (`audiences`): named recipients that qualify by relationship, so "my current employer" follows you from job to job and lapses when you leave. Each audience has:
  - a purpose;
  - grants for person-level fields and sections;
  - a baseline visibility (`baseVisibility`);
  - accepted verification methods, kept separately for releasing and for write-back;
  - an expiry;
  - field authority rules for write-back.
- Entries can name audiences (`audiences: [...]`) to share something otherwise private with one recipient only.
- `organizations[].domains`, used to recognise a requester.
- `work[].employerRecord`: the employer's own record of the job (official title, department, division, cost center, employee number, position, manager, work location, status, hire date). It is released only to an audience bound to that job.
- **Releases** (`releases`, `lib/release.mjs`, `turnrow-profile release`): builds an audience-scoped payload in any mapping's format, with a consent receipt (recipient, purpose, what was shared, expiry, SHA-256 of the payload) and a record for the profile's release log.
- **SCIM 2.0 mapping** (`mappings/scim.json`): the core User, the Enterprise User extension, and a `urn:turnrow:…:profile:2.0:User` extension (pronouns, preferred title, skills, languages and more), for employee directories and identity providers.
- **Write-back** (`lib/writeback.mjs`, `turnrow-profile writeback`): an employer's SCIM User becomes claims cited to its system of record (primary evidence).
  - Employer-authoritative fields are accepted; the previous value is kept as an unaccepted claim.
  - On a locked job, existing values are kept and the employer's value is flagged for review (empty fields can still be filled). Subject-authoritative fields are always flagged for review.
  - Changes to person-level fields are returned as suggestions and never applied.
- `lib/audience.mjs`: resolves audiences on a date, checks requesters against policy (method and domain, including subdomains) and looks up field authority. An email address alone can never authorize write-back.
- Validator checks for audience, release and employer-record consistency.
- `examples/employee.profile.json` (fictional) with a sample SCIM write-back and outputs; 22 new tests (58 total).

## 2.0.0 (2026-11-07): Turnrow Profile Schema

First public release of this fork. The repository no longer defines the JSON Resume schema: it defines the Turnrow Profile, a superset with an evidence model, and treats JSON Resume as one of several output formats.

### Added
- `schema/profile.schema.json` (JSON Schema draft 2020-12), with:
  - `visibility`, `status`, `confidence`, `priority`, `citations`, `claims`, `openQuestion`, `lock`, `attribution` and per-target overrides on every entry
  - structured `metrics` that can be confirmed or disputed on their own
  - fuzzy dates (about, before, after, estimated, between)
  - multiple name forms; a `places` registry with coordinates and Wikidata/GeoNames ids
  - `timeline` events; `service` for military, scouting, volunteer and board work
  - content `rules` (forbidden phrases and patterns, negative assertions)
  - `sources` with evidence quality; profile bundles with checksums
  - localized text; required image alt text
- `lib/validate.mjs`: cross-reference, claim, consent and bundle checks on top of the schema.
- `lib/convert.mjs` and `mappings/`: declarative conversion to JSON Resume, schema.org JSON-LD, a LinkedIn paste sheet, a short bio and a timeline, with rule enforcement.
- `lib/import-jsonresume.mjs`: import an existing JSON Resume as a draft profile.
- `bin/profile.mjs`: `validate`, `open`, `convert` and `import` commands.
- A fictional sample profile and its generated outputs; a `node --test` suite; CI on Node 20 and 22.

### Changed
- The JSON Resume schema files moved to `upstream/jsonresume/` and were refreshed to JSON Resume 1.7.1 from the jsonresume.org monorepo. They are unmodified and serve as the compatibility target for export and import.
- Removed the upstream semantic-release and npm publish workflows. The package is marked private until there is a decision to publish.

---

# Upstream history (JSON Resume)

<a id="1.0.0"></a>
## [WIP], Version 1.0.0

### [Discussion: Planning 1.0](https://github.com/jsonresume/resume-schema/issues/372)

---

<a id="0.0.0"></a>
## [2014-07-30, Version 0.0.0]((https://github.com/jsonresume/resume-schema/blob/0.0.0/schema.json))

### Changes
* [[v0.1.3] - add `education.url`](https://github.com/jsonresume/resume-schema/releases/tag/v0.1.3)
* [[v0.1.2] - add `$schema` property](https://github.com/jsonresume/resume-schema/releases/tag/v0.1.2)
* [[v0.1.1] - better dates](https://github.com/jsonresume/resume-schema/releases/tag/v0.1.1) - [Discussion](https://github.com/jsonresume/resume-schema/issues/142)
* [[v0.0.17]](https://github.com/jsonresume/resume-schema/commit/a6d1ae5c990e3370de6ca305ef32477b9516391b)
  * [[675972] - add `location` to work entries](https://github.com/jsonresume/resume-schema/pull/291)
  * [[ded5de] - move to entity description](https://github.com/jsonresume/resume-schema/pull/271)
  * [[b885dd] - move from `company` to `name`](https://github.com/jsonresume/resume-schema/pull/270)
  * [[9c965e] - Use `image` instead of `picture`](https://github.com/jsonresume/resume-schema/pull/268)
  * [[fb876d] - rewrite `website` to `url`](https://github.com/jsonresume/resume-schema/pull/267) - [Discussion](https://github.com/jsonresume/resume-schema/issues/266)
  * [[d996db] - add `project` section to the schema](https://github.com/jsonresume/resume-schema/pull/254) - [Discussion](https://github.com/jsonresume/resume-schema/issues/201)
  * [[720393] - company description](https://github.com/jsonresume/resume-schema/pull/261)
  * [[a26a72] - Add `lastModified` to meta](https://github.com/jsonresume/resume-schema/pull/259)
  * [[ec76c1] - meta `version`](https://github.com/jsonresume/resume-schema/pull/258)
  * [[230260] - Use `canonical` instead of `url`](https://github.com/jsonresume/resume-schema/pull/257)
  * [[de6067] - `meta` was added](https://github.com/jsonresume/resume-schema/pull/237) - [Discussion](https://github.com/jsonresume/resume-schema/issues/204)
  * [[8d316c] - updated `language' properties](https://github.com/jsonresume/resume-schema/pull/149) - [Discussion](https://github.com/jsonresume/resume-schema/issues/145)
  * [[a1bc56] - changes `website` -> `url`](https://github.com/jsonresume/resume-schema/pull/155) - [Discussion](https://github.com/jsonresume/resume-schema/issues/148)
* [[v0.0.12]](https://github.com/jsonresume/resume-schema/commit/f18c18743ac1903761b80851393a3a756dc327e4)
  * [[f02300] - `languages` was added](https://github.com/jsonresume/resume-schema/commit/f02300e36ba076787d008928b29963c3ffce6121) - [Discussion](https://github.com/jsonresume/resume-schema/issues/34)
  * [[1c93f1] - `hobbies` was renamed to `interests`](https://github.com/jsonresume/resume-schema/commit/1c93f11f121df3794ad59a99cfbd42e7948201c4)
  * [[dee007] - `volunteer` was added](https://github.com/jsonresume/resume-schema/commit/dee007c2e373645b6b67d07a92aebf22fda5b95a) - [Discussion](https://github.com/jsonresume/resume-schema/issues/43)
  * [[b1b62f] - `summary` was added to `awards`](https://github.com/jsonresume/resume-schema/commit/b1b62fb425f4ad8b13ad4612d658bdd203f51206) - [Discussion](https://github.com/jsonresume/resume-schema/issues/119)
  * [[7bde1b] - `summary` was added to `publications`](https://github.com/jsonresume/resume-schema/pull/129) - [Discussion](https://github.com/jsonresume/resume-schema/issues/126)
  * [[818051] - `profiles` was changed to a type array instead of an object](https://github.com/jsonresume/resume-schema/pull/116) - [Discussion](https://github.com/jsonresume/resume-schema/issues/6)
  * [[1a97f0] - `bio` was renamed to `basics`](https://github.com/jsonresume/resume-schema/pull/117) - [Discussion](https://github.com/jsonresume/resume-schema/issues/68)
  * [[bb0171] - `address` and `postalCode` were added to `location`](https://github.com/jsonresume/resume-schema/pull/110) - [Discussion](https://github.com/jsonresume/resume-schema/issues/76)
  * [[a236a3] - `awardDate` was changed to `date`](https://github.com/jsonresume/resume-schema/pull/107) - [Discussion](https://github.com/jsonresume/resume-schema/pull/107)
  * [[7e53c3] - `websites` was changed to `website`, changed from object into string](https://github.com/jsonresume/resume-schema/pull/101) - [Discussion](https://github.com/jsonresume/resume-schema/issues/10)
  * [[277c0d] - specified that `countryCode` conforms to ISO standard](https://github.com/jsonresume/resume-schema/pull/78) - [Discussion](https://github.com/jsonresume/resume-schema/pull/78)
  * [[24b0bb] - `region` replaced `state` as the default](https://github.com/jsonresume/resume-schema/pull/99) - [Discussion](https://github.com/jsonresume/resume-schema/issues/19)
  * [[011b4a] - `picture` was added to the `bio` object](https://github.com/jsonresume/resume-schema/pull/80) - [Discussion](https://github.com/jsonresume/resume-schema/issues/29)
  * [[0d4ae8] - `gpa` was added to `education` objects](https://github.com/jsonresume/resume-schema/pull/97) - [Discussion](https://github.com/jsonresume/resume-schema/issues/7)
  * [[afc937] - `email` and `phone` were changed from objects into strings](https://github.com/jsonresume/resume-schema/pull/98) - [Discussion](https://github.com/jsonresume/resume-schema/issues/27)
  * [[717b2a] - `firstName` and `lastName` were merged into `name`](https://github.com/jsonresume/resume-schema/releases/tag/v0.0.12) - [Discussion](https://github.com/jsonresume/resume-schema/issues/4)
* [[v0.0.10] - Add `bio.label`](https://github.com/jsonresume/resume-schema/releases/v0.0.10)
* [[v0.0.7] - Remove `skills.releaseDate`](https://github.com/jsonresume/resume-schema/releases/tag/v0.0.7)
* [[v0.0.6] - Schema First Draft](https://github.com/jsonresume/resume-schema/releases/tag/v0.0.6)
