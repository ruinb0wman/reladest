import { Book } from '@/types/book';

import libraryEn from '@/data/demo/library.en.json';
import libraryZh from '@/data/demo/library.zh.json';

/**
 * Demo book URLs may be absolute (`https://cdn.readest.com/books/…`, upstream
 * web) or root-relative (`/demo/testbook.epub`, LAN/self-hosted). Root-relative
 * entries are resolved against the app's own origin so a LAN build never
 * reaches Readest's CDN.
 *
 * Both the exported libraries and the isDemoBook() set below MUST use the same
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

const demoBookUrls = new Set([...demoLibraries.en.library, ...demoLibraries.zh.library]);

/**
 * Demo books are the sample shelf an anonymous web visitor gets (issue #5049).
 * They are imported as ordinary url-backed rows so the library isn't empty, but
 * they are not the user's content: they must never be pushed to the cloud, and
 * a cloud row must never be merged back over one. Identifying them by url also
 * covers rows imported before this rule existed.
 */
export const isDemoBook = (book: Book): boolean => !!book.url && demoBookUrls.has(book.url);
