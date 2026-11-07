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
| Military, scouting, volunteer and board work | `service`, its own section, so each output decides where it goes. | |
| Study that didn't end in a degree | `education.completed: false`, so no output implies a degree. | |

## Repository layout

| Path | What it is |
|---|---|
| [`schema/profile.schema.json`](schema/profile.schema.json) | The schema (JSON Schema draft 2020-12). |
| [`lib/validate.mjs`](lib/validate.mjs) | Schema validation, plus the checks a schema can't express: cross-references, claim consistency, open questions, consent for references, bundle files, rule syntax. |
| [`lib/convert.mjs`](lib/convert.mjs) | Applies a mapping to a profile and enforces the content rules. |
| [`lib/import-jsonresume.mjs`](lib/import-jsonresume.mjs) | Converts a JSON Resume into a profile. Everything imported starts as a draft. |
| [`mappings/`](mappings/) | `jsonresume`, `schemaorg`, `linkedin`, `brief`, `timeline`. |
| [`bin/profile.mjs`](bin/profile.mjs) | Command line: `validate`, `open`, `convert`, `import`. |
| [`examples/`](examples/) | The fictional sample profile and every output generated from it. |
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
  - Values and lookups: `money`, `metricText`, `lookup`, `visible`.
  - Context: `locale`, `now`.
- Empty values are dropped, so missing data never renders as a blank field.

### Other targets

- **Europass:** copy `jsonresume.json` and rename keys to the Europass model. Map `languages[].cefr` to the language levels and `skills[].escoUri` to ESCO skills. Europass imports XML, so add a JSON-to-XML step.
- **HR Open Standards / ATS:** map `work` to employment history and `credentials` to certifications the same way.
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

`schemaVersion` follows semantic versioning. Changes that break existing files bump the major version; new optional fields bump the minor version. 2.0.0 is the first public release (1.0 was an internal draft).

## Credits and licence

This repository began as a fork of [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema), which is archived; JSON Resume development continues in [jsonresume/jsonresume.org](https://github.com/jsonresume/jsonresume.org). The evidence model follows ideas from the FamilySearch GEDCOM 7 specification and the GEDCOM X conceptual model.

MIT licence. See [LICENSE.md](LICENSE.md). JSON Resume's own copyright notice is kept there and in [`upstream/jsonresume/LICENSE.md`](upstream/jsonresume/LICENSE.md).
