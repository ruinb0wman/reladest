import { md5 } from '@/utils/md5';

/**
 * The replica kind vocabulary that LOCAL code still needs.
 *
 * Readest Cloud sync (the replica layer) was removed for the LAN build: there is
 * no account, no remote replica store, and no settings/dictionary/font push. What
 * survives is the naming and identity layer those local features still use:
 *
 *   - the kind strings, because every replica-aware store tags its rows with one
 *     (and `syncCategories` gates on them);
 *   - the content-id helpers, because a dictionary's id is how the app
 *     recognises "this is the same row" locally, independent of any sync.
 *
 * The adapters that used to own these (`services/sync/adapters/*`) were deleted
 * together with the sync engine.
 */
export const CUSTOM_TRANSLATOR_KIND = 'custom_translator';
export const DICTIONARY_KIND = 'dictionary';
export const FONT_KIND = 'font';
export const SETTINGS_KIND = 'settings';
export const TEXTURE_KIND = 'texture';
export const TRANSLATION_PROMPT_KIND = 'translation_prompt';

/**
 * Stable id for an imported dictionary: its content identity (partial md5 of the
 * source archive + size + the file names inside it), not its display name, so a
 * rename or a re-import of the same archive maps to the same row.
 */
export const computeDictionaryReplicaId = (
  partialMd5: string,
  byteSize: number,
  filenames: string[],
): string => {
  const sortedFilenames = [...filenames].sort();
  return md5(`${partialMd5}|${byteSize}|${sortedFilenames.join(',')}`);
};
