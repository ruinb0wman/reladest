import { Book } from '@/types/book';

import libraryEn from '@/data/demo/library.en.json';
import libraryZh from '@/data/demo/library.zh.json';

/**
 * Demo book URLs may be absolute (`https://cdn.readest.com/books/…`, upstream
 * web) or root-relative (`/demo/testbook.epub`, LAN/self-hosted). Root-relative
 * entries are resolved against the app's own origin so a LAN build never
 * reaches Readest's CDN.
 *
 * Both the exported libraries and the demo row stamp MUST use the same
 * rewritten list — if they diverge, a demo row stops being recognised as one
 * and would be pushed to the cloud as user content.
 */
const resolveDemoUrl = (url: string): string =>
  url.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;

const resolveLibrary = (raw: { library: string[] }) => ({
  ...raw,
  library: raw.library.map(resolveDemoUrl),
});

export const demoLibraries = {
  en: resolveLibrary(libraryEn),
  zh: resolveLibrary(libraryZh),
};

/**
 * `useDemoBooks` stamps every row it imports, and the stamp travels with the row
 * (it is persisted and mirrored like any other field).
 *
 * The previous rule matched on url, which stopped working the moment this fork
 * pointed the demo list at a same-origin `/demo/testbook.epub`: that address is
 * served by our own server, so a *real* book imported from it — or any ordinary
 * row that happened to carry it — was read as a demo row and silently skipped by
 * sync. The url set is gone rather than narrowed, because with a same-origin
 * sample there is no url that separates a demo row from a real one.
 *
 * A row imported by an older build carries no stamp; such rows are ordinary
 * books now, which is what they are after the sample file has been replaced.
 */
export const isDemoBook = (book: Book): boolean => book.isDemo === true;
