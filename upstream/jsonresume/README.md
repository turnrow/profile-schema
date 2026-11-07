# Upstream: JSON Resume schema

These files are an unmodified copy of the JSON Resume schema, used as the compatibility target for this project's JSON Resume export (`mappings/jsonresume.json`) and import (`lib/import-jsonresume.mjs`). The tests validate our export against `schema.json` here.

- Source: [jsonresume/jsonresume.org](https://github.com/jsonresume/jsonresume.org), `packages/schema`
- Version: `@jsonresume/schema` 1.7.1
- Commit: `692eabc` (7 Nov 2026)
- Licence: MIT, © JSON Resume (see `LICENSE.md` in this folder)

This repository began as a fork of the archived [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema). Development of the JSON Resume schema moved to the monorepo above, so the copy here is taken from there.

To refresh: copy `schema.json`, `job-schema.json`, `sample.resume.json`, `sample.job.json` and `LICENSE.md` from the monorepo's `packages/schema`, update the version and commit above, and run `npm test`.
