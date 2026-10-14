# Bucket names

User ask: rename Essentials / Fun / Future You to "Keep Me Alive", "Make Me Happy", "Make Me Rich",
and hear other funny suggestions.

- Family columns `nameEssentials`, `nameFun`, `nameFuture` (defaults: the user's names), editable in
  Settings → Family (trimmed, 1–30 characters, distinct, not a label the pages already use).
- Bucket keys stay `essentials` / `fun` / `future`; every label, chart, insight sentence and CSV uses
  the family's names (`useBucketNames`, CSV cells escaped).
- The spreadsheet importer still reads the workbook's own headings (Essentials / Fun / Future You).
