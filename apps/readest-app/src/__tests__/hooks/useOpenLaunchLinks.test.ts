import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Defect B (see the pause-investigation report's "unrelated defects" section):
// a `readest://book/<abs-hash>` deep link arriving while a regular book's
// reader is already mounted used to be treated like any other book and
// dispatched into the reader in place ('open-book-in-reader'), which drives
// useBooksManager's initViewState down the document-loader path a streaming
// must route to the player instead, the same way a library tap on an ABS
// book already does (router.push('/player?id=...')), regardless of whether
// a reader happens to be mounted underneath.
const navigateToReaderMock = vi.fn();
const getCurrentMock = vi.fn(async () => [] as string[]);
const routerPushMock = vi.fn();

const books: Record<string, { hash: string; format: string }> = {
  epubBook: { hash: 'epubBook', format: 'EPUB' },
};

const libraryState = {
  libraryLoaded: true,
  getBookByHash: (hash: string) => books[hash] ?? (hash.startsWith('book') ? { hash } : undefined),
  updateBook: vi.fn(),
  setCheckPendingLaunchLink: vi.fn(),
};

type ViewLike = { goTo: (cfi: string) => void };
type ReaderState = {
  bookKeys: string[];
  viewStates: Record<string, { view: ViewLike; inited: boolean }>;
  setPreviewMode: ReturnType<typeof vi.fn>;
};
// A reader is mounted; bookKeys lists only the currently-displayed book(s).
// viewStates may carry stale entries for books switched away from.
const readerState: ReaderState = {
  bookKeys: ['bookA-1'],
  viewStates: {},
  setPreviewMode: vi.fn(),
};

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: () => getCurrentMock(),
}));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => true };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPushMock }) }));
vi.mock('@/utils/nav', () => ({
  navigateToReader: (...a: unknown[]) => navigateToReaderMock(...a),
}));
vi.mock('@/store/libraryStore', () => {
  const useLibraryStore = ((selector: (s: typeof libraryState) => unknown) =>
    selector(libraryState)) as unknown as {
    (selector: (s: typeof libraryState) => unknown): unknown;
    getState: () => typeof libraryState;
  };
  useLibraryStore.getState = () => libraryState;
  return { useLibraryStore };
});
vi.mock('@/store/readerStore', () => {
  const useReaderStore = (() => readerState) as unknown as {
    (): ReaderState;
    getState: () => ReaderState;
  };
  useReaderStore.getState = () => readerState;
  return { useReaderStore };
});

import { useOpenLaunchLinks } from '@/hooks/useOpenLaunchLinks';
import { eventDispatcher } from '@/utils/event';

const CFI = 'epubcfi(/6/4!/4/2)';
const annotationUrlFor = (hash: string) =>
  `readest://book/${hash}/annotation/note1?cfi=${encodeURIComponent(CFI)}`;

const collectSwitch = () => {
  const switched = vi.fn();
  const handler = (e: Event) => switched((e as CustomEvent).detail);
  eventDispatcher.on('open-book-in-reader', handler);
  return {
    switched,
    stop: () => eventDispatcher.off('open-book-in-reader', handler),
  };
};

describe('useOpenLaunchLinks — reader already mounted (annotation link)', () => {
  beforeEach(() => {
    navigateToReaderMock.mockReset();
    readerState.setPreviewMode.mockReset();
    readerState.bookKeys = ['bookA-1'];
    readerState.viewStates = { 'bookA-1': { view: { goTo: vi.fn() }, inited: true } };
    window.history.replaceState({}, '', '/reader?ids=bookA');
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('switches the book in place instead of calling the no-op navigateToReader', async () => {
    const { switched, stop } = collectSwitch();
    renderHook(() => useOpenLaunchLinks());
    await eventDispatcher.dispatch('app-incoming-url', { urls: [annotationUrlFor('bookB')] });
    await Promise.resolve();
    stop();

    // navigateToReader('/reader?ids=bookB&cfi=...') does not re-init an
    // already-mounted reader, so the reader would stay on bookA. The fix routes
    // through the in-place switch event carrying the target cfi.
    expect(navigateToReaderMock).not.toHaveBeenCalled();
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ bookHash: 'bookB', cfi: CFI }));
  });

  it('jumps in place when the target book is the currently displayed one', async () => {
    const goTo = vi.fn();
    readerState.bookKeys = ['bookB-1'];
    readerState.viewStates = { 'bookB-1': { view: { goTo }, inited: true } };

    renderHook(() => useOpenLaunchLinks());
    await eventDispatcher.dispatch('app-incoming-url', { urls: [annotationUrlFor('bookB')] });
    await Promise.resolve();

    expect(goTo).toHaveBeenCalledWith(CFI);
    expect(readerState.setPreviewMode).toHaveBeenCalledWith('bookB-1', true);
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });

  it('switches back to a book that was opened before but is no longer displayed (#4887)', async () => {
    // Simulates opening A -> B -> A all by deep link. After A -> B, bookA-1 is
    // still in viewStates with a now-detached view (never cleared on switch),
    // while bookKeys reflects only bookB-2. A deep link back to book A must
    // switch in place, NOT goTo the stale detached bookA view.
    const staleGoTo = vi.fn();
    readerState.bookKeys = ['bookB-2'];
    readerState.viewStates = {
      'bookA-1': { view: { goTo: staleGoTo }, inited: true },
      'bookB-2': { view: { goTo: vi.fn() }, inited: true },
    };

    const { switched, stop } = collectSwitch();
    renderHook(() => useOpenLaunchLinks());
    await eventDispatcher.dispatch('app-incoming-url', { urls: [annotationUrlFor('bookA')] });
    await Promise.resolve();
    stop();

    expect(staleGoTo).not.toHaveBeenCalled();
    expect(navigateToReaderMock).not.toHaveBeenCalled();
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ bookHash: 'bookA', cfi: CFI }));
  });

  it('releases the Library gate when the linked book is not in the library', async () => {
    libraryState.setCheckPendingLaunchLink.mockClear();
    renderHook(() => useOpenLaunchLinks());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['readest://book/missing/annotation/n1'],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(libraryState.setCheckPendingLaunchLink).toHaveBeenCalledWith(false);
  });
});
