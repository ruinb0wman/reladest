/**
 * groupBundlesByStem — bundle grouping by filename stem.
 *
 * Covers the extension parsing, the StarDict/DICT/SLOB/BGL rules and the
 * Android content-URI display-name handling (#4489).
 */
import { describe, it, expect } from 'vitest';
import { groupBundlesByStem } from '@/services/dictionaries/dictionaryService';
import type { SelectedFile } from '@/hooks/useFileSelector';

describe('groupBundlesByStem — Android content-URI display names (#4489)', () => {
  // On some Android devices the SAF picker returns an opaque `content://`
  // document id that carries no filename/extension in the URI string (e.g.
  // `.../document/document%3A1001`). The file selector resolves the real
  // DISPLAY_NAME via the native content resolver into `SelectedFile.name`;
  // bundle grouping must classify by that name, not by parsing the ext-less
  // URI path — otherwise every file is orphaned and the user sees the bogus
  // "Skipped incomplete bundles" error even though the bundle is complete.
  const cu = (name: string, id: number): SelectedFile => ({
    path: `content://com.android.providers.media.documents/document/document%3A${id}`,
    name,
  });

  it('forms a complete StarDict bundle from ext-less content URIs via name', () => {
    const { bundles, orphans } = groupBundlesByStem([
      cu('21cen.ifo', 1001),
      cu('21cen.idx', 1002),
      cu('21cen.dict.dz', 1003),
    ]);
    expect(orphans).toEqual([]);
    expect(bundles).toHaveLength(1);
    const b = bundles[0]!;
    expect(b.kind).toBe('stardict');
    if (b.kind === 'stardict') {
      expect(b.ifo.name).toBe('21cen.ifo');
      expect(b.idx.name).toBe('21cen.idx');
      expect(b.dict.name).toBe('21cen.dict.dz');
      expect(b.dict.isDictZip).toBe(true);
    }
  });
});
