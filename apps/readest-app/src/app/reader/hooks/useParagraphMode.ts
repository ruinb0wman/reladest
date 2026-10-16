import { useCallback, useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { saveViewSettings } from '@/helpers/settings';
import { ParagraphIterator } from '@/utils/paragraph';
import { getParagraphPresentation } from '@/utils/paragraphPresentation';
import { DEFAULT_PARAGRAPH_MODE_CONFIG } from '@/services/constants';
import { isRangeLike } from '@/utils/range';

interface UseParagraphModeProps {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
}

// Derived state for the TTS-sync indicator (later slice renders it).
//  - 'unsupported': fixed-layout book; sync can never engage.
//  - 'idle':        TTS not playing / not engaged.
//  - 'following':   actively following the spoken position.
//  - 'syncing':     a cross-section position is pending a re-init.
//  - 'decoupled':   was following, user took manual control (TTS still playing).
export type TtsSyncStatus =
  | 'unsupported'
  | 'idle'
  | 'following'
  | 'syncing'
  | 'decoupled'
  | 'paused';

export interface ParagraphState {
  isActive: boolean;
  isLoading: boolean;
  currentIndex: number;
  totalParagraphs: number;
  currentRange: Range | null;
}

export const useParagraphMode = ({ bookKey, viewRef }: UseParagraphModeProps) => {
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings, getProgress } = useReaderStore();

  const iteratorRef = useRef<ParagraphIterator | null>(null);
  const currentDocIndexRef = useRef<number | undefined>(undefined);
  const isProcessingRef = useRef(false);
  const isFocusingRef = useRef(false);
  const focusResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookKeyRef = useRef(bookKey);
  const pendingNavigationRef = useRef<'next' | 'prev' | null>(null);
  const initPromiseRef = useRef<Promise<boolean> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMountRef = useRef(true);
  const toggleInFlightRef = useRef(false);
  // The paragraph focused when paragraph mode was last exited, so re-entering
  // on the same page resumes there rather than at the page's first paragraph
  // (#6200). Keyed on the view's live location CFI (set synchronously on every
  // relocate, so a move in between is never missed — the store's progress is
  // rAF-debounced and can lag). The paragraph itself is remembered by its
  // position in the iterator plus its text as a check — both stable for the
  // same document, unlike the CFI of a block range, which could come out
  // malformed and resolve to an empty range (#4717).
  const lastParagraphRef = useRef<{
    locationCfi: string;
    docIndex: number;
    index: number;
    text: string;
  } | null>(null);
  bookKeyRef.current = bookKey;

  const [paragraphState, setParagraphState] = useState<ParagraphState>({
    isActive: false,
    isLoading: false,
    currentIndex: -1,
    totalParagraphs: 0,
    currentRange: null,
  });

  const paragraphConfig = getViewSettings(bookKey)?.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;

  const getPrimaryContent = useCallback(() => {
    const view = viewRef.current;
    if (!view) return null;

    const contents = view.renderer.getContents();
    if (contents.length === 0) return null;

    const primaryIndex = view.renderer.primaryIndex;
    return contents.find((content) => content.index === primaryIndex) ?? contents[0] ?? null;
  }, [viewRef]);

  const updateStateFromIterator = useCallback(
    (isLoading = false) => {
      const iterator = iteratorRef.current;
      if (!iterator) {
        setParagraphState({
          isActive: paragraphConfig.enabled,
          isLoading,
          currentIndex: -1,
          totalParagraphs: 0,
          currentRange: null,
        });
        return;
      }
      setParagraphState({
        isActive: paragraphConfig.enabled,
        isLoading,
        currentIndex: iterator.currentIndex,
        totalParagraphs: iterator.length,
        currentRange: iterator.current(),
      });
    },
    [paragraphConfig.enabled],
  );

  const initIterator = useCallback(async (): Promise<boolean> => {
    if (isProcessingRef.current) {
      return initPromiseRef.current ?? false;
    }
    isProcessingRef.current = true;
    setParagraphState((prev) => ({ ...prev, isLoading: true }));

    const initPromise = (async (): Promise<boolean> => {
      try {
        const view = viewRef.current;
        if (!view) return false;

        const content = getPrimaryContent();
        const { doc, index } = content ?? {};
        const docIndex = index ?? view.renderer.primaryIndex;
        if (!doc) return false;

        currentDocIndexRef.current = docIndex;

        await new Promise((r) => requestAnimationFrame(r));
        iteratorRef.current = await ParagraphIterator.createAsync(doc);

        const pendingNav = pendingNavigationRef.current;
        pendingNavigationRef.current = null;

        if (pendingNav === 'next') {
          iteratorRef.current.first();
          updateStateFromIterator(false);
          return true;
        } else if (pendingNav === 'prev') {
          iteratorRef.current.last();
          updateStateFromIterator(false);
          return true;
        }

        const progress = getProgress(bookKeyRef.current);
        const progressRange = progress?.range;
        const progressLocation = progress?.location;
        const isSameDoc = progressRange?.startContainer?.ownerDocument === doc;

        // Resolve a CFI against the CURRENT document. A CFI is document-instance
        // independent, so this survives the section iframe being recreated when
        // paragraph mode toggles — unlike a stored Range, which is bound to the
        // document it was created in.
        const resolveRangeFromCfi = (cfi?: string | null): Range | null => {
          if (!cfi) return null;
          try {
            const resolved = view.resolveCFI(cfi);
            if (!resolved || resolved.index !== docIndex) return null;
            const anchor = resolved.anchor(doc);
            // Realm-safe: iframe-realm Range fails top-realm `instanceof Range`.
            if (isRangeLike(anchor)) return anchor;
            if (anchor) {
              const range = doc.createRange();
              range.selectNodeContents(anchor);
              return range;
            }
          } catch {
            return null;
          }
          return null;
        };

        // Re-entering at the location paragraph mode was left from resumes at
        // the paragraph that was focused then (#6200); any move in between
        // changes the live location and falls through to the page itself.
        const resumeLastParagraph = (): boolean => {
          const last = lastParagraphRef.current;
          const iterator = iteratorRef.current;
          const locationCfi = view.lastLocation?.cfi;
          if (!last || !iterator || !locationCfi) return false;
          if (last.locationCfi !== locationCfi || last.docIndex !== docIndex) return false;
          const range = iterator.goTo(last.index);
          return !!range && range.toString() === last.text;
        };

        // Otherwise resume from the freshest current position. The view's live
        // lastLocation CFI is set synchronously by foliate on every relocate; the
        // readerStore progress is rAF-debounced and can lag, which sent resume to
        // a stale page (the chapter start) and let repeated enter/exit walk
        // further back (#4717). The view's live lastLocation CFI is
        // foliate-generated and well-formed, so it's the most reliable target.
        const targetRange =
          resolveRangeFromCfi(view.lastLocation?.cfi) ??
          (isSameDoc ? progressRange : null) ??
          resolveRangeFromCfi(progressLocation);

        if (!resumeLastParagraph()) {
          if (targetRange && iteratorRef.current) {
            try {
              await iteratorRef.current.findByRangeAsync(targetRange);
            } catch {
              iteratorRef.current.first();
            }
          } else {
            iteratorRef.current.first();
          }
        }

        updateStateFromIterator(false);
        return true;
      } finally {
        isProcessingRef.current = false;
        initPromiseRef.current = null;
      }
    })();

    initPromiseRef.current = initPromise;
    return initPromise;
  }, [getPrimaryContent, viewRef, getProgress, updateStateFromIterator]);

  // `align` scrolls the underlying view so the focused paragraph sits at the page
  // top. Pass `false` when entering/resuming paragraph mode: the focused paragraph
  // is already on screen, and scrolling to its start rewinds the reading position
  // whenever that paragraph began on an earlier page — repeated enter/exit would
  // then walk back to the chapter start (#4717). Navigation passes `true` so the
  // view follows to off-screen paragraphs.
  const focusCurrentParagraph = useCallback(
    async (align = true) => {
      const view = viewRef.current;
      const iterator = iteratorRef.current;
      if (!view || !iterator) return;

      const range = iterator.current();
      if (!range) return;

      await new Promise((r) => requestAnimationFrame(r));

      if (focusResetTimerRef.current) {
        clearTimeout(focusResetTimerRef.current);
      }

      const presentation = getParagraphPresentation(
        range.startContainer.ownerDocument,
        range,
        getViewSettings(bookKeyRef.current),
      );

      if (align) {
        isFocusingRef.current = true;
        const docIndex = currentDocIndexRef.current;
        const renderer = view.renderer as FoliateView['renderer'] & {
          goTo?: (target: { index: number; anchor: Range }) => Promise<void>;
        };
        if (docIndex !== undefined && renderer.goTo) {
          renderer.goTo({ index: docIndex, anchor: range });
        } else {
          view.renderer.scrollToAnchor?.(range);
        }
        focusResetTimerRef.current = setTimeout(() => {
          isFocusingRef.current = false;
        }, 200);
      }

      eventDispatcher.dispatch('paragraph-focus', {
        bookKey: bookKeyRef.current,
        range,
        index: iterator.currentIndex,
        total: iterator.length,
        presentation,
      });
    },
    [getViewSettings, viewRef],
  );

  // Compares documents rather than section indices: a section too big to lay
  // out whole is rendered as chunk documents (foliate-js section-chunks.js)
  // that share its index, so stepping into the next chunk keeps the index.
  const waitForNewSection = useCallback(
    async (oldDoc: Document | undefined, maxAttempts: number = 15): Promise<boolean> => {
      const view = viewRef.current;
      if (!view) return false;

      for (let i = 0; i < maxAttempts; i++) {
        const primaryContent = getPrimaryContent();
        if (
          primaryContent?.doc &&
          view.renderer.primaryIndex >= 0 &&
          primaryContent.doc !== oldDoc
        ) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 50 * (i + 1)));
      }
      return false;
    },
    [getPrimaryContent, viewRef],
  );

  const goToNextParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

    const range = iterator.next();
    if (range) {
      updateStateFromIterator();
      focusCurrentParagraph();
      return true;
    }

    const oldDoc = getPrimaryContent()?.doc;
    pendingNavigationRef.current = 'next';
    iteratorRef.current = null;

    eventDispatcher.dispatch('paragraph-section-changing', {
      bookKey: bookKeyRef.current,
      direction: 'next',
    });

    try {
      await view.renderer.nextSection?.();
      const newSectionReady = await waitForNewSection(oldDoc);

      if (!newSectionReady) {
        pendingNavigationRef.current = null;
        pendingNavigationRef.current = 'prev';
        await initIterator();
        focusCurrentParagraph();
        return false;
      }

      const success = await initIterator();
      if (success) {
        focusCurrentParagraph();
      }
      return success;
    } catch (e) {
      console.warn('[ParagraphMode] Section navigation failed:', e);
      pendingNavigationRef.current = null;
      await initIterator();
      focusCurrentParagraph();
      return false;
    }
  }, [
    viewRef,
    updateStateFromIterator,
    focusCurrentParagraph,
    initIterator,
    waitForNewSection,
    getPrimaryContent,
  ]);

  const goToPrevParagraph = useCallback(async () => {
    const iterator = iteratorRef.current;
    const view = viewRef.current;
    if (!iterator || !view) return false;

    const range = iterator.prev();
    if (range) {
      updateStateFromIterator();
      focusCurrentParagraph();
      return true;
    }

    const oldDoc = getPrimaryContent()?.doc;
    pendingNavigationRef.current = 'prev';
    iteratorRef.current = null;

    eventDispatcher.dispatch('paragraph-section-changing', {
      bookKey: bookKeyRef.current,
      direction: 'prev',
    });

    try {
      await view.renderer.prevSection?.();
      const newSectionReady = await waitForNewSection(oldDoc);

      if (!newSectionReady) {
        pendingNavigationRef.current = null;
        pendingNavigationRef.current = 'next';
        await initIterator();
        focusCurrentParagraph();
        return false;
      }

      const success = await initIterator();
      if (success) {
        focusCurrentParagraph();
      }
      return success;
    } catch (e) {
      console.warn('[ParagraphMode] Section navigation failed:', e);
      pendingNavigationRef.current = null;
      await initIterator();
      focusCurrentParagraph();
      return false;
    }
  }, [
    viewRef,
    updateStateFromIterator,
    focusCurrentParagraph,
    initIterator,
    waitForNewSection,
    getPrimaryContent,
  ]);

  const goToParagraph = useCallback(
    (index: number) => {
      const iterator = iteratorRef.current;
      if (!iterator) return false;

      const range = iterator.goTo(index);
      if (range) {
        updateStateFromIterator();
        focusCurrentParagraph();
        return true;
      }
      return false;
    },
    [updateStateFromIterator, focusCurrentParagraph],
  );

  const toggleParagraphMode = useCallback(async () => {
    const settings = getViewSettings(bookKeyRef.current);
    if (!settings) return;
    if (toggleInFlightRef.current) return;

    toggleInFlightRef.current = true;
    try {
      const currentConfig = settings.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
      const newEnabled = !currentConfig.enabled;
      const newConfig = { ...currentConfig, enabled: newEnabled };

      if (newEnabled) {
        setViewSettings(bookKeyRef.current, { ...settings, paragraphMode: newConfig });
        saveViewSettings(envConfig, bookKeyRef.current, 'paragraphMode', newConfig, true, false);

        const success = await initIterator();
        if (success) {
          // Resume: don't scroll the underlying view (would rewind, #4717).
          await focusCurrentParagraph(false);
        }
      } else {
        setViewSettings(bookKeyRef.current, { ...settings, paragraphMode: newConfig });
        saveViewSettings(envConfig, bookKeyRef.current, 'paragraphMode', newConfig, true, false);

        const iterator = iteratorRef.current;
        const range = iterator?.current();
        if (iterator && range) {
          const locationCfi = viewRef.current?.lastLocation?.cfi;
          const docIndex = currentDocIndexRef.current;
          if (locationCfi && docIndex !== undefined) {
            lastParagraphRef.current = {
              locationCfi,
              docIndex,
              index: iterator.currentIndex,
              text: range.toString(),
            };
          }
          // Don't scroll to the paragraph on exit: navigation already moved the
          // view to the focused paragraph, and re-anchoring to its start rewinds
          // the reading position when it began on an earlier page (#4717).
        }
        eventDispatcher.dispatch('paragraph-mode-disabled', { bookKey: bookKeyRef.current });
        iteratorRef.current = null;
        updateStateFromIterator();
      }
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [
    getViewSettings,
    setViewSettings,
    getProgress,
    envConfig,
    initIterator,
    focusCurrentParagraph,
    viewRef,
    updateStateFromIterator,
  ]);

  useEffect(() => {
    if (!isFirstMountRef.current) return;
    isFirstMountRef.current = false;

    if (paragraphConfig.enabled && !iteratorRef.current && !isProcessingRef.current) {
      const init = async () => {
        const success = await initIterator();
        if (success) {
          // Resume on open: don't scroll the underlying view (would rewind, #4717).
          await focusCurrentParagraph(false);
        }
      };
      const timer = setTimeout(init, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const executeRelocateHandler = async () => {
      if (
        paragraphConfig.enabled &&
        !isProcessingRef.current &&
        !pendingNavigationRef.current &&
        !iteratorRef.current
      ) {
        await initIterator();
      }
    };

    const handleRelocate = () => {
      if (isFocusingRef.current) {
        isFocusingRef.current = false;
        return;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(executeRelocateHandler, 100);
    };

    view.renderer.addEventListener('relocate', handleRelocate);
    return () => {
      view.renderer.removeEventListener('relocate', handleRelocate);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [viewRef, paragraphConfig.enabled, initIterator]);

  useEffect(() => {
    const handleToggle = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current) {
        toggleParagraphMode();
      }
    };

    const handleNext = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current && paragraphConfig.enabled) {
        goToNextParagraph();
      }
    };

    const handlePrev = (event: CustomEvent) => {
      if (event.detail?.bookKey === bookKeyRef.current && paragraphConfig.enabled) {
        goToPrevParagraph();
      }
    };

    eventDispatcher.on('toggle-paragraph-mode', handleToggle);
    eventDispatcher.on('paragraph-next', handleNext);
    eventDispatcher.on('paragraph-prev', handlePrev);

    return () => {
      eventDispatcher.off('toggle-paragraph-mode', handleToggle);
      eventDispatcher.off('paragraph-next', handleNext);
      eventDispatcher.off('paragraph-prev', handlePrev);
    };
  }, [toggleParagraphMode, goToNextParagraph, goToPrevParagraph, paragraphConfig.enabled]);

  useEffect(() => {
    return () => {
      if (focusResetTimerRef.current) {
        clearTimeout(focusResetTimerRef.current);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      iteratorRef.current = null;
      initPromiseRef.current = null;
    };
  }, []);

  return {
    paragraphState,
    paragraphConfig,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
    goToParagraph,
    focusCurrentParagraph,
    initIterator,
  };
};
