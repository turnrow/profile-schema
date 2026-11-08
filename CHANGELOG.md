# Changelog

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
- **Personal government ids are refused:** `person.identifiers` rejects keys like ssn, itin, passport or driver's licence. A profile is meant to be shared, and those numbers don't belong in it.
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
- `work[].employerRecord`: the employer's own record of the job (official title, department, division, cost centre, employee number, position, manager, work location, status, hire date). It is released only to an audience bound to that job.
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
