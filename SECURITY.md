# Security and privacy

## Reporting a problem

This project handles personal data, so privacy problems count as security problems. If you find a way to leak something a profile marks private, to bypass a content rule, or to make the tools read or write outside what they should, please report it privately using **GitHub's private vulnerability reporting** on this repository (Security → Report a vulnerability). Please don't open a public issue. We aim to acknowledge reports within a week.

## What the tools guarantee, and what they don't

- **Filtering is by declaration.** Outputs include only entries whose visibility, status and confidence the mapping accepts, and person fields hidden by `person.visibility`. A custom mapping can only reach data through the profile it is given; releases give it a profile already reduced to what the audience may see.
- **Releases need the subject's consent.** `release` refuses unless `meta.subjectConsent.given` is true. Internal `note` fields and code rationales are removed before any mapping runs, so a custom mapping can't print them.
- **Content rules** are checked against every string in an output. They are pattern checks, not understanding: a forbidden claim reworded may get through. Rule patterns are written by the profile's owner, so a pathological pattern can be slow; don't run profiles from untrusted sources without limits.
- **JSON-LD** from the `schemaorg` mapping is HTML-safe. Other outputs are data: escape them for the context you render them in.
- **Links** must be http(s) (or `bundle:` paths for media). That stops `javascript:` and `data:` links, but not links to hostile sites; treat links in third-party profiles accordingly.
- **Audiences decide policy, not identity.** `checkRequester` decides whether a verified requester qualifies. Verifying the OIDC/SAML token, DNS record or signature is the calling application's job.
- **Write-back** treats the employer's data as claims: values are checked, history is kept, locked values aren't changed and person fields are only suggested. It doesn't verify signatures on the payload.
- **Bundles**: paths and symbolic links can't leave the bundle folder, and checksums are verified when given.
- **Other people's data.** Contacts of recommenders, endorsers and references are private by default, never rendered, and released only with the `personContacts` grant. Their words appear only with their recorded consent, and only to the extent its scope allows. A release removes what the scope doesn't cover before any mapping runs; an anonymous author's name, employer and identifiers never leave.
- **Photos.** `media add` refuses images with GPS coordinates unless asked to strip them, and a 2.6.0 bundle with a located image is invalid. Location metadata is read from PNG and JPEG only: WebP, HEIC, AVIF and TIFF can't be checked, so they are refused the same way. Other formats (GIF, PDF) are not inspected. Other metadata (camera, orientation) is kept; check it before publishing.
- **Badges.** Imported credentials are stored unaltered and hashed, but their signatures are not checked yet: an imported badge is a draft until someone confirms it. `badges import` reaches the network only with `--fetch`.
- **Personal government ids** are refused by key and by shape. That's a guard, not a guarantee: don't put them in a profile.
