# GEDCOM 5.5.1: grammar extracted from the specification

GEDCOM 5.5.1 has no machine-readable tables, only the specification itself. `grammar.txt` is the part of it a program can check against: the structure definitions of the lineage-linked grammar and the size limits of the primitive elements.

- **Source:** *The GEDCOM Standard, Release 5.5.1*, [gedcom.io/specifications/ged551.pdf](https://gedcom.io/specifications/ged551.pdf), fetched 2026-11-10.
- **How it was made:** `pdftotext -layout`, then every `NAME:=` definition block in chapter 2 was kept line for line, with prose, page numbers and blank lines removed and runs of spaces collapsed. Nothing was corrected, so the specification's own typos (`{0:1)`) are still there. The size lines (`NAME:= {Size=1:90}`) come from the primitive elements section the same way.
- **What it is not:** the enumerated values and date grammar are described in the specification's prose and are not in this file. The tests' checker states those few rules itself.
- **No official test files** for 5.5.1 could be found to vendor beside it, as there are for 7.0.

Copyright © 1987, 1989, 1992, 1993, 1995, 1999, 2019 by The Church of Jesus Christ of Latter-day Saints. This document may be copied for purposes of review or programming of genealogical software, provided this notice is included. All other rights reserved.
