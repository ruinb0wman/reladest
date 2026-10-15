import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';

/**
 * #5910: the reader's sync row read ONLY Readest Cloud's per-book stamps, so a
 * user syncing exclusively through WebDAV / iCloud / Drive / S3 was told "Never
 * synced" — or, with no Readest account at all, "Sign in to Sync" — while their
 * sync was working perfectly. This hook is the shared answer to "is my sync
 * healthy?" for both the reader View menu and the library Settings menu.
 */

let mockUser: { id: string } | null = null;
let mockSettings: Partial<SystemSettings> = {};
let mockByKind: Record<string, { isSyncing: boolean }> = {};
let mockLastError: Record<string, string | null> = {};
let mockHardcover: Record<string, { pending: number; lastError: string | null }> = {};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, vars?: Record<string, unknown>): string =>
      vars ? `${key}|${JSON.stringify(vars)}` : key,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Partial<SystemSettings> }) => unknown) =>
    selector({ settings: mockSettings }),
}));
vi.mock('@/store/fileSyncStore', () => ({
  useFileSyncStore: (
    selector: (s: { byKind: unknown; lastErrorByKind: unknown }) => unknown,
  ): unknown => selector({ byKind: mockByKind, lastErrorByKind: mockLastError }),
}));
vi.mock('@/store/hardcoverSyncStore', () => ({
  useHardcoverSyncStore: (selector: (s: { byBook: typeof mockHardcover }) => unknown): unknown =>
    selector({ byBook: mockHardcover }),
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({
  getReadyFileSyncBackends: (settings: Partial<SystemSettings>) => {
    const ready: string[] = [];
    if (settings?.webdav?.enabled) ready.push('webdav');
    return ready;
  },
}));

const { useCloudSyncStatus } = await import('@/hooks/useCloudSyncStatus');

const NOW = 1_700_000_000_000;

beforeEach(() => {
  mockUser = null;
  mockSettings = {};
  mockByKind = {};
  mockLastError = {};
  mockHardcover = {};
  vi.setSystemTime(NOW);
});

describe('useCloudSyncStatus (issue #5910)', () => {
  it('reports a third-party backend as synced with no Readest account', () => {
    mockSettings = { webdav: { enabled: true, lastSyncedAt: NOW - 60_000 } } as never;
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.needsSignIn).toBe(false);
    expect(result.current.label).toContain('Synced {{time}}');
    expect(result.current.lastSyncedAt).toBe(NOW - 60_000);
    expect(result.current.providers.map((p) => p.kind)).toEqual(['webdav']);
  });

  it('never asks for sign-in — a LAN build has no account to sign into', () => {
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.needsSignIn).toBe(false);
    expect(result.current.label).toBe('Never synced');
  });

  it('reports only the file backend, with its own timestamp', () => {
    mockUser = { id: 'u1' };
    mockSettings = {
      webdav: { enabled: true, lastSyncedAt: NOW - 120_000 },
    } as never;
    const { result } = renderHook(() => useCloudSyncStatus(NOW - 300_000));

    expect(result.current.providers).toEqual([
      expect.objectContaining({ kind: 'webdav', lastSyncedAt: NOW - 120_000 }),
    ]);
    // The hook's `nativeLastSyncedAt` argument belonged to the Readest Cloud
    // rows and no longer contributes.
    expect(result.current.lastSyncedAt).toBe(NOW - 120_000);
  });

  it('reports an in-flight backend run', () => {
    mockSettings = { webdav: { enabled: true, lastSyncedAt: NOW - 60_000 } } as never;
    mockByKind = { webdav: { isSyncing: true } };
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.syncing).toBe(true);
    expect(result.current.label).toBe('Syncing…');
  });

  it('reports a backend whose last run failed, over a stale success', () => {
    mockSettings = { webdav: { enabled: true, lastSyncedAt: NOW - 60_000 } } as never;
    mockLastError = { webdav: 'ETIMEDOUT' };
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.failed).toBe(true);
    expect(result.current.label).toBe('Sync failed');
  });
});

describe('useCloudSyncStatus Hardcover (book scope)', () => {
  const hardcover = (over = {}) =>
    ({
      hardcover: {
        enabled: true,
        autoSync: true,
        accessToken: 'tok',
        lastSyncedAt: NOW - 60_000,
        ...over,
      },
    }) as never;

  it('is a book-scope provider only, with its own timestamp', () => {
    mockSettings = hardcover();

    const library = renderHook(() => useCloudSyncStatus(0)).result.current;
    expect(library.providers).toEqual([]);
    expect(library.label).toBe('Never synced');

    const book = renderHook(() => useCloudSyncStatus(0, 'book-a')).result.current;
    expect(book.providers).toEqual([
      expect.objectContaining({ kind: 'hardcover', name: 'Hardcover', lastSyncedAt: NOW - 60_000 }),
    ]);
    expect(book.label).toContain('Synced {{time}}');
  });

  it('is a provider with Auto Sync off, since the row push is a manual sync', () => {
    mockSettings = hardcover({ autoSync: false });
    const { result } = renderHook(() => useCloudSyncStatus(0, 'book-a'));
    expect(result.current.providers.map((p) => p.kind)).toEqual(['hardcover']);
  });

  it('is omitted when disconnected or missing a token', () => {
    for (const over of [{ enabled: false }, { accessToken: '' }]) {
      mockSettings = hardcover(over);
      const { result } = renderHook(() => useCloudSyncStatus(0, 'book-a'));
      expect(result.current.providers).toEqual([]);
    }
  });

  it("reports this book's in-flight and failed pushes, not another book's", () => {
    mockSettings = hardcover();
    mockHardcover = { 'book-a': { pending: 1, lastError: null } };
    expect(renderHook(() => useCloudSyncStatus(0, 'book-a')).result.current.label).toBe('Syncing…');

    mockHardcover = { 'book-a': { pending: 0, lastError: 'boom' } };
    const a = renderHook(() => useCloudSyncStatus(0, 'book-a')).result.current;
    expect(a.failed).toBe(true);
    expect(a.label).toBe('Sync failed');

    const b = renderHook(() => useCloudSyncStatus(0, 'book-b')).result.current;
    expect(b.failed).toBe(false);
    expect(b.label).toContain('Synced {{time}}');
  });

  it('lists Hardcover alongside the file backend without a sign-in prompt', () => {
    mockSettings = { hardcover: { enabled: true, autoSync: true, accessToken: 'tok' } } as never;
    const { result } = renderHook(() => useCloudSyncStatus(0, 'book-a'));

    expect(result.current.providers.map((p) => p.kind)).toEqual(['hardcover']);
    expect(result.current.needsSignIn).toBe(false);
  });
});
