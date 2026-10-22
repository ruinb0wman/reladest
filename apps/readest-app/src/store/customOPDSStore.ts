import { create } from 'zustand';
import type { EnvConfigType } from '@/services/environment';
import type { OPDSCatalog } from '@/types/opds';
import { useSettingsStore } from './settingsStore';
import { computeOpdsCatalogContentId } from '@/services/sync/replicaKinds';

/**
 * Backfill `contentId` (and `addedAt`) on legacy catalogs that predate
 * replica sync. Returns the same array reference if no changes were
 * required so callers can cheaply detect a no-op.
 *
 * `addedAt` is assigned per array index so the existing display order
 * survives the migration: index 0 (newest in the legacy array) gets
 * the largest timestamp, index N gets the smallest. The total span is
 * tiny (≤ N ms) so newly-imported catalogs (with `Date.now()`) still
 * sort above the migrated set, which matches the legacy "prepend new
 * entries" UX.
 */
const backfillSyncFields = (catalogs: OPDSCatalog[]): OPDSCatalog[] => {
  let mutated = false;
  const baseTime = Date.now();
  const next = catalogs.map((c, i) => {
    if (c.contentId && c.addedAt !== undefined) return c;
    mutated = true;
    return {
      ...c,
      contentId: c.contentId ?? computeOpdsCatalogContentId(c.url),
      addedAt: c.addedAt ?? baseTime - i,
    };
  });
  return mutated ? next : catalogs;
};

/**
 * Display order for the catalog list. Entries the user has dragged carry an
 * explicit `sortOrder`; everything else falls back to the legacy newest-first
 * `addedAt` order and sorts *above* the stamped block, so adding a catalog to
 * a hand-arranged list still surfaces it at the top.
 */
const compareForDisplay = (a: OPDSCatalog, b: OPDSCatalog): number => {
  const ao = a.sortOrder;
  const bo = b.sortOrder;
  if (ao === undefined && bo === undefined) return (b.addedAt || 0) - (a.addedAt || 0);
  if (ao === undefined) return -1;
  if (bo === undefined) return 1;
  return ao - bo;
};

interface OPDSStoreState {
  catalogs: OPDSCatalog[];
  loading: boolean;

  /**
   * Visible catalogs in display order: manually placed entries by ascending
   * `sortOrder`, preceded by never-dragged ones in `addedAt`-descending
   * (newest first) order.
   */
  getAvailableCatalogs(): OPDSCatalog[];
  getCatalog(id: string): OPDSCatalog | undefined;
  /** Look up by URL — used for popular-catalog dedup (independent of contentId). */
  findByUrl(url: string): OPDSCatalog | undefined;
  /** Look up by stable cross-device content id. */
  findByContentId(contentId: string): OPDSCatalog | undefined;

  /**
   * Add (or revive) a catalog. Computes `contentId` from URL if absent.
   * Always attaches a reincarnation token (minted when absent, existing
   * one preserved) so the upsert replaces any server-side tombstone with
   * a fresh row instead of losing to it under remove-wins.
   */
  addCatalog(catalog: Omit<OPDSCatalog, 'contentId'> & { contentId?: string }): OPDSCatalog;
  /**
   * Patch a catalog's mutable fields. Only the patched fields are
   * republished — credentials (username/password) are NOT in the
   * synced field set yet, so editing them stays local-only until the
   * encrypted-field PR lands.
   */
  updateCatalog(id: string, patch: Partial<OPDSCatalog>): OPDSCatalog | undefined;
  /** Soft-delete by id; pushes a tombstone if the entry has a contentId. */
  removeCatalog(id: string): boolean;
  /**
   * Apply a manual display order. `orderedIds` leads; any visible catalog it
   * omits keeps its relative position behind them, so the stamp always covers
   * the whole visible list and no entry is left with a stale (or absent)
   * `sortOrder` that would fling it back to the top. Publishes one upsert per
   * stamped catalog so the order follows the user across devices.
   */
  reorderCatalogs(orderedIds: string[]): void;

  /** Hydrate from `settings.opdsCatalogs`. Backfills sync fields if needed. */
  loadCustomOPDSCatalogs(envConfig: EnvConfigType): Promise<void>;
  /** Persist current state back into settings. */
  saveCustomOPDSCatalogs(envConfig: EnvConfigType): Promise<void>;
}

export const useCustomOPDSStore = create<OPDSStoreState>((set, get) => ({
  catalogs: [],
  loading: false,

  getAvailableCatalogs: () =>
    get()
      .catalogs.filter((c) => !c.deletedAt)
      .sort(compareForDisplay),

  getCatalog: (id) => get().catalogs.find((c) => c.id === id),

  findByUrl: (url) => {
    const normalized = url.trim().toLowerCase();
    return get().catalogs.find((c) => c.url.trim().toLowerCase() === normalized && !c.deletedAt);
  },

  findByContentId: (contentId) =>
    contentId ? get().catalogs.find((c) => c.contentId === contentId) : undefined,

  addCatalog: (input) => {
    const contentId = input.contentId ?? computeOpdsCatalogContentId(input.url);
    const existing = get().catalogs.find((c) => c.contentId === contentId);
    // Under CRDT remove-wins a plain upsert can't revive a server-side
    // tombstone, so a re-added catalog silently vanishes on the next
    // pull (issue #5180, same class as fonts/textures #4410). We can't
    // see the server's tombstone from here, and — unlike fonts/textures —
    // saveCustomOPDSCatalogs strips local tombstones at persistence, so
    // after an app restart `existing` is usually absent even when the
    // server row is dead. Always carry a reincarnation token on add so
    // the upsert beats any server tombstone; the token is inert when the
    // row is alive. Preserve an existing token to avoid churning a new
    // one on every add.
    const reincarnation =
      input.reincarnation ?? existing?.reincarnation ?? Math.random().toString(36).slice(2);
    const catalog: OPDSCatalog = {
      ...input,
      contentId,
      addedAt: input.addedAt ?? existing?.addedAt ?? Date.now(),
      deletedAt: undefined,
      reincarnation,
    };
    set((state) => {
      const idx = state.catalogs.findIndex((c) => c.contentId === contentId);
      const catalogs =
        idx >= 0
          ? state.catalogs.map((c, i) => (i === idx ? catalog : c))
          : [...state.catalogs, catalog];
      return { catalogs };
    });
    return catalog;
  },

  updateCatalog: (id, patch) => {
    let updated: OPDSCatalog | undefined;
    set((state) => {
      const idx = state.catalogs.findIndex((c) => c.id === id);
      if (idx < 0) return state;
      const old = state.catalogs[idx]!;
      if (old.deletedAt) return state;
      updated = { ...old, ...patch };
      // Recompute contentId only if the URL itself changed; otherwise
      // preserve the existing one so we keep the same server row.
      if (patch.url && patch.url !== old.url) {
        updated.contentId = computeOpdsCatalogContentId(patch.url);
      }
      return {
        catalogs: state.catalogs.map((c, i) => (i === idx ? updated! : c)),
      };
    });
    return updated;
  },

  removeCatalog: (id) => {
    const catalog = get().catalogs.find((c) => c.id === id);
    if (!catalog) return false;
    set((state) => ({
      catalogs: state.catalogs.map((c) => (c.id === id ? { ...c, deletedAt: Date.now() } : c)),
    }));
    return true;
  },

  reorderCatalogs: (orderedIds) => {
    const visible = get().catalogs.filter((c) => !c.deletedAt);
    const byId = new Map(visible.map((c) => [c.id, c]));
    const leading = orderedIds.map((id) => byId.get(id)).filter((c): c is OPDSCatalog => !!c);
    const leadingIds = new Set(leading.map((c) => c.id));
    const trailing = visible.filter((c) => !leadingIds.has(c.id)).sort(compareForDisplay);
    const nextOrder = new Map([...leading, ...trailing].map((c, i) => [c.id, i]));

    const updated: OPDSCatalog[] = [];
    const catalogs = get().catalogs.map((c) => {
      const order = nextOrder.get(c.id);
      if (order === undefined || c.sortOrder === order) return c;
      const next = { ...c, sortOrder: order };
      updated.push(next);
      return next;
    });
    if (!updated.length) return;
    set({ catalogs });
  },

  loadCustomOPDSCatalogs: async (_envConfig) => {
    try {
      const { settings } = useSettingsStore.getState();
      const persisted = settings?.opdsCatalogs ?? [];
      const backfilled = backfillSyncFields(persisted);
      set({ catalogs: backfilled });
      // Backfill mutated something: persist the fresh contentIds so the
      // rest of the code can keep treating them as stable row identities.
      if (backfilled !== persisted) {
        await get().saveCustomOPDSCatalogs(_envConfig);
      }
    } catch (error) {
      console.error('Failed to load OPDS catalogs:', error);
    }
  },

  saveCustomOPDSCatalogs: async (_envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { catalogs } = get();
      // Tombstoned entries stay in memory so the orchestrator can detect
      // re-import / reincarnation, but they're stripped at the
      // persistence boundary. The next pull will mirror server-side
      // tombstones back into memory if the row is still deleted.
      settings.opdsCatalogs = catalogs.filter((c) => !c.deletedAt);
      setSettings(settings);
      saveSettings(_envConfig, settings);
    } catch (error) {
      console.error('Failed to save OPDS catalogs:', error);
      throw error;
    }
  },
}));

/**
 * Look up an OPDS catalog by its contentId, falling back to the persisted
 * settings when the in-memory store is empty (the settings page can ask
 * before the OPDS page mounts).
 */
export const findOPDSCatalogByContentId = (contentId: string): OPDSCatalog | undefined => {
  if (!contentId) return undefined;
  const inMemory = useCustomOPDSStore.getState().findByContentId(contentId);
  if (inMemory) return inMemory;
  const persisted = useSettingsStore.getState().settings?.opdsCatalogs ?? [];
  return persisted.find((c) => c.contentId === contentId && !c.deletedAt);
};
