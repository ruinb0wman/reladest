import type { SystemSettings } from '@/types/settings';
import type { FileSyncProvider } from './provider';
import { buildSettingsPath } from './layout';

/**
 * Settings + bookshelf mirror: the small, text-only half of "my setup follows me
 * to my other device".
 *
 * What travels is an allow-list of *groupings*, not the whole settings object.
 * Everything device-specific (WebDAV credentials, device id, sync cursors, last
 * opened book, UI toggles) stays local by simply never being listed here — a
 * deny-list would have to name every future field, this way a new field is
 * device-local until someone deliberately adds it.
 *
 * Merge policy is per group, last-writer-wins, with the local side remembering
 * the hash of the value it last pushed/saw (`settings.settingsSyncState`). That
 * one hash is what tells "I changed this" apart from "they changed this", so two
 * devices editing different groups both keep their edit; only a genuine edit to
 * the *same* group falls back to timestamps.
 */

/** Settings keys that travel, grouped by the thing the user thinks they changed. */
export const SYNC_SETTING_GROUPS = {
  bookshelves: ['bookshelves'],
  library: [
    'libraryViewMode',
    'librarySortBy',
    'librarySortAscending',
    'librarySortByAuto',
    'libraryThenSortBy',
    'libraryThenSortAscending',
    'libraryGroupBy',
    'libraryCoverFit',
    'libraryAutoColumns',
    'libraryColumns',
    'librarySkeuomorphicCovers',
  ],
  reading: ['globalViewSettings'],
} as const satisfies Record<string, readonly (keyof SystemSettings)[]>;

export type SettingsSyncGroup = keyof typeof SYNC_SETTING_GROUPS;

export interface SettingsMirrorGroup {
  /** When this value was written by the device that wrote it. */
  savedAt: number;
  /** Stable hash of `value`, so a peer can tell an edit from a re-send. */
  hash: string;
  value: unknown;
}

export interface SettingsMirrorFile {
  schemaVersion: 1;
  groups: Partial<Record<SettingsSyncGroup, SettingsMirrorGroup>>;
}

export interface SettingsSyncState {
  groups: Record<string, { hash: string; savedAt: number }>;
}

/** FNV-1a over the canonical JSON of a group's values. Stable enough to compare. */
export const hashGroupValue = (value: unknown): string => {
  const text = JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

const readGroup = (settings: SystemSettings, keys: readonly (keyof SystemSettings)[]) =>
  Object.fromEntries(keys.map((key) => [key, settings[key]]));

/**
 * One group's worth of work, as decided by {@link planSettingsMerge}.
 * `apply` carries the remote values to write locally; `push` carries the local
 * values to write to the mirror.
 */
export interface SettingsGroupPlan {
  group: SettingsSyncGroup;
  apply?: SettingsMirrorGroup;
  push?: SettingsMirrorGroup;
  /** Bookkeeping to store locally either way (keeps the baseline current). */
  local: { hash: string; savedAt: number };
}

/**
 * Decide, per group, whether to take the remote value, push the local one, or do
 * nothing. Pure: the caller does the I/O and applies the plan.
 *
 * - no remote group        → push (first sync, or the peer never had it)
 * - hashes equal           → nothing (adopt the remote timestamp as baseline)
 * - local unchanged since last sync → apply remote (only they edited)
 * - local changed, remote not      → push local
 * - both changed                   → newer `savedAt` wins
 */
export const planSettingsMerge = (
  settings: SystemSettings,
  remote: SettingsMirrorFile | null,
  state: SettingsSyncState | undefined,
  now: number,
): SettingsGroupPlan[] =>
  (Object.keys(SYNC_SETTING_GROUPS) as SettingsSyncGroup[]).map((group) => {
    const value = readGroup(settings, SYNC_SETTING_GROUPS[group]);
    const hash = hashGroupValue(value);
    const local = state?.groups?.[group];
    const theirs = remote?.groups?.[group];

    if (!theirs) {
      const pushed = { savedAt: now, hash, value };
      return { group, push: pushed, local: { hash, savedAt: now } };
    }
    if (theirs.hash === hash) {
      // Same content (or the peer already has ours): just sync the baseline.
      return { group, local: { hash, savedAt: theirs.savedAt } };
    }
    const localChanged = !local || local.hash !== hash;
    const remoteChanged = !local || theirs.savedAt > local.savedAt;
    if (!localChanged)
      return { group, apply: theirs, local: { hash: theirs.hash, savedAt: theirs.savedAt } };
    if (!remoteChanged) {
      const pushed = { savedAt: now, hash, value };
      return { group, push: pushed, local: { hash, savedAt: now } };
    }
    // Both sides moved: newest edit wins, and the loser's value is replaced.
    if (theirs.savedAt > (local?.savedAt ?? 0)) {
      return { group, apply: theirs, local: { hash: theirs.hash, savedAt: theirs.savedAt } };
    }
    const pushed = { savedAt: now, hash, value };
    return { group, push: pushed, local: { hash, savedAt: now } };
  });

/** The subset of settings a plan would write back locally. */
export const settingsPatchFromPlan = (plans: SettingsGroupPlan[]): Partial<SystemSettings> => {
  const patch: Record<string, unknown> = {};
  for (const plan of plans) {
    if (!plan.apply) continue;
    Object.assign(patch, plan.apply.value as Record<string, unknown>);
  }
  return patch as Partial<SystemSettings>;
};

export const mergeMirrorFile = (
  remote: SettingsMirrorFile | null,
  plans: SettingsGroupPlan[],
): SettingsMirrorFile => {
  const groups = { ...(remote?.groups ?? {}) };
  for (const plan of plans) if (plan.push) groups[plan.group] = plan.push;
  return { schemaVersion: 1, groups };
};

export const stateFromPlan = (
  previous: SettingsSyncState | undefined,
  plans: SettingsGroupPlan[],
): SettingsSyncState => {
  const groups = { ...(previous?.groups ?? {}) };
  for (const plan of plans) groups[plan.group] = plan.local;
  return { groups };
};

const parseMirrorFile = (text: string | null): SettingsMirrorFile | null => {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as SettingsMirrorFile;
    if (parsed?.schemaVersion !== 1 || typeof parsed.groups !== 'object') return null;
    return parsed;
  } catch {
    // A corrupt peer file must not wedge sync: treat it as absent and rewrite.
    return null;
  }
};

export interface SettingsMirrorResult {
  patch: Partial<SystemSettings>;
  state: SettingsSyncState;
  pushed: boolean;
}

/**
 * Read the mirror, decide, then write back only when something was pushed.
 * Transport failures propagate so the caller can report them like any other
 * sync failure.
 */
export const syncSettingsMirror = async (
  provider: FileSyncProvider,
  settings: SystemSettings,
  now: number = Date.now(),
): Promise<SettingsMirrorResult> => {
  const path = buildSettingsPath(provider.rootPath);
  const remote = parseMirrorFile(await provider.readText(path));
  const plans = planSettingsMerge(settings, remote, settings.settingsSyncState, now);
  const state = stateFromPlan(settings.settingsSyncState, plans);
  const pushed = plans.some((plan) => plan.push);
  if (pushed) {
    await provider.writeText(path, JSON.stringify(mergeMirrorFile(remote, plans), null, 2));
  }
  return { patch: settingsPatchFromPlan(plans), state, pushed };
};
