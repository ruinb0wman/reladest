import { eventDispatcher } from '@/utils/event';
import { FileSyncError } from './provider';
import { formatSyncFailure } from './syncResult';

import type { TranslationFunc } from '@/hooks/useTranslation';
import type { SyncLibraryResult } from './engine';
import type { FileSyncBackendKind } from './providerRegistry';

/**
 * The ONE place a library-wide file sync reports its outcome to the user, and it
 * reports by toast — there is no sync-result dialog. Both entry points reach it:
 * `runFileLibrarySyncPass` (pull to refresh, the SettingsMenu sync row, the
 * backup window, the debounced background pass) and the settings form's manual
 * "Sync now", which builds its own engine.
 *
 * The message it returns is also what the caller records as `lastErrorByKind` for
 * the health surfaces, so the toast and the persisted row state never disagree.
 * Failure detail (per-book reasons) rides in the toast body: it is multi-line,
 * scrollable and dismissible there.
 */
export type SyncOutcome = { result?: SyncLibraryResult | null; error?: unknown };

/** Backend-neutral translation of a thrown sync error — the brief toast text. */
export const formatSyncError = (_: TranslationFunc, e: unknown): string => {
  if (e instanceof FileSyncError) {
    switch (e.code) {
      case 'AUTH_FAILED':
        return _('Authentication failed. Reconnect in Settings.');
      case 'NOT_FOUND':
        return _('Remote resource not found');
      case 'NETWORK':
        return _('Network error');
    }
    if (typeof e.status === 'number') {
      return _('Sync failed (status {{status}})', { status: e.status });
    }
  }
  return _('Sync failed.');
};

/**
 * Last failure already shown per backend. A background pass retries on every
 * library change, so without this an offline server would fire a toast per book
 * closed. The same message is shown once; a different one (server came back, then
 * a different failure) is shown again. Cleared by the next success.
 */
const lastNotified = new Map<FileSyncBackendKind, string>();

/** Test seam: the dedupe memory is module state and outlives one test case. */
export const clearSyncNoticeCache = () => lastNotified.clear();

/**
 * Report one backend's finished run. Returns the failure message it recorded
 * (`null` on success) so the caller can feed `lastErrorByKind` from one place.
 *
 * A success is only announced when the run actually moved books — the background
 * pass runs every few seconds while the library is being used, and toasting
 * "0 books synced" each time would be noise.
 */
export const notifySyncOutcome = (
  _: TranslationFunc,
  kind: FileSyncBackendKind,
  { result, error }: SyncOutcome,
): string | null => {
  const failure = error !== undefined ? formatSyncError(_, error) : formatSyncFailure(result!, _);

  if (!failure) {
    lastNotified.delete(kind);
    const count = result?.booksSynced ?? 0;
    if (count > 0) {
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('{{count}} book(s) synced', { count }),
      });
    }
    return null;
  }

  if (lastNotified.get(kind) !== failure) {
    lastNotified.set(kind, failure);
    eventDispatcher.dispatch('toast', { type: 'error', message: failure, timeout: 8000 });
  }
  return failure;
};
