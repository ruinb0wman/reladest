/**
 * CSS declaration body for a `::highlight()` rule, derived from a highlight
 * style + colour so an in-paragraph highlight matches the reader's own.
 *
 * The CSS Custom Highlight pseudo only supports a handful of properties
 * (background-color, text-decoration, color, …), so styles map onto those:
 *   - highlight/outline → a translucent background of the chosen colour
 *   - underline/squiggly/strikethrough → a text-decoration in the chosen colour
 *
 * Upstream this lived in `paragraphTts.ts` alongside the paragraph-mode TTS
 * plumbing (which is gone). Both callers here are annotation highlights: the
 * overlay paints each note's range with its own style, and the TTS word/sentence
 * highlight that used to read the user's TTS highlight options no longer exists.
 */
export const buildHighlightCssText = (options?: { style?: string; color?: string }): string => {
  const color = options?.color || '#808080';
  switch (options?.style) {
    case 'underline':
      return `text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: 2px; text-underline-offset: 2px;`;
    case 'squiggly':
      return `text-decoration: underline wavy; text-decoration-color: ${color};`;
    case 'strikethrough':
      return `text-decoration: line-through; text-decoration-color: ${color};`;
    case 'highlight':
    case 'outline':
    default:
      return `background-color: color-mix(in srgb, ${color} 40%, transparent);`;
  }
};
