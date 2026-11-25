#!/usr/bin/env python3
"""Reduce the India Post "All India Pincode Directory" CSV to crates/aarogyam-domain/data/pincodes.tsv.gz.

Usage: python3 scripts/gen-pincodes.py <pincode.csv>
One line per PIN: pin<TAB>district<TAB>state
"""
import csv
import datetime
import gzip
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "crates/aarogyam-domain/data"
SRC_URL = "https://data.gov.in/resource/all-india-pincode-directory-till-last-month"
MIRROR = "https://github.com/dropdevrahul/pincodes-india (pincode.csv; its README cites the data.gov.in resource)"


def title(s):
    return " ".join(w.capitalize() for w in s.strip().split())


def main():
    src = sys.argv[1]
    dist, state = defaultdict(Counter), defaultdict(Counter)
    with open(src, newline="", encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            pin = r["Pincode"].strip()
            # 999999 is a data-entry placeholder in the source, not a real PIN.
            if not re.fullmatch(r"[1-9]\d{5}", pin) or pin == "999999":
                continue
            d, s = title(r["District"]), title(r["StateName"])
            if d in ("", "Na"):
                continue
            dist[pin][d] += 1
            state[pin][s] += 1
    lines = []
    for pin in sorted(dist):
        # most common value; ties broken alphabetically for stable output
        d = min(dist[pin].items(), key=lambda kv: (-kv[1], kv[0]))[0]
        s = min(state[pin].items(), key=lambda kv: (-kv[1], kv[0]))[0]
        lines.append(f"{pin}\t{d}\t{s}\n")
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "pincodes.tsv.gz", "wb") as raw, gzip.GzipFile(
        filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0
    ) as gz:
        gz.write("".join(lines).encode("utf-8"))
    size = (OUT / "pincodes.tsv.gz").stat().st_size
    (OUT / "PINCODES.md").write_text(
        f"""# PIN code data

- Source: India Post, All India Pincode Directory, {SRC_URL}
- Fetched via mirror: {MIRROR}
- Attribution: Contains data from the All India Pincode Directory, Department of Posts (India Post), published on the Open Government Data (OGD) Platform India (data.gov.in) under GODL-India.
- Licence: Government Open Data License - India (GODL-India), https://data.gov.in/government-open-data-license-india
- Downloaded: {datetime.date.today().isoformat()}; data date: the mirror's last commit to pincode.csv is 2024-05-05 (the directory is refreshed monthly, so prefer a fresh data.gov.in download)
- Rows: {len(lines)} PINs {size} bytes gzipped
- Format: gzip of `pin<TAB>district<TAB>state`, title-cased, sorted by PIN

Regenerate: `python3 scripts/gen-pincodes.py <pincode.csv>`
""",
        encoding="utf-8",
    )
    print(len(lines), size)


main()
