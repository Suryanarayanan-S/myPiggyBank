import type { PrismaClient } from '@prisma/client';
import type { AiClient, AiRequest } from '../ai/client.js';
import { monthBounds } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';

/**
 * The server's AI: none without ANTHROPIC_API_KEY. `monthlyTokens` is for the whole server (one
 * key pays for every family on it).
 */
export type AiSetup = { client: AiClient; model: string; monthlyTokens: number };

async function usedThisMonth(prisma: PrismaClient, familyId?: string) {
  const { _sum } = await prisma.aiUsage.aggregate({
    where: { familyId, createdAt: { gte: monthBounds(new Date()).start } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (_sum.inputTokens ?? 0) + (_sum.outputTokens ?? 0);
}

export async function aiStatus(prisma: PrismaClient, familyId: string, ai: AiSetup | null) {
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: familyId },
    select: { aiSuggestions: true },
  });
  return {
    available: ai !== null,
    enabled: ai !== null && family.aiSuggestions,
    model: ai?.model ?? null,
    usedTokens: await usedThisMonth(prisma, familyId),
    monthlyTokens: ai?.monthlyTokens ?? null,
  };
}

/**
 * One request to the AI for a family: only when the server has a key, the family switched AI
 * on and this month's tokens are not used up. Every answer's tokens are counted.
 */
export async function askAi<T>(
  prisma: PrismaClient,
  familyId: string,
  ai: AiSetup | null,
  feature: string,
  req: AiRequest<T>,
): Promise<T | null> {
  if (!ai) {
    throw new AppError(
      400,
      'AI_NOT_SET_UP',
      'AI is not set up on this server: add ANTHROPIC_API_KEY to .env and restart',
    );
  }
  const status = await aiStatus(prisma, familyId, ai);
  if (!status.enabled) {
    throw new AppError(403, 'AI_OFF', 'AI suggestions are off: switch them on in Settings');
  }
  if ((await usedThisMonth(prisma)) >= ai.monthlyTokens) {
    throw new AppError(
      429,
      'AI_LIMIT',
      `This month’s AI allowance on this server (${ai.monthlyTokens.toLocaleString('en')} tokens) is used up`,
    );
  }
  const result = await ai.client.json(req);
  await prisma.aiUsage.create({
    data: {
      familyId,
      feature,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  });
  return result.data;
}

const busy = new Set<string>();

/**
 * Runs `work` as the family's only AI request: a second one while it runs is refused, so
 * parallel requests cannot all pass the monthly limit before any of them is counted.
 */
export async function oneAtATime<T>(familyId: string, work: () => Promise<T>): Promise<T> {
  if (busy.has(familyId)) {
    throw new AppError(429, 'AI_BUSY', 'The AI is already working on a request: wait for it');
  }
  busy.add(familyId);
  try {
    return await work();
  } finally {
    busy.delete(familyId);
  }
}
