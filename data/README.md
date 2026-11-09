# Code lists

The validator checks occupation, industry and skill codes against these lists, and outputs fill in official titles from them. Each file names its source inside (`publisher`, `url`, `edition`).

| File | What | Source | Licence |
|---|---|---|---|
| `soc-2018.json` | 2018 Standard Occupational Classification: 23 major groups, 98 minor groups, 459 broad occupations, 867 detailed occupations | U.S. Bureau of Labor Statistics, [bls.gov/soc/2018](https://www.bls.gov/soc/2018/) | U.S. government work, public domain |
| `onet-soc.json` | O*NET-SOC 2019 taxonomy: 1,016 occupation codes and titles | O*NET 30.3 database (May 2026), [onetcenter.org](https://www.onetcenter.org/database.html) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `onet-elements.json` | O*NET content-model elements: abilities (1.A), essential skills (2.A), transferable skills (2.B), knowledge (2.C), software skills (2.E) and work activities (4.A) | O*NET 30.3, Content Model Reference | CC BY 4.0 |
| `naics-2022.json` | 2022 North American Industry Classification System, 2- to 6-digit codes | U.S. Census Bureau, [census.gov/naics](https://www.census.gov/naics/) | U.S. government work, public domain |

## Attribution (O*NET)

This product includes information from the O*NET 30.3 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. Turnrow Solutions Group has modified all or some of this information: only codes, titles and element names are kept. USDOL/ETA has not approved, endorsed, or tested these modifications.

## How these were made

The build machine couldn't reach bls.gov, onetcenter.org or census.gov directly, so the files were built from public copies of the official releases and checked against the published counts:

- SOC 2018: the BLS structure as imported by the Open Skills Network's [OSMT](https://github.com/CredentialEngine/osmt) (`import/BLS-Import.csv`). Counts match the 2018 SOC exactly (23 / 98 / 459 / 867).
- O*NET 30.3: the database's `Occupation Data.txt` and `Content Model Reference.txt`, as redistributed with its CC BY 4.0 notice. 1,016 O*NET-SOC codes, matching the 2019 taxonomy.
- NAICS 2022: Census Bureau's `2-6 digit_2022_Codes` file as kept in the U.S. EPA's [flowsa](https://github.com/USEPA/flowsa).

Rebuild them from the official downloads before a release that depends on exact titles. Codes from other editions (SOC 2028, once published; earlier NAICS) are accepted unchecked, so a profile never has to wait for this folder to be updated.
