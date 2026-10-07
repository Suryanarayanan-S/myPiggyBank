import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

describe('production static serving', () => {
  let app: FastifyInstance;
  let dist: string;
  beforeAll(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>myPiggyBank</title>');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    app = await makeApp({ frontendDist: dist });
  });
  afterAll(async () => {
    await app.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('serves index.html at / and for client-side routes', async () => {
    for (const url of ['/', '/settings']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>myPiggyBank</title>');
    }
  });

  it('serves built assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
  });

  it('still returns JSON 404 for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
