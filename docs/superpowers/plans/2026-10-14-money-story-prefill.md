# Money story and Quick entry suggestions

User ask: idea 10 (a monthly "money story") and idea 4 (smarter quick entry), each with an on/off
switch in Settings.

- Settings → Extras: `Family.showMoneyStory`, `Family.quickEntryHints` (default on);
  `PUT /family { extras }` (strict, at least one key).
- Money story (dashboard): the latest recorded month among the last six finished ones, against the
  average of the earlier recorded months; one line per bucket with a mood, savings rate vs the
  previous recorded month, biggest real category, uncategorised waiting, unspent/overspent, money
  without a rate. Descriptive only — never advice. `lib/moneyStory.ts` (tested).
- Quick entry: rows carry `lastMonth` and `usual` (average over recorded months among the three
  before) from money in the account's currency — without other accounts' grid totals and without
  recurring payments. "Like last month" / "Usual amounts" fill empty boxes only (categories without
  individual transactions this month); nothing is saved until Save.

**Update (2026-10-15):** the user asked to remove the money story; it is gone (code, switch and
`showMoneyStory` column). Quick entry suggestions stay.
