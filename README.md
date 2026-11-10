<p align="center">
  <picture>
    <source srcset="brand/svg/profile-schema-lockup-dark.svg" media="(prefers-color-scheme: dark)">
    <img src="brand/svg/profile-schema-lockup-light.svg" alt="Profile Schema" width="420">
  </picture>
</p>

# Profile Schema, a Turnrow Solution

[![CI status](https://github.com/turnrow/profile-schema/actions/workflows/ci.yml/badge.svg)](https://github.com/turnrow/profile-schema/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/turnrow/profile-schema?label=version&color=023341)](CHANGELOG.md)
[![JSON Schema draft 2020-12](https://img.shields.io/badge/JSON%20Schema-2020--12-023341)](schema/profile.schema.json)
[![Exports to JSON Resume 1.7.1](https://img.shields.io/badge/JSON%20Resume-1.7.1-023341)](upstream/jsonresume/)
[![Node.js 20 or later](https://img.shields.io/badge/node-%3E%3D20-023341?logo=nodedotjs&logoColor=white)](package.json)
[![MIT license](https://img.shields.io/badge/license-MIT-023341)](LICENSE.md)
[![Design system: WCAG AAA](https://img.shields.io/badge/design%20system-WCAG%20AAA-023341)](brand/README.md)

One JSON file holds a person's whole professional record. Every output (a JSON Resume, schema.org JSON-LD for a profile page, a LinkedIn paste sheet, a slide bio, a timeline or map) is a filtered, mapped view of that file. Fix a fact once and every output picks it up.

It starts from [JSON Resume](https://jsonresume.org) and adds an evidence model taken from genealogy, where conflicting sources are the norm ([GEDCOM 7](https://gedcom.io) and [GEDCOM X](https://www.familysearch.org/developers/docs/api/gx_json)). Every fact records:

- **where it came from** (citations to sources, with a quality grade),
- **what each source says** when they disagree (competing claims, with one accepted and the reason why),
- **how sure we are** (confidence: high, medium or low),
- **where it stands in review** (status: draft, pending, approved, disputed or retired),
- **who may see it** (visibility: public, network or private).

Outputs choose what they accept. The public JSON-LD takes only approved, public facts at high or medium confidence, so an unconfirmed number or a private phone number never reaches the open web by accident. Confidence is honest: from 2.5, something resting only on your own word (a CV, your own account) can be medium at most; high needs a document, a publication or another person.

```sh
npm install
node bin/profile.mjs validate examples/sample.profile.json
node bin/profile.mjs open     examples/sample.profile.json          # what still needs confirming
node bin/profile.mjs review   examples/sample.profile.json --out review.md   # the whole profile, for checking (internal)
node bin/profile.mjs convert  examples/sample.profile.json schemaorg  # or jsonresume, linkedin, brief, timeline
node bin/profile.mjs convert  examples/sample.profile.json brief --locale es
node bin/profile.mjs convert  examples/sample.profile.json jsonresume --visibility public,network  # override which entries go in
node bin/profile.mjs convert  my-bundle/ schemaorg --media-base https://example.com/me/   # publish bundle: images
node bin/profile.mjs import   my-resume.json --out my.profile.json   # start from an existing JSON Resume
node bin/profile.mjs media add my-bundle/ headshot.jpg --id headshot --alt "…" --purpose primary --from 2024-01 [--strip-gps]   # add a photo, hashed and versioned
```

`node bin/profile.mjs help` lists every command and option. Commands and day-to-day tasks are in the [command reference](#command-reference) below.

The sample is a **fictional** person built to exercise every feature. Its outputs are in [`examples/out/`](examples/out/).

## What it adds to JSON Resume

| Need | How the schema handles it | Borrowed from |
|---|---|---|
| Keep private facts private | `visibility` on every entry, metric, name and profile link. Email, phone and credential numbers default to private. | |
| Don't publish what isn't confirmed | `status` on every entry and metric. Pending and disputed items must carry an `openQuestion`. | |
| Know where each fact came from | `citations` point to `sources`; each citation carries an evidence `quality` (primary, secondary, selfReported, published, hearsay). | GEDCOM QUAY, GEDCOM X SourceReference |
| Keep both sides when sources disagree | `claims`: each source's value for a field. At most one is `accepted`, and the field must equal it. With conflicting values and none accepted, the entry must be `disputed`. | GEDCOM X evidence vs. conclusion |
| Separate "how sure" from "where in review" | `confidence` (high, medium, low) apart from `status`. The validator warns when confidence is high but every citation is self-reported. | GEDCOM X ConfidenceLevel |
| Dates as precisely as they are known | `fuzzyDate`: `1996`, `{"value": "1996", "qualifier": "about"}`, `{"between": ["1990", "1991"]}`, before, after, estimated. Formats that only state exact dates (JSON Resume, JSON-LD) leave qualified dates out instead of overstating them. | GEDCOM date qualifiers |
| More than one name | `person.names`: preferred, legal, birth, professional, nickname, alsoKnownAs, transliteration, native, each with language, script and visibility. | GEDCOM X NameForm |
| The story, not just the jobs | `timeline` events: journeys, voyages, residences, foundings, firsts, with places, metrics and links to related entries. | GEDCOM events |
| Unambiguous places | `places` with coordinates, Wikidata/GeoNames ids and historical names, referenced by id. | GEDCOM PLAC, GEDCOM X PlaceDescription |
| Statements that are not true | `rules`: forbidden phrases, forbidden patterns and negative assertions (`notTrue`). Converters refuse to emit output that breaks a rule. | GEDCOM negative assertions |
| Approval that sticks | `lock` records who approved an entry and when; a later change must go back for approval. | GEDCOM RESN LOCKED |
| Who changed what | Optional `attribution` per entry (or rely on git). | GEDCOM X Attribution |
| Evidence kept with the data | A **profile bundle**: a folder with `profile.json` and a `media/` folder. `bundle:media/…` URLs resolve inside it, and `sha256` checksums are verified. | GEDZip |
| Localization | Any text field is a string or a map of BCP 47 tags (`{"en-US": "…", "es": "…"}`), with fallback to the default locale. | GEDCOM X `lang` |
| Accessibility | `alt` is required on every image. | |
| Short and long views from one file | `priority` (0–100), structured `metrics`, and per-target `targets.<name>` overrides or omission. | |
| Organizations written once | `organizations` map, referenced by id, with `sameAs` links. | |
| Organizations that change | Dated names, domains, identifiers and parents; `organizationEvents` for mergers, acquisitions, splits and rebrands; employer names in each output's style. | GEDCOM X place jurisdictions over time; Wikidata "replaces"/"replaced by" |
| Registry and tax ids | EIN, UEI, DUNS, CAGE, LEI, state entity and tax numbers and more, with format checks, dates and privacy defaults (tax ids private). | GEDCOM EXID |
| Titles and duties within a job | `positions` with how each began; `responsibilities` that continue through promotions, with dated scope. | |
| Military, scouting, volunteer and board work | `service`, its own section, so each output decides where it goes. | |
| Study that didn't end in a degree | `education.completed: false`, so no output implies a degree. | |

## Organizations change; your history shouldn't

Companies rename, rebrand, merge, get acquired, split and dissolve. Each organization keeps one id while its names, domains, owners and identifiers change around it, and `organizationEvents` link it to what came before and after. A job always points at the organization you actually worked for.

```json
"eds": {
  "name": "EDS",
  "names": [
    { "name": "Electronic Data Systems Corporation", "type": "legal", "to": "2008" },
    { "name": "EDS, an HP Company", "type": "brand", "from": "2008-08-26", "to": "2009-09-23" },
    { "name": "HP Enterprise Services", "type": "brand", "from": "2009-09-23", "to": "2015-11-01" }
  ],
  "domains": [ { "domain": "eds.com", "status": "retired" } ],
  "parents": [ { "organization": "hp", "relation": "subsidiary", "from": "2008-08-26", "to": "2015-11-01" } ]
}
```

```json
{ "id": "dxc-formed", "type": "merger", "date": "2017-04", "predecessors": ["eds", "csc"], "successors": ["dxc"] }
```

Each output names employers in its own style (`orgNameStyle`):

| Style | Example | Use |
|---|---|---|
| `atTheTime` | Coopers & Lybrand | Résumés, reference letters, timelines |
| `today` | PwC | Search, matching a company page |
| `both` (default) | Coopers & Lybrand (now PwC) | Most outputs |
| `legal` | CSI (doing business as Buchanan Associates) | Background checks, which match the legal entity on your W-2 |

The LinkedIn sheet gives both the name at the time and the company to search for today, and lists what changed while you were there ("Acquired by HP (Aug 2008)").

**Audiences follow history too.** Only domains live on the request date qualify, and retired domains never do (an expired domain can be bought by anyone). A requester can speak for a past employer if it is the employer, a parent that owns it on that date, or its successor. In the example, DXC can verify EDS employment today, HP could in 2012, and `eds.com` never can. For a split, `recordsTo` says which successor holds the records.

Identity is always the id, never the name: two companies can share a name ("CSI"), and a famous name can be reused by an unrelated company.

## Registry and tax identifiers

Organizations carry the ids that registries and tax authorities issue, each checked against its format:

| Kind | Schemes |
|---|---|
| US federal | `ein`, `uei` (SAM.gov), `duns`, `cage`, `secCik`, `npi`, `ipeds` |
| US state | `stateEntityNumber` (Secretary of State file/charter number, Washington UBI…), `stateTaxId` (state taxpayer number, Oregon BIN…), `stateBusinessId`; each needs `jurisdiction` (`US-TX`) and usually a `label` |
| International | `lei` (check digits verified), `vat`, `abn`, `bn`, `siren`, `siret`, `companyNumber` (with `jurisdiction`) |
| Reference | `wikidata`, `ror`, `opencorporates`, `ticker`, `isin`, `figi`, `other` |

```json
"identifiers": [
  { "scheme": "ein", "value": "98-7654321", "audiences": ["former-employers"] },
  { "scheme": "duns", "value": "123456789", "to": "2022-04-04", "status": "replaced" },
  { "scheme": "uei", "value": "VN1AJFAD19J9", "from": "2022-04-04" },
  { "scheme": "stateEntityNumber", "value": "603123456", "jurisdiction": "US-WA", "label": "Washington UBI" }
]
```

- **Tax ids are private by default.** An EIN or state tax id appears only where its visibility allows, or in a release to an audience it names. For a sole proprietor, an EIN identifies a person. Registry ids (UEI, DUNS, LEI, CAGE, state entity numbers) are public.
- **Dates matter.** `orgIdentifier` returns the id in force on a date, so a DUNS retired in 2022 isn't presented as current, while a verification of a 2019 job still gets the DUNS from then.
- **Personal government ids are refused.** SSNs, ITINs, passport and driver's license numbers can't be stored as person identifiers.
- **The `verification` mapping** gives what background checks match on: the employer's legal name at the time, its EIN (where shared), state entity numbers, the employer of record, dates and official titles.
- `classifications` hold NAICS, SIC, NACE, ISIC or ANZSIC codes.

## Positions and responsibilities

A job is one relationship with an employer. **Positions** are the titles held within it, with how each began: hire, promotion, re-title, lateral move, transfer, reorganization, acquisition, merger, demotion or return. A re-title or an acquisition can change the name of a job without changing the job.

**Responsibilities** are duties, and they don't stop at a promotion. Each applies by its dates, or by naming the positions it covers, so one responsibility can run through several titles. Outputs list it under each position it applied to, marked "Continued" after the first. Its `scope` figures carry dates, so "3 engineers" shows under the position where that was true and "8 engineers" under the later one.

```json
{
  "id": "release-team", "kind": "leadership", "summary": "Led the release-engineering team.",
  "startDate": "2007-04", "endDate": "2011-03",
  "scope": [
    { "id": "team-2007", "label": "engineers", "value": 3, "from": "2007-04", "to": "2009-06" },
    { "id": "team-2009", "label": "engineers", "value": 8, "from": "2009-07", "to": "2011-03" }
  ]
}
```

JSON Resume and schema.org have no nested positions, so they get one entry per position. The LinkedIn sheet groups positions under the company, the way LinkedIn shows them. A job without positions behaves as a single position. For staffing agencies, PEOs and parent companies, `employerOfRecord` records who legally employed you.

## Occupation, industry and skill codes

Jobs, positions and responsibilities can carry **occupation codes**; organizations carry **industry codes**; skills carry **skill codes**. They let a profile line up with labour-market data, job boards and background-check forms without retyping anything.

| Where | Field | Systems | Checked against |
|---|---|---|---|
| Work, service, a position, a responsibility | `occupations` | `soc` (U.S. SOC, kept by the Bureau of Labor Statistics), `onetSoc` (O*NET-SOC), `isco`, `esco`, `noc`, `anzsco` | SOC 2018 (all 1,447 codes) and the O*NET-SOC 2019 taxonomy (1,016 codes) |
| Organizations | `classifications` | `naics`, `sic`, `nace`, `isic`, `anzsic` | NAICS 2022 (2,125 codes) |
| Skills | `codes` | `onet` (O*NET content-model elements: skills 2.A/2.B, knowledge 2.C, software 2.E), `esco`, `lightcast` | O*NET 31.0 elements |

```json
{
  "id": "acme-platform", "organization": "acme", "title": "Platform Engineering Lead",
  "occupations": [
    { "system": "soc", "code": "11-3021" },
    { "system": "onetSoc", "code": "11-3021.00" },
    { "system": "soc", "code": "15-1252", "match": "secondary" }
  ]
}
```

- **`match`** says how well a code fits: `primary` (the default), `secondary` (a real part of the work, like estimating for a construction manager), or `related` (the nearest code when none fits).
- **Codes can sit at any level.** A responsibility that differs from its job (installing a company's server system during a project-management job) gets its own code; a position can differ from the rest of the job (systems engineer years, then architect years). Outputs gather a job's codes from all three.
- **Validation:** unknown codes are errors. Warnings cover a SOC group used where a detailed occupation exists, a `label` that differs from the official title, two primary codes in one system, and an O*NET-SOC code that isn't under the primary SOC code. Codes from an edition the package doesn't bundle (SOC 2028 when it arrives, say) are accepted unchecked. `label` can be left out: outputs fill in the official title.
- **Outputs:** schema.org gets `occupationalCategory` (a `CategoryCode` with its code set; primary and secondary codes only, since a related code is a nearest fit, not a claim) on each position and `DefinedTerm`s for coded skills; the `verification` mapping lists each job's SOC codes; the LinkedIn sheet and JSON Resume have no place for them.

The lists are in [`data/`](data/), with their sources and licenses in [`data/README.md`](data/README.md). O*NET data is © the O*NET Resource Center, used under CC BY 4.0.

## Audiences: share different things with different recipients

Public, network and private cover the open web, signed-in views and nothing. Real recipients are narrower: your employer's directory, a recruiter, a client, a past employer verifying dates. **Audiences** name them and grant each one exactly what it should see.

```json
"audiences": {
  "current-employer": {
    "kind": "employer",
    "relation": "current",
    "purpose": "employeeDirectory",
    "person": ["name", "preferredName", "pronouns", "image", "email", "jobTitle", "shortBio"],
    "sections": ["skills", "languages", "credentials"],
    "baseVisibility": ["public", "network"],
    "verification": { "methods": ["oidc", "saml", "dnsTxt"], "writeBackMethods": ["oidc"] },
    "expires": "onSeparation",
    "writeBack": { "allowed": true }
  }
}
```

- **Qualification by relationship:** "current employer" resolves to whichever job is current, so it follows you to each new job, and access ends when the job does (`expires: "onSeparation"`). `former` covers past employers; `organization` or `workRef` names one directly.
- **Several recipients, or anyone you invite:** `organizations` lists several (a short list of funds, any one of which qualifies). `recipients: "anyVerified"` admits whoever passes one of the audience's verification methods, such as a single-use `invitation` you issued for a data room. The release names the recipient (`--recipient "Example Ventures"`), and an email address alone never qualifies.
- **Recognising the recipient:** organizations list their `domains`. The application verifies the requester (OIDC or SAML token from the employer's identity provider, a DNS TXT record or `.well-known` file, or a signed request), and `checkRequester` decides whether that method and domain qualify. A matching email address alone is the weakest proof and can never authorize write-back.
- **Grants:** an audience receives only the person-level fields and sections it lists. Entries are included when their visibility is in `baseVisibility`, and an entry can name an audience to share something otherwise private with that recipient only (a first-aid certificate for the employer's safety roster, say).
- **The employer's own record:** `work[].employerRecord` holds the official title, department, manager and internal ids as the employer records them. It goes only to an audience bound to that job, never to anyone else. Your own wording (`title`) stays alongside it.

### Releases and consent receipts

```sh
node bin/profile.mjs release examples/employee.profile.json current-employer \
  --format scim --domain acme.example --method oidc --application acme-directory \
  --out directory.json --receipt receipt.json --record
```

A release is refused unless `meta.subjectConsent.given` is true. It is the scoped payload plus a **consent receipt**: recipient, purpose, what was shared, expiry and the SHA-256 of the payload. `--record` appends it to the profile's `releases` log. Stopping a release stops future updates; copies already delivered stay with the recipient, and the receipt says so. The `scim` mapping produces a SCIM 2.0 User with the Enterprise User extension (employee number, department, division, cost center, manager), the format directories and identity providers already accept.

### Write-back: corrections from the employer

```sh
node bin/profile.mjs writeback examples/employee.profile.json current-employer examples/acme-writeback.scim.json \
  --domain acme.example --method oidc --out updated.profile.json
```

The employer's SCIM User is read as evidence, not as an overwrite. Each value becomes a claim cited to the employer's system of record (primary quality).

| Field | Default authority | Result |
|---|---|---|
| `employerRecord.*` (official title, department, manager, ids…), `startDate`, `endDate` | Employer | Accepted, with the previous value kept as an unaccepted claim. If the job is locked, existing values are kept and the employer's value is flagged for review; empty fields can still be filled. |
| `title` (your own wording) | You | Kept as a claim for review. |
| Name, preferred name, pronouns | You | Returned as suggestions, never applied. |

An audience's `writeBack.authority` can change these defaults field by field. Write-back requires a strong verification method (OIDC, SAML or a signed request by default).

**Out of scope here:** verifying tokens, DNS records and signatures is the application's job. This library decides whether what was verified satisfies the audience. Signed attestations (for example W3C Verifiable Credentials issued by the employer) fit naturally as primary-quality citations and are a likely next step.

## Command reference

Run the tool as `node bin/profile.mjs <command>`, or as `turnrow-profile <command>` once the package is installed or linked (`npm link`).

| Task | Command |
|---|---|
| Check a profile or bundle | `validate <profile \| bundle>...` |
| Check many at once (a shell glob works) | `validate profiles/*.json` |
| Get the result as JSON, for scripts and CI | `validate <profile> --json` |
| See what still needs confirming | `open <profile \| bundle>` |
| Get the whole profile as one file to check | `review <profile \| bundle> --out review.md` |
| Write an output | `convert <profile \| bundle> <mapping> [--out file]` |
| Write an accessible résumé PDF | `pdf <profile \| bundle> --out resume.pdf` |
| Start from a JSON Resume | `import <resume.json> --out my.profile.json` |
| Share with an audience, with a consent receipt | `release <profile> <audience> --method … --domain …` |
| Take an employer's corrections | `writeback <profile> <audience> <scim-user.json> --method … --domain …` |
| Add a photo to a bundle | `media add <bundle> <image> --id … --alt "…"` |
| Add an Open Badge to a bundle | `badges import <bundle> <file \| url>` |

Bundled mappings: `jsonresume`, `schemaorg`, `linkedin`, `brief`, `timeline`, `resume`, `scim`, `verification`. Pass a path ending in `.json` to use your own.

Options that apply widely: `--out <file>` (folders are created as needed), `--locale <tag>` (a BCP 47 tag such as `es` or `pt-BR`) and `--on <yyyy-mm-dd>` (the date an output is made for; default today, UTC). An option can be written `--out file` or `--out=file`. A misspelled option stops the command.

| Exit code | Meaning |
|---|---|
| 0 | Success. |
| 1 | A profile is not valid, or something went wrong (a missing file, bad JSON). |
| 2 | The command was used wrongly (an unknown command or option, a missing argument). |
| 3 | The output breaks one of the profile's content rules. |
| 4 | A release was refused (no consent, or the requester doesn't qualify). |

### Use it in your editor and in CI

- **Editor.** Point a profile's `$schema` at the schema file and editors that understand JSON Schema (VS Code among them) complete field names and flag mistakes as you type: `"$schema": "https://raw.githubusercontent.com/turnrow/profile-schema/main/schema/profile.schema.json"`, or a relative path, as the examples do.
- **CI.** `validate` checks every file it is given and exits 1 if any fails, so one step covers a folder: `node bin/profile.mjs validate profiles/*.json`.

### When something goes wrong

| Message | What to do |
|---|---|
| `"organisation" is not a known field here` | A field name is misspelled or is in the wrong place. Compare it with the schema or an example. |
| `must be equal to one of the allowed values: …` | Use one of the values listed. |
| `status is pending but openQuestion is missing` | Say what needs confirming in `openQuestion`, or change the status. |
| `is a zip archive: unzip it and pass the folder` | The tools read a bundle as a folder. |
| `Output breaks content rules` (exit 3) | An output contains something `rules` forbids. Fix the text, or pass `--allow-rule-violations` to see the output with warnings. |
| `Release refused` (exit 4) | The reason follows the message: consent isn't recorded, the audience has expired, or the domain or method doesn't qualify. |
| Anything unexpected | Run again with `TURNROW_DEBUG=1` for a stack trace, and include it in the issue. |

## The résumé view

```sh
node bin/profile.mjs convert examples/sample.profile.json resume --locale es
```

The `resume` mapping is not a résumé; it is what a résumé template reads. Every decision is made here, so a template only lays out: the PDF and the plain-text ATS résumé (both on the [roadmap](ROADMAP.md)) will read this view and nothing else, and so will say the same thing. See [`examples/out/sample.resume.json`](examples/out/sample.resume.json).

| Field | What it holds |
|---|---|
| `title`, `locale`, `direction`, `madeFor` | The document title, its language, `ltr` or `rtl`, and the date it was made for. |
| `person` | Name, headline, location, the contact details the output may show, links with labels, and the photo in force with its alt text. |
| `summary` | A heading and the text. |
| `sections[]` | In reading order, each with `id`, a `heading` in the output's language and `entries`. A section with no entries is left out, so no heading stands over nothing. |

Every entry has the same shape, whatever its section: `id`, `priority`, `title`, and where they apply `organization`, `location`, `detail`, `dates`, `datesNumeric`, `summary`, `bullets`, `keywords`, `url`. A job also lists its `positions`, newest first, each with its own title, dates and bullets.

- **Dates come twice:** `dates` in the reader's language ("mar 2024 – Actualidad") and `datesNumeric` as `MM/YYYY` for applicant tracking systems. Uncertain dates keep their qualifier in both ("c. 1996").
- **`priority`** (0–100, default 50) is on every entry, so a one-page layout knows what to drop first.
- **Study that didn't end in a degree** reads "… (not completed)", or names the subject alone.
- **Other people's words** appear only with their consent, and only to its scope.
- Headings and levels are translated in English, Spanish, French, German and Portuguese; other locales fall back to English words with their own date formats.

## The résumé PDF

```sh
node bin/profile.mjs pdf examples/sample.profile.json --out resume.pdf
node bin/profile.mjs pdf my-bundle/ --out resume.pdf --pages 1 --photo --locale es
```

`pdf` lays out the [résumé view](#the-résumé-view) with a [Typst](https://typst.app) template and writes a tagged PDF that declares PDF/UA-1, the accessibility standard for PDF. Typst is a separate program: install it from [typst.app/open-source](https://typst.app/open-source/), or point to it with `--typst <path>`. Without it the command says so and stops.

| Option | What it does |
|---|---|
| `--out <file>` | Where the PDF goes. Required. |
| `--pages 1` | One page is a hard limit: if the résumé runs longer, nothing is written and the least important entries are named. Default `auto`. |
| `--min-priority <n>` | Leave out entries whose `priority` is below `n` (0–100). |
| `--density compact` | Smaller type and margins. Default `comfortable`. |
| `--paper a4` | Default `us-letter`. |
| `--photo` | Show the photo in force, with its alt text. Off by default; many employers ask for résumés without one. The photo must be stored in the bundle. |
| `--locale`, `--on` | The language of headings and dates, and the date the résumé is made for. |

- **Accessible by construction.** The document title and language are set; the name, sections and entries are real headings in order; reading order is visual order (one column); links are underlined and named; the photo carries its alt text; decorative rules are marked as decoration; no line is stranded at the top or bottom of a page. Text is Atkinson Hyperlegible Next in the brand colors, each at WCAG AAA contrast (7:1).
- **Still check it.** Typst refuses to write a PDF/UA-1 file it knows is wrong, but a tool can't judge reading order or plain language. Listen to it with a screen reader before sending it widely. Automated veraPDF validation is on the [roadmap](ROADMAP.md).
- **One layout so far:** `classic` ([`templates/resume/classic.typ`](templates/resume/classic.typ)). A template holds layout only; to make your own, copy it and read the same view.

When one page isn't enough:

```
error: the résumé runs to 2 pages, and one was asked for
To fit one page, leave out the least important entries. Lowest priority first:
  - Awards: "Waterfront Project of the Year" (harbor-award, priority 40)
  …
```

## The review file

```sh
node bin/profile.mjs review examples/sample.profile.json --out review.md
```

`review` writes the whole profile as one Markdown file, for the person and the people who check their record. Outputs show only what is approved and public; the review file shows everything, so nothing is approved unseen. See [`examples/out/sample.review.md`](examples/out/sample.review.md).

| Part | What it shows |
|---|---|
| Summary | Whether the subject's consent is recorded; counts by status, confidence and visibility; validation errors and warnings; open items (disputed, then pending, then questions); content rule hits in each output. |
| The person | Each personal field and name with its visibility. |
| Entries by section | One row per entry, position, responsibility and figure: what it says, status, confidence, visibility, sources with their quality, codes, internal notes, and which outputs show it. |
| Claims and disputes | What each source says beside what the profile says, with the decision and the reason. |
| Other people's data | People named in the profile, what is held about them, and each recommender's and endorser's consent and its scope. Contact details are counted, not printed. |
| Audiences and releases | What each audience is granted, whether it is active on the date, and the releases already made. |

- **"Which outputs show it"** is worked out with each mapping's own filter, so it reads "Shown in: linkedin, schemaorg. Hidden from: brief (priority 40 is below 80)." A mapping's own limits (the first five, say) are not applied.
- **It is internal.** It holds drafts, private entries, notes and other people's details. `.gitignore` leaves out `review.md` and `*.review.md`; keep it out of shared folders too.
- **An invalid profile still gets a file**, headed by its errors.
- **Accessible Markdown:** one top heading, no skipped levels, every table with a header row, status in words (never color or symbols), and links named for where they go.
- `--on` sets the date outputs are judged for; `--locale` picks the language of translated text.

From code: `reviewMarkdown(profile, { on, locale, mappings })`. Pass your own `mappings` to report on outputs of your own.

## Repository layout

| Path | What it is |
|---|---|
| [`schema/profile.schema.json`](schema/profile.schema.json) | The schema (JSON Schema draft 2020-12). |
| [`lib/validate.mjs`](lib/validate.mjs) | Schema validation, plus the checks a schema can't express: cross-references, claim consistency, open questions, consent for references, bundle files, rule syntax. |
| [`lib/convert.mjs`](lib/convert.mjs) | Applies a mapping to a profile and enforces the content rules. |
| [`lib/import-jsonresume.mjs`](lib/import-jsonresume.mjs) | Converts a JSON Resume into a profile. Everything imported starts as a draft. |
| [`lib/i18n.mjs`](lib/i18n.mjs) | Translations of the fixed words in outputs, and locale-aware dates and numbers. |
| [`lib/identifiers.mjs`](lib/identifiers.mjs) | Identifier privacy defaults, LEI check digits, normalization. |
| [`lib/history.mjs`](lib/history.mjs) | Organization names and domains on a date, parents, successors, and how a job's positions and responsibilities line up. |
| [`lib/codes.mjs`](lib/codes.mjs) | Looks up and checks occupation, industry and skill codes against the bundled lists. |
| [`data/`](data/) | SOC 2018, O*NET-SOC and O*NET content-model elements (31.0), NAICS 2022. |
| [`lib/audience.mjs`](lib/audience.mjs) | Resolves audiences on a date, checks requesters against policy and looks up field authority. |
| [`lib/release.mjs`](lib/release.mjs) | Builds audience-scoped releases with consent receipts. |
| [`lib/writeback.mjs`](lib/writeback.mjs) | Turns an employer's SCIM User into claims under the authority rules. |
| [`mappings/`](mappings/) | `jsonresume`, `schemaorg`, `linkedin`, `brief`, `timeline`, `scim`, `verification`. |
| [`lib/pdf.mjs`](lib/pdf.mjs) | Prepares the résumé view for the template, runs Typst and explains its failures. |
| [`templates/`](templates/) | Typst templates for the résumé PDF. Layout only. |
| [`lib/review.mjs`](lib/review.mjs) | Writes the review file: every entry with its status, sources and which outputs show it. |
| [`bin/profile.mjs`](bin/profile.mjs) | Command line: `validate`, `open`, `review`, `convert`, `pdf`, `import`, `release`, `writeback`, `media add`, `badges import`. |
| [`examples/`](examples/) | Three fictional people: a founder; a new employee with audiences; and someone whose employers (EDS, Coopers & Lybrand, Buchanan) changed around them, with real company histories cited to public sources. Plus a sample SCIM write-back and every generated output. |
| [`upstream/jsonresume/`](upstream/jsonresume/) | An unmodified copy of the current JSON Resume schema (1.7.1). The tests validate our JSON Resume export against it. |
| [`test/`](test/) | `node --test`: schema, validator, converter, rules and import round trip. |
| [`brand/`](brand/) | Logos, icons, favicons, design tokens (light and dark), fonts and the scripts that generate them. See [Brand and design system](#brand-and-design-system). |

## Use it from code

```js
import { validateProfile, convert, loadMapping, fromJsonResume } from "@turnrow/profile-schema";

const result = validateProfile(profile);           // { valid, errors, warnings, openItems }
const { output } = convert(profile, loadMapping("schemaorg"), { locale: "en-US" });
```

`convert` throws a `RuleViolationError` if the output breaks a rule. Pass `{ allowRuleViolations: true }` to get the violations back as warnings instead.

## Writing a mapping

A mapping is JSON: an `include` filter and an `output` template.

```json
{
  "target": "mytarget",
  "include": { "visibility": ["public"], "status": ["approved"], "confidence": ["high"], "minPriority": 0 },
  "output": {
    "fullName": "$.person.name",
    "jobs": {
      "$each": "$$.work",
      "$where": { "employmentType": ["fullTime", "contract"] },
      "$sort": "-startDate",
      "$limit": 5,
      "$map": {
        "employer": { "$fn": "org", "args": ["$.organization"] },
        "dates": { "$fn": "dateRangeText", "args": ["$.startDate", "$.endDate", "$.current"] }
      }
    }
  }
}
```

- `"$.path"` reads from the current item and `"$$.path"` from the profile root. Any other string is copied as written.
- `$each` loops over a list. Section entries in it are filtered by `include`; other objects (links, places) by visibility only. `$where` (a `null` in a list also matches a missing field), `$sort` (comma-separated fields, `-` for descending) and `$limit` are optional.
- `{"$if": …, "$then": …, "$else": …}` handles conditionals. `{"$literal": …}` passes a value through without evaluating it.
- Helpers (`$fn`):
  - Text: `text` (localize), `concat`, `join`, `coalesce`, `truncate`, `enumMap`.
  - Organizations and places: `org`, `orgObj`, `place`, `placeObj`, `placeGeo`, `placeIdUri`.
  - Names: `name`, `names`.
  - Dates: `isoExact` (exact dates only), `isoLoose` (lower bound), `date`, `dateText` (renders "c. 1996", "before 1998", "1990/91"), `dateRangeText`. The `numeric` format gives `MM/YYYY`.
  - Names: `namesDuring` (names in use during a period), `pronunciation`.
  - Identifiers: `orgIdentifiers`, `orgIdentifier` (in force on a date), `orgClassification`.
  - History and roles: `employer` (in the mapping's `orgNameStyle`), `orgNameAt`, `orgNow`, `orgAlternateNames`, `tenureNotes`, `positions`, `flatPositions`, `responsibilityLines`, `joinLines`, `concatLists`.
  - Values and lookups: `money`, `metricText`, `lookup`, `visible`.
  - Documents: `label` (a fixed phrase in the output's language), `labelFor` (a translated enum value), `section` (an `{ id, heading, entries }` block that drops itself when empty), `count`.
  - Context: `locale`, `direction`, `onDate`, `now`.
- Empty values are dropped, so missing data never renders as a blank field.
- `"ruleExemptKeys": ["id"]` keeps the content rules from reading identifiers as prose (an id such as `state-u-ms` is not a claim to an MS). Exempt only keys a reader never sees.

### Other targets

- **Europass:** copy `jsonresume.json` and rename keys to the Europass model. Map `languages[].cefr` to the language levels and `skills[].escoUri` to ESCO skills. Europass imports XML, so add a JSON-to-XML step.
- **HR Open Standards / ATS:** map `work` to employment history and `credentials` to certifications the same way. Employee directories and identity providers are covered by the `scim` mapping.
- **GEDCOM:** `timeline`, `service`, `education` and `names` map naturally to GEDCOM events, attributes and name structures, if a family-history export is ever wanted.

## Photos, recommendations, endorsements and badges (2.6)

**Photos are versioned assets, not bare URLs.** A `media` entry can carry:
- `uuid`, `version` and `supersedes`, so a re-shot headshot is a new version of the same asset;
- `sha256`, `width`, `height` and `byteSize`;
- `renditions` (square, banner…);
- `credit`, `license` and `consent`;
- `capturedOn`, and the extracted `metadata` (camera, orientation).

`person.images` says which photo is in force when (`{ media, purpose, from, to }`). A job or a position can name its own photo with `media`. Every output then asks one helper which image applies on its date.

`profile media add <bundle> <file> --id … --alt …` copies a photo into the bundle, hashes it and records its size. A photo with GPS coordinates is refused unless you pass `--strip-gps`, which blanks the location in place and keeps everything else. In a 2.6.0 file, a bundled image that still has GPS is an error.

**Other people** live in `people`: recommenders, endorsers, references and managers. Their names, roles, identifiers, contacts and photos are all dated, so a recommendation from 2019 shows the author's title and employer from 2019, and a name change is kept, not overwritten. Contacts are private by default. They never reach an output, and they reach a release only when the audience has the `personContacts` grant.

**Recommendations** keep the full text verbatim, with:
- `highlights`, checked to be verbatim parts of the text (whitespace and Unicode normalization aside);
- the date and time;
- the relationship (manager, peer, client…, linked to the job);
- who the author was then (`authorAt`);
- where it came from (`source`, with an optional screenshot).

A recommendation needs the author's consent before it is shown anywhere. `consent.scope` decides what is shown:

| Scope | Shown |
|---|---|
| `full` | The text and the author's name. |
| `highlights` | The featured highlights only, with the name. |
| `nameOnly` | The author's name and title, and no text. |
| `anonymous` | The text, credited to the author's title alone ("Director of Terminal Operations", or "A colleague"); the employer is left out too, since a title at a named employer can identify someone. |

Outputs:
- schema.org: `Recommendation` on the profile page;
- JSON Resume: `references`;
- LinkedIn sheet: a Recommendations list;
- brief: a featured quote.

**Endorsements** are someone vouching for a skill, credential or badge, optionally as an Open Badges 3.0 `EndorsementCredential`. `endorsementCount` counts only approved, consented endorsements.

**Badges** use the [Open Badges 3.0](https://www.imsglobal.org/spec/ob/v3p0/) vocabulary (1EdTech, built on W3C Verifiable Credentials 2.0): `achievement` (with `achievementType`, criteria and alignments), `issuer`, `validFrom`/`validUntil`. The issuer's original credential is kept byte for byte in the bundle, with its hash.

`profile badges import <bundle> <file | url>` reads:
- Open Badges 3.0 as JSON-LD or a VC-JWT;
- Open Badges 2.0 hosted or signed assertions;
- baked PNG and SVG images.

A URL is fetched only with `--fetch`. Alignments to O*NET or SOC are checked like occupation codes. A badge that stands for a `credentials` entry (`credentialRef`) is listed once.

Outputs:
- schema.org: an `EducationalOccupationalCredential` with `credentialCategory: "badge"`;
- JSON Resume: `certificates`;
- LinkedIn sheet: Licenses & certifications, with the credential URL.

See [`examples/recommended/`](examples/recommended/), a fictional bundle made entirely by `scripts/make-fixtures.mjs` (`npm run fixtures`).

## Profile bundles

A bundle is a folder. Zip it to send it; the tools read the folder, so unzip it first.

```
ines-calloway/
  profile.json
  media/
    cv-2024.pdf
    headshot.jpg
  badges/
    harbor-ops-badge.json
```

Refer to files as `bundle:media/cv-2024.pdf`. `validate <folder>` checks that each file exists and that any `sha256` matches, including each rendition and each badge's original credential. Keeping the evidence with the data means a source can't quietly go missing.

## What this schema deliberately doesn't hold

Some things don't belong in a file meant for sharing, so the schema has no place for them, and where it can it refuses them:

- **Government identity and tax numbers for a person** (SSN, ITIN, passport, driver's license). `person.identifiers` refuses such keys, and any value shaped like an SSN.
- **Date of birth and age.** Graduation dates can still act as an age proxy; leave education dates out of outputs where that matters (a per-target override does this).
- **Compensation and salary history.** Many places bar employers from asking for it.
- **Health details, sexual orientation, religion, immigration status, criminal history.** If a career break was for health reasons, the validator asks you to keep it private or describe it as "personal".

## Localization and accessibility

- Every text field can hold translations. `--locale` picks one, falling back to the default language.
- Dates and numbers are formatted for the locale. Fixed words in outputs come from translation tables (English, Spanish, French, German, Portuguese) in [`lib/i18n.mjs`](lib/i18n.mjs); adding a language means copying one block.
- Images need alt text. Names can carry a pronunciation (respelling, IPA or audio) for directories and screen readers.
- The project produces data, not pages. A page built from it should meet WCAG AAA, work mobile-first and support dark mode; [ROADMAP.md](ROADMAP.md) tracks a reference renderer that does.

## Privacy and consent

The schema makes privacy enforceable, but it doesn't decide what is appropriate. Before publishing anything public about a real person, record their consent in `meta.subjectConsent`. The validator warns until you do, and `release` refuses to hand anything to anyone without it.

Rulings, caveats and where a figure came from go in `note` fields (on entries, positions, responsibilities, metrics and organizations) and a code's `rationale`. They are internal: no output or release ever includes them. Keep real people's profiles out of public repositories unless they have agreed.

Individual person fields (location, pronouns, photo and others) can be hidden from public outputs with `person.visibility`. Security notes, including the HTML-safe JSON-LD and the link rules, are in [SECURITY.md](SECURITY.md).

## Versioning

`schemaVersion` follows semantic versioning. Changes that break existing files bump the major version; new optional fields bump the minor version. 2.0.0 was the first public release (1.0 was an internal draft); 2.1.0 added audiences, releases and write-back; 2.2.0 added organization history, positions and responsibilities; 2.3.0 added registry and tax identifiers; 2.4.0 hardens security and privacy, localizes outputs and fills model gaps; 2.5.0 adds occupation, industry and skill codes, internal notes and open-recipient audiences, and refuses releases without consent; 2.6.0 adds versioned photos, other people, recommendations, endorsements and Open Badges 3.0 badges. Earlier files remain valid; a 2.5.0 or 2.6.0 file is held to stricter checks (see the changelog). 2.6.1 fixes privacy gaps and command-line problems found in review, with no schema change, so files keep `schemaVersion` 2.6.0. Releases are tagged from 2.6.1 on (`v2.6.1`); earlier versions were not tagged.

**Releasing.** Bump `version` in `package.json`, add a `## <version> (<date>): …` entry to `CHANGELOG.md`, and merge to `main`. The [release workflow](.github/workflows/release.yml) runs the tests, tags `v<version>` and publishes a GitHub release with that changelog entry as its notes. It does nothing when the tag already exists. Merged branches are deleted with the [delete-merged-branch workflow](.github/workflows/delete-merged-branch.yml), which refuses any branch with commits that are not in `main`.

## Brand and design system

Profile Schema has its own logo and design system in [`brand/`](brand/). The mark is a person inside three nested rings that point forward: one record, described in layers, rendered to many outputs. The full guide is [`brand/README.md`](brand/README.md). The essentials:

| Need | Use |
|---|---|
| Logo on a light page | [`brand/svg/profile-schema-lockup-light.svg`](brand/svg/profile-schema-lockup-light.svg) |
| Logo on a dark page | [`brand/svg/profile-schema-lockup-dark.svg`](brand/svg/profile-schema-lockup-dark.svg) |
| App icon or avatar | [`brand/svg/profile-schema-icon.svg`](brand/svg/profile-schema-icon.svg), or PNGs in [`brand/png/`](brand/png/) |
| Favicons, manifest and theme color | [`brand/head-snippet.html`](brand/head-snippet.html) |
| Colors, type, spacing in CSS | [`brand/design-system/tokens.css`](brand/design-system/tokens.css), which follows the reader's light or dark setting |
| Tokens for design tools | [`brand/design-system/tokens.dtcg.json`](brand/design-system/tokens.dtcg.json) (W3C format) |

- **Name.** In writing, the product is **Profile Schema**, and the full form is **Profile Schema, a Turnrow Solution**. The lowercase `profile-schema` belongs to the logo and to code (the package `@turnrow/profile-schema`, file names, URLs).
- **Accessible by default.** Every text color meets WCAG AAA (7:1) on every surface in both themes, and `brand/tools/contrast.py` fails if one stops meeting it. Type is Atkinson Hyperlegible Next and Mono, sized in `rem` and mobile-first.
- **Dark mode and localization.** Each color has a light and a dark value. Layouts use logical properties so right-to-left locales mirror; the logo itself never mirrors, and the product name is never translated.
- **Generated, not drawn.** Logos come from constructed geometry in `brand/tools/build_brand.py`. Change its constants and re-run; never hand-edit an SVG.

## Credits and license

This repository began as a fork of [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema), which is archived; JSON Resume development continues in [jsonresume/jsonresume.org](https://github.com/jsonresume/jsonresume.org). The evidence model follows ideas from the FamilySearch GEDCOM 7 specification and the GEDCOM X conceptual model.

MIT license. See [LICENSE.md](LICENSE.md). The fonts in `brand/fonts/` are under the SIL Open Font License; their licenses are kept beside them. JSON Resume's own copyright notice is kept there and in [`upstream/jsonresume/LICENSE.md`](upstream/jsonresume/LICENSE.md).
