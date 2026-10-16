import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Book } from '@/types/book';

/**
 * The sample shelf must not reach a mirror.
 *
 * `runFileLibrarySyncPass` pushes `useLibraryStore`'s library to WebDAV. The
 * library page merges the sample rows `useDemoBooks` imports into that store so
 * they can be shown, which is how a row nobody imported ended up in the remote
 * `library.json` — and, because the index is a union merge, on every other
 * device too (two identical cards in the phone's library).
 *
 * The filter is on the push side only: a row that is already in the mirror still
 * merges on the way in, or this device would try to re-pull what its peers hold.
 */

const engineCalls = vi.hoisted(() => ({
  syncLibrary: vi.fn(async () => ({ booksSynced: 0 })),
  pushBookFile: vi.fn(async () => ({ uploaded: true })),
  pushBookCover: vi.fn(async () => {}),
  downloadBookFile: vi.fn(async () => true),
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => ['webdav'],
  settingsKeyForBackend: () => 'webdav',
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/services/sync/file/providerRegistry', () => ({
  createFileSyncProvider: async () => ({ rootPath: '/' }),
}));

vi.mock('@/services/sync/file/appLocalStore', () => ({
  createAppLocalStore: () => ({}),
}));

vi.mock('@/services/sync/file/engine', () => ({
  FileSyncEngine: class {
    syncLibrary = engineCalls.syncLibrary;
    pushBookFile = engineCalls.pushBookFile;
    pushBookCover = engineCalls.pushBookCover;
    downloadBookFile = engineCalls.downloadBookFile;
  },
}));

const { runFileBookUpload, runFileLibrarySyncPass } = await import(
  '@/services/sync/file/runLibrarySync'
);
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');

const makeBook = (over: Partial<Book> & Pick<Book, 'hash'>): Book => ({
  format: 'EPUB',
  title: over.hash,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const envConfig = { getAppService: async () => ({}) } as never;

/** The library argument of the last `syncLibrary` call. */
const pushedHashes = (): string[] => {
  const call = engineCalls.syncLibrary.mock.calls.at(-1) as unknown as [Book[]];
  return call[0].map((book) => book.hash);
};

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ library: [], libraryLoaded: true });
  useSettingsStore.setState({
    settings: { webdav: { deviceId: 'device-1', strategy: 'silent' } },
  } as never);
});

describe('the sample shelf and the file-sync mirror', () => {
  it('leaves demo rows out of the library it pushes', async () => {
    useLibraryStore.setState({
      library: [makeBook({ hash: 'demo-1', isDemo: true }), makeBook({ hash: 'mine-1' })],
    });

    await runFileLibrarySyncPass(envConfig, (text: string) => text);

    expect(pushedHashes()).toEqual(['mine-1']);
  });

  it('pushes a real book that carries the sample address', async () => {
    useLibraryStore.setState({
      library: [
        makeBook({ hash: 'demo-1', isDemo: true }),
        makeBook({ hash: 'real-from-demo-url', url: 'http://localhost:17321/demo/testbook.epub' }),
      ],
    });

    await runFileLibrarySyncPass(envConfig, (text: string) => text);

    expect(pushedHashes()).toEqual(['real-from-demo-url']);
  });

  it('refuses the explicit per-book upload of a demo book', async () => {
    const uploaded = await runFileBookUpload(envConfig, makeBook({ hash: 'demo-1', isDemo: true }));

    expect(uploaded).toBe(false);
    expect(engineCalls.pushBookFile).not.toHaveBeenCalled();
  });
});
