# Turnrow Profile Schema

One JSON file holds a person's whole professional record. Every output (a JSON Resume, schema.org JSON-LD for a profile page, a LinkedIn paste sheet, a slide bio, a timeline or map) is a filtered, mapped view of that file. Fix a fact once and every output picks it up.

It starts from [JSON Resume](https://jsonresume.org) and adds an evidence model taken from genealogy, where conflicting sources are the norm ([GEDCOM 7](https://gedcom.io) and [GEDCOM X](https://www.familysearch.org/developers/docs/api/gx_json)). Every fact records:

- **where it came from** (citations to sources, with a quality grade),
- **what each source says** when they disagree (competing claims, with one accepted and the reason why),
- **how sure we are** (confidence: high, medium or low),
- **where it stands in review** (status: draft, pending, approved, disputed or retired),
- **who may see it** (visibility: public, network or private).

Outputs choose what they accept. The public JSON-LD takes only approved, high-confidence, public facts, so an unconfirmed number or a private phone number never reaches the open web by accident.

```sh
npm install
node bin/profile.mjs validate examples/sample.profile.json
node bin/profile.mjs open     examples/sample.profile.json          # what still needs confirming
node bin/profile.mjs convert  examples/sample.profile.json schemaorg  # or jsonresume, linkedin, brief, timeline
node bin/profile.mjs convert  examples/sample.profile.json brief --locale es
node bin/profile.mjs import   my-resume.json --out my.profile.json   # start from an existing JSON Resume
```

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
| Evidence kept with the data | A **profile bundle**: a folder (or a zip of one) with `profile.json` and a `media/` folder. `bundle:media/…` URLs resolve inside it, and `sha256` checksums are verified. | GEDZip |
| Localization | Any text field is a string or a map of BCP 47 tags (`{"en-US": "…", "es": "…"}`), with fallback to the default locale. | GEDCOM X `lang` |
| Accessibility | `alt` is required on every image. | |
| Short and long views from one file | `priority` (0–100), structured `metrics`, and per-target `targets.<name>` overrides or omission. | |
| Organizations written once | `organizations` map, referenced by id, with `sameAs` links. | |
| Organizations that change | Dated names, domains, identifiers and parents; `organizationEvents` for mergers, acquisitions, splits and rebrands; employer names in each output's style. | GEDCOM X place jurisdictions over time; Wikidata "replaces"/"replaced by" |
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
- **Recognising the recipient:** organizations list their `domains`. The application verifies the requester (OIDC or SAML token from the employer's identity provider, a DNS TXT record or `.well-known` file, or a signed request), and `checkRequester` decides whether that method and domain qualify. A matching email address alone is the weakest proof and can never authorize write-back.
- **Grants:** an audience receives only the person-level fields and sections it lists. Entries are included when their visibility is in `baseVisibility`, and an entry can name an audience to share something otherwise private with that recipient only (a first-aid certificate for the employer's safety roster, say).
- **The employer's own record:** `work[].employerRecord` holds the official title, department, manager and internal ids as the employer records them. It goes only to an audience bound to that job, never to anyone else. Your own wording (`title`) stays alongside it.

### Releases and consent receipts

```sh
node bin/profile.mjs release examples/employee.profile.json current-employer \
  --format scim --domain acme.example --method oidc --application acme-directory \
  --out directory.json --receipt receipt.json --record
```

A release is the scoped payload plus a **consent receipt**: recipient, purpose, what was shared, expiry and the SHA-256 of the payload. `--record` appends it to the profile's `releases` log. Stopping a release stops future updates; copies already delivered stay with the recipient, and the receipt says so. The `scim` mapping produces a SCIM 2.0 User with the Enterprise User extension (employee number, department, division, cost centre, manager), the format directories and identity providers already accept.

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

## Repository layout

| Path | What it is |
|---|---|
| [`schema/profile.schema.json`](schema/profile.schema.json) | The schema (JSON Schema draft 2020-12). |
| [`lib/validate.mjs`](lib/validate.mjs) | Schema validation, plus the checks a schema can't express: cross-references, claim consistency, open questions, consent for references, bundle files, rule syntax. |
| [`lib/convert.mjs`](lib/convert.mjs) | Applies a mapping to a profile and enforces the content rules. |
| [`lib/import-jsonresume.mjs`](lib/import-jsonresume.mjs) | Converts a JSON Resume into a profile. Everything imported starts as a draft. |
| [`lib/history.mjs`](lib/history.mjs) | Organization names and domains on a date, parents, successors, and how a job's positions and responsibilities line up. |
| [`lib/audience.mjs`](lib/audience.mjs) | Resolves audiences on a date, checks requesters against policy and looks up field authority. |
| [`lib/release.mjs`](lib/release.mjs) | Builds audience-scoped releases with consent receipts. |
| [`lib/writeback.mjs`](lib/writeback.mjs) | Turns an employer's SCIM User into claims under the authority rules. |
| [`mappings/`](mappings/) | `jsonresume`, `schemaorg`, `linkedin`, `brief`, `timeline`, `scim`. |
| [`bin/profile.mjs`](bin/profile.mjs) | Command line: `validate`, `open`, `convert`, `import`, `release`, `writeback`. |
| [`examples/`](examples/) | Three fictional people: a founder; a new employee with audiences; and someone whose employers (EDS, Coopers & Lybrand, Buchanan) changed around them, with real company histories cited to public sources. Plus a sample SCIM write-back and every generated output. |
| [`upstream/jsonresume/`](upstream/jsonresume/) | An unmodified copy of the current JSON Resume schema (1.7.1). The tests validate our JSON Resume export against it. |
| [`test/`](test/) | `node --test`: schema, validator, converter, rules and import round trip. |

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
  - Dates: `isoExact` (exact dates only), `isoLoose` (lower bound), `date`, `dateText` (renders "c. 1996", "before 1998", "1990/91"), `dateRangeText`.
  - History and roles: `employer` (in the mapping's `orgNameStyle`), `orgNameAt`, `orgNow`, `orgAlternateNames`, `tenureNotes`, `positions`, `flatPositions`, `responsibilityLines`, `joinLines`, `concatLists`.
  - Values and lookups: `money`, `metricText`, `lookup`, `visible`.
  - Context: `locale`, `now`.
- Empty values are dropped, so missing data never renders as a blank field.

### Other targets

- **Europass:** copy `jsonresume.json` and rename keys to the Europass model. Map `languages[].cefr` to the language levels and `skills[].escoUri` to ESCO skills. Europass imports XML, so add a JSON-to-XML step.
- **HR Open Standards / ATS:** map `work` to employment history and `credentials` to certifications the same way. Employee directories and identity providers are covered by the `scim` mapping.
- **GEDCOM:** `timeline`, `service`, `education` and `names` map naturally to GEDCOM events, attributes and name structures, if a family-history export is ever wanted.

## Profile bundles

A bundle is a folder, or a zip of one:

```
ines-calloway/
  profile.json
  media/
    cv-2024.pdf
    headshot.jpg
```

Refer to files as `bundle:media/cv-2024.pdf`. `validate <folder>` checks that each file exists and that any `sha256` matches. Keeping the evidence with the data means a source can't quietly go missing.

## Privacy and consent

The schema makes privacy enforceable, but it doesn't decide what is appropriate. Before publishing anything public about a real person, record their consent in `meta.subjectConsent` (the validator warns until you do). Keep real people's profiles out of public repositories unless they have agreed.

## Versioning

`schemaVersion` follows semantic versioning. Changes that break existing files bump the major version; new optional fields bump the minor version. 2.0.0 was the first public release (1.0 was an internal draft); 2.1.0 added audiences, releases and write-back; 2.2.0 adds organization history, positions and responsibilities. Earlier files remain valid.

## Credits and licence

This repository began as a fork of [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema), which is archived; JSON Resume development continues in [jsonresume/jsonresume.org](https://github.com/jsonresume/jsonresume.org). The evidence model follows ideas from the FamilySearch GEDCOM 7 specification and the GEDCOM X conceptual model.

MIT licence. See [LICENSE.md](LICENSE.md). JSON Resume's own copyright notice is kept there and in [`upstream/jsonresume/LICENSE.md`](upstream/jsonresume/LICENSE.md).
