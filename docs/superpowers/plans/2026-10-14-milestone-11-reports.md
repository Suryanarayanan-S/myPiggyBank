# Milestone 11 — Reports

**Spec:** `docs/superpowers/specs/2026-10-14-mypiggybank-v2-features-design.md` (M11).

## Rules

- The year report reuses the dashboard maths (`buildDashboard`) for `YYYY-01…YYYY-12` and for the
  year before, in the chosen currency (`?currency=`, default spending currency).
- A month is **recorded** when it has any income or expense. Averages are over recorded months.
- **Previous year** is shown whenever it has at least one recorded month, with "N of 12 months
  recorded" so a partial year is never compared silently. Changes are amounts and % (null when
  the previous amount is 0).
- Categories and people are merged across both years by id (a category only in one year shows
  0 in the other), sorted by this year's amount.
- Net worth: the latest snapshot before 1 January (else the first one in the year) and the
  latest on or before 31 December (or today), in the view currency; a snapshot that cannot be
  converted counts as missing.
- CSV (`/reports/year/:year.csv`): semicolons, decimal commas, UTF-8 BOM — like the export.

## Tasks

1. Domain `yearReport` (merge + averages + changes) with tests.
2. Service + routes (`GET /reports/year/:year`, `GET /reports/year/:year.csv`) with API tests.
3. Frontend Reports page (year switcher, month table, totals/averages/last year, categories,
   people, net worth, CSV link, print styles that hide navigation); e2e with screenshots.
