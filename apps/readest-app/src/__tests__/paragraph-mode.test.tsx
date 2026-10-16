import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor as waitForWithOptions,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { useParagraphMode } from '@/app/reader/hooks/useParagraphMode';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import {
  getParagraphActionForKey,
  getParagraphActionForZone,
  getParagraphPresentation,
} from '@/utils/paragraphPresentation';

const currentViewSettings = {
  paragraphMode: { enabled: true },
  writingMode: 'horizontal-tb',
  vertical: false,
  rtl: false,
};

const mockGetViewSettings = vi.fn(() => currentViewSettings);
const mockSetViewSettings = vi.fn();
const mockGetProgress = vi.fn((): { sectionHref?: string; location?: string } | null => null);
const mockGetView = vi.fn((): unknown => null);
const realSetTimeout = globalThis.setTimeout;
const waitFor = <T,>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

beforeEach(() => {
  // Preserve Testing Library's 1s failure timeout while collapsing app animation/debounce waits.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout) =>
    realSetTimeout(handler, typeof timeout === 'number' && timeout < 500 ? 0 : timeout),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

let mockIsFixedLayout = false;
const mockBooksData: Record<string, { config?: { booknotes?: unknown[] } }> = {};

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      getBookData: () => ({ isFixedLayout: mockIsFixedLayout }),
      booksData: mockBooksData,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasSafeAreaInset: false } }),
}));

// Highlight colours resolve through the read settings (custom colours first);
// the reader never mounts before they are loaded.
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: {} } }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: mockGetViewSettings,
    setViewSettings: mockSetViewSettings,
    getProgress: mockGetProgress,
    getView: mockGetView,
  }),
}));

global.ResizeObserver = class ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this);
  }

  disconnect() {}

  unobserve() {}
} as typeof ResizeObserver;

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

const attachDefaultView = (
  doc: Document,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
) => {
  Object.defineProperty(doc, 'defaultView', {
    value: { getComputedStyle },
    configurable: true,
  });
};

function createMockView(docs: Document[], initialPrimaryIndex: number) {
  const contents = docs.map((doc, index) => ({ doc, index }));

  const renderer = {
    primaryIndex: initialPrimaryIndex,
    getContents: vi.fn(() => contents),
    nextSection: vi.fn(async () => {
      renderer.primaryIndex = Math.min(renderer.primaryIndex + 1, contents.length - 1);
    }),
    prevSection: vi.fn(async () => {
      renderer.primaryIndex = Math.max(renderer.primaryIndex - 1, 0);
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    goTo: vi.fn(),
    scrollToAnchor: vi.fn(),
  };

  const view = {
    renderer,
    resolveCFI: vi.fn(),
    getCFI: vi.fn(() => 'epubcfi(/6/4!/4/2/1:0)'),
  } as unknown as FoliateView;

  return { view, renderer };
}

let hookApi: ReturnType<typeof useParagraphMode> | null = null;

const HookHarness = ({ view }: { view: React.RefObject<FoliateView | null> }) => {
  hookApi = useParagraphMode({ bookKey: 'book-1', viewRef: view });
  return null;
};

describe('paragraph mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookApi = null;
    mockIsFixedLayout = false;
    currentViewSettings.writingMode = 'horizontal-tb';
    currentViewSettings.vertical = false;
    currentViewSettings.rtl = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves source presentation and navigation rules', () => {
    const verticalDoc = createDoc('<p lang="ja">縦書きの段落です。</p>');
    const verticalParagraph = verticalDoc.querySelector('p')!;
    const verticalRange = verticalDoc.createRange();
    verticalRange.selectNodeContents(verticalParagraph);

    attachDefaultView(verticalDoc, (element: Element) => {
      if (element === verticalParagraph || element === verticalDoc.body) {
        return {
          writingMode: 'vertical-rl',
          direction: 'ltr',
          textOrientation: 'upright',
          unicodeBidi: 'plaintext',
          textAlign: 'start',
        } as CSSStyleDeclaration;
      }

      return {
        writingMode: 'horizontal-tb',
        direction: 'ltr',
      } as CSSStyleDeclaration;
    });

    const arabicDoc = createDoc('<p dir="rtl">هذا نص عربي</p>');
    const arabicParagraph = arabicDoc.querySelector('p')!;
    const arabicRange = arabicDoc.createRange();
    arabicRange.selectNodeContents(arabicParagraph);
    attachDefaultView(
      arabicDoc,
      () =>
        ({
          writingMode: 'horizontal-tb',
          direction: 'rtl',
          textAlign: 'start',
        }) as CSSStyleDeclaration,
    );

    expect(getParagraphPresentation(verticalDoc, verticalRange)).toEqual(
      expect.objectContaining({
        lang: 'ja',
        dir: 'ltr',
        writingMode: 'vertical-rl',
        vertical: true,
      }),
    );
    expect(getParagraphPresentation(arabicDoc, arabicRange)).toEqual(
      expect.objectContaining({
        dir: 'rtl',
        rtl: true,
      }),
    );

    expect(getParagraphActionForZone('left', { rtl: true, vertical: false })).toBe('next');
    expect(getParagraphActionForZone('top', { vertical: true, writingMode: 'vertical-rl' })).toBe(
      'prev',
    );
    expect(getParagraphActionForKey('ArrowLeft', { rtl: true, vertical: false })).toBe('next');
    expect(
      getParagraphActionForKey('ArrowLeft', { vertical: true, writingMode: 'vertical-rl' }),
    ).toBe('next');
  });

  it('uses the active primary section when moving across chapter boundaries', async () => {
    const previousChapterDoc = createDoc('<p>Old chapter ending</p>');
    const nextChapterDoc = createDoc('<h1>Chapter 2</h1><p>First paragraph</p>');
    const { view, renderer } = createMockView([previousChapterDoc, nextChapterDoc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Old chapter ending');
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Chapter 2');
    });

    expect(renderer.nextSection).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(renderer.goTo).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 }));
    });
  });

  it('moves across the chunks of a section rendered in chunks', async () => {
    // foliate-js renders a huge section as chunk documents that share its
    // spine index; each holds hidden placeholders for the other chunks.
    const firstChunk = createDoc('<p>End of chunk one</p><p data-foliate-chunk="1"></p>');
    const secondChunk = createDoc(
      '<p data-foliate-chunk="0"></p><p>Start of chunk two</p><p>More of chunk two</p>',
    );
    const chunks = [firstChunk, secondChunk];
    let primary = 0;
    const { view, renderer } = createMockView(chunks, 0);
    renderer.getContents.mockImplementation(() => [
      { doc: chunks[primary]!, index: 0 },
      { doc: chunks[1 - primary]!, index: 0 },
    ]);
    renderer.nextSection.mockImplementation(async () => {
      primary = 1;
    });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('End of chunk one');
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Start of chunk two');
    });
    expect(renderer.nextSection).toHaveBeenCalledTimes(1);
  });

  it('resumes without scrolling the underlying view so repeated enter/exit cannot rewind (#4717)', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p><p>Para C</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    // Resuming/entering focuses the paragraph already at the reading position.
    // Scrolling the underlying view to that paragraph's start rewinds whenever it
    // began on an earlier page, so the view must NOT be moved on resume (#4717).
    expect(renderer.goTo).not.toHaveBeenCalled();
    expect(renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('resumes at the view live CFI even when the store progress is stale (#4717)', async () => {
    const doc = createDoc('<p>Block zero</p><p>Block one</p><p>Block two</p>');
    const { view } = createMockView([doc], 0);
    // The rAF-debounced store (mockGetProgress) returns null/stale; the view's
    // live lastLocation CFI points at the third paragraph. Resume must follow the
    // live CFI (resolved against the current doc), not fall back to chapter start.
    const thirdParagraph = doc.querySelectorAll('p')[2]!;
    (view as unknown as { lastLocation: { cfi: string } }).lastLocation = { cfi: 'cfi-live' };
    (view.resolveCFI as ReturnType<typeof vi.fn>).mockImplementation((cfi: string) =>
      cfi === 'cfi-live'
        ? {
            index: 0,
            anchor: () => {
              const r = doc.createRange();
              r.selectNodeContents(thirdParagraph);
              return r;
            },
          }
        : null,
    );
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block two');
    });
  });

  it('does not scroll the underlying view when exiting paragraph mode (#4717)', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    await act(async () => {
      await hookApi?.toggleParagraphMode();
    });

    expect(renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('still scrolls the underlying view when navigating paragraphs', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p><p>Para C</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    // Navigation to another paragraph must move the underlying view (the goTo
    // runs after a rAF inside focusCurrentParagraph, so wait for it).
    await waitFor(() => {
      expect(renderer.goTo).toHaveBeenCalled();
    });
  });

  it('renders preserved presentation and layout-aware click zones in the overlay', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>مرحبا بالعالم</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: true } as never}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: {
          lang: 'ja',
          dir: 'ltr',
          writingMode: 'vertical-rl',
          textOrientation: 'upright',
          vertical: true,
          rtl: true,
        },
      });
    });

    const paragraphContent = await waitFor(() => {
      const node = container.querySelector('.paragraph-content') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    expect(paragraphContent.getAttribute('lang')).toBe('ja');
    expect(paragraphContent.style.writingMode).toBe('vertical-rl');
    dispatchSpy.mockClear();

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    let clickTime = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clickTime);

    fireEvent.click(contentArea, { clientX: 150, clientY: 20 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
    });

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: {
          dir: 'rtl',
          writingMode: 'horizontal-tb',
          vertical: false,
          rtl: true,
        },
      });
    });
    dispatchSpy.mockClear();

    clickTime += 320;

    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    });
  });

  const renderVisibleOverlay = async (onClose: () => void) => {
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>Hello world</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
        onClose={onClose}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false },
      });
    });

    return { container, overlayBookKey };
  };

  const mockContentRect = (contentArea: HTMLElement) =>
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

  it('reveals the controls instead of exiting when the backdrop is tapped', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const onClose = vi.fn();
    const { container, overlayBookKey } = await renderVisibleOverlay(onClose);

    const dialog = await waitFor(() => {
      const node = container.querySelector('[role="dialog"]') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    dispatchSpy.mockClear();

    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-show-controls', {
      bookKey: overlayBookKey,
    });
  });

  it('reveals the controls instead of exiting when the center zone is tapped', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const onClose = vi.fn();
    const { container, overlayBookKey } = await renderVisibleOverlay(onClose);

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    mockContentRect(contentArea);
    dispatchSpy.mockClear();

    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });

    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-show-controls', {
      bookKey: overlayBookKey,
    });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
  });

  it('still exits on a double-tap of the paragraph', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    mockContentRect(contentArea);

    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });
    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const getDialog = (container: HTMLElement) =>
    container.querySelector('[role="dialog"]') as HTMLDivElement;

  it('paints a solid backdrop instead of blurring the page behind it (#5275)', async () => {
    const { container } = await renderVisibleOverlay(vi.fn());
    const dialog = getDialog(container);

    expect(dialog.className).toContain('bg-base-100');
    expect(dialog.getAttribute('style') ?? '').not.toContain('blur');
    expect(dialog.getAttribute('style') ?? '').not.toContain('background');
  });

  it('focuses the dialog when it opens so it receives keys directly (#4717)', async () => {
    const { container } = await renderVisibleOverlay(vi.fn());
    const dialog = getDialog(container);
    expect(document.activeElement).toBe(dialog);
  });

  it('exits when the toggle paragraph mode shortcut (Shift+P) is pressed (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'P', shiftKey: true });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exits when Escape is pressed on the dialog (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops the toggle key from propagating so it cannot fire twice (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);

    fireEvent.keyDown(getDialog(container), { key: 'P', shiftKey: true });

    // The dialog handler must stop propagation so the global useShortcuts
    // handler never receives the same keypress (which would re-toggle).
    expect(windowSpy).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowSpy);
  });

  it('does not exit on an unrelated key while visible', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'x' });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('paragraph mode display settings (#5246)', () => {
  afterEach(() => {
    cleanup();
  });

  const fontViewSettings = {
    writingMode: 'horizontal-tb',
    vertical: false,
    rtl: false,
    defaultFont: 'Serif',
    serifFont: 'Bitter',
    sansSerifFont: 'Roboto',
    monospaceFont: 'Fira Code',
    defaultCJKFont: 'LXGW WenKai',
    defaultFontSize: 20,
    lineHeight: 1.6,
    fontWeight: 400,
  } as never;

  const renderOverlayWithFonts = async (fontScale?: number) => {
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>你好，世界</p>');
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('p')!);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        viewSettings={fontViewSettings}
        fontScale={fontScale}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false },
      });
    });

    return waitFor(() => {
      const node = container.querySelector('.paragraph-content') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
  };

  it('applies the reader font chain including the CJK/custom font', async () => {
    const paragraphContent = await renderOverlayWithFonts();

    // The bare `"Bitter", serif` pair dropped the user's CJK/custom font, so
    // CJK text fell back to the system font (#5246). The overlay must resolve
    // the same chain as the RSVP overlay (getBaseFontFamily).
    expect(paragraphContent.style.fontFamily).toContain('Bitter');
    expect(paragraphContent.style.fontFamily).toContain('LXGW WenKai');
  });

  it('scales the paragraph text and its frame by the font scale', async () => {
    const paragraphContent = await renderOverlayWithFonts(1.5);

    expect(paragraphContent.style.fontSize).toBe('30px');
    // The frame must carry the scaled font too, so its ch-based width cap
    // grows with the text instead of squeezing bigger text into the same box.
    const frame = paragraphContent.parentElement as HTMLDivElement;
    expect(frame.style.fontSize).toBe('30px');
  });
});

describe('paragraph mode selection (#6200)', () => {
  const overlayBookKey = 'overlay-book';
  const sourceCfi = 'epubcfi(/6/8!/4/2,/3:1,/3:6)';
  const mockGetCFI = vi.fn(() => sourceCfi);
  const contentRect = {
    width: 300,
    height: 300,
    top: 0,
    left: 0,
    right: 300,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;

  beforeEach(() => {
    vi.clearAllMocks();
    document.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    cleanup();
    document.getSelection()?.removeAllRanges();
  });

  const presentation = { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false };

  // A paragraph-mode range starts inside the block and ends before the next
  // one, exactly as ParagraphIterator builds them.
  const createSourceRange = (doc: Document) => {
    const range = doc.createRange();
    range.setStart(doc.querySelector('p')!, 0);
    range.setEndBefore(doc.querySelector('h2')!);
    return range;
  };

  const renderOverlayWithSource = async (
    onClose = vi.fn(),
    html = '<p>Hello <em>brave</em> new world</p><h2>Next</h2>',
  ) => {
    const doc = createDoc(html);
    const range = createSourceRange(doc);
    const view = Object.assign(new EventTarget(), {
      renderer: { getContents: () => [{ doc, index: 3 }] },
      getCFI: mockGetCFI,
      book: {
        sections: [
          {},
          {},
          {},
          {
            resolveHref: (href: string) => {
              if (/^https?:/.test(href)) return href;
              const url = new URL(href, 'https://book/OEBPS/Text/ch1.xhtml');
              return url.pathname.slice(1) + url.hash;
            },
          },
        ],
        isExternal: (href: string) => /^https?:/.test(href),
      },
      resolveNavigation: vi.fn<() => { index: number } | undefined>(() => ({ index: 4 })),
      goTo: vi.fn(),
    });
    mockGetView.mockReturnValue(view);
    mockGetProgress.mockReturnValue({ sectionHref: 'ch1.xhtml' });

    const { container, rerender } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
        onClose={onClose}
      />,
    );
    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation,
      });
    });
    const clone = await waitFor(() => {
      const node = container.querySelector('.paragraph-content') as HTMLElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLDivElement;
    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue(contentRect);
    return { container, rerender, dialog, contentArea, clone, doc, range, onClose, view };
  };

  // Select `text` (within one text node) in the clone, as the user would.
  const selectInClone = (clone: HTMLElement, text: string) => {
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return range;
    }
    throw new Error(`"${text}" not found in the clone`);
  };

  const settle = () => act(() => new Promise<void>((resolve) => realSetTimeout(resolve, 5)));

  const selectionReports = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([name]) => name === 'footnote-selection');

  it.each([
    ['../Notes/notes.xhtml#note1', 'OEBPS/Notes/notes.xhtml#note1'],
    ['#note1', 'OEBPS/Text/ch1.xhtml#note1'],
  ])('routes a cloned footnote %s through the reader without navigating the app (#6359)', async (href, resolved) => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, view, onClose } = await renderOverlayWithSource(
      vi.fn(),
      '<p>Text <a epub:type="noteref" href="' + href + '"><sup>1</sup></a></p><h2>Next</h2>',
    );
    const onLink = vi.fn((event: Event) => event.preventDefault());
    view.addEventListener('link', onLink);
    dispatchSpy.mockClear();

    expect(fireEvent.click(clone.querySelector('sup')!)).toBe(false);

    expect(onLink).toHaveBeenCalledTimes(1);
    const event = onLink.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ a: clone.querySelector('a'), href: resolved });
    expect(event.cancelable).toBe(true);
    expect(view.goTo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', expect.anything());
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', expect.anything());
  });

  it('leaves paragraph mode for an ordinary in-book link the popup does not consume', async () => {
    const { clone, view, onClose } = await renderOverlayWithSource(
      vi.fn(),
      '<p><a href="../Text/ch2.xhtml">Next chapter</a></p><h2>Next</h2>',
    );

    expect(fireEvent.click(clone.querySelector('a')!)).toBe(false);

    expect(view.goTo).toHaveBeenCalledWith('OEBPS/Text/ch2.xhtml');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resolves a fragment against the source section when its filename is outdated', async () => {
    const { clone, view } = await renderOverlayWithSource(
      vi.fn(),
      '<p><a href="old.xhtml#note1">Note</a></p><h2>Next</h2>',
    );
    view.resolveNavigation.mockReturnValue(undefined);
    const onLink = vi.fn((event: Event) => event.preventDefault());
    view.addEventListener('link', onLink);

    expect(fireEvent.click(clone.querySelector('a')!)).toBe(false);

    expect((onLink.mock.calls[0]![0] as CustomEvent).detail.href).toBe(
      'OEBPS/Text/ch1.xhtml#note1',
    );
    expect(view.goTo).not.toHaveBeenCalled();
  });

  it('hands external paragraph links to the existing confirmation', async () => {
    const { clone, view, onClose } = await renderOverlayWithSource(
      vi.fn(),
      '<p><a href="https://example.com/">Website</a></p><h2>Next</h2>',
    );
    const onExternalLink = vi.fn((event: Event) => event.preventDefault());
    view.addEventListener('external-link', onExternalLink);

    expect(fireEvent.click(clone.querySelector('a')!)).toBe(false);

    expect(onExternalLink).toHaveBeenCalledTimes(1);
    expect((onExternalLink.mock.calls[0]![0] as CustomEvent).detail.href).toBe(
      'https://example.com/',
    );
    expect(view.goTo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents native link navigation when a selection gesture or popup consumes the click', async () => {
    const { clone, view } = await renderOverlayWithSource(
      vi.fn(),
      '<p><a href="#note1">Select this text</a></p><h2>Next</h2>',
    );
    const onLink = vi.fn();
    view.addEventListener('link', onLink);
    selectInClone(clone, 'Select');

    expect(fireEvent.click(clone.querySelector('a')!)).toBe(false);
    expect(onLink).not.toHaveBeenCalled();

    document.getSelection()!.removeAllRanges();
    const consume = () => true;
    eventDispatcher.onSync('iframe-single-click', consume);
    try {
      expect(fireEvent.click(clone.querySelector('a')!)).toBe(false);
      expect(onLink).not.toHaveBeenCalled();
      expect(view.goTo).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.offSync('iframe-single-click', consume);
    }
  });

  it('reports a settled selection in the clone with the CFI of that text in the book', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, doc } = await renderOverlayWithSource();
    dispatchSpy.mockClear();
    // The reader page is select-none; the clone must opt back in.
    expect(clone.className).toContain('select-text');

    selectInClone(clone, 'brave');

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        'footnote-selection',
        expect.objectContaining({
          key: overlayBookKey,
          index: 3,
          cfi: sourceCfi,
          href: 'ch1.xhtml',
        }),
      );
    });
    // The CFI is computed from the same text in the book document, so
    // highlights and notes anchor where the paragraph really is.
    const [index, mapped] = mockGetCFI.mock.calls[0] as unknown as [number, Range];
    expect(index).toBe(3);
    expect(mapped.toString()).toBe('brave');
    expect(mapped.startContainer.ownerDocument).toBe(doc);
    // The toolbar is positioned from the overlay's own range.
    const detail = selectionReports(dispatchSpy)[0]![1] as { range: Range };
    expect(detail.range.toString()).toBe('brave');
    expect(detail.range.startContainer.ownerDocument).toBe(document);
  });

  it('keeps the clone DOM, and a selection in it, across re-renders', async () => {
    const onClose = vi.fn();
    const { clone, rerender } = await renderOverlayWithSource(onClose);
    const textNode = selectInClone(clone, 'brave').startContainer;

    // Anything that re-renders the overlay (a store update, the fade-in) must
    // not rebuild the paragraph's DOM out from under the selection.
    await act(async () => {
      rerender(
        <ParagraphOverlay
          bookKey={overlayBookKey}
          viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
          fontScale={1.25}
          onClose={onClose}
        />,
      );
    });

    expect(textNode.isConnected).toBe(true);
    expect(document.getSelection()!.toString()).toBe('brave');
  });

  it('reports a selection once and never treats a collapsed selection as a dismissal', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone } = await renderOverlayWithSource();
    dispatchSpy.mockClear();

    selectInClone(clone, 'brave');
    await waitFor(() => expect(selectionReports(dispatchSpy)).toHaveLength(1));

    // The browser re-fires selectionchange for the same range (and again on
    // pointerup); the annotator must not be handed the selection twice.
    document.dispatchEvent(new Event('selectionchange'));
    fireEvent.pointerUp(clone);
    await settle();
    expect(selectionReports(dispatchSpy)).toHaveLength(1);

    // A click on a toolbar button collapses the host selection; that is not
    // the user dismissing the toolbar.
    document.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await settle();
    expect(selectionReports(dispatchSpy)).toHaveLength(1);
  });

  it('neither navigates nor exits on taps while text is selected', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, contentArea, onClose } = await renderOverlayWithSource();
    selectInClone(clone, 'brave');
    await settle();
    dispatchSpy.mockClear();

    // The click a drag-selection ends with, and both clicks of a word
    // double-click, land here with the selection live.
    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    await settle();

    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets a showing selection popup consume the tap instead of navigating', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const consume = vi.fn(() => true);
    eventDispatcher.onSync('iframe-single-click', consume);
    try {
      const { contentArea, onClose } = await renderOverlayWithSource();
      dispatchSpy.mockClear();

      fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
      await settle();

      expect(consume).toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
      expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-show-controls', {
        bookKey: overlayBookKey,
      });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.offSync('iframe-single-click', consume);
    }
  });

  it('ignores a horizontal swipe while text is selected', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, dialog } = await renderOverlayWithSource();
    dispatchSpy.mockClear();

    // The long-press that selects the word lands mid-gesture; the finger then
    // drags the selection handle, which must not turn the paragraph.
    fireEvent.touchStart(dialog, { touches: [{ clientX: 200, clientY: 100 }] });
    selectInClone(clone, 'brave');
    fireEvent.touchMove(document, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(document);
    await settle();

    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
  });

  it('drops the selection on Escape and only exits on the next Escape', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, dialog, onClose } = await renderOverlayWithSource();
    selectInClone(clone, 'brave');
    await waitFor(() => expect(selectionReports(dispatchSpy)).toHaveLength(1));
    dispatchSpy.mockClear();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.getSelection()!.rangeCount).toBe(0);
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('footnote-selection', { key: overlayBookKey });
    });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets Shift+Arrow start a keyboard selection from a caret in the clone', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, dialog } = await renderOverlayWithSource();
    // A click in the text leaves a collapsed caret, not a selection.
    const caret = document.createRange();
    caret.setStart(clone.querySelector('em')!.firstChild!, 2);
    caret.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(caret);
    dispatchSpy.mockClear();

    const shifted = fireEvent.keyDown(dialog, { key: 'ArrowRight', shiftKey: true });

    // Left to the browser: not prevented, and no paragraph turned.
    expect(shifted).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });

    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
  });

  it('clears the reported selection when the paragraph changes', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { clone, doc } = await renderOverlayWithSource();
    selectInClone(clone, 'brave');
    await waitFor(() => expect(selectionReports(dispatchSpy)).toHaveLength(1));
    dispatchSpy.mockClear();

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range: createSourceRange(doc),
        presentation,
      });
    });

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('footnote-selection', { key: overlayBookKey });
    });
  });

  it('waits out the double-click interval before a mouse tap navigates', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const { contentArea, onClose } = await renderOverlayWithSource();
    dispatchSpy.mockClear();
    let clickTime = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clickTime);

    const mouseClick = () =>
      fireEvent(
        contentArea,
        new PointerEvent('click', {
          bubbles: true,
          clientX: 40,
          clientY: 150,
          pointerType: 'mouse',
        }),
      );

    // A word double-click's first click must not have turned the paragraph
    // by the time its second click selects the word.
    mouseClick();
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
    });

    // Two clicks inside the interval with nothing selected are still the
    // double-tap that exits, and the pending single tap is dropped.
    dispatchSpy.mockClear();
    clickTime += 1_000;
    mouseClick();
    mouseClick();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
  });
});

describe('paragraph mode resume (#6200)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookApi = null;
    currentViewSettings.paragraphMode = { enabled: true };
  });

  afterEach(() => {
    cleanup();
    currentViewSettings.paragraphMode = { enabled: true };
  });

  // Enter paragraph mode on a page whose live location is its first paragraph,
  // move two paragraphs on, and exit. Live CFIs resolve to a paragraph each.
  const exitFromThirdParagraph = async () => {
    const doc = createDoc('<p>Block zero</p><p>Block one</p><p>Block two</p>');
    const { view } = createMockView([doc], 0);
    const blocks = doc.querySelectorAll('p');
    const pages: Record<string, Element> = {
      'cfi-page-start': blocks[0]!,
      'cfi-page-2': blocks[1]!,
    };
    (view as unknown as { lastLocation: { cfi: string } }).lastLocation = { cfi: 'cfi-page-start' };
    (view.resolveCFI as ReturnType<typeof vi.fn>).mockImplementation((cfi: string) =>
      pages[cfi]
        ? {
            index: 0,
            anchor: () => {
              const r = doc.createRange();
              r.selectNodeContents(pages[cfi]!);
              return r;
            },
          }
        : null,
    );
    mockGetProgress.mockReturnValue({ location: 'loc-page-1' });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toBe('Block zero');
    });
    await act(async () => {
      await hookApi!.goToNextParagraph();
    });
    await act(async () => {
      await hookApi!.goToNextParagraph();
    });
    expect(hookApi?.paragraphState.currentRange?.toString()).toBe('Block two');

    await act(async () => {
      await hookApi!.toggleParagraphMode();
    });
    currentViewSettings.paragraphMode = { enabled: false };
    return view;
  };

  it('re-enters at the paragraph it was exited from, not the first paragraph of the page', async () => {
    await exitFromThirdParagraph();

    await act(async () => {
      await hookApi!.toggleParagraphMode();
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toBe('Block two');
    });
  });

  it('re-enters at the live location once the view has moved, even while the store progress is stale', async () => {
    const view = await exitFromThirdParagraph();
    // The view relocated within the same document (set synchronously by
    // foliate); the rAF-debounced store still reports the old page.
    (view as unknown as { lastLocation: { cfi: string } }).lastLocation = { cfi: 'cfi-page-2' };
    expect(mockGetProgress()?.location).toBe('loc-page-1');

    await act(async () => {
      await hookApi!.toggleParagraphMode();
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toBe('Block one');
    });
  });
});

describe('paragraph mode highlights (#6200)', () => {
  const overlayBookKey = 'overlay-book';
  const presentation = { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false };
  type HighlightEntry = { ranges: Range[] };
  let highlights: Map<string, HighlightEntry>;

  beforeEach(() => {
    vi.clearAllMocks();
    highlights = new Map();
    // jsdom has no CSS Custom Highlight API; the overlay paints through it.
    (globalThis as unknown as { CSS: unknown }).CSS = { highlights };
    (globalThis as unknown as { Highlight: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    delete mockBooksData['overlay'];
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as unknown as { CSS?: unknown }).CSS;
    delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
    delete mockBooksData['overlay'];
  });

  const painted = () =>
    [...highlights.entries()].map(([name, entry]) => ({
      name,
      texts: entry.ranges.map((range) => range.toString()),
      inClone: entry.ranges.every((range) => range.startContainer.ownerDocument === document),
    }));

  const renderWithNotes = async (booknotes: object[]) => {
    const doc = createDoc(
      '<p class="intro">Intro text</p><p>Hello <em>brave</em> new world</p><h2>Next</h2>',
    );
    const paragraph = doc.querySelectorAll('p')[1]!;
    const range = doc.createRange();
    range.setStart(paragraph, 0);
    range.setEndBefore(doc.querySelector('h2')!);
    const rangeOver = (text: string) => {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node as Text).data.indexOf(text);
        if (at < 0) continue;
        const r = doc.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + text.length);
        return r;
      }
      throw new Error(`"${text}" not in source`);
    };
    const anchors: Record<string, () => Range> = {
      'epubcfi(/6/8!/4/4/2,/1:0,/1:5)': () => rangeOver('brave'),
      'epubcfi(/6/8!/4/4,/3:5,/3:10)': () => rangeOver('world'),
      'epubcfi(/6/8!/4/2,/1:0,/1:5)': () => rangeOver('Intro'),
    };
    mockGetView.mockReturnValue({
      renderer: { getContents: () => [{ doc, index: 3 }] },
      getCFI: vi.fn(),
      resolveCFI: (cfi: string) => (anchors[cfi] ? { index: 3, anchor: anchors[cfi] } : null),
    });
    mockBooksData['overlay'] = { config: { booknotes } };

    const utils = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
      />,
    );
    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation,
      });
    });
    await waitFor(() => {
      expect(utils.container.querySelector('.paragraph-content')).not.toBeNull();
    });
    return utils;
  };

  const note = (id: string, cfi: string, extra: object = {}) => ({
    id,
    type: 'annotation',
    cfi,
    style: 'highlight',
    color: 'yellow',
    text: '',
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  });

  it('paints the highlights that fall in the focused paragraph onto the clone', async () => {
    const { container } = await renderWithNotes([
      note('a', 'epubcfi(/6/8!/4/4/2,/1:0,/1:5)'),
      note('b', 'epubcfi(/6/8!/4/4,/3:5,/3:10)', { style: 'underline', color: 'red' }),
      // Another paragraph of the same section: not this clone's.
      note('c', 'epubcfi(/6/8!/4/2,/1:0,/1:5)'),
      // Deleted: gone from the page, so gone from the clone.
      note('d', 'epubcfi(/6/8!/4/4/2,/1:0,/1:5)', { color: 'blue', deletedAt: 2 }),
    ]);

    await waitFor(() => expect(painted()).toHaveLength(2));
    expect(painted()).toEqual([
      { name: 'readest-annotation-highlight-facc15', texts: ['brave'], inClone: true },
      { name: 'readest-annotation-underline-f87171', texts: ['world'], inClone: true },
    ]);
    // Each painted style/colour gets its own ::highlight() rule.
    const css = container.querySelector('style')!.textContent!;
    expect(css).toContain('::highlight(readest-annotation-highlight-facc15)');
    expect(css).toContain('#facc15');
    expect(css).toContain('::highlight(readest-annotation-underline-f87171)');
    expect(css).toContain('text-decoration: underline');
  });

  it('shows a highlight made in paragraph mode as soon as the book notes change', async () => {
    const { rerender } = await renderWithNotes([]);
    await act(async () => {});
    expect(painted()).toHaveLength(0);

    mockBooksData['overlay'] = {
      config: { booknotes: [note('a', 'epubcfi(/6/8!/4/4/2,/1:0,/1:5)')] },
    };
    rerender(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
      />,
    );

    await waitFor(() => expect(painted()).toHaveLength(1));
    expect(painted()[0]!.texts).toEqual(['brave']);
  });

  it('paints every occurrence of a global highlight in the paragraph', async () => {
    await renderWithNotes([
      note('g', 'epubcfi(/6/8!/4/4/2,/1:0,/1:5)', { text: 'e', global: true }),
    ]);

    await waitFor(() => expect(painted()).toHaveLength(1));
    // The anchored range plus every "e" in "Hello brave new world".
    const texts = painted()[0]!.texts;
    expect(texts).toContain('brave');
    expect(texts.filter((t) => t === 'e')).toHaveLength(3);
  });
});
