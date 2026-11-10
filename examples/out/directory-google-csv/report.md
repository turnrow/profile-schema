# Directory change report

**Internal.** This file holds personal data. Keep it out of public repositories and shared folders.

- Directory: google-csv, for acme.example (verified by oidc)
- Made for: 2026-11-07
- Compared with an export of 4 users (sha256 f73b0bc1bbf5…)
- Change set: sha256 5856708e752494b36b3791052570939daa08cfaccbdd5c9381b65cccaf38ca3f

## Summary

- **People with changes:** 1 (1 field).
- **People already up to date:** 1.
- **People left out:** 2.
- **Differences left as they are:** 1.
- **Directory users with no profile in the folder:** 2. They are not touched.

## Before you approve

Nothing has been changed. This run only read the folder and the export. Read the changes below. Each one was released by the person it is about, to this employer, and has a consent receipt in the `receipts` folder. A sync never creates, removes or renames a user, never clears a value, and never changes a field the employer is the authority for.

To apply: `upload google-bulk-update.csv in the Admin console: Directory > Users > Bulk update users`.

## Changes

### Sam Rivera

Directory user sam.rivera@acme.example, matched by employee number. Profile: sam-rivera.profile.json. Release: release-a8c73600-c08c-b3c1-429b-8b1588004fa5.

| Field | Directory attribute | Now | Will be |
| --- | --- | --- | --- |
| givenName | First Name \[Required\] | Samantha | Sam |

## Differences left as they are

These are not changed. Where the employer is the authority for a field: if the directory is right, the profile learns it through write-back; if the profile is right, correct the directory at its source (usually the HR system).

| Person | Field | The directory says | The profile says | Why it is not changed |
| --- | --- | --- | --- | --- |
| Sam Rivera | department | Platform Engineering | Engineering | the employer is the authority |

## People left out

| Profile | Person | Why |
| --- | --- | --- |
| jo-reyes.profile.json | Jo Reyes | no directory user has this person's employee number or e-mail address |
| lee-park.profile.json | Lee Park | the subject has not given consent (meta.subjectConsent.given is not true) |
