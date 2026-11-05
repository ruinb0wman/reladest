/**
 * Local filesystem over HTTP, for the browser build running next to a node
 * process on the same machine. The web app's `Books` base points here instead
 * of IndexedDB, so whole books live on disk once (#<plan>) instead of twice.
 *
 * Scope is exactly what `FileSystem` (types/system.ts) asks of a base dir and
 * nothing more: read a byte range, list, stat, write atomically, delete.
 * Everything stays inside SYNC_ROOT — a resolved path that escapes it is
 * refused, symlinks included, the same contract as scripts/lan/dav-server.mjs.
 *
 * Why a route and not OPFS/File System Access: the browser cannot reach a real
 * path, and OPFS would be a fourth copy.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read lazily so tests (and a late `.env`) can point the route at a sandbox. */
const root = () =>
  path.resolve(process.env['SYNC_ROOT'] || path.join(process.env['HOME'] || '.', 'readest-sync'));

const TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  json: 'application/json',
  xml: 'application/xml',
  ncx: 'application/x-dtbncx+xml',
  html: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};
const contentType = (fp: string) =>
  TYPES[path.extname(fp).slice(1).toLowerCase()] || 'application/octet-stream';

const fail = (status: number, message: string) =>
  new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * URL segments -> absolute path inside SYNC_ROOT, or null when the request
 * escapes it. Lexical check first (cheap, catches `..` on paths that do not
 * exist yet), then realpath (catches symlinks out of the root).
 */
export async function resolveFsPath(segments: string[]): Promise<string | null> {
  if (segments.some((s) => s === '..' || s.includes('\\') || s.includes('\0'))) return null;
  const base = root();
  const candidate = path.resolve(base, segments.join('/'));
  if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;
  const [baseReal, real] = await Promise.all([
    fsp.realpath(base).catch(() => base),
    fsp.realpath(candidate).catch(() => null),
  ]);
  const effective = real ?? candidate;
  if (effective !== baseReal && !effective.startsWith(baseReal + path.sep)) return null;
  return candidate;
}

/** `bytes=a-b` / `bytes=a-` / `bytes=-n`, clamped to the file.
 * undefined = no range requested, null = unsatisfiable. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, rawStart, rawEnd] = m;
  let start = rawStart ? Number(rawStart) : size - Number(rawEnd || 0);
  let end = rawStart && rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end) return null;
  return { start, end };
}

async function serveFile(target: string, req: Request, headOnly: boolean): Promise<Response> {
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) return fail(404, 'not found');

  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': contentType(target),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': 'private, no-cache',
  };
  if (req.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });

  const parsed = parseRange(req.headers.get('range'), stat.size);
  if (parsed === null) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${stat.size}` },
    });
  }
  const { start, end } = parsed ?? { start: 0, end: stat.size - 1 };
  const partial = parsed !== undefined;
  const length = stat.size === 0 ? 0 : end - start + 1;
  headers['Content-Length'] = String(length);
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  const status = partial ? 206 : 200;
  if (headOnly || length === 0) return new Response(null, { status, headers });

  const stream = createReadStream(target, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

async function listDir(target: string): Promise<Response> {
  const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => null);
  if (!entries) return fail(404, 'not found');
  const items = await Promise.all(
    entries.map(async (e) => {
      const fp = path.join(target, e.name);
      const size = await fsp
        .stat(fp)
        .then((s) => (s.isFile() ? s.size : 0))
        .catch(() => 0);
      return { path: e.name, size };
    }),
  );
  return Response.json(items, { headers: { 'Cache-Control': 'no-store' } });
}

async function statPath(target: string): Promise<Response> {
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat) return fail(404, 'not found');
  return Response.json(
    {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.isFile() ? stat.size : 0,
      mtime: stat.mtime,
      atime: stat.atime,
      birthtime: stat.birthtime,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

type Ctx = { params: Promise<{ path?: string[] }> };

const targetOf = async (ctx: Ctx) => {
  const { path: segments } = await ctx.params;
  return resolveFsPath(segments ?? []);
};

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const target = await targetOf(ctx);
  if (!target) return fail(403, 'outside the sync root');
  const params = new URL(req.url).searchParams;
  if (params.has('list')) return listDir(target);
  if (params.has('stat')) return statPath(target);
  return serveFile(target, req, false);
}

export async function HEAD(req: Request, ctx: Ctx): Promise<Response> {
  const target = await targetOf(ctx);
  if (!target) return fail(403, 'outside the sync root');
  return serveFile(target, req, true);
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { path: segments } = await ctx.params;
  const target = await resolveFsPath(segments ?? []);
  if (!target) return fail(403, 'outside the sync root');
  const makeDir = new URL(req.url).searchParams.has('dir');

  try {
    if (makeDir) {
      await fsp.mkdir(target, { recursive: true });
      return new Response(null, { status: 201 });
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    // tmp + rename: a half-written book must never be visible under its real
    // name, or a reader opening mid-write sees a corrupt file.
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    if (req.body) {
      await pipeline(Readable.fromWeb(req.body as never), createWriteStream(tmp));
    } else {
      await fsp.writeFile(tmp, Buffer.from(await req.arrayBuffer()));
    }
    await fsp.rename(tmp, target);
    return new Response(null, { status: 201 });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : 'write failed');
  }
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const target = await targetOf(ctx);
  if (!target) return fail(403, 'outside the sync root');
  if (target === root()) return fail(403, 'refusing to delete the sync root');
  const recursive = new URL(req.url).searchParams.has('recursive');
  const ok = await fsp
    .rm(target, { recursive, force: false })
    .then(() => true)
    .catch(() => false);
  return ok ? new Response(null, { status: 204 }) : fail(404, 'not found');
}
