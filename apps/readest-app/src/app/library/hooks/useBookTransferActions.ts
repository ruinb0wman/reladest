import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { createProgressThrottle, toProgressPercent, type ProgressPayload } from '@/utils/transfer';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { runFileBookDownload, runFileBookUpload } from '@/services/sync/file/runLibrarySync';

/**
 * One throttle runs per in-flight transfer, and every emit re-renders the
 * visible shelf, so a bulk download multiplies this rate by the batch size.
 * Matches the cadence of the single page-level throttle this replaced.
 */
const PROGRESS_THROTTLE_MS = 500;

interface BookDownloadOptions {
  redownload?: boolean;
  queued?: boolean;
  // Bulk callers (the select-mode Download action, #5244) report one summary
  // toast for the whole batch instead of one per book — a group can hold
  // hundreds.
  silent?: boolean;
}

/**
 * Explicit per-book Upload/Download routing (#5062) — cloud sync providers are
 * independently selectable, so a book's destinations depend on which of
 * {Readest Cloud, a file backend} are switched on. Extracted out of the huge
 * library page component so this routing (previously untested) can be
 * exercised directly with `renderHook`, the same pattern already used for
 * {@link useBooksSync} and {@link useLibraryFileSync}.
 */
export const useBookTransferActions = (
  envConfig: EnvConfigType,
  appService: AppService | null,
  updateBook: (envConfig: EnvConfigType, book: Book) => Promise<void>,
  setBooksTransferProgress: Dispatch<SetStateAction<{ [key: string]: number }>>,
) => {
  const _ = useTranslation();

  /**
   * Per-book progress reporting for the cover overlay: returns the handler to
   * hand to the transfer, and the teardown to run once it settles.
   *
   * Progress is throttled per transfer (native plugins emit dense per-chunk
   * bursts) and the entry is dropped on teardown, so a stale value cannot
   * linger. The overlay starts indeterminate rather than blank, since no
   * backend knows the byte total until its first progress event.
   *
   * `done()` latches: Tauri delivers Channel progress messages over IPC
   * independently of the invoke response, so a final payload can arrive after
   * the transfer resolved. Nothing clears the entry a second time, so a late
   * event that re-armed the throttle would strand the cover behind a stale
   * overlay with its action button gone, permanently.
   */
  const trackProgress = (bookHash: string) => {
    let settled = false;
    const throttle = createProgressThrottle((progress: ProgressPayload) => {
      setBooksTransferProgress((prev) => {
        const next = toProgressPercent(progress);
        if (prev[bookHash] === next) return prev;
        return { ...prev, [bookHash]: next };
      });
    }, PROGRESS_THROTTLE_MS);
    throttle.push({ progress: 0, total: 0, transferSpeed: 0 });
    return {
      onProgress: (progress: ProgressPayload) => {
        if (!settled) throttle.push(progress);
      },
      done: () => {
        settled = true;
        throttle.cancel();
        setBooksTransferProgress((prev) => {
          if (prev[bookHash] == null) return prev;
          const next = { ...prev };
          delete next[bookHash];
          return next;
        });
      },
    };
  };

  const handleBookUpload = useCallback(
    async (book: Book, _syncBooks = true) => {
      const settingsNow = useSettingsStore.getState().settings;
      const backends = getActiveFileSyncBackends(settingsNow);

      // The file mirror is the only destination a LAN build has, so an
      // explicit Upload reaches it directly (#5062 made it "every selected
      // destination"; there is exactly one now).
      const pushed = backends.length > 0 ? await runFileBookUpload(envConfig, book) : false;

      if (pushed) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: _('Book uploaded: {{title}}', { title: book.title }),
        });
        return true;
      }
      // An explicit Upload action must never silently no-op: with no mirror
      // configured the honest answer is "configure one", not "upload failed".
      eventDispatcher.dispatch('toast', {
        type: backends.length > 0 ? 'error' : 'info',
        timeout: 5000,
        message:
          backends.length > 0
            ? _('Failed to upload book: {{title}}', { title: book.title })
            : _('Turn on a provider in Cloud Sync settings to upload this book'),
      });
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleBookDownload = useCallback(
    async (book: Book, downloadOptions: BookDownloadOptions = {}) => {
      // `redownload` and `queued` were Readest Cloud transfer-queue options;
      // the file mirror always re-reads what it needs, so only `silent` matters.
      const { silent = false } = downloadOptions;
      const settingsNow = useSettingsStore.getState().settings;
      const backends = getActiveFileSyncBackends(settingsNow);
      // `uploadedAt` is stamped by the file-sync engine for a mirrored book, so
      // a metadata-only shelf row has exactly one place to fetch its file from.
      if (backends.length > 0) {
        const tracker = trackProgress(book.hash);
        let ok = false;
        try {
          ok = await runFileBookDownload(envConfig, book, tracker.onProgress);
        } finally {
          tracker.done();
        }
        if (ok) {
          await updateBook(envConfig, book);
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              type: 'info',
              timeout: 2000,
              message: _('Book downloaded: {{title}}', { title: book.title }),
            });
          }
          return true;
        }

        if (!silent) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            timeout: 2000,
            message: _('Failed to download book: {{title}}', { title: book.title }),
          });
        }
        return false;
      }
      // No mirror configured: nothing to fetch the file from. A row can still
      // carry `uploadedAt` from a provider this device has since switched off.
      if (!silent) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          timeout: 2000,
          message: _('Failed to download book: {{title}}', { title: book.title }),
        });
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

  return { handleBookUpload, handleBookDownload };
};
