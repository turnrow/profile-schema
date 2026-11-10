# FamilySearch GEDCOM 7: structure tables and test files

Unmodified copies from the FamilySearch GEDCOM specification, used by the tests to check the GEDCOM 7 export against the standard itself.

| File | From | What it is |
|---|---|---|
| `substructures.tsv`, `cardinalities.tsv`, `payloads.tsv`, `enumerationsets.tsv`, `enumerations.tsv`, `grammar.abnf` | `extracted-files/` in [FamilySearch/GEDCOM](https://github.com/FamilySearch/GEDCOM) (`main`, fetched 2026-11-10) | Which structures may appear where, how often, with what kind of value. |
| `maximal70.ged`, `minimal70.ged`, `escapes.ged`, `maximal70.gdz` | [gedcom.io/testfiles/gedcom70](https://gedcom.io/testfiles/gedcom70/) (fetched 2026-11-10) | The official test files. The tests' checker must accept these before it is trusted on our own output. |

Licensed under the Apache License 2.0; see `LICENSE` and `NOTICE`. The specification is at [gedcom.io](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html).
