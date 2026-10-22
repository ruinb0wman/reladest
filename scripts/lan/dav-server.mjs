#!/usr/bin/env node
/**
 * Minimal WebDAV server for the LAN hub — replaces the rclone dependency.
 *
 * Scope is exactly what the app's own client asks for, and nothing more:
 *   OPTIONS, HEAD, GET, PUT, MKCOL, DELETE, PROPFIND (Depth 0/1)
 *
 * Why not serve it from a Next route handler: the App Router only dispatches
 * the verbs it knows (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), and PROPFIND and
 * MKCOL are not among them. Doing it here keeps one small file we own instead of
 * a 60 MB third-party binary, and keeps the hub on its own port so a wedged sync
 * can never take the app down.
 *
 * Auth: HTTP Basic against WEBDAV_USER / WEBDAV_PASS. Everything stays inside
 * SYNC_ROOT — a resolved path that escapes it is refused, symlinks included.
 *
 * Run: node dav-server.mjs   (env: SYNC_ROOT, HUB_PORT, WEBDAV_USER, WEBDAV_PASS)
 */
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';

const VERBOSE = process.env.DAV_VERBOSE === '1';

/** Per-server config; a factory (not module globals) so tests can run one on a temp root. */
const config = { root: '.', user: 'readest', pass: '' };

const log = (...args) => {
  if (VERBOSE) console.log(new Date().toISOString(), ...args);
};

const unauthorized = (req, res) => {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Readest", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Unauthorized');
};

const safeEqual = (a, b) => {
  // Hash both sides so the comparison length is fixed regardless of input.
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};

const isAuthorized = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return safeEqual(decoded.slice(0, separator), config.user) && safeEqual(decoded.slice(separator + 1), config.pass);
};

/**
 * Map a URL path to a filesystem path inside SYNC_ROOT. Returns null when the request
 * escapes the root (encoded `..`, absolute tricks) or resolves outside it via a
 * symlink.
 */
const resolveInside = async (urlPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const relative = path.posix.normalize(decoded).replace(/^(\.\.(\/|$))+/, '');
  const candidate = path.resolve(config.root, `.${path.posix.isAbsolute(relative) ? relative : `/${relative}`}`);
  const rootReal = await realpath(config.root).catch(() => config.root);
  // Existing paths: compare the resolved real path. New paths (PUT of a fresh
  // file): the lexical check above already guarantees containment.
  const existing = await realpath(candidate).catch(() => null);
  const effective = existing ?? candidate;
  if (effective !== rootReal && !effective.startsWith(rootReal + path.sep)) return null;
  return candidate;
};

const xmlEscape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** RFC 1123 date, which is what getlastmodified is specified to be. */
const httpDate = (mtime) => new Date(mtime).toUTCString();

/** href is the encoded path relative to the server root, trailing slash for collections. */
const hrefFor = (fsPath, isDir) => {
  const relative = path.relative(config.root, fsPath).split(path.sep).filter(Boolean);
  const encoded = relative.map((segment) => encodeURIComponent(segment)).join('/');
  return `/${encoded}${isDir ? '/' : ''}`;
};

const propstat = (fsPath, stats, isDir) => {
  const props = [
    '<d:displayname>' + xmlEscape(path.basename(fsPath)) + '</d:displayname>',
    isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>',
    isDir ? '' : `<d:getcontentlength>${stats.size}</d:getcontentlength>`,
    `<d:getlastmodified>${httpDate(stats.mtime)}</d:getlastmodified>`,
    `<d:creationdate>${stats.birthtime.toISOString()}</d:creationdate>`,
    isDir ? '' : '<d:getcontenttype>application/octet-stream</d:getcontenttype>',
  ].join('');
  return (
    '<d:response>' +
    `<d:href>${xmlEscape(hrefFor(fsPath, isDir))}</d:href>` +
    `<d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` +
    '</d:response>'
  );
};

const propfind = async (req, res, fsPath) => {
  const stats = await stat(fsPath).catch(() => null);
  if (!stats) return send(res, 404, 'Not Found');

  const depth = (req.headers.depth || '0').trim();
  if (depth !== '0' && depth !== '1') {
    // Depth: infinity on PROPFIND is optional in the spec; refusing it is
    // compliant and keeps a deep tree from being walked in one request.
    return send(res, 403, 'Only Depth: 0 and Depth: 1 are supported');
  }

  const blocks = [propstat(fsPath, stats, stats.isDirectory())];
  if (depth === '1' && stats.isDirectory()) {
    const entries = await readdir(fsPath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(fsPath, entry.name);
      const childStats = await stat(childPath).catch(() => null);
      if (childStats) blocks.push(propstat(childPath, childStats, childStats.isDirectory()));
    }
  }

  const body =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<d:multistatus xmlns:d="DAV:">' +
    blocks.join('') +
    '</d:multistatus>';
  res.writeHead(207, { 'Content-Type': 'application/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

const send = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const handle = async (req, res) => {
  if (!isAuthorized(req)) return unauthorized(req, res);

  const fsPath = await resolveInside(req.url || '/');
  if (!fsPath) return send(res, 403, 'Forbidden');

  const method = (req.method || 'GET').toUpperCase();
  log(method, req.url);

  try {
    switch (method) {
      case 'OPTIONS': {
        res.writeHead(200, {
          DAV: '1',
          Allow: 'OPTIONS, HEAD, GET, PUT, MKCOL, DELETE, PROPFIND',
          'Content-Length': '0',
        });
        return res.end();
      }
      case 'HEAD': {
        const stats = await stat(fsPath).catch(() => null);
        if (!stats || stats.isDirectory()) return send(res, 404, 'Not Found');
        res.writeHead(200, { 'Content-Length': stats.size, ETag: `"${stats.size}-${stats.mtimeMs}"` });
        return res.end();
      }
      case 'GET': {
        const stats = await stat(fsPath).catch(() => null);
        if (!stats || stats.isDirectory()) return send(res, 404, 'Not Found');
        res.writeHead(200, {
          'Content-Length': stats.size,
          ETag: `"${stats.size}-${stats.mtimeMs}"`,
          'Content-Type': 'application/octet-stream',
        });
        return pipeline(createReadStream(fsPath), res).catch(() => res.destroy());
      }
      case 'PUT': {
        const parentStats = await stat(path.dirname(fsPath)).catch(() => null);
        // 409 is the WebDAV way of saying "the collection does not exist"; the
        // app's client answers it by creating the ancestors and retrying.
        if (!parentStats || !parentStats.isDirectory()) return send(res, 409, 'Conflict');
        const existed = !!(await stat(fsPath).catch(() => null));
        let bytes = 0;
        const sink = createWriteStream(fsPath);
        req.on('data', (chunk) => {
          bytes += chunk.length;
        });
        await pipeline(req, sink);
        res.writeHead(existed ? 204 : 201, { 'Content-Length': '0' });
        log('wrote', fsPath, bytes);
        return res.end();
      }
      case 'MKCOL': {
        const exists = await stat(fsPath).catch(() => null);
        if (exists) return send(res, 405, 'Already exists');
        const parentStats = await stat(path.dirname(fsPath)).catch(() => null);
        if (!parentStats) return send(res, 409, 'Conflict');
        await mkdir(fsPath);
        return send(res, 201, 'Created');
      }
      case 'DELETE': {
        const stats = await stat(fsPath).catch(() => null);
        if (!stats) return send(res, 404, 'Not Found');
        if (stats.isDirectory()) {
          if (fsPath === path.resolve(config.root)) return send(res, 403, 'Refusing to delete the sync root');
          await rm(fsPath, { recursive: true, force: true });
        } else {
          await rm(fsPath, { force: true });
        }
        return send(res, 204, '');
      }
      case 'PROPFIND':
        return await propfind(req, res, fsPath);
      default:
        res.writeHead(405, { Allow: 'OPTIONS, HEAD, GET, PUT, MKCOL, DELETE, PROPFIND' });
        return res.end();
    }
  } catch (err) {
    console.error(method, req.url, 'failed:', err?.message || err);
    if (!res.headersSent) send(res, 500, 'Internal error');
    else res.destroy();
  }
};

/**
 * Build a WebDAV server rooted at `root`. Exported so the protocol behaviour
 * (auth, traversal, the seven verbs) can be tested against a temp directory
 * without spawning a process; the CLI below is a thin wrapper.
 */
export const createDavServer = ({ root, user = 'readest', pass = '' }) => {
  config.root = path.resolve(root);
  config.user = user;
  config.pass = pass;
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('unhandled:', err);
      if (!res.headersSent) send(res, 500, 'Internal error');
    });
  });
};

const startedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (startedDirectly) {
  const root = process.env.SYNC_ROOT || path.join(process.env.HOME || '.', 'readest-sync');
  const port = Number(process.env.HUB_PORT || 17322);
  const server = createDavServer({
    root,
    user: process.env.WEBDAV_USER || 'readest',
    pass: process.env.WEBDAV_PASS || '',
  });
  await mkdir(path.resolve(root), { recursive: true });
  server.listen(port, '0.0.0.0', () => {
    console.log(`webdav hub on :${port} root=${path.resolve(root)}`);
  });
}
