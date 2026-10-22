import { describe, expect, it } from 'vitest';
import {
  hashGroupValue,
  mergeMirrorFile,
  planSettingsMerge,
  settingsPatchFromPlan,
  stateFromPlan,
  type SettingsMirrorFile,
  type SettingsSyncState,
} from '@/services/sync/file/settingsMirror';
import type { SystemSettings } from '@/types/settings';

const settings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    bookshelves: { rows: {} },
    libraryGroupBy: 'group',
    globalViewSettings: { fontSize: 16 },
    webdav: { enabled: true, serverUrl: 'http://192.168.1.20:17322' },
    ...overrides,
  }) as unknown as SystemSettings;

const mirrorWith = (group: string, value: unknown, savedAt: number): SettingsMirrorFile => ({
  schemaVersion: 1,
  groups: { [group]: { savedAt, hash: hashGroupValue(value), value } },
});

describe('settings mirror merge', () => {
  it('pushes every group when the peer has no file yet', () => {
    const plans = planSettingsMerge(settings(), null, undefined, 1000);
    expect(plans.every((p) => p.push && !p.apply)).toBe(true);
    expect(plans.map((p) => p.group).sort()).toEqual(['bookshelves', 'library', 'reading']);
  });

  it('does nothing when the peer already holds the same value', () => {
    const local = settings();
    const remote = mirrorWith('library', { libraryGroupBy: 'group' }, 500);
    const plans = planSettingsMerge(local, remote, { groups: {} }, 1000);
    const library = plans.find((p) => p.group === 'library')!;
    expect(library.push).toBeUndefined();
    expect(library.apply).toBeUndefined();
    // Baseline adopts the peer's timestamp so the next compare is honest.
    expect(library.local.savedAt).toBe(500);
  });

  it('applies the peer value when only the peer changed', () => {
    const local = settings();
    const state: SettingsSyncState = {
      groups: { library: { hash: hashGroupValue({ libraryGroupBy: 'group' }), savedAt: 500 } },
    };
    const remoteValue = { libraryGroupBy: 'author' };
    const plans = planSettingsMerge(local, mirrorWith('library', remoteValue, 900), state, 1000);
    const library = plans.find((p) => p.group === 'library')!;
    expect(library.apply?.value).toEqual(remoteValue);
    expect(library.push).toBeUndefined();
  });

  it('pushes the local value when only this device changed', () => {
    const local = settings({ libraryGroupBy: 'series' });
    const state: SettingsSyncState = {
      groups: { library: { hash: hashGroupValue({ libraryGroupBy: 'group' }), savedAt: 500 } },
    };
    const plans = planSettingsMerge(
      local,
      mirrorWith('library', { libraryGroupBy: 'group' }, 500),
      state,
      1000,
    );
    const library = plans.find((p) => p.group === 'library')!;
    expect(library.push?.value).toEqual(expect.objectContaining({ libraryGroupBy: 'series' }));
    expect(library.push?.savedAt).toBe(1000);
  });

  it('lets the newer edit win when both devices changed the same group', () => {
    const local = settings({ libraryGroupBy: 'series' });
    const state: SettingsSyncState = {
      groups: { library: { hash: 'stale', savedAt: 900 } },
    };
    const older = planSettingsMerge(
      local,
      mirrorWith('library', { libraryGroupBy: 'author' }, 800),
      state,
      1000,
    ).find((p) => p.group === 'library')!;
    expect(older.push).toBeDefined();

    const newer = planSettingsMerge(
      local,
      mirrorWith('library', { libraryGroupBy: 'author' }, 1200),
      state,
      1000,
    ).find((p) => p.group === 'library')!;
    expect(newer.apply?.value).toEqual({ libraryGroupBy: 'author' });
  });

  it('keeps device-local settings out of the mirror', () => {
    const plans = planSettingsMerge(settings(), null, undefined, 1000);
    const everything = settingsPatchFromPlan(plans);
    expect(everything).not.toHaveProperty('webdav');
    const merged = JSON.stringify(mergeMirrorFile(null, plans));
    expect(merged).not.toContain('192.168.1.20');
  });

  it('records a baseline per group for the next run', () => {
    const plans = planSettingsMerge(settings(), null, undefined, 1000);
    const state = stateFromPlan(undefined, plans);
    expect(Object.keys(state.groups).sort()).toEqual(['bookshelves', 'library', 'reading']);
    expect(state.groups['library']!.savedAt).toBe(1000);
  });
});
