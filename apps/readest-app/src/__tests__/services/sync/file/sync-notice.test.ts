import { beforeEach, describe, expect, test, vi } from 'vitest';

import { eventDispatcher } from '@/utils/event';
import { FileSyncError } from '@/services/sync/file/provider';
import {
  clearSyncNoticeCache,
  formatSyncError,
  notifySyncOutcome,
} from '@/services/sync/file/syncNotice';
import type { SyncLibraryResult } from '@/services/sync/file/engine';

/**
 * `notifySyncOutcome` is the single place a library-wide file sync reports to the
 * user, and it reports by toast — the sync-result dialog is gone. Two rules the
 * dialog could not express are pinned here: nothing is announced for a run that
 * moved no books (the background pass runs on every library change), and the same
 * failure is shown once rather than once per retry.
 */

// Mirrors the real translator for the keys this module uses.
const _ = ((key: string, params?: Record<string, string | number>) =>
  params ? key.replace(/{{(\w+)}}/g, (_m, k: string) => String(params[k] ?? '')) : key) as never;

const ok = (booksSynced: number): SyncLibraryResult => ({ booksSynced }) as SyncLibraryResult;

const dispatch = () => vi.spyOn(eventDispatcher, 'dispatch');
const toasts = (spy: ReturnType<typeof dispatch>) =>
  spy.mock.calls.filter(([event]) => event === 'toast').map(([, detail]) => detail);

beforeEach(() => {
  vi.restoreAllMocks();
  clearSyncNoticeCache();
});

describe('notifySyncOutcome — success', () => {
  test('toasts the book count', () => {
    const spy = dispatch();
    expect(notifySyncOutcome(_, 'webdav', { result: ok(3) })).toBeNull();
    expect(toasts(spy)).toEqual([{ type: 'success', message: '3 book(s) synced' }]);
  });

  test('stays quiet when nothing moved and clears the failure memory', () => {
    const spy = dispatch();
    const failed = { failures: 1, failedBooks: [] } as unknown as SyncLibraryResult;
    notifySyncOutcome(_, 'webdav', { result: failed });
    spy.mockClear();

    notifySyncOutcome(_, 'webdav', { result: ok(0) });
    expect(toasts(spy)).toHaveLength(0);

    // The same failure again is news after a success, not a repeat.
    notifySyncOutcome(_, 'webdav', { result: failed });
    expect(toasts(spy)).toHaveLength(1);
  });
});

describe('notifySyncOutcome — failure', () => {
  const partial = {
    booksSynced: 1,
    totalBooks: 2,
    failures: 1,
    indexPushFailed: true,
    failedBooks: [{ hash: 'a', title: 'Failed PDF', phase: 'upload-file', reason: 'HTTP 507' }],
  } as unknown as SyncLibraryResult;

  test('toasts the detail and returns it for the health row', () => {
    const spy = dispatch();
    const message = notifySyncOutcome(_, 'webdav', { result: partial });

    expect(message).toContain('HTTP 507');
    expect(toasts(spy)).toEqual([{ type: 'error', message, timeout: 8000 }]);
  });

  test('a run that could not write library.json is a failure, not a count', () => {
    const spy = dispatch();
    const message = notifySyncOutcome(_, 'webdav', { result: partial });
    expect(message).toContain('Failed to upload the library index');
    expect((toasts(spy)[0] as { type: string }).type).toBe('error');
  });

  test('the same failure is toasted once, a new one is toasted again', () => {
    const spy = dispatch();
    notifySyncOutcome(_, 'webdav', { result: partial });
    notifySyncOutcome(_, 'webdav', { result: partial });
    expect(toasts(spy)).toHaveLength(1);

    notifySyncOutcome(_, 'webdav', { error: new FileSyncError('nope', 'NETWORK') });
    expect(toasts(spy)).toHaveLength(2);
  });
});

describe('formatSyncError', () => {
  test.each([
    ['AUTH_FAILED', 'Authentication failed. Reconnect in Settings.'],
    ['NOT_FOUND', 'Remote resource not found'],
    ['NETWORK', 'Network error'],
  ])('%s has its own line', (code, expected) => {
    expect(formatSyncError(_, new FileSyncError('x', code as never))).toBe(expected);
  });

  test('falls back to the generic failure for anything else', () => {
    expect(formatSyncError(_, new Error('boom'))).toBe('Sync failed.');
  });
});
