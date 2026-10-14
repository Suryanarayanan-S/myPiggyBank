# Milestone 9 — Savings goals

**Spec:** `docs/superpowers/specs/2026-10-14-mypiggybank-v2-features-design.md` (M9).

## Model

- `Goal`: familyId, name (≤ 60), `targetAmount` (BigInt minor units > 0), `currency`,
  `targetDate?`, `memberId?`, `note?`, `status` (`active` | `reached` | `archived`).
- `GoalLink`: goalId, `kind` (`account` | `asset`; `holding` arrives in M10), `refId`.
  Unique per goal + kind + refId. Links are replaced as a whole on save and checked for family
  ownership; a deleted account/asset simply stops counting.
- `GoalEntry`: goalId, date, signed `amount` in the goal currency (withdrawals negative), note.

## Rules

- **Saved at a date** = Σ linked account balances on that date (opening + transactions up to it)
  + Σ linked assets' latest valuation on or before it + Σ entries up to it — each converted into
  the goal currency with the rate of that date's month. Unconvertible parts are listed, not added.
- **Progress** (domain `goalProgress`, pure): `pctBp` (capped display, raw kept), `left`
  (≥ 0), with a target date: `monthsLeft` (whole months from today to the date, at least 1),
  `monthlyNeeded = ceil(left / monthsLeft)`, `pace` = (saved today − saved 3 months ago) / 3,
  `onTrack` = pace ≥ needed. No date → no needed/onTrack. Reached (saved ≥ target) → onTrack
  true, needed 0. Target date in the past and not reached → `overdue`.
- Archived goals are listed separately and never shown on the dashboard.

## Tasks

1. Domain `goalProgress` + tests (edge cases: no date, past date, reached, zero/negative pace,
   rounding up).
2. Schema + migration; service + routes: `GET/POST /goals`, `PUT/DELETE /goals/:id`,
   `POST /goals/:id/entries`, `DELETE /goals/:id/entries/:entryId`; `?currency=` not needed
   (each goal has its own currency). API tests incl. family scoping, foreign link ids → 404,
   conversion and unconverted parts, saved-at-date history.
3. Frontend: Goals page (cards, form with links, entries), dashboard Goals card, navigation.
   E2E with screenshots in modern, dark and retro.
