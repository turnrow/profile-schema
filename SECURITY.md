# Security and privacy

## Reporting a problem

This project handles personal data, so privacy problems count as security problems. If you find a way to leak something a profile marks private, to bypass a content rule, or to make the tools read or write outside what they should, please report it privately using **GitHub's private vulnerability reporting** on this repository (Security → Report a vulnerability). Please don't open a public issue. We aim to acknowledge reports within a week.

## What the tools guarantee, and what they don't

- **Filtering is by declaration.** Outputs include only entries whose visibility, status and confidence the mapping accepts, and person fields hidden by `person.visibility`. A custom mapping can only reach data through the profile it is given; releases give it a profile already reduced to what the audience may see.
- **Content rules** are checked against every string in an output. They are pattern checks, not understanding: a forbidden claim reworded may get through. Rule patterns are written by the profile's owner, so a pathological pattern can be slow; don't run profiles from untrusted sources without limits.
- **JSON-LD** from the `schemaorg` mapping is HTML-safe. Other outputs are data: escape them for the context you render them in.
- **Links** must be http(s) (or `bundle:` paths for media). That stops `javascript:` and `data:` links, but not links to hostile sites; treat links in third-party profiles accordingly.
- **Audiences decide policy, not identity.** `checkRequester` decides whether a verified requester qualifies. Verifying the OIDC/SAML token, DNS record or signature is the calling application's job.
- **Write-back** treats the employer's data as claims: values are checked, history is kept, locked values aren't changed and person fields are only suggested. It doesn't verify signatures on the payload.
- **Bundles**: paths and symbolic links can't leave the bundle folder, and checksums are verified when given.
- **Personal government ids** are refused by key and by shape. That's a guard, not a guarantee: don't put them in a profile.
