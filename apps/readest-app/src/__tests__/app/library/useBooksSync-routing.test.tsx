import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * `pullLibrary` in useBooksSync.ts has one sync path in a LAN build: the file
 * backend's pass. Upstream there was also a "native pull" of the Readest Cloud
 * book rows, and this file covered all four combinations of the two (#5062);
 * that provider is gone, so the cases below pin the two that remain — a
 * configured backend runs the pass, no configured backend runs nothing — plus
 * the rule that outcome reporting belongs to the pass, not this hook.
 *
 * `getActiveFileSyncBackends` is settable per test (unlike
 * demo-books-sync.test.tsx, which hardcodes it to the one scenario where the
 * branches cannot be observed) so both paths can actually be exercised.
 */

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
  generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  downloadBookCovers: vi.fn(async (_books: Book[]) => {}),
}));

const syncState = vi.hoisted(() => ({
  useSyncInited: true,
  syncedBooks: null as Book[] | null,
  syncBooks: vi.fn(async (_books?: Book[], _op?: string, _since?: number) => 0),
  // Kept falsy so the auto-sync effect's 'both' branch (which is not what
  // these tests are about) never fires and never contends with pullLibrary
  // over the shared isPullingRef guard. See the module doc comment above.
  lastSyncedAtBooks: 0,
}));

// Per-test-settable routing inputs, read by the mocked cloudSyncProvider
// functions below instead of being hardcoded to one scenario.
const routing = vi.hoisted(() => ({
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileLibrarySyncPass = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ booksSynced: number; indexPushFailed?: boolean } | null> => ({
      booksSynced: 1,
    }),
  ),
);

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));

vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (text: string, params?: Record<string, string | number>): string => {
      if (!params) return text;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        text,
      );
    },
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => syncState,
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileLibrarySyncPass,
}));

const { useBooksSync } = await import('@/app/library/hooks/useBooksSync');
const { useLibraryStore } = await import('@/store/libraryStore');
const { eventDispatcher } = await import('@/utils/event');

beforeEach(() => {
  vi.clearAllMocks();
  appService.downloadBookCovers.mockReset().mockResolvedValue(undefined);
  syncState.syncedBooks = null;
  syncState.lastSyncedAtBooks = 0;
  routing.backends = [];
  useLibraryStore.setState({ library: [], libraryLoaded: true, isSyncing: false });
});

afterEach(() => {
  // Without this, a hook instance left mounted from a prior test can
  // re-render (its `pullLibrary` callback is unstable across renders because
  // the mocked useEnv returns a fresh `envConfig` object every time) when a
  // later test mutates the shared zustand stores, re-firing its effects with
  // that later test's routing values and polluting its mock call counts.
  cleanup();
});

describe('useBooksSync pullLibrary routing (issue #5062)', () => {
  it('runs the file pass and never the native pull', async () => {
    routing.backends = ['webdav'];

    renderHook(() => useBooksSync());

    // The mount effect calls pullLibrary() once automatically.
    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());
    expect(syncState.syncBooks).not.toHaveBeenCalled();
  });

  it('runs nothing when no backend is configured', async () => {
    routing.backends = [];

    renderHook(() => useBooksSync());

    // Nothing is configured, so the pass must not even start.
    await act(async () => {
      await Promise.resolve();
    });
    expect(runFileLibrarySyncPass).not.toHaveBeenCalled();
    expect(syncState.syncBooks).not.toHaveBeenCalled();
  });

  it('leaves outcome reporting to the pass, so one run yields one toast', async () => {
    // The toast for a library-wide run is emitted by `notifySyncOutcome`, called
    // from inside `runFileLibrarySyncPass`. A toast here as well would double-fire
    // for every pull.
    routing.backends = ['webdav'];

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksSync());

    // Let the mount effect's pullLibrary() call settle first so it doesn't
    // contend with the explicit call below over isPullingRef.
    await waitFor(() => expect(runFileLibrarySyncPass).toHaveBeenCalled());

    dispatchSpy.mockClear();
    runFileLibrarySyncPass.mockClear();

    await act(async () => {
      await result.current.pullLibrary();
    });

    expect(runFileLibrarySyncPass).toHaveBeenCalledTimes(1);
    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(0);
  });
});
