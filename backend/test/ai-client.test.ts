import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicClient } from '../src/ai/client.js';

/** A one-answer stand-in for the Anthropic API. */
async function serve(reply: { status?: number; text: string; stop_reason?: string }) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = reply.status ?? 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify(
          reply.status
            ? { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }
            : {
                id: 'msg_test',
                type: 'message',
                role: 'assistant',
                model: 'claude-test',
                content: [{ type: 'text', text: reply.text }],
                stop_reason: reply.stop_reason ?? 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 700, output_tokens: 30 },
              },
        ),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return anthropicClient({ apiKey: 'k', model: 'claude-test', baseURL: `http://127.0.0.1:${port}` });
}
const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const schema = z.object({ answers: z.array(z.number()) });
const req = { system: 's', prompt: 'p', schema };

describe('anthropicClient', () => {
  it('reads an answer in the schema, with its tokens', async () => {
    const ai = await serve({ text: '{"answers":[1,2]}' });
    expect(await ai.json(req)).toEqual({
      data: { answers: [1, 2] },
      model: 'claude-test',
      inputTokens: 700,
      outputTokens: 30,
    });
  });

  it('a cut-off, refused or misshaped answer gives no data, but its tokens still count', async () => {
    for (const reply of [
      { text: '{"answers":[1,', stop_reason: 'max_tokens' },
      { text: 'I cannot help with that.', stop_reason: 'refusal' },
      { text: '{"answers":"none"}' },
      { text: 'not json' },
    ]) {
      const ai = await serve(reply);
      expect(await ai.json(req)).toMatchObject({ data: null, inputTokens: 700, outputTokens: 30 });
    }
  });

  it('a refused key is said plainly', async () => {
    const ai = await serve({ status: 401, text: '' });
    await expect(ai.json(req)).rejects.toMatchObject({
      code: 'AI_FAILED',
      message: 'The AI key was refused: check ANTHROPIC_API_KEY in .env',
    });
  });
});
