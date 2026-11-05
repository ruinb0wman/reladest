// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BaseDir, FileSystem } from '@/types/system';

const idb = (): FileSystem =>
  ({
    resolvePath: (path: string, base: BaseDir) => ({
      baseDir: 0,
      basePrefix: async () => '',
      fp: base === 'Books' ? `Readest/Books/${path}` : base === 'None' ? path : `${base}/${path}`,
      base,
    }),
    getPrefix: async () => 'Readest/Books',
    getURL: (path: string) => `idb-url:${path}`,
    getBlobURL: async (path: string) => `idb-blob:${path}`,
    getImageURL: async (path: string) => `idb-img:${path}`,
    openFile: vi.fn(async () => new File(['idb'], 'idb')),
    copyFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => 'idb'),
    writeFile: vi.fn(async () => undefined),
    removeFile: vi.fn(async () => undefined),
    readDir: vi.fn(async () => [{ path: 'x.epub', size: 1 }]),
    createDir: vi.fn(async () => undefined),
    removeDir: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
    stats: vi.fn(async () => ({
      isFile: true,
      isDirectory: false,
      size: 1,
      mtime: null,
      atime: null,
      birthtime: null,
    })),
  }) as unknown as FileSystem;

const load = async (enabled: boolean) => {
  vi.resetModules();
  process.env['NEXT_PUBLIC_LOCAL_FS'] = enabled ? '1' : '0';
  const { withDiskBooks } = await import('@/services/diskBooksFileSystem');
  return withDiskBooks(idb());
};

describe('withDiskBooks', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a pass-through when the flag is off', async () => {
    const fs = await load(false);
    expect(fs.getURL('a.epub')).toBe('idb-url:a.epub');
    await fs.readFile('a.json', 'Books', 'text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps Books paths onto the disk route, keeping the hub layout', async () => {
    const fs = await load(true);
    expect(await fs.getBlobURL('abc/书名.epub', 'Books')).toBe(
      `/api/local-fs/Readest/books/abc/${encodeURIComponent('书名.epub')}`,
    );
    // Only book files leave IndexedDB. Covers and configs are small and, for
    // `config.json`, the disk path belongs to the frozen wire format.
    expect(await fs.getBlobURL('Readest/Books/abc/cover.png', 'None')).toBe(
      'idb-blob:Readest/Books/abc/cover.png',
    );
  });

  it('leaves non-Books bases on IndexedDB', async () => {
    const fs = await load(true);
    expect(await fs.getBlobURL('Readest/settings.json', 'Data')).toBe(
      'idb-blob:Readest/settings.json',
    );
    await fs.readFile('settings.json', 'Settings', 'text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads, writes, lists and stats through the route', async () => {
    const fs = await load(true);
    fetchMock.mockResolvedValueOnce(new Response('PK'));
    expect(await fs.readFile('abc/a.epub', 'Books', 'text')).toBe('PK');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/local-fs/Readest/books/abc/a.epub');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await fs.writeFile('abc/a.epub', 'Books', bytes);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/local-fs/Readest/books/abc/a.epub', {
      method: 'PUT',
      body: bytes,
    });

    fetchMock.mockResolvedValueOnce(Response.json([{ path: 'a.epub', size: 3 }]));
    // A hash dir is split across the two stores, so the listing merges them.
    expect(await fs.readDir('abc', 'Books')).toEqual([
      { path: 'a.epub', size: 3 },
      { path: 'x.epub', size: 1 },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/local-fs/Readest/books/abc?list=1');

    fetchMock.mockResolvedValueOnce(
      Response.json({ isFile: true, isDirectory: false, size: 7, mtime: 0 }),
    );
    expect(await fs.stats('abc/a.epub', 'Books')).toMatchObject({ isFile: true, size: 7 });
  });

  it('opens book files lazily through RemoteFile instead of buffering them', async () => {
    const fs = await load(true);
    fetchMock.mockImplementation(async (_url, init?: RequestInit) => {
      if (init?.method === 'HEAD')
        return new Response(null, { headers: { 'content-length': '9' } });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-range': 'bytes 0-2/9', 'content-type': 'application/epub+zip' },
      });
    });
    const file = await fs.openFile('abc/a.epub', 'Books');
    expect(file.size).toBe(9);
    expect(file.name).toBe('a.epub');
    expect(await file.slice(0, 3).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('keeps configs and covers in IndexedDB', async () => {
    const fs = await load(true);
    await fs.writeFile('abc/config.json', 'Books', 'local');
    await fs.readFile('abc/cover.png', 'Books', 'binary');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a missing file as absent, not as a failure', async () => {
    const fs = await load(true);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fs.exists('abc/gone.epub', 'Books')).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(fs.removeFile('abc/gone.epub', 'Books')).resolves.toBeUndefined();
  });
});
