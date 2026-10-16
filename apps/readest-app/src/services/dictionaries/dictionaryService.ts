/**
 * Dictionary import / delete service.
 *
 * Takes a flat list of files chosen via `useFileSelector('dictionaries')`,
 * groups them into StarDict / DICT / SLOB / BGL bundles by filename stem, writes each
 * bundle's files into `'Dictionaries'/<id>/`, and returns metadata records
 * for the {@link customDictionaryStore}.
 *
 * Mirrors the structure of `src/services/fontService.ts` but handles
 * multi-file bundles instead of single-file fonts.
 */
import type { FileSystem } from '@/types/system';
import type { SelectedFile } from '@/hooks/useFileSelector';
import { uniqueId } from '@/utils/misc';
import { getFilename } from '@/utils/path';
import type { ImportedDictionary } from './types';
import { scanEntryOffsets, serializeOffsetsSidecar } from './stardictReader';
import { computeDictionaryContentId } from './contentId';
import { v4 as uuidv4 } from 'uuid';
import {
  findExistingDictionaryMatches,
  findTombstonedDictionaryMatches,
  preserveLiveDictionaryState,
  preserveUserCustomName,
  shouldMintReincarnationForLiveReimport,
} from './dictionaryDedup';

interface SourceFile {
  /** Filename including extension, e.g. `oald7.idx`. */
  name: string;
  /** Stem (lowercase, without final extension). For `.dict.dz` use the stem of `.dict`. */
  stem: string;
  /** Final extension (lowercase, no dot). For `oald7.dict.dz`, this is `dz`. */
  ext: string;
  /** True when ext is `dz` AND the next-to-last segment is `dict`. */
  isDictZip: boolean;
  /** Raw input — Tauri path or browser File. */
  source: SelectedFile;
}

interface StarDictGroup {
  kind: 'stardict';
  stem: string;
  ifo: SourceFile;
  idx: SourceFile;
  dict: SourceFile;
  syn?: SourceFile;
}

interface DictGroup {
  kind: 'dict';
  stem: string;
  index: SourceFile;
  dict: SourceFile;
}

interface SlobGroup {
  kind: 'slob';
  stem: string;
  slob: SourceFile;
}

interface BglGroup {
  kind: 'bgl';
  stem: string;
  bgl: SourceFile;
}

type Bundle = StarDictGroup | DictGroup | SlobGroup | BglGroup;

interface GroupResult {
  bundles: Bundle[];
  /** Files that didn't form a complete bundle (e.g. `.idx` without matching `.ifo`). */
  orphans: SourceFile[];
}

/** Read the source file as a `File` (web) or via the path (Tauri filesystem). */
async function readSource(fs: FileSystem, source: SelectedFile): Promise<File> {
  if (source.file) return source.file;
  if (source.path) {
    // Open from absolute filesystem path. `'None'` keeps the path as-is.
    return fs.openFile(source.path, 'None');
  }
  throw new Error('SelectedFile has neither path nor file');
}

function classify(source: SelectedFile): SourceFile {
  // Prefer the resolved display name. For Tauri `content://` URIs the path may
  // be an opaque SAF document id with no filename/extension (some Android
  // devices, #4489); `source.name` carries the real DISPLAY_NAME resolved via
  // the native content resolver. `getFilename(path)` is only a last-resort
  // fallback for the rare case neither is set.
  const rawName = source.file?.name ?? source.name ?? (source.path ? getFilename(source.path) : '');
  const name = rawName;
  const lower = name.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  const ext = lastDot >= 0 ? lower.slice(lastDot + 1) : '';
  // Detect `foo.dict.dz` — final ext is `dz`, but the bundle stem is `foo`.
  const beforeLast = lastDot >= 0 ? lower.slice(0, lastDot) : lower;
  const isDictZip = ext === 'dz' && beforeLast.endsWith('.dict');
  let stem: string;
  if (isDictZip) {
    // `foo.dict.dz` → stem `foo`
    stem = beforeLast.slice(0, -'.dict'.length);
  } else if (lastDot >= 0) {
    // `foo.idx` → stem `foo`
    stem = beforeLast;
  } else {
    stem = lower;
  }
  return { name, stem, ext, isDictZip, source };
}

/**
 * Group a flat list of selected files into StarDict / DICT / SLOB / BGL bundles by
 * stem. Files that don't belong to any complete bundle land in `orphans`.
 *
 * Rules:
 *  - StarDict bundle = exactly one `.ifo` + one `.idx` + one `.dict` or
 *    `.dict.dz` (sharing a stem). `.syn` is optional.
 *  - DICT (dictd) bundle = one `.index` + one `.dict` or `.dict.dz`
 *    (sharing a stem). Note: `.idx` (StarDict) and `.index` (DICT) differ
 *    only by spelling — the StarDict branch wins when both are present.
 *  - Slob bundle = one `.slob` file.
 *  - A stem with multiple format markers is treated as multiple bundles.
 */
export function groupBundlesByStem(files: SelectedFile[]): GroupResult {
  const classified = files.map(classify);
  const byStem = new Map<string, SourceFile[]>();
  for (const f of classified) {
    if (!byStem.has(f.stem)) byStem.set(f.stem, []);
    byStem.get(f.stem)!.push(f);
  }

  const bundles: Bundle[] = [];
  const orphans: SourceFile[] = [];
  for (const [stem, group] of byStem) {
    const ifo = group.find((f) => f.ext === 'ifo');
    const idx = group.find((f) => f.ext === 'idx');
    const indexFile = group.find((f) => f.ext === 'index');
    const dict = group.find((f) => f.ext === 'dict' || f.isDictZip);
    const syn = group.find((f) => f.ext === 'syn');
    const slob = group.find((f) => f.ext === 'slob');
    const bgl = group.find((f) => f.ext === 'bgl');

    if (ifo && idx && dict) {
      bundles.push({ kind: 'stardict', stem, ifo, idx, dict, syn });
    } else if (indexFile && dict) {
      bundles.push({ kind: 'dict', stem, index: indexFile, dict });
    } else if (slob) {
      bundles.push({ kind: 'slob', stem, slob });
    } else if (bgl) {
      bundles.push({ kind: 'bgl', stem, bgl });
    } else {
      orphans.push(...group);
    }
  }

  return { bundles, orphans };
}

/** Parse a StarDict `.ifo` (key=value, one per line) into a record. */
function parseIfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

async function writeBundleFile(
  fs: FileSystem,
  bundleDir: string,
  filename: string,
  source: File,
): Promise<void> {
  const dst = `${bundleDir}/${filename}`;
  await fs.writeFile(dst, 'Dictionaries', source);
}

/** Build a fresh bundle directory `'Dictionaries'/<id>/`. */
async function createBundleDir(fs: FileSystem): Promise<string> {
  const id = uniqueId();
  await fs.createDir(id, 'Dictionaries', true);
  return id;
}

async function importStarDictBundle(
  fs: FileSystem,
  group: StarDictGroup,
): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const ifoFile = await readSource(fs, group.ifo.source);
  const idxFile = await readSource(fs, group.idx.source);
  const dictFile = await readSource(fs, group.dict.source);
  const synFile = group.syn ? await readSource(fs, group.syn.source) : undefined;

  await writeBundleFile(fs, bundleDir, group.ifo.name, ifoFile);
  await writeBundleFile(fs, bundleDir, group.idx.name, idxFile);
  await writeBundleFile(fs, bundleDir, group.dict.name, dictFile);
  if (synFile && group.syn) {
    await writeBundleFile(fs, bundleDir, group.syn.name, synFile);
  }

  // Pre-compute offsets sidecars at import time. Subsequent provider inits
  // skip the full `.idx` (and `.syn`) scan — the only reads are the small
  // sidecar plus per-lookup probes. Net effect on cmudict-class bundles:
  // ~62% init IO reduction.
  const idxOffsetsName = `${group.idx.stem}.idx.offsets`;
  {
    const idxBytes = new Uint8Array(await idxFile.arrayBuffer());
    const offsets = scanEntryOffsets(idxBytes, /* payloadBytes */ 8);
    const sidecar = serializeOffsetsSidecar(offsets);
    // Wrap as a File so writeFile's `string | ArrayBuffer | File` signature
    // accepts it without an unsafe ArrayBuffer cast (Uint8Array.buffer is
    // typed `ArrayBufferLike` in TS strict mode).
    const sidecarFile = new File([new Uint8Array(sidecar)], idxOffsetsName);
    await fs.writeFile(`${bundleDir}/${idxOffsetsName}`, 'Dictionaries', sidecarFile);
  }
  let synOffsetsName: string | undefined;
  if (synFile && group.syn) {
    synOffsetsName = `${group.syn.stem}.syn.offsets`;
    const synBytes = new Uint8Array(await synFile.arrayBuffer());
    const offsets = scanEntryOffsets(synBytes, /* payloadBytes */ 4);
    const sidecar = serializeOffsetsSidecar(offsets);
    const sidecarFile = new File([new Uint8Array(sidecar)], synOffsetsName);
    await fs.writeFile(`${bundleDir}/${synOffsetsName}`, 'Dictionaries', sidecarFile);
  }

  const ifoText = await ifoFile.text();
  const ifo = parseIfo(ifoText);
  const name = ifo['bookname'] || group.stem;
  const lang = ifo['lang'] || ifo['idxoffsetlang'] || undefined;

  // Supported runtime surface: DictZip-compressed `.dict.dz` *or* raw `.dict`
  // (the body is opened via `loadDictBody`, which probes the gzip header and
  // falls through to a passthrough buffer for raw files). Restriction is on
  // the entry shape: single-type `sametypesequence` ∈ {m, h, x, t}. Bundles
  // outside this surface as `unsupported` so the popup hides them and the
  // settings UI shows a clear reason; the import itself still succeeds.
  let unsupported = false;
  let unsupportedReason: string | undefined;
  const seq = ifo['sametypesequence'];
  if (!seq || seq.length !== 1) {
    unsupported = true;
    unsupportedReason = seq
      ? `Multi-type sametypesequence "${seq}" is not supported in v1.`
      : 'StarDict bundles without sametypesequence are not supported in v1.';
  } else if (!'mhxt'.includes(seq)) {
    unsupported = true;
    unsupportedReason = `StarDict entry type "${seq}" is not supported in v1.`;
  }

  // Stardict primary = .ifo (small text; partialMD5 is effectively full-hash).
  const stardictFilenames = [group.ifo.name, group.idx.name, group.dict.name];
  if (group.syn?.name) stardictFilenames.push(group.syn.name);
  const contentId = await computeDictionaryContentId(ifoFile, stardictFilenames);

  return {
    id: contentId,
    contentId,
    kind: 'stardict',
    name,
    bundleDir,
    files: {
      ifo: group.ifo.name,
      idx: group.idx.name,
      dict: group.dict.name,
      syn: group.syn?.name,
      idxOffsets: idxOffsetsName,
      synOffsets: synOffsetsName,
    },
    lang,
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

async function importDictBundle(fs: FileSystem, group: DictGroup): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const indexFile = await readSource(fs, group.index.source);
  const dictFile = await readSource(fs, group.dict.source);
  await writeBundleFile(fs, bundleDir, group.index.name, indexFile);
  await writeBundleFile(fs, bundleDir, group.dict.name, dictFile);

  // Try to read the `00databaseshort` body for a friendly bundle name. The
  // index lists it; the body lives in the dict. We do this best-effort: any
  // failure falls back to the stem.
  let name = group.stem;
  try {
    const indexText = await indexFile.text();
    // Find the "00databaseshort\t<offset>\t<size>" line.
    const m = indexText.match(/^00databaseshort\t([^\t]+)\t([^\t\r\n]+)/m);
    if (m) {
      const decode = (s: string): number => {
        let n = 0;
        const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        for (const ch of s) {
          const v = A.indexOf(ch);
          if (v < 0) throw new Error('bad b64');
          n = n * 64 + v;
        }
        return n;
      };
      const off = decode(m[1]!);
      const size = decode(m[2]!);
      // Read the dict body. If gzipped we need the whole thing — but for
      // the friendly-name read, that's still cheap (the freedict bundles
      // are <300 KB compressed).
      const buf = await dictFile.arrayBuffer();
      const u8 = new Uint8Array(buf);
      let body: Uint8Array;
      if (u8[0] === 0x1f && u8[1] === 0x8b) {
        const { gunzipSync } = await import('fflate');
        body = gunzipSync(u8);
      } else {
        body = u8;
      }
      name = new TextDecoder('utf-8').decode(body.subarray(off, off + size)).trim() || group.stem;
    }
  } catch {
    // Best-effort label; the bundle is still importable.
  }
  // DICT primary = .dict (or .dict.dz). The runtime body loader probes the
  // gzip header and falls through to a passthrough buffer for raw files.
  const dictFilenames = [group.dict.name, group.index.name];
  const contentId = await computeDictionaryContentId(dictFile, dictFilenames);

  return {
    id: contentId,
    contentId,
    kind: 'dict',
    name,
    bundleDir,
    files: {
      index: group.index.name,
      dict: group.dict.name,
    },
    addedAt: Date.now(),
  };
}

async function importSlobBundle(fs: FileSystem, group: SlobGroup): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const slobFile = await readSource(fs, group.slob.source);
  await writeBundleFile(fs, bundleDir, group.slob.name, slobFile);

  // Read header bytes to derive the friendly name + sanity-check compression.
  let name = group.stem;
  let unsupported = false;
  let unsupportedReason: string | undefined;
  try {
    const { SlobReader } = await import('./slobReader');
    const reader = new SlobReader();
    await reader.load({ slob: slobFile });
    const labelTag = reader.header.tags['label'];
    if (labelTag) name = labelTag.replace(/\0+$/u, '') || group.stem;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    unsupported = true;
    if (/Unsupported Slob compression/i.test(message)) {
      unsupportedReason = message;
    } else if (/Unsupported Slob encoding/i.test(message)) {
      unsupportedReason = message;
    } else {
      unsupportedReason = `Failed to parse Slob header: ${message}`;
    }
  }

  // Slob primary = .slob (single-file bundle).
  const contentId = await computeDictionaryContentId(slobFile, [group.slob.name]);

  return {
    id: contentId,
    contentId,
    kind: 'slob',
    name,
    bundleDir,
    files: { slob: group.slob.name },
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

async function importBglBundle(fs: FileSystem, group: BglGroup): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const bglFile = await readSource(fs, group.bgl.source);
  await writeBundleFile(fs, bundleDir, group.bgl.name, bglFile);

  // Parse the glossary properties for the friendly name; a parse failure
  // flags the bundle unsupported (the import itself still succeeds).
  let name = group.stem;
  let unsupported = false;
  let unsupportedReason: string | undefined;
  try {
    const { BglReader } = await import('./bglReader');
    const reader = new BglReader();
    await reader.load({ bgl: bglFile });
    if (reader.metadata.title) name = reader.metadata.title;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    unsupported = true;
    unsupportedReason = /Babylon/i.test(message) ? message : `Failed to parse BGL: ${message}`;
  }

  // BGL primary = .bgl (single-file bundle).
  const contentId = await computeDictionaryContentId(bglFile, [group.bgl.name]);

  return {
    id: contentId,
    contentId,
    kind: 'bgl',
    name,
    bundleDir,
    files: { bgl: group.bgl.name },
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

export interface ImportDictionariesResult {
  imported: ImportedDictionary[];
  /**
   * Bundles whose name matched one or more existing dictionaries in the
   * user's library. The duplicate's old bundle dir has been removed from
   * disk; the caller still needs to update the store — drop `oldIds`,
   * insert `newDict` in the first old entry's `providerOrder` slot, and
   * inherit the first old entry's enabled flag.
   */
  replacements: { oldIds: string[]; newDict: ImportedDictionary }[];
  /** Filenames that didn't form a valid bundle. */
  orphanFiles: string[];
  /** Sources that failed independently while other selected sources continued. */
  importErrors?: { name: string; message: string }[];
}

/**
 * Top-level import entry point. Groups the selected files into bundles and
 * imports each one. When a freshly-imported bundle's name matches an
 * existing (non-deleted) dictionary, the existing on-disk bundle dirs are
 * removed and the new dict is reported in `replacements` so the caller can
 * swap the store entry in place (preserving the position in
 * `providerOrder` and the enabled flag).
 */
export async function importDictionaries(
  fs: FileSystem,
  files: SelectedFile[],
  existingDictionaries: ImportedDictionary[] = [],
): Promise<ImportDictionariesResult> {
  const { bundles, orphans } = groupBundlesByStem(files);
  // Track all existing entries; findExistingDictionaryMatches handles the
  // contentId-vs-name tier logic. Re-importing a renamed dict still matches
  // because contentId is stable per file content.
  const existing: ImportedDictionary[] = [...existingDictionaries];

  const imported: ImportedDictionary[] = [];
  const replacements: { oldIds: string[]; newDict: ImportedDictionary }[] = [];
  // ContentIds (or, for legacy bundles without one, names) already added in
  // this import call. A second bundle in the same selection that matches an
  // earlier one is dropped (the first wins) so we don't end up with
  // intra-call duplicates.
  const seenContentIds = new Set<string>();
  const seenLegacyNames = new Set<string>();

  for (const bundle of bundles) {
    let dict: ImportedDictionary;
    if (bundle.kind === 'stardict') {
      dict = await importStarDictBundle(fs, bundle);
    } else if (bundle.kind === 'dict') {
      dict = await importDictBundle(fs, bundle);
    } else if (bundle.kind === 'slob') {
      dict = await importSlobBundle(fs, bundle);
    } else {
      dict = await importBglBundle(fs, bundle);
    }

    const intraCallKey = dict.contentId ?? `__name:${dict.name}`;
    const isIntraCallDup = dict.contentId
      ? seenContentIds.has(dict.contentId)
      : seenLegacyNames.has(dict.name);
    if (isIntraCallDup) {
      try {
        await fs.removeDir(dict.bundleDir, 'Dictionaries', true);
      } catch (err) {
        console.warn('Failed to clean up duplicate bundle dir', dict.bundleDir, err);
      }
      continue;
    }
    if (dict.contentId) seenContentIds.add(dict.contentId);
    else seenLegacyNames.add(dict.name);
    void intraCallKey;

    const olds = findExistingDictionaryMatches(dict, existing);
    if (olds.length > 0) {
      for (const old of olds) {
        try {
          await fs.removeDir(old.bundleDir, 'Dictionaries', true);
        } catch (err) {
          console.warn('Failed to remove replaced bundle dir', old.bundleDir, err);
        }
      }
      // Drop matched entries from `existing` so subsequent bundles in this
      // call don't double-replace them.
      const oldIdSet = new Set(olds.map((o) => o.id));
      for (let i = existing.length - 1; i >= 0; i--) {
        if (oldIdSet.has(existing[i]!.id)) existing.splice(i, 1);
      }
      // Preserve durable live-entry state across re-import while keeping
      // parsed/file-backed fields from the fresh bundle.
      const preserved = preserveLiveDictionaryState(dict, olds);
      const newDict = shouldMintReincarnationForLiveReimport(dict, olds)
        ? { ...preserved, reincarnation: uuidv4() }
        : preserved;
      replacements.push({ oldIds: olds.map((o) => o.id), newDict });
      continue;
    }

    // No live match — but check for a tombstoned (soft-deleted) entry
    // with the same contentId. If found, this is a reincarnation: mint
    // a fresh token so the server-side row surfaces as alive again on
    // every device that pulls.
    const tombstoned = findTombstonedDictionaryMatches(dict, existing);
    if (tombstoned.length > 0) {
      const tombstonedIdSet = new Set(tombstoned.map((o) => o.id));
      for (let i = existing.length - 1; i >= 0; i--) {
        if (tombstonedIdSet.has(existing[i]!.id)) existing.splice(i, 1);
      }
      const reincarnatedDict = preserveUserCustomName(
        { ...dict, reincarnation: uuidv4() },
        tombstoned,
      );
      replacements.push({ oldIds: tombstoned.map((o) => o.id), newDict: reincarnatedDict });
      continue;
    }

    imported.push(dict);
  }

  return {
    imported,
    replacements,
    orphanFiles: orphans.map((o) => o.name),
  };
}

/** Remove a dictionary's bundle directory. The metadata is dropped by the caller. */
export async function deleteDictionary(fs: FileSystem, dict: ImportedDictionary): Promise<void> {
  if (await fs.exists(dict.bundleDir, 'Dictionaries')) {
    await fs.removeDir(dict.bundleDir, 'Dictionaries', true);
  }
}
