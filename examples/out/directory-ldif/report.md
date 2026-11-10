# Directory change report

**Internal.** This file holds personal data. Keep it out of public repositories and shared folders.

- Directory: ldif, for acme.example (verified by oidc)
- Made for: 2026-11-07
- Compared with an export of 4 users (sha256 c6f94d268b66…)
- Change set: sha256 35175676b7eb8a8005d8c5e6a832f9fad37053b9c4514c581f337489a9565156

## Summary

- **People with changes:** 1 (2 fields).
- **People already up to date:** 1.
- **People left out:** 2.
- **Differences left as they are:** 3.
- **Directory users with no profile in the folder:** 2. They are not touched.

## Before you approve

Nothing has been changed. This run only read the folder and the export. Read the changes below. Each one was released by the person it is about, to this employer, and has a consent receipt in the `receipts` folder. A sync never creates, removes or renames a user, never clears a value, and never changes a field the employer is the authority for.

To apply: `apply directory-changes.ldif with ldapmodify (or ldifde -i on Active Directory), after a dry run with ldapmodify -n`.

## Changes

### Sam Rivera

Directory user sam.rivera@acme.example, matched by employee number. Profile: sam-rivera.profile.json. Release: release-a8c73600-c08c-b3c1-429b-8b1588004fa5.

| Field | Directory attribute | Now | Will be |
| --- | --- | --- | --- |
| givenName | givenName | Samantha | Sam |
| displayName | displayName | Samantha Rivera | Sam Rivera |

## Differences left as they are

These are not changed. Where the employer is the authority for a field: if the directory is right, the profile learns it through write-back; if the profile is right, correct the directory at its source (usually the HR system).

| Person | Field | The directory says | The profile says | Why it is not changed |
| --- | --- | --- | --- | --- |
| Dana Okoye | workLocation | (empty) | Austin, Texas | the employer is the authority |
| Sam Rivera | department | Platform Engineering | Engineering | the employer is the authority |
| Sam Rivera | workLocation | (empty) | Austin, Texas | the employer is the authority |

## People left out

| Profile | Person | Why |
| --- | --- | --- |
| jo-reyes.profile.json | Jo Reyes | no directory user has this person's employee number or e-mail address |
| lee-park.profile.json | Lee Park | the subject has not given consent (meta.subjectConsent.given is not true) |
