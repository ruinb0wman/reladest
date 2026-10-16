import type { Transformer } from './types';
import { footnoteTransformer } from './footnote';
import { languageTransformer } from './language';
import { punctuationTransformer } from './punctuation';
import { whitespaceTransformer } from './whitespace';
import { sanitizerTransformer } from './sanitizer';
import { styleTransformer } from './style';
import { proofreadTransformer } from './proofread';
import { warichuTransformer } from './warichu';
import { nbspTransformer } from './nbsp';
import { epubSwitchTransformer } from './epubSwitch';

export const availableTransformers: Transformer[] = [
  epubSwitchTransformer,
  punctuationTransformer,
  footnoteTransformer,
  languageTransformer,
  styleTransformer,
  whitespaceTransformer,
  sanitizerTransformer,
  nbspTransformer,
  proofreadTransformer,
  warichuTransformer,
  // Add more transformers here
];
