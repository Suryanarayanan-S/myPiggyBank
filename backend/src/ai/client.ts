import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';

export type AiRequest<T> = {
  system: string;
  prompt: string;
  /** the answer's shape: the model is held to it, and it is checked again here */
  schema: z.ZodType<T>;
};
export type AiResult<T> = {
  /** null when the model declined, was cut off or answered in another shape */
  data: T | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** The only way the app talks to an AI. Tests pass a fake one to `buildApp`. */
export interface AiClient {
  json<T>(req: AiRequest<T>): Promise<AiResult<T>>;
}

const failed = (message: string) => new AppError(502, 'AI_FAILED', message);

/** Claude through the Anthropic SDK; `baseURL` only for a stand-in server (e2e). */
export function anthropicClient(opts: { apiKey: string; model: string; baseURL?: string }) {
  const sdk = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    // a suggestion that takes longer is not worth waiting for
    timeout: 60_000,
    maxRetries: 1,
  });
  const client: AiClient = {
    async json<T>({ system, prompt, schema }: AiRequest<T>) {
      let response;
      try {
        // `create`, not `parse`: an answer that is cut off or refused was still paid for, so
        // its tokens must come back to be counted; it is read here instead.
        response = await sdk.messages.create({
          model: opts.model,
          max_tokens: 16_000,
          system,
          messages: [{ role: 'user', content: prompt }],
          // small, well-defined tasks: little thinking needed
          output_config: { effort: 'low', format: zodOutputFormat(schema as z.ZodType) },
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError)
          throw failed('The AI key was refused: check ANTHROPIC_API_KEY in .env');
        if (err instanceof Anthropic.RateLimitError)
          throw failed('The AI is busy right now: try again in a minute');
        if (err instanceof Anthropic.APIError)
          throw failed(`The AI could not answer (${err.status ?? 'no connection'})`);
        throw err;
      }
      return {
        data: response.stop_reason === 'end_turn' ? readJson(response.content, schema) : null,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
  return client;
}

/** The answer's text as the schema's shape, or null when it is not. */
function readJson<T>(content: Anthropic.ContentBlock[], schema: z.ZodType<T>): T | null {
  const text = content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
