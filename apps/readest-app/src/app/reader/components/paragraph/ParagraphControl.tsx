'use client';

import React, { useCallback, useState } from 'react';
import { FoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useReaderStore } from '@/store/readerStore';
import {
  loadParagraphFontScaleIndex,
  PARAGRAPH_FONT_SCALE_OPTIONS,
  saveParagraphFontScaleIndex,
} from '@/utils/paragraphPresentation';
import { useParagraphMode } from '../../hooks/useParagraphMode';
import ParagraphBar from './ParagraphBar';
import ParagraphOverlay from './ParagraphOverlay';

interface ParagraphControlProps {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
  gridInsets: Insets;
}

const ParagraphControl: React.FC<ParagraphControlProps> = ({ bookKey, viewRef, gridInsets }) => {
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const {
    paragraphState,
    paragraphConfig,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
  } = useParagraphMode({ bookKey, viewRef });

  // Device-level display scale for the paragraph text (#5246), persisted like
  // the RSVP overlay's display settings.
  const [fontScaleIndex, setFontScaleIndex] = useState(loadParagraphFontScaleIndex);
  const handleFontScaleIndexChange = useCallback((index: number) => {
    setFontScaleIndex(saveParagraphFontScaleIndex(index));
  }, []);

  if (!paragraphConfig?.enabled) {
    return null;
  }

  return (
    <>
      <ParagraphOverlay
        bookKey={bookKey}
        viewSettings={viewSettings ?? undefined}
        fontScale={PARAGRAPH_FONT_SCALE_OPTIONS[fontScaleIndex] ?? 1}
        gridInsets={gridInsets}
        onClose={toggleParagraphMode}
      />
      <ParagraphBar
        bookKey={bookKey}
        currentIndex={paragraphState.currentIndex}
        totalParagraphs={paragraphState.totalParagraphs}
        isLoading={paragraphState.isLoading}
        onPrev={goToPrevParagraph}
        onNext={goToNextParagraph}
        onClose={toggleParagraphMode}
        fontScaleIndex={fontScaleIndex}
        onFontScaleIndexChange={handleFontScaleIndexChange}
        viewSettings={viewSettings ?? undefined}
        gridInsets={gridInsets}
      />
    </>
  );
};

export default ParagraphControl;
