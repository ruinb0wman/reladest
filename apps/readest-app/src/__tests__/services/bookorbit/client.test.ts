import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookOrbitClient } from '@/services/bookorbit/client';
import type { BookOrbitTarget } from '@/services/bookorbit/client';

const server: BookOrbitTarget = {
  serverUrl: 'http://localhost:13380',
  username: 'admin',
  password: 'pw',
  accessToken: 'stale-token',
};

const json = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const authHeader = (call: unknown[]): string | undefined =>
  (call[1] as { headers?: Record<string, string> })?.headers?.['Authorization'];

describe('BookOrbitClient', () => {
  // The access token lives 15 minutes and /auth/refresh needs a cookie a native
  // client never has, so a 401 means "log in again with the stored credentials".
  it('re-logs in and retries once on 401', async () => {
    const onTokensUpdated = vi.fn();
    fetchMock
      .mockResolvedValueOnce(json({ message: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(json({ accessToken: 'fresh-token', user: {} }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new BookOrbitClient(server, { onTokensUpdated });

    await client.putPlaybackState(9, {
      assetId: 'aud_x',
      positionMs: 1234,
      capturedAt: '2026-09-19T00:00:00.000Z',
      operationId: '11111111-2222-4333-8444-555555555555',
      baseRevision: 3,
      manifestRevision: 'a'.repeat(64),
    });

    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:13380/api/v1/auth/login');
    expect(authHeader(fetchMock.mock.calls[2]!)).toBe('Bearer fresh-token');
    // The caller persists the new token; a captured copy would go stale.
    expect(onTokensUpdated).toHaveBeenCalledWith({ accessToken: 'fresh-token' });
  });

  it('logs in once when concurrent requests all see 401', async () => {
    fetchMock.mockImplementation(
      async (url: string, init?: { headers?: Record<string, string> }) => {
        if (url.endsWith('/auth/login')) return json({ accessToken: 'fresh-token', user: {} });
        if (init?.headers?.['Authorization'] === 'Bearer fresh-token') return json({ ok: true });
        return json({ message: 'Unauthorized' }, 401);
      },
    );
    const client = new BookOrbitClient(server, { onTokensUpdated: vi.fn() });

    await Promise.all([
      client.putPlaybackState(9, {
        assetId: 'a',
        positionMs: 1234,
        capturedAt: '2026-09-19T00:00:00.000Z',
        operationId: '11111111-2222-4333-8444-555555555555',
        baseRevision: 3,
        manifestRevision: 'a'.repeat(64),
      }),
      client.putPlaybackState(10, {
        assetId: 'b',
        positionMs: 1234,
        capturedAt: '2026-09-19T00:00:00.000Z',
        operationId: '11111111-2222-4333-8444-555555555555',
        baseRevision: 3,
        manifestRevision: 'a'.repeat(64),
      }),
      client.putPlaybackState(11, {
        assetId: 'c',
        positionMs: 1234,
        capturedAt: '2026-09-19T00:00:00.000Z',
        operationId: '11111111-2222-4333-8444-555555555555',
        baseRevision: 3,
        manifestRevision: 'a'.repeat(64),
      }),
    ]);

    const logins = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'));
    expect(logins).toHaveLength(1);
  });

  it('sends a playback position in the shape the server validates', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    const client = new BookOrbitClient(server, { onTokensUpdated: vi.fn() });

    await client.putPlaybackState(9, {
      assetId: 'aud_x',
      positionMs: 1234,
      capturedAt: '2026-09-19T00:00:00.000Z',
      operationId: '11111111-2222-4333-8444-555555555555',
      baseRevision: 3,
      manifestRevision: 'a'.repeat(64),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://localhost:13380/api/v1/audiobooks/9/playback-state');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({ assetId: 'aud_x', positionMs: 1234 });
  });
});
