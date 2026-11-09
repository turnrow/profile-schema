# Code lists

The validator checks occupation, industry and skill codes against these lists, and outputs fill in official titles from them. Each file names its source inside (`publisher`, `url`, `edition`).

| File | What | Source | License |
|---|---|---|---|
| `soc-2018.json` | 2018 Standard Occupational Classification: 23 major groups, 98 minor groups, 459 broad occupations, 867 detailed occupations | U.S. Bureau of Labor Statistics, [bls.gov/soc/2018](https://www.bls.gov/soc/2018/) | U.S. government work, public domain |
| `onet-soc.json` | O*NET-SOC 2019 taxonomy: 1,016 occupation codes and titles | O*NET 31.0 database (August 2026), [onetcenter.org](https://www.onetcenter.org/database.html) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `onet-elements.json` | O*NET content-model elements: abilities (1.A), essential skills (2.A), transferable skills (2.B), knowledge (2.C), software skills (2.E) and work activities (4.A) | O*NET 31.0, Content Model Reference | CC BY 4.0 |
| `naics-2022.json` | 2022 North American Industry Classification System, 2- to 6-digit codes | U.S. Census Bureau, [census.gov/naics](https://www.census.gov/naics/) | U.S. government work, public domain |

## Attribution (O*NET)

This product includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. Turnrow Solutions Group has modified all or some of this information: only codes, titles and element names are kept. USDOL/ETA has not approved, endorsed, or tested these modifications.

## How these were made

`scripts/build-code-lists.mjs` builds every file here from the official release files, and records each input's SHA-256 in the output (`inputs`). These files are generated: change the script or its inputs, never the JSON by hand.

```sh
node scripts/build-code-lists.mjs --soc <BLS 2018 SOC structure.csv> --onet <db_31_0_text folder> --naics "<2-6 digit_2022_Codes.csv>"
```

The build machine couldn't reach bls.gov, onetcenter.org or census.gov directly, so this release was built from public copies of the official files, checked as follows:

- **SOC 2018:** the BLS structure as imported by the Open Skills Network's [OSMT](https://github.com/CredentialEngine/osmt) (`import/BLS-Import.csv`). The counts match the 2018 SOC exactly (23 / 98 / 459 / 867).
- **O*NET 31.0:** `Occupation Data.txt` and `Content Model Reference.txt` from the August 2026 text database. Two independent public copies had byte-identical files (SHA-256 `164236c5…` and `532e9fa2…`). There are 1,016 O*NET-SOC codes, matching the 2019 taxonomy. Codes and element names are unchanged from 30.3, so profiles that cite 30.3 are still checked.
- **NAICS 2022:** the Census Bureau's `2-6 digit_2022_Codes` file, as kept in the U.S. EPA's [flowsa](https://github.com/USEPA/flowsa).

Before a release that depends on exact titles, rebuild from the official downloads and compare the recorded hashes. Codes from other editions (SOC 2028 once it's published; earlier NAICS editions) are accepted unchecked, so a profile never has to wait for this folder to be updated.
