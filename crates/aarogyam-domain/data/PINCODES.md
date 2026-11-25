# PIN code data

- Source: India Post, All India Pincode Directory, https://data.gov.in/resource/all-india-pincode-directory-till-last-month
- Fetched via mirror: https://github.com/dropdevrahul/pincodes-india (pincode.csv; its README cites the data.gov.in resource)
- Attribution: Contains data from the All India Pincode Directory, Department of Posts (India Post), published on the Open Government Data (OGD) Platform India (data.gov.in) under GODL-India.
- Licence: Government Open Data License - India (GODL-India), https://data.gov.in/government-open-data-license-india
- Downloaded: 2026-11-24; data date: the mirror's last commit to pincode.csv is 2024-05-05 (the directory is refreshed monthly, so prefer a fresh data.gov.in download)
- Rows: 19299 PINs 57286 bytes gzipped
- Format: gzip of `pin<TAB>district<TAB>state`, title-cased, sorted by PIN

Regenerate: `python3 scripts/gen-pincodes.py <pincode.csv>`
