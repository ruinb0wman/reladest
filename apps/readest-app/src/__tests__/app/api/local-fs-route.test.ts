// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { GET, HEAD, PUT, DELETE, resolveFsPath } from '@/app/api/local-fs/[[...path]]/route';

const SANDBOX = path.join(process.cwd(), '.test-sandbox-local-fs');

const ctx = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
const url = (segments: string[], query = '') =>
  `http://localhost/api/local-fs/${segments.join('/')}${query}`;

const get = (segments: string[], query = '', headers: Record<string, string> = {}) =>
  GET(new Request(url(segments, query), { headers }), ctx(segments));
const put = (segments: string[], body: string | null, query = '') =>
  PUT(new Request(url(segments, query), { method: 'PUT', body }), ctx(segments));
const del = (segments: string[], query = '') =>
  DELETE(new Request(url(segments, query), { method: 'DELETE' }), ctx(segments));

describe('local-fs route', () => {
  beforeAll(async () => {
    process.env['SYNC_ROOT'] = SANDBOX;
    await fsp.rm(SANDBOX, { recursive: true, force: true });
    await fsp.mkdir(path.join(SANDBOX, 'Readest', 'books', 'abc'), { recursive: true });
    // A symlink pointing out of the root must be refused.
    await fsp.symlink('/etc', path.join(SANDBOX, 'escape')).catch(() => undefined);
  });

  afterAll(async () => {
    await fsp.rm(SANDBOX, { recursive: true, force: true });
  });

  it('keeps every request inside SYNC_ROOT', async () => {
    expect(await resolveFsPath(['Readest', 'books', 'abc'])).toBe(
      path.join(SANDBOX, 'Readest', 'books', 'abc'),
    );
    expect(await resolveFsPath(['..', 'etc'])).toBeNull();
    expect(await resolveFsPath(['Readest', '..', '..', 'etc'])).toBeNull();
    expect(await resolveFsPath(['escape', 'passwd'])).toBeNull();
  });

  it('round-trips a file through PUT / GET / HEAD / STAT / LIST / DELETE', async () => {
    expect((await put(['Readest', 'books', 'abc', 'book.json'], 'hello')).status).toBe(201);

    const full = await get(['Readest', 'books', 'abc', 'book.json']);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe('5');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(await full.text()).toBe('hello');

    const head = await HEAD(
      new Request(url(['Readest', 'books', 'abc', 'book.json'])),
      ctx(['Readest', 'books', 'abc', 'book.json']),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('5');
    expect(await head.text()).toBe('');

    const stat = await (await get(['Readest', 'books', 'abc', 'book.json'], '?stat=1')).json();
    expect(stat).toMatchObject({ isFile: true, isDirectory: false, size: 5 });

    const list = await (await get(['Readest', 'books', 'abc'], '?list=1')).json();
    expect(list).toEqual([{ path: 'book.json', size: 5 }]);

    expect((await del(['Readest', 'books', 'abc', 'book.json'])).status).toBe(204);
    expect((await get(['Readest', 'books', 'abc', 'book.json'])).status).toBe(404);
  });

  it('serves byte ranges, which is what makes books open lazily', async () => {
    await put(['Readest', 'books', 'abc', 'r.epub'], 'hello world');

    const mid = await get(['Readest', 'books', 'abc', 'r.epub'], '', { Range: 'bytes=1-3' });
    expect(mid.status).toBe(206);
    expect(mid.headers.get('content-range')).toBe('bytes 1-3/11');
    expect(await mid.text()).toBe('ell');

    const open = await get(['Readest', 'books', 'abc', 'r.epub'], '', { Range: 'bytes=6-' });
    expect(await open.text()).toBe('world');

    const suffix = await get(['Readest', 'books', 'abc', 'r.epub'], '', { Range: 'bytes=-2' });
    expect(await suffix.text()).toBe('ld');

    const satisfied = await get(['Readest', 'books', 'abc', 'r.epub'], '', {
      Range: 'bytes=99-',
    });
    expect(satisfied.status).toBe(416);
    expect(satisfied.headers.get('content-range')).toBe('bytes */11');
  });

  it('answers 304 to a matching ETag so covers are not re-read per render', async () => {
    const first = await get(['Readest', 'books', 'abc', 'r.epub']);
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const again = await get(['Readest', 'books', 'abc', 'r.epub'], '', { 'If-None-Match': etag });
    expect(again.status).toBe(304);
  });

  it('writes atomically and never leaves a half-written file under the real name', async () => {
    await put(['Readest', 'books', 'abc', 'big.epub'], 'v1');
    await put(['Readest', 'books', 'abc', 'big.epub'], 'v2-longer');
    expect(await (await get(['Readest', 'books', 'abc', 'big.epub'])).text()).toBe('v2-longer');
    const leftovers = (await fsp.readdir(path.join(SANDBOX, 'Readest', 'books', 'abc'))).filter(
      (f) => f.includes('.tmp-'),
    );
    expect(leftovers).toEqual([]);
  });

  it('refuses to delete the sync root', async () => {
    expect((await del([])).status).toBe(403);
  });
});
