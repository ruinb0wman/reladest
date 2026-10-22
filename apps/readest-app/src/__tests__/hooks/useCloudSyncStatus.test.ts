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
