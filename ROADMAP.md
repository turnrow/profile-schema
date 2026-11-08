# Roadmap

Items found in the 2.4.0 review that aren't done yet, roughly in priority order.

## Trust
- **Signed employer claims.** Accept employer write-backs as W3C Verifiable Credentials and record the signature with the claim, so employment history stays verifiable after the employer is gone.
- **Revocation follow-through.** When a release is revoked, generate the erasure or stop-processing request for the recipient (GDPR Article 17, CCPA deletion), not just a log entry.

## Outputs
- **Reference renderer.** An HTML résumé and profile page built from the profile: WCAG AAA, mobile-first, dark mode, right-to-left scripts, with the JSON-LD embedded.
- **Plain-text ATS résumé** that applicant tracking systems parse reliably.
- **Europass and HR Open Standards** mappings (Europass needs a JSON-to-XML step).
- **Age-neutral option** for outputs: leave out graduation years and roles older than a set horizon.

## Data quality
- **Per-state identifier formats** (Texas file number, Washington UBI, Oregon BIN…) as optional checks.
- **UEI check character**, if GSA publishes the algorithm.
- **Wikidata import** of organization history (names, "replaces"/"replaced by", owners), cited automatically.

## Developer experience
- TypeScript types generated from the schema; a generated schema reference.
- A decision on publishing to npm (the package is private for now).
- A scheduled check that the copy of the JSON Resume schema in `upstream/` is current.
