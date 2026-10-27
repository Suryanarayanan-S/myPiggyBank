import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AiClient, AiRequest } from '../src/ai/client.js';
import { AppError } from '../src/lib/errors.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

/** A stand-in for Claude: answers from a table of payee words, and remembers what it was sent. */
function fakeAi(table: Record<string, string> = {}) {
  const sent: AiRequest<unknown>[] = [];
  const ai: AiClient = {
    async json<T>(req: AiRequest<T>) {
      sent.push(req as AiRequest<unknown>);
      const payload = JSON.parse(req.prompt.slice(req.prompt.indexOf('{')));
      const keyOf = (name: string) =>
        payload.categories.find((c: { name: string }) => c.name === name)?.key ?? null;
      const answers = payload.lines.map((l: { line: number; text: string }) => {
        const hit = Object.entries(table).find(([word]) => l.text.includes(word));
        return { line: l.line, category: hit ? keyOf(hit[1]) : null };
      });
      return {
        data: req.schema.parse({ answers }),
        model: 'fake-model',
        inputTokens: 1000,
        outputTokens: 50,
      };
    },
  };
  return { ai, sent };
}

const row = (index: number, description: string, amount = 480, type = 'expense') => ({
  index,
  description,
  type,
  amount,
});

describe('AI suggestions', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let cat: (n: string) => string;
  const start = async (ai: AiClient | null, monthlyTokens = 2_000_000) => {
    app = await makeApp({ ai: ai && { client: ai, model: 'fake-model', monthlyTokens } });
    call = client(app, (await signUp(app)).cookie);
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    cat = (n) => cats.find((c) => c.name === n)!.id;
  };
  beforeEach(resetDb);
  afterEach(() => app?.close());

  it('without a key on the server, says it is not set up and never asks', async () => {
    await start(null);
    expect((await call('GET', '/api/ai/status')).json().data).toEqual({
      available: false,
      enabled: false,
      model: null,
      usedTokens: 0,
      monthlyTokens: null,
    });
    await call('PUT', '/api/family', { aiSuggestions: true });
    const res = await call('POST', '/api/ai/categorize', {
      currency: 'EUR',
      rows: [row(0, 'Bäckerei')],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AI_NOT_SET_UP');
  });

  it('is off for a family until switched on', async () => {
    const { ai, sent } = fakeAi();
    await start(ai);
    expect((await call('GET', '/api/ai/status')).json().data).toMatchObject({
      available: true,
      enabled: false,
      model: 'fake-model',
    });
    const res = await call('POST', '/api/ai/categorize', {
      currency: 'EUR',
      rows: [row(0, 'Bäckerei')],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AI_OFF');
    expect(sent).toHaveLength(0);
    const family = (await call('PUT', '/api/family', { aiSuggestions: true })).json().data;
    expect(family.aiSuggestions).toBe(true);
  });

  it('suggests categories per line, asks about each text once, masks numbers, counts usage', async () => {
    const { ai, sent } = fakeAi({ Bäckerei: 'Groceries', Employer: 'Salary', Pizza: 'Salary' });
    await start(ai);
    await call('PUT', '/api/family', { aiSuggestions: true });
    const res = await call('POST', '/api/ai/categorize', {
      currency: 'EUR',
      rows: [
        row(0, 'Bäckerei Schäfer DE89370400440532013000'),
        row(3, 'Employer GmbH', 375000, 'income'),
        row(4, 'Bäckerei  schäfer de89370400440532013000'), // same text, other spacing and case
        row(6, 'Pizza Roma'), // an income category for a payment: dropped
        row(7, 'Unknown shop'),
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      suggestions: [
        { index: 0, categoryId: cat('Groceries') },
        { index: 4, categoryId: cat('Groceries') },
        { index: 3, categoryId: cat('Salary') },
      ],
      asked: 4,
      left: 0,
      error: null,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.prompt).toContain('[IBAN]');
    expect(sent[0]!.prompt).not.toContain('DE89');
    expect((await call('GET', '/api/ai/status')).json().data.usedTokens).toBe(1050);
  });

  it('asks in batches of 100 and at most 200 texts per request', async () => {
    const { ai, sent } = fakeAi();
    await start(ai);
    await call('PUT', '/api/family', { aiSuggestions: true });
    const rows = Array.from({ length: 250 }, (_, i) => row(i, `Shop ${i}`));
    const data = (await call('POST', '/api/ai/categorize', { currency: 'EUR', rows })).json().data;
    expect(sent).toHaveLength(2);
    expect(data).toMatchObject({ asked: 200, left: 50 });
  });

  it('stops at the monthly limit', async () => {
    const { ai, sent } = fakeAi();
    await start(ai, 1000);
    await call('PUT', '/api/family', { aiSuggestions: true });
    const ask = () =>
      call('POST', '/api/ai/categorize', { currency: 'EUR', rows: [row(0, 'Shop')] });
    expect((await ask()).statusCode).toBe(200);
    const res = await ask();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('AI_LIMIT');
    expect(sent).toHaveLength(1);
  });

  it('the monthly limit is for the whole server, not per family', async () => {
    const { ai, sent } = fakeAi();
    await start(ai, 1000);
    await call('PUT', '/api/family', { aiSuggestions: true });
    await call('POST', '/api/ai/categorize', { currency: 'EUR', rows: [row(0, 'Shop')] });
    // a newly registered family gets no fresh allowance
    const other = client(app, (await signUp(app)).cookie);
    await other('PUT', '/api/family', { aiSuggestions: true });
    const res = await other('POST', '/api/ai/categorize', {
      currency: 'EUR',
      rows: [row(0, 'Shop')],
    });
    expect(res.json().error.code).toBe('AI_LIMIT');
    expect(sent).toHaveLength(1);
  });

  it('one request per family at a time: a parallel one is refused before asking', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { ai: inner, sent } = fakeAi();
    const ai: AiClient = { json: async (req) => (await gate, inner.json(req)) };
    await start(ai);
    await call('PUT', '/api/family', { aiSuggestions: true });
    const ask = () =>
      call('POST', '/api/ai/categorize', { currency: 'EUR', rows: [row(0, 'Shop')] });
    const first = ask();
    await new Promise((r) => setTimeout(r, 50));
    const second = await ask();
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('AI_BUSY');
    release();
    expect((await first).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect((await ask()).statusCode).toBe(200); // free again afterwards
  });

  it('keeps what the first batch found when a later one fails', async () => {
    let calls = 0;
    const { ai: inner } = fakeAi({ 'Shop 1': 'Groceries' });
    const ai: AiClient = {
      json: (req) => {
        calls += 1;
        if (calls === 2) throw new AppError(502, 'AI_FAILED', 'The AI could not be reached');
        return inner.json(req);
      },
    };
    await start(ai);
    await call('PUT', '/api/family', { aiSuggestions: true });
    const rows = Array.from({ length: 150 }, (_, i) => row(i, `Shop ${i}`));
    const data = (await call('POST', '/api/ai/categorize', { currency: 'EUR', rows })).json().data;
    expect(data.error).toBe('The AI could not be reached');
    expect(data.suggestions.length).toBeGreaterThan(0);
  });

  it('a family only ever sees its own usage', async () => {
    const { ai } = fakeAi();
    await start(ai);
    await call('PUT', '/api/family', { aiSuggestions: true });
    await call('POST', '/api/ai/categorize', { currency: 'EUR', rows: [row(0, 'Shop')] });
    const other = client(app, (await signUp(app)).cookie);
    expect((await other('GET', '/api/ai/status')).json().data.usedTokens).toBe(0);
    expect(await prisma.aiUsage.count()).toBe(1);
  });
});
