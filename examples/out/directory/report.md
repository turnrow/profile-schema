# Directory change report

**Internal.** This file holds personal data. Keep it out of public repositories and shared folders.

- Directory: scim, for acme.example (verified by oidc)
- Made for: 2026-11-07
- Compared with an export of 4 users (sha256 12669f253f32…)
- Change set: sha256 07c5a58e2424a711c0c465817bb970abe4dfb4baf9fba6772ae05709147a1b25

## Summary

- **People with changes:** 1 (7 fields).
- **People already up to date:** 1.
- **People left out:** 2.
- **Differences the directory decides:** 3.
- **Directory users with no profile in the folder:** 2. They are not touched.

## Before you approve

Nothing has been changed. This run only read the folder and the export. Read the changes below. Each one was released by the person it is about, to this employer, and has a consent receipt in the `receipts` folder. A sync never creates, removes or renames a user, never clears a value, and never changes a field the employer is the authority for.

To apply: `send scim-bulk.json to the directory's SCIM /Bulk endpoint`.

## Changes

### Sam Rivera

Directory user sam.rivera@acme.example, matched by employee number. Profile: sam-rivera.profile.json. Release: release-a8c73600-c08c-b3c1-429b-8b1588004fa5.

| Field | Directory attribute | Now | Will be |
| --- | --- | --- | --- |
| givenName | name.givenName | Samantha | Sam |
| displayName | displayName | Samantha Rivera | Sam Rivera |
| nickname | nickName | (empty) | Sam |
| pronouns | urn:turnrow:params:scim:schemas:extension:profile:2.0:User:pronouns | (empty) | she/her |
| preferredTitle | urn:turnrow:params:scim:schemas:extension:profile:2.0:User:preferredTitle | (empty) | Platform Engineering Lead |
| photoUrl | photos\[type eq "photo"\].value | (empty) | https://example.com/images/sam-rivera.jpg |
| shortBio | urn:turnrow:params:scim:schemas:extension:profile:2.0:User:shortBio | (empty) | Platform engineer who makes other engineers faster: build systems, internal tooling and the paved road from laptop to production. |

## Differences the directory decides

The employer is the authority for these fields, so they are not changed. If the directory is right, the profile learns it through write-back. If the profile is right, correct the directory at its source (usually the HR system).

| Person | Field | The directory says | The profile says |
| --- | --- | --- | --- |
| Sam Rivera | department | Platform Engineering | Engineering |
| Sam Rivera | workLocation | (empty) | Austin, Texas |
| Dana Okoye | workLocation | (empty) | Austin, Texas |

## People left out

| Profile | Person | Why |
| --- | --- | --- |
| jo-reyes.profile.json | Jo Reyes | no directory user has this person's employee number or e-mail address |
| lee-park.profile.json | Lee Park | the subject has not given consent (meta.subjectConsent.given is not true) |
