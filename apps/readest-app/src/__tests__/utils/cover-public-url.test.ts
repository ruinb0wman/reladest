import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Book } from '@/types/book';
import { getPublicCoverUrl, isPublicImageUrl } from '@/utils/cover';

// Issue #5424: annotations exported to markdown / pushed to Readwise reference
// the book cover by a publicly fetchable URL. A cover already backed by a
// public URL is reused as-is; otherwise the local cover.png is published to
// media/book_covers/<user-seg>/<coverHash>.png and that URL is cached.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isPublicImageUrl', () => {
  it('accepts http(s) URLs and rejects local ones', () => {
    expect(isPublicImageUrl('https://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://localhost:3000/c.png')).toBe(false);
    expect(isPublicImageUrl('http://127.0.0.1/c.png')).toBe(false);
    expect(isPublicImageUrl('https://asset.localhost/c.png')).toBe(false);
    expect(isPublicImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isPublicImageUrl(undefined)).toBe(false);
    expect(isPublicImageUrl(null)).toBe(false);
  });
});

describe('getPublicCoverUrl', () => {
  it('reuses an already-public coverImageUrl', async () => {
    const book = { hash: 'h1', coverImageUrl: 'https://cdn.example/cover.png' } as Book;
    await expect(getPublicCoverUrl(book, null)).resolves.toBe('https://cdn.example/cover.png');
  });

  it('has no public cover to offer otherwise', async () => {
    // Publishing a local cover to Readest's bucket is gone, so a book without an
    // already-public URL simply has none — never an error.
    const book = { hash: 'h1', coverImageUrl: null } as Book;
    await expect(getPublicCoverUrl(book, null)).resolves.toBeUndefined();
  });

  it('ignores a local-only coverImageUrl', async () => {
    const book = { hash: 'h1', coverImageUrl: 'http://localhost:3000/cover.png' } as Book;
    await expect(getPublicCoverUrl(book, null)).resolves.toBeUndefined();
  });
});
