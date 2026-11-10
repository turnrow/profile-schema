# Roadmap

Items not done yet, roughly in priority order. Planned milestones are tracked as GitHub issues (2.7 is done; in 2.8, GEDCOM 7.0 and 5.5.1, the plain-text ATS résumé, Open Badges 3.0/CLR 2.0, HR Open and Europass are done, so 2.8 is complete; 2.9 is built: the design, the batch runner, file connectors for Google Workspace and LDAP, and API connectors for Google, Entra, Okta and OneLogin, none yet run against a real directory; 3.0 has its design, the organization schema and the builder): 2.7 (review document and accessible PDF résumé), 2.8 (exports: Open Badges 3.0/CLR 2.0, Europass, HR Open, plain-text ATS, GEDCOM 7.0 and 5.5.1), 2.9 (directory sync) and 3.0 (time-based org chart).

## Trust
- **Badge signature checks.** Verify Open Badges 3.0 proofs (Data Integrity and VC-JWT) and Open Badges 2.0 signed assertions, and check revocation lists, instead of reporting them as not implemented.
- **Badge recipient check.** `verifyBadge` confirms a hosted badge matches the issuer's copy, but not that it was awarded to the profile's subject (Open Badges 2.0 recipients are usually a salted hash of an email address).
- **Signed employer claims.** Accept employer write-backs as W3C Verifiable Credentials and record the signature with the claim, so employment history stays verifiable after the employer is gone.
- **Revocation follow-through.** When a release is revoked, generate the erasure or stop-processing request for the recipient (GDPR Article 17, CCPA deletion), not just a log entry.

## Outputs
- **Endorsements in outputs.** Endorsements are released but not yet rendered; show counts and quotes where a format has a place for them.
- **Reference renderer.** An HTML résumé and profile page built from the profile: WCAG AAA, mobile-first, dark mode, right-to-left scripts, with the JSON-LD embedded.
- **Age-neutral option** for outputs: leave out graduation years and roles older than a set horizon.

## Data quality
- **Rebuild the code lists from the official downloads** (BLS, O*NET, Census) with a script and a checksum, instead of the public copies 2.5.0 was built from.
- **SOC 2028** when OMB publishes it (expected 2027), with the BLS crosswalk from 2018 so existing codes can be suggested forward.
- **ESCO and ISCO lists**, so those codes are checked too, and an O*NET-SOC ↔ ISCO crosswalk.
- **Suggest codes** from a job title using the O*NET "Sample of Reported Titles" and SOC direct-match titles.
- **Per-state identifier formats** (Texas file number, Washington UBI, Oregon BIN…) as optional checks.
- **UEI check character**, if GSA publishes the algorithm.
- **Wikidata import** of organization history (names, "replaces"/"replaced by", owners), cited automatically.

## Developer experience
- TypeScript types generated from the schema; a generated schema reference.
- A decision on publishing to npm (the package is private for now).
- **Read GPS in WebP, HEIC, AVIF and TIFF**, so phone photos can be added without converting them first.
- **`media add --purpose` should end the previous photo's dates** when it adds a newer one, instead of leaving two open-ended rows.
- **Read zipped bundles directly** (`validate bundle.zip`), with the same path and size guards as folders; today a zip must be unzipped first.
- **Translate the field labels of the LinkedIn sheet** ("Company at the time", "Relationship"); only the phrases inside values are translated today.
- A scheduled check that the copy of the JSON Resume schema in `upstream/` is current.
