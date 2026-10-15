import type { SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';
import { isCloudSyncAllowed } from '@/utils/access';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * The cloud sync provider kind for library data (book files, book rows,
 * progress, notes) in a LAN build: WebDAV is the only one left.
 *
 * Upstream this was a set of independent providers — the native Readest Cloud
 * plus Google Drive / OneDrive / S3 / iCloud — with a derived default for
 * Readest Cloud (its `enabled` flag absent meant "on unless a third-party
 * provider is"). The third-party backends and Readest Cloud were removed in
 * 2.5-B and the storage slice respectively, so the set is now a single
 * per-device `enabled` flag and the derivation is gone with it.
 */
export type CloudSyncProviderKind = FileSyncBackendKind;

/** Settings slice key for a third-party backend kind. */
export const settingsKeyForBackend = (_kind: FileSyncBackendKind): 'webdav' => 'webdav';

/** Human-readable provider name (product names — deliberately untranslated). */
export const cloudProviderDisplayName = (_kind: CloudSyncProviderKind): string => 'WebDAV';

/**
 * The third-party backends the user has switched on, in a STABLE order that
 * every loop, list, and sync pass in the app relies on.
 */
export const getEnabledFileSyncBackends = (
  settings: SystemSettings | null | undefined,
): FileSyncBackendKind[] => {
  const enabled: FileSyncBackendKind[] = [];
  if (settings?.webdav?.enabled) enabled.push('webdav');
  return enabled;
};

/** Whether a file-sync backend is switched on. */
export const hasAnyFileSyncEnabled = (settings: SystemSettings | null | undefined): boolean =>
  getEnabledFileSyncBackends(settings).length > 0;

/**
 * Every provider syncing the library on this device. Only WebDAV exists now,
 * so this is the enabled-backend list under a name the call sites already use.
 */
export const getCloudSyncProviders = (
  settings: SystemSettings | null | undefined,
): CloudSyncProviderKind[] => getEnabledFileSyncBackends(settings);

/** Comma-joined product names, for the "Synced via {{provider}}" copy. */
export const cloudProvidersDisplayName = (kinds: CloudSyncProviderKind[]): string =>
  kinds.map(cloudProviderDisplayName).join(', ');

export interface CloudSyncGate {
  /** Backends the user switched on (WebDAV, in a LAN build). */
  backends: FileSyncBackendKind[];
  /**
   * True when a backend is switched on but the plan does not allow cloud sync.
   * Paused means paused: a paused backend does not sync. (In a self-hosted
   * build the gate always passes, so this can only stay false.)
   */
  paused: boolean;
}

export const resolveCloudSyncGate = (
  settings: SystemSettings | null | undefined,
  plan: UserPlan = 'free',
  customizationPurchased = false,
): CloudSyncGate => {
  const backends = getEnabledFileSyncBackends(settings);
  return {
    // `plan` is only a gate input: in a self-hosted build isCloudSyncAllowed()
    // returns true regardless, so a paused backend can only mean the user has
    // not configured one at all.
    backends,
    paused: backends.length > 0 && !isCloudSyncAllowed(plan, customizationPurchased),
  };
};

/** The backends that may actually run right now (empty when paused). */
export const getActiveFileSyncBackends = (
  settings: SystemSettings | null | undefined,
  plan?: UserPlan,
): FileSyncBackendKind[] => {
  const gate = resolveCloudSyncGate(settings, plan);
  return gate.paused ? [] : gate.backends;
};

/**
 * One-time upgrade migration helper (appService migrate20260706): users
 * who already had WebDAV/Drive enabled before provider selection shipped
 * become "third-party selected" on upgrade, which gates native Readest
 * Cloud uploads off — with syncBooks at its old `false` default their
 * books would back up nowhere. Flip syncBooks on for every enabled backend.
 * Mutates `settings` in place (the migration runner saves the same
 * snapshot afterwards) and returns whether anything changed.
 */
export const applySyncBooksAutoEnable = (settings: SystemSettings): boolean => {
  let changed = false;
  for (const kind of getEnabledFileSyncBackends(settings)) {
    // A switch (rather than a generically-keyed write) keeps each branch's
    // settings slice type intact; `settings[key] = { ...slice, syncBooks }`
    // does not typecheck when `key` is a union of literal keys.
    switch (kind) {
      case 'webdav':
        if (settings.webdav && !settings.webdav.syncBooks) {
          settings.webdav = { ...settings.webdav, syncBooks: true };
          changed = true;
        }
        break;
    }
  }
  return changed;
};
