import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SetStateAction } from 'react';

import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { INDETERMINATE_PROGRESS, type ProgressHandler } from '@/utils/transfer';

/**
 * A per-book Upload/Download has exactly one destination in a LAN build: the
 * file mirror (WebDAV). Upstream this file also covered the Readest Cloud
 * routing (#5062) and the Books-sync-off gate; both went with that provider.
 *
 * `getActiveFileSyncBackends` is settable per test (same pattern as
 * useBooksSync-routing.test.tsx) so the routing branches can be exercised
 * directly, without rendering the whole library page.
 */

const routing = vi.hoisted(() => ({
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileBookUpload = vi.hoisted(() => vi.fn(async () => true));
const runFileBookDownload = vi.hoisted(() =>
  vi.fn(
    async (
      _envConfig: EnvConfigType,
      _book: Book,
      _onProgress?: ProgressHandler,
    ): Promise<boolean> => true,
  ),
);

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

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileBookUpload,
  runFileBookDownload,
}));

const { useBookTransferActions } = await import('@/app/library/hooks/useBookTransferActions');
const { eventDispatcher } = await import('@/utils/event');

const envConfig: EnvConfigType = { getAppService: async () => ({}) as AppService };

const makeBook = (over: Partial<Book> = {}): Book => ({
  hash: 'book-1',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

type ProgressState = { [key: string]: number };

const setup = (appService: AppService | null = null) => {
  const updateBook = vi.fn(async (_envConfig: EnvConfigType, _book: Book) => {});
  // Mimic React's functional state updates so tests can assert the actual
  // progress transitions (indeterminate start, percentage updates, cleanup).
  let progressState: ProgressState = {};
  const setBooksTransferProgress = vi.fn((updater: SetStateAction<ProgressState>) => {
    progressState = typeof updater === 'function' ? updater(progressState) : updater;
  });
  const { result } = renderHook(() =>
    useBookTransferActions(envConfig, appService, updateBook, setBooksTransferProgress),
  );
  return { result, updateBook, getProgress: () => progressState };
};

beforeEach(() => {
  vi.clearAllMocks();
  routing.backends = [];
});

describe('useBookTransferActions upload routing (issue #5062)', () => {
  it('uploads to the file mirror', async () => {
    routing.backends = ['webdav'];

    const { result } = setup();
    const book = makeBook();
    const ok = await result.current.handleBookUpload(book);

    expect(runFileBookUpload).toHaveBeenCalledWith(envConfig, book);
    expect(ok).toBe(true);
  });

  it('toasts "turn on a provider" and returns false when nothing is enabled', async () => {
    routing.backends = [];
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = setup();
    const book = makeBook();
    const ok = await result.current.handleBookUpload(book);

    expect(runFileBookUpload).not.toHaveBeenCalled();
    expect(ok).toBe(false);
    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({
      type: 'info',
      message: 'Turn on a provider in Cloud Sync settings to upload this book',
    });
  });
});

describe('useBookTransferActions upload failures', () => {
  it('reports a failed file-backend upload', async () => {
    routing.backends = ['webdav'];
    runFileBookUpload.mockResolvedValueOnce(false);
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = setup();
    const ok = await result.current.handleBookUpload(makeBook());

    expect(ok).toBe(false);
    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({
      type: 'error',
      message: 'Failed to upload book: Title',
    });
  });
});

describe('useBookTransferActions download routing (issue #5062)', () => {
  it('tries file mirrors first because uploadedAt does not identify which provider has the book (#5009)', async () => {
    routing.backends = ['webdav'];

    const { result } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(ok).toBe(true);
  });

  it('falls back to a file backend when the book is not in Readest Cloud storage', async () => {
    routing.backends = ['webdav'];

    const { result, updateBook } = setup();
    const book = makeBook({ uploadedAt: null });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(updateBook).toHaveBeenCalledWith(envConfig, book);
    expect(ok).toBe(true);
  });

  it('shows indeterminate progress while a file-backend download runs and clears it on completion', async () => {
    routing.backends = ['webdav'];
    let release!: (ok: boolean) => void;
    runFileBookDownload.mockImplementationOnce(
      () =>
        new Promise<boolean>((res) => {
          release = res;
        }),
    );

    const { result, getProgress } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const promise = result.current.handleBookDownload(book, { queued: true });

    // The native plugin cannot report a byte total up front, so the entry
    // starts indeterminate until progress events arrive.
    expect(getProgress()).toEqual({ [book.hash]: INDETERMINATE_PROGRESS });

    release(true);
    await promise;
    expect(getProgress()).toEqual({});
  });

  it('ignores a progress event that arrives after the transfer finished', async () => {
    // Tauri delivers Channel messages over IPC independently of the invoke
    // response, so the downloader's last payload can land after the command
    // resolved. Nothing clears the entry a second time, so a late event that
    // re-armed the throttle would leave the cover stuck behind a stale overlay
    // with its action button gone, permanently.
    vi.useFakeTimers();
    try {
      routing.backends = ['webdav'];
      let late!: ProgressHandler;
      runFileBookDownload.mockImplementationOnce(async (_env, _book, onProgress) => {
        late = onProgress!;
        return true;
      });

      const { result, getProgress } = setup();
      const book = makeBook({ uploadedAt: 12345 });
      await result.current.handleBookDownload(book, { queued: true });
      expect(getProgress()).toEqual({});

      late({ progress: 90, total: 100, transferSpeed: 0 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(getProgress()).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
