# Directory sync (2.9): design

**Status:** written 2026-11-10 without a live brainstorm. Josh asked for the open items to be handled before the next review, so every choice the brainstorm was meant to settle is settled here on a recommendation and listed in [Decisions to confirm](#decisions-to-confirm). Nothing in this document is expensive to change before the connectors that write to a live directory are used.

**Asked for (issue #30):** tools that read a folder of profile files and produce individual and mass updates for an organization's directory: first as files a Google Workspace administrator can upload, then through the Google Directory API and Microsoft Entra ID, with LDAP, Okta, OneLogin and others to follow.

## What already exists

| Piece | Where | Use here |
|---|---|---|
| The employer's own facts about a job | `work[].employerRecord` | What the directory already knows; compared, never pushed |
| Audiences and grants | `audiences`, `lib/audience.mjs` | Decide what an employer may be sent |
| Releases with consent receipts | `lib/release.mjs` | Every person's update is a release |
| SCIM 2.0 User mapping | `mappings/scim.json` | The one payload every connector starts from |
| Write-back and its authority table | `lib/writeback.mjs`, `DEFAULT_AUTHORITY` | Says who is the authority for each field |
| The review writer | `lib/review.mjs` | The change report is written the same way |

The new work is the batch run, the diff, and the connectors.

## The rule the rest follows from

**A directory update is a release, to an employer, of fields the person is the authority for.**

- *A release*: it passes through `buildRelease`, so it needs the subject's consent, an active audience, a verified recipient, and it leaves a consent receipt. Nothing reaches a change set any other way.
- *To an employer*: the audience must have `purpose: "employeeDirectory"` and cover the organization whose directory is being updated.
- *Fields the person is the authority for*: the write-back table already says the employer is the authority for `employerRecord.*` and for start and end dates, and the subject for their name, pronouns and preferred title. Sync runs that table the other way. The directory (or the HR system behind it) is the source of truth for department, manager, cost center and official title, so the profile's copy of those is **compared and reported, never pushed**. Pushing them would overwrite the employer's record with a copy the profile got from the employer.

## How a run works

```
turnrow-profile directory diff <folder> --against <export> --target <connector>
                               --domain <employer domain> --method <how the domain was verified>
                               [--audience <id>] [--on <date>] --out <folder>
turnrow-profile directory apply <change-set.json> ...        (connectors that call an API)
```

1. **Read the folder.** Every `*.profile.json` and every bundle folder (one with `profile.json`), not following links out of the folder. A file that is not a valid profile is a refusal, not a crash.
2. **Read the export.** The connector reads the directory's own export (the Google Admin console's user CSV, a Microsoft Entra export, LDIF, or a SCIM list) into neutral *directory users*.
3. **For each profile, build the release.** Pick the audience: `--audience`, or the profile's single active `employeeDirectory` audience that the given domain qualifies for. Build the SCIM payload with `buildRelease`. No consent, no such audience, or a domain that does not qualify: a refusal with its reason.
4. **Match the person to a directory user.** In this order, stopping at the first that gives exactly one user: the employee number, then the primary e-mail address, then any other e-mail address or alias the directory lists. No match or more than one: a refusal. People are never matched by name.
5. **Compare field by field.** For each field the connector supports (below), compare the release's value with the directory's.
   - The subject is the authority and the values differ: a **change** (`from`, `to`).
   - The employer is the authority and the values differ: a **note** ("the directory says X, the profile says Y"), for write-back to resolve.
   - The release has no value: **nothing**. Absent means "not shared", never "clear it".
6. **Write the results** to `--out`:
   - `changes/<user>.json`: one change file per person;
   - `change-set.json`: all of them, with the export's hash, the date, the recipient and the connector;
   - the connector's own file where it has one (a CSV to upload, an LDIF file);
   - `report.md`: what will change, for a person to read and approve;
   - `refusals.json` (also in the report): who was left out and why;
   - `receipts/<user>.json`: the consent receipt for each release.

Nothing is changed in any directory by `diff`. Profile files are not written to unless `--record` is given, which adds each release record to its profile, as `release --record` does.

## Fields

Neutral names, the SCIM path each comes from, and who is the authority. A connector lists which of these its directory can hold.

| Field | From the SCIM payload | Authority | Pushed? |
|---|---|---|---|
| `givenName`, `familyName` | `name.givenName`, `name.familyName` | subject | yes |
| `displayName` | `displayName` | subject | yes |
| `nickname` | `nickName` | subject | yes |
| `pronouns` | extension `pronouns` | subject | yes |
| `preferredTitle` | extension `preferredTitle` | subject | yes, where the directory has a separate field for it |
| `phone` | `phoneNumbers[0]` | subject | yes, when the audience grants contact details |
| `photoUrl` | `photos[0]` | subject | yes, when the image is published |
| `headline`, `shortBio` | extension | subject | yes, where the directory has a field |
| `namePronunciation` | extension | subject | yes, where the directory has a field |
| `title` | `title` (the employer's official title) | employer | compared only |
| `department`, `division`, `costCenter` | enterprise extension | employer | compared only |
| `employeeNumber` | enterprise extension | employer | used to match; compared only |
| `managerId`, `managerName` | enterprise extension | employer | compared only |
| `workLocation` | extension | employer | compared only |

An audience's own `writeBack.authority` rules are honoured: if an employer's audience says the subject is the authority for `employerRecord.workLocation`, that field is pushed.

## What a sync never does

- Create, delete, suspend or rename a user, or change a login or primary e-mail address.
- Touch groups, licences, organizational units, passwords, recovery details or admin roles.
- Clear a value.
- Match a person by name.
- Send anything the audience does not grant, or anything for a person who has not consented.

## Approving and applying

- **File connectors** (Google bulk CSV, LDIF): `diff` writes the file; a person reads the report and uploads the file. That upload is the approval.
- **API connectors** (Google Directory API, Entra, Okta, OneLogin, LDAP over the network): `directory apply` takes a change set and does nothing unless given `--apply`; without it, it prints the requests it would send. With it:
  1. the change set is refused if it is older than `--max-age` (default 7 days) or its hash is not the one in the report the approver names with `--approved <sha256>`;
  2. each user is read again, and a field is changed only if the directory still holds the `from` value the approver saw; otherwise it is skipped and reported;
  3. it stops at the first error from the directory, leaving the rest unapplied;
  4. every request is written to an audit log (JSON lines: time, user, field, from, to, release id, result), and a **rollback change set**, the inverse of what was applied, is written beside it. Rolling back is applying that file.

## Credentials

- Never in a profile, a change set, a report, a log or a command line. A connector reads them from environment variables or from a file path given in one.
- Each connector's issue names the narrowest permission that does the job, confirmed from the vendor's current documentation as its first step. `diff` needs no credentials at all: it works from an export a person downloaded.
- The audit log records what was sent and the directory's answer, without tokens or headers.

## Connectors

One module each in `lib/directory/`, with the same shape:

```
{ id, label,
  fields: { <neutral field>: <the directory's attribute> },   // only what this directory can hold
  readExport(bytes) -> DirectoryUser[],                          // the directory's own export
  render?(changeSet) -> [{ name, data }],                        // file connectors: the file to upload
  plan?(changeSet)   -> [{ method, url, body, user, fields }],   // API connectors: the requests
}
```

| Issue | Connector | Kind | Notes |
|---|---|---|---|
| #32 | `google-csv` | file | The Admin console's bulk-update CSV |
| #33 | `google` | API | Directory API `users.patch`; a custom schema for fields Google lacks |
| #34 | `entra` | API | Microsoft Graph `/users`; extension attributes |
| #35 | `okta` | API | Users API |
| #36 | `onelogin` | API | Users API v2 |
| #37 | `ldif` | file | `changetype: modify` records; applying over LDAPS is left to `ldapmodify` |
| #38 | others | — | Triage only, until someone needs one |

## Decisions to confirm

These were the brainstorm's questions. Each is decided as above; say so if you want any of them the other way.

1. **Employer-owned fields are compared, not pushed.** The alternative, pushing title and department from the profile, would make the profile the system of record for HR data. Recommended: no.
2. **Matching is by employee number, then e-mail; never by name; no match is a refusal.** The alternative, offering likely matches for a person to confirm, is friendlier and riskier. Recommended: not in 2.9.
3. **A missing value never clears the directory's.** Clearing would need its own explicit instruction. Recommended: not in 2.9.
4. **Sync never creates or removes users.** Onboarding and offboarding belong to the HR system.
5. **The recipient is attested once per run** (`--domain`, `--method`), by the administrator running it, exactly as `release` does today. Each profile's audience is still checked against it.
6. **Profile files are read-only unless `--record` is given.**
7. **API connectors apply only what an approver saw**, by hash, and only where the directory still holds the old value.
8. **LDAP is file-only.** The tool writes LDIF; `ldapmodify` applies it. A network LDAP client would be a new dependency and a new place to hold a bind password.

## Not in 2.9

- Reading from an HR system to *start* profiles (that is import, and write-back already handles corrections).
- Group membership, licences, organizational units.
- A scheduler. A run is something a person starts.
- The org chart (3.0, issue #39), which builds on the directory users and manager links read here.
