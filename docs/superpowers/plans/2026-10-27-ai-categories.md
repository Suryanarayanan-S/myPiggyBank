# AI, step 1 and 2: the AI client and categories for bank lines — plan

Goal: when a bank statement is imported, the lines that neither a learned rule nor the built-in
keywords can place get a category suggested by Claude. The user still checks every row and
clicks Import; an accepted suggestion becomes a learned rule, so the same payee is never asked
about twice.

## Decisions

- **Off unless set up twice.** The server needs `ANTHROPIC_API_KEY` in `.env` (no key: no AI,
  nothing changes), and each family switches "AI suggestions" on in Settings (off by default).
- **One client** (`backend/src/ai/client.ts`): `AiClient.json({system, prompt, schema})` →
  `{data, usage}`. The real one uses the Anthropic SDK (`messages.parse` + `zodOutputFormat`,
  effort low); tests pass a fake through `buildApp({ai})`, so no test goes online. Model from
  `AI_MODEL` (default `claude-opus-5-5`; `claude-haiku-5-5` is cheaper), endpoint from
  `ANTHROPIC_BASE_URL` (e2e points it at a local stub). SDK errors become a clear `AI_FAILED`.
- **What leaves the server** (`domain/redact.ts`): only the line's text, its type and amount,
  and the family's category names. IBANs, card/account numbers (runs of 6+ digits), PANs, emails
  and phone numbers are masked first. Never the database, names of people or account names.
- **Usage** (`AiUsage` table: feature, model, tokens): shown in Settings; a monthly token limit
  (`AI_MONTHLY_TOKENS`, default 2,000,000) stops further calls with a clear message.
- **Categories** (`domain/aiCategorize.ts` pure, `services/aiCategoryService.ts`):
  `POST /api/ai/categorize {rows:[{index, description, type, amount}], currency}`. Distinct texts
  only (same text once), at most 200 per request, 100 per call. Categories are sent with short
  keys (`c1`…) and their bucket names; the answer may only name a key of the row's kind or
  nothing ("unsure" is allowed and preferred to a guess). Anything else is dropped.
- **Import screen**: after "Check rows", rows without a suggestion (and not already imported)
  are sent; the answers fill only boxes the user has not touched, marked "AI". "Remember" is on
  for them, so importing saves the rule (existing behaviour). A failure only shows a note.
  The "read on this server only" line says what is sent when AI is on.
- **Settings**: an "AI suggestions" card — the switch, what is sent, this month's usage, or
  "not set up on this server" with what to add to `.env`.

## Steps (test-first, one commit)

1. Schema: `Family.aiSuggestions`, `AiUsage`; migration (sorts last).
2. `redact`, prompt/answer domain functions; unit tests.
3. Client, usage/limit service, `/ai/status`, `/ai/categorize`; tests with a fake client.
4. Config, server wiring, compose/.env.example.
5. Frontend: Settings card, import screen; e2e with a stub AI server.
6. Check, e2e, review, deploy.
