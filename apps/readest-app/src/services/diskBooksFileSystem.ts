import { BaseDir, FileInfo, FileItem, FileSystem, ResolvedPath } from '@/types/system';
import { RemoteFile } from '@/utils/file';
import { LOCAL_BOOKS_SUBDIR } from './constants';

/**
 * Keeps whole books on disk instead of in IndexedDB, for the browser build that
 * runs next to a node process on the same machine (`/api/local-fs`), where the
 * filesystem is reachable over HTTP.
 *
 * Only the book files themselves are redirected. `library.json`, per-book
 * `config.json`, covers and the nav cache stay in IndexedDB: they are small,
 * they are written far more often than book bytes, and — decisively — the
 * per-book `config.json` on disk belongs to the file-sync wire format
 * (`sync/file/layout.ts`), which holds a different shape and is frozen. Two
 * write paths sharing one path would silently clobber each other.
 *
 * Matched on the resolved path prefix rather than on `base` because covers are
 * read through `getBlobURL(<localBooksDir>/<hash>/cover.png, 'None')`.
 */
const LOCAL_PREFIX = `${LOCAL_BOOKS_SUBDIR}/`;
/** Where the book files live under SYNC_ROOT (see `sync/file/layout.ts`). */
const DISK_PREFIX = 'Readest/books/';
const ROUTE = '/api/local-fs';

/** Book formats that get a real file of their own. Mirrors `EXTS` in
 * `libs/document` — kept as a local set so the initial bundle does not pull in
 * the reader's parsers. */
const BOOK_EXTENSIONS = new Set([
  '.epub',
  '.pdf',
  '.mobi',
  '.azw',
  '.azw3',
  '.cbz',
  '.fb2',
  '.fbz',
  '.txt',
  '.md',
  '.html',
]);

/** Off unless the deployment opts in (`.env.web`), so a build without the
 * node-side route keeps using IndexedDB. */
export const isDiskBooksEnabled = () => process.env['NEXT_PUBLIC_LOCAL_FS'] === '1';

const urlOf = (fp: string) =>
  `${ROUTE}/${fp.replace(LOCAL_PREFIX, DISK_PREFIX).split('/').map(encodeURIComponent).join('/')}`;

const isBooksPath = (fp: string) =>
  fp.startsWith(LOCAL_PREFIX) && BOOK_EXTENSIONS.has(fp.slice(fp.lastIndexOf('.')).toLowerCase());

class DiskBooksFileSystem implements FileSystem {
  constructor(private readonly idb: FileSystem) {}

  private disk(path: string, base: BaseDir) {
    const { fp } = this.idb.resolvePath(path, base);
    return isBooksPath(fp) ? urlOf(fp) : null;
  }

  resolvePath(path: string, base: BaseDir): ResolvedPath {
    return this.idb.resolvePath(path, base);
  }
  getPrefix(base: BaseDir): Promise<string> {
    return this.idb.getPrefix(base);
  }

  getURL(path: string): string {
    const url = isBooksPath(path) ? urlOf(path) : null;
    return url ?? this.idb.getURL(path);
  }

  async getBlobURL(path: string, base: BaseDir): Promise<string> {
    return this.disk(path, base) ?? this.idb.getBlobURL(path, base);
  }

  async getImageURL(path: string): Promise<string> {
    return this.getBlobURL(path, 'None');
  }

  async openFile(path: string, base: BaseDir, filename?: string, fetcher?: typeof fetch) {
    const url = this.disk(path, base);
    if (!url) return this.idb.openFile(path, base, filename, fetcher);
    // RemoteFile already does lazy HEAD + `Range` reads, which is what keeps a
    // 300 MB PDF from being materialised in memory just to show page one.
    return new RemoteFile(url, filename || path.split('/').pop(), '', Date.now(), fetcher).open();
  }

  async copyFile(srcPath: string, srcBase: BaseDir, dstPath: string, dstBase: BaseDir) {
    if (!this.disk(srcPath, srcBase) && !this.disk(dstPath, dstBase)) {
      return this.idb.copyFile(srcPath, srcBase, dstPath, dstBase);
    }
    await this.writeFile(dstPath, dstBase, await this.readFile(srcPath, srcBase, 'binary'));
  }

  async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
    const url = this.disk(path, base);
    if (!url) return this.idb.readFile(path, base, mode);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`File not found: ${path} (${response.status})`);
    return mode === 'text' ? response.text() : response.arrayBuffer();
  }

  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File) {
    const url = this.disk(path, base);
    if (!url) return this.idb.writeFile(path, base, content);
    const body = content instanceof File ? await content.arrayBuffer() : content;
    const response = await fetch(url, { method: 'PUT', body });
    if (!response.ok) throw new Error(`Failed to write ${path} (${response.status})`);
  }

  async removeFile(path: string, base: BaseDir) {
    const url = this.disk(path, base);
    if (!url) return this.idb.removeFile(path, base);
    const response = await fetch(url, { method: 'DELETE' });
    // A missing file is not an error here: the IndexedDB backend is equally
    // forgiving, and callers delete optimistically.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove ${path} (${response.status})`);
    }
  }

  async readDir(path: string, base: BaseDir, extensions?: string[]): Promise<FileItem[]> {
    const { fp } = this.idb.resolvePath(path, base);
    if (!fp.startsWith(LOCAL_PREFIX)) return this.idb.readDir(path, base, extensions);
    // A hash dir is split across both stores: book files live on disk, config,
    // cover and nav stay in IndexedDB. Merge them, letting IndexedDB win on a
    // name clash — it holds this device's copy, the disk one is the wire copy.
    const merged = new Map<string, FileItem>();
    for (const item of await this.idb.readDir(path, base)) merged.set(item.path, item);
    const response = await fetch(`${this.disk(path, base) ?? this.urlOfDir(fp)}?list=1`).catch(
      () => null,
    );
    if (response?.ok) {
      for (const item of (await response.json()) as FileItem[]) merged.set(item.path, item);
    }
    const items = [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
    return extensions?.length
      ? items.filter((item) => extensions.includes(item.path.split('.').pop() ?? ''))
      : items;
  }

  private urlOfDir(fp: string) {
    return `${ROUTE}/${fp.replace(LOCAL_PREFIX, DISK_PREFIX)}`.replace(/\/+$/, '');
  }

  async createDir(path: string, base: BaseDir, recursive?: boolean) {
    const url = this.disk(path, base);
    if (!url) return this.idb.createDir(path, base, recursive);
    const response = await fetch(`${url}?dir=1`, { method: 'PUT' });
    if (!response.ok) throw new Error(`Failed to create ${path} (${response.status})`);
  }

  async removeDir(path: string, base: BaseDir, recursive?: boolean) {
    const url = this.disk(path, base);
    if (!url) return this.idb.removeDir(path, base, recursive);
    const response = await fetch(`${url}?recursive=1`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove ${path} (${response.status})`);
    }
  }

  async exists(path: string, base: BaseDir): Promise<boolean> {
    const url = this.disk(path, base);
    if (!url) return this.idb.exists(path, base);
    return (await fetch(url, { method: 'HEAD' })).ok;
  }

  async stats(path: string, base: BaseDir): Promise<FileInfo> {
    const url = this.disk(path, base);
    if (!url) return this.idb.stats(path, base);
    const response = await fetch(`${url}?stat=1`);
    if (!response.ok) throw new Error(`File not found: ${path}`);
    const stat = await response.json();
    return {
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      size: stat.size,
      mtime: stat.mtime ? new Date(stat.mtime) : null,
      atime: stat.atime ? new Date(stat.atime) : null,
      birthtime: stat.birthtime ? new Date(stat.birthtime) : null,
    };
  }
}

/** Wrap the web filesystem so `Books` reads/writes reach the node-side route. */
export const withDiskBooks = (idb: FileSystem): FileSystem =>
  isDiskBooksEnabled() ? new DiskBooksFileSystem(idb) : idb;
