// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { pathToFileURL } from 'node:url';

// The hub lives in scripts/ (outside this project's root), so it is loaded by
// absolute URL at test time rather than through the bundler's resolver.
const hubModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../../../../../../scripts/lan/dav-server.mjs'),
).href;
type DavServerFactory = (opts: { root: string; user?: string; pass?: string }) => Server;
let createDavServer: DavServerFactory;

/**
 * Protocol checks for the LAN hub (scripts/lan/dav-server.mjs). These are the
 * exact verbs the app's WebDAV client calls, so the assertions mirror the
 * client's expectations: 401 without auth, MKCOL 201/405, PUT 201 then 204, 409
 * when the collection is missing, PROPFIND 207 with Depth 0 and 1, and no way
 * out of the configured root.
 */
describe('LAN WebDAV hub', () => {
  let server: Server;
  let base: string;
  let root: string;

  const auth = { Authorization: `Basic ${Buffer.from('lan:secret').toString('base64')}` };

  beforeAll(async () => {
    ({ createDavServer } = (await import(hubModuleUrl)) as { createDavServer: DavServerFactory });
    root = await mkdtemp(path.join(tmpdir(), 'dav-hub-'));
    server = createDavServer({ root, user: 'lan', pass: 'secret' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  it('refuses requests without credentials', async () => {
    const res = await fetch(`${base}/Readest/`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
  });

  it('creates collections and reports an existing one as 405', async () => {
    expect((await fetch(`${base}/Readest`, { method: 'MKCOL', headers: auth })).status).toBe(201);
    expect((await fetch(`${base}/Readest`, { method: 'MKCOL', headers: auth })).status).toBe(405);
  });

  it('round-trips a file and distinguishes create from replace', async () => {
    await fetch(`${base}/Readest/books`, { method: 'MKCOL', headers: auth });
    const created = await fetch(`${base}/Readest/books/a.json`, {
      method: 'PUT',
      headers: auth,
      body: '{"v":1}',
    });
    expect(created.status).toBe(201);
    const replaced = await fetch(`${base}/Readest/books/a.json`, {
      method: 'PUT',
      headers: auth,
      body: '{"v":2}',
    });
    expect(replaced.status).toBe(204);

    const got = await fetch(`${base}/Readest/books/a.json`, { headers: auth });
    expect(await got.text()).toBe('{"v":2}');
    const head = await fetch(`${base}/Readest/books/a.json`, { method: 'HEAD', headers: auth });
    expect(head.headers.get('content-length')).toBe('7');
  });

  it('answers 409 for a PUT whose parent collection is missing', async () => {
    const res = await fetch(`${base}/Readest/missing/a.json`, {
      method: 'PUT',
      headers: auth,
      body: 'x',
    });
    expect(res.status).toBe(409);
  });

  it('lists a collection with Depth 1 and the collection itself with Depth 0', async () => {
    const depth1 = await fetch(`${base}/Readest/books`, {
      method: 'PROPFIND',
      headers: { ...auth, Depth: '1' },
    });
    expect(depth1.status).toBe(207);
    const xml = await depth1.text();
    expect(xml).toContain('<d:collection/>');
    expect(xml).toContain('/Readest/books/a.json');

    const depth0 = await fetch(`${base}/Readest/books`, {
      method: 'PROPFIND',
      headers: { ...auth, Depth: '0' },
    });
    expect((await depth0.text()).match(/<d:response>/g)).toHaveLength(1);
  });

  it('deletes a collection recursively', async () => {
    expect((await fetch(`${base}/Readest/books`, { method: 'DELETE', headers: auth })).status).toBe(
      204,
    );
    const gone = await fetch(`${base}/Readest/books/a.json`, { headers: auth });
    expect(gone.status).toBe(404);
  });

  it('cannot be walked out of its root', async () => {
    const escaped = await fetch(`${base}/..%2F..%2Fetc/passwd`, { headers: auth });
    expect(escaped.status).toBe(404);
    const direct = await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`, { headers: auth });
    expect([403, 404]).toContain(direct.status);
  });
});
