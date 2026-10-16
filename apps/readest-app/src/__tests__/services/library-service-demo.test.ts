import { describe, expect, it } from 'vitest';

import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';

import { saveLibraryBooks } from '@/services/libraryService';

/**
 * The sample shelf never lands in `library.json`.
 *
 * The library page merges the rows `useDemoBooks` imports into the store so their
 * cards can be rendered, and from then on every save — the demo merge itself, a
 * progress stamp, a settings restore — passes that same store library. Filtering
 * here is the one choke point they all share. What leaks instead is a 6.8 MB
 * sample book on disk that the file sync then mirrors to every device.
 */

const makeBook = (over: Partial<Book> & Pick<Book, 'hash'>): Book => ({
  format: 'EPUB',
  title: over.hash,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/** In-memory FileSystem: only the text methods the persistence helpers use. */
const makeFs = () => {
  const files = new Map<string, string>();
  const fs = {
    exists: async (path: string) => files.has(path),
    createDir: async () => {},
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, _base: string, body: string) => {
      files.set(path, body);
    },
  } as unknown as FileSystem;
  return { fs, files };
};

describe('libraryService.saveLibraryBooks', () => {
  it('drops demo rows and keeps the rest', async () => {
    const { fs, files } = makeFs();

    await saveLibraryBooks(fs, [
      makeBook({ hash: 'demo-1', isDemo: true }),
      makeBook({ hash: 'mine-1' }),
    ]);

    const written = JSON.parse(files.get('library.json')!) as Book[];
    expect(written.map((book) => book.hash)).toEqual(['mine-1']);
  });

  it('leaves a real book that carries the sample address alone', async () => {
    const { fs, files } = makeFs();

    await saveLibraryBooks(fs, [
      makeBook({ hash: 'real-from-demo-url', url: 'http://localhost:17321/demo/testbook.epub' }),
    ]);

    const written = JSON.parse(files.get('library.json')!) as Book[];
    expect(written.map((book) => book.hash)).toEqual(['real-from-demo-url']);
  });
});
