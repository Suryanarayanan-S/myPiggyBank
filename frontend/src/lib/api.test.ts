import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage } from './api';

const respond = (status: number, body: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('unwraps { data } on success and sends JSON', async () => {
    respond(200, JSON.stringify({ data: { id: 1 } }));
    await expect(api.post('/things', { a: 1 })).resolves.toEqual({ id: 1 });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/things');
    expect(init).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiError carrying the server error code', async () => {
    respond(409, JSON.stringify({ error: { code: 'EMAIL_TAKEN', message: 'Taken' } }));
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'EMAIL_TAKEN', message: 'Taken' });
  });

  it('handles non-JSON error bodies (e.g. proxy errors)', async () => {
    respond(502, '<html>Bad gateway</html>');
    await expect(api.get('/x')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('errorMessage prefers the first validation detail', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', [
      { path: 'password', message: 'Password must be at least 10 characters' },
    ]);
    expect(errorMessage(e)).toBe('Password must be at least 10 characters');
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong');
  });
});
