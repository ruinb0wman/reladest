// Text-range helpers for paragraph mode.
//
// Upstream these lived in `services/tts/wordHighlight` next to the TTS
// word-boundary matching they were written for. The matching is gone with TTS;
// what paragraph mode still needs is the plain "which text does this range
// cover, minus injected gloss content" pair, used to map a selection or an
// annotation's range onto the overlay's rendered clone of the paragraph.

import { isMutedRubyNode } from '@/utils/ruby';

// Any cfi-inert subtree is injected, non-book content — invisible to CFI and to
// spoken text. Word-offset matching must ignore it too, or boundary words
// (gloss-free) won't align with the walked text. Ruby follows the same rule the
// TTS node filter applies, so whichever side of a ruby pair is muted there is
// muted here: for a kana reading that is the base, otherwise the annotation.
const isInertText = (node: Node): boolean => {
  if (isMutedRubyNode(node)) return true;
  let p: Node | null = node.parentNode;
  while (p) {
    if (p.nodeType === Node.ELEMENT_NODE && (p as Element).hasAttribute('cfi-inert')) return true;
    p = p.parentNode;
  }
  return false;
};

/** range.toString() minus any inert (gloss) text — the matching baseline. */
export const rangeTextExcludingInert = (base: Range): string => {
  const root = base.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  if (root.nodeType === Node.TEXT_NODE) {
    // A range contained in one text node (e.g. a middle sentence of a paragraph
    // wrapped in a single <span>) must honour the range offsets, exactly as
    // getTextSubRange does. Returning the whole node would make word offsets
    // drift relative to the highlighted sub-range.
    if (isInertText(root)) return '';
    return (root as Text).data.slice(base.startOffset, base.endOffset);
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!base.intersectsNode(node) || isInertText(node)) continue;
    const text = node as Text;
    const from = node === base.startContainer ? base.startOffset : 0;
    const to = node === base.endContainer ? base.endOffset : text.data.length;
    if (to > from) out += text.data.slice(from, to);
  }
  return out;
};

// Extract the sub-range covering [start, end) of base.toString(). Walks the
// text nodes intersecting the base range, slicing partially-contained
// boundary nodes the same way Range stringification does.
export const getTextSubRange = (base: Range, start: number, end: number): Range | null => {
  if (start < 0 || end <= start) return null;
  const root = base.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  // A TreeWalker never yields its root, which is the node itself when the
  // base range lies within a single text node.
  const textNodes = function* () {
    if (root.nodeType === Node.TEXT_NODE) {
      yield root;
      return;
    }
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isInertText(node)) yield node;
    }
  };
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  for (const node of textNodes()) {
    if (!base.intersectsNode(node)) continue;
    const text = node as Text;
    const from = node === base.startContainer ? base.startOffset : 0;
    const to = node === base.endContainer ? base.endOffset : text.data.length;
    if (to <= from) continue;
    const len = to - from;
    if (!startNode && pos + len > start) {
      startNode = text;
      startOffset = from + (start - pos);
    }
    if (startNode && pos + len >= end) {
      const range = doc.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(text, from + (end - pos));
      return range;
    }
    pos += len;
  }
  return null;
};
