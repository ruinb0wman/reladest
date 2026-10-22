import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeOpdsCatalogContentId } from '@/services/sync/replicaKinds';
import type { OPDSCatalog } from '@/types/opds';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

const makeEnvConfig = (): EnvConfigType =>
  ({
    getAppService: vi.fn(),
  }) as unknown as EnvConfigType;

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    opdsCatalogs: [],
    ...overrides,
  }) as unknown as SystemSettings;

beforeEach(() => {
  useCustomOPDSStore.setState({ catalogs: [], loading: false });
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
  vi.clearAllMocks();
});

describe('customOPDSStore', () => {
  describe('addCatalog', () => {
    test('mints a contentId from the URL when one is not provided', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'My Library',
        url: 'https://example.com/opds',
      });
      expect(cat.contentId).toBe(computeOpdsCatalogContentId('https://example.com/opds'));
      expect(cat.addedAt).toBeGreaterThan(0);
    });

    test('re-adding a soft-deleted entry mints a reincarnation token', () => {
      const first = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(first.id);
      vi.clearAllMocks();
      const revived = useCustomOPDSStore.getState().addCatalog({
        id: 'l2',
        name: 'L1 again',
        url: 'https://example.com/opds',
      });
      expect(revived.deletedAt).toBeUndefined();
      expect(revived.reincarnation).toBeTruthy();
    });

    test('re-adding after a restart (local tombstone stripped) still revives the server row', async () => {
      // Reporter scenario (#5180): the catalog carries a server-side
      // tombstone (from a prior delete on this or another device). After
      // an app restart the local tombstone is gone — saveCustomOPDSCatalogs
      // strips deletedAt entries from persisted settings — so addCatalog
      // sees no in-memory entry and, before this fix, never minted a
      // reincarnation token. Under CRDT remove-wins the re-added catalog
      // then loses to the tombstone and vanishes on the next pull. The
      // re-add must reincarnate even though no local tombstone survives.
      const env = makeEnvConfig();
      const first = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(first.id);
      await useCustomOPDSStore.getState().saveCustomOPDSCatalogs(env);
      // The tombstone did not survive persistence...
      expect(useSettingsStore.getState().settings.opdsCatalogs).toHaveLength(0);

      // ...so a restart hydrates an empty store.
      useCustomOPDSStore.setState({ catalogs: [], loading: false });
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(env);
      expect(useCustomOPDSStore.getState().catalogs).toHaveLength(0);

      vi.clearAllMocks();
      const revived = useCustomOPDSStore.getState().addCatalog({
        id: 'l2',
        name: 'L1 again',
        url: 'https://example.com/opds',
      });
      expect(revived.deletedAt).toBeUndefined();
      expect(revived.reincarnation).toBeTruthy();
    });
  });

  describe('updateCatalog', () => {
    test('a non-URL patch keeps the contentId', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'Old',
        url: 'https://example.com/opds',
      });
      const oldContentId = cat.contentId;
      const updated = useCustomOPDSStore.getState().updateCatalog(cat.id, { name: 'New' });
      expect(updated!.name).toBe('New');
      expect(updated!.contentId).toBe(oldContentId);
    });

    test('changing the URL recomputes contentId', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'Cat',
        url: 'https://example.com/opds',
      });
      const updated = useCustomOPDSStore
        .getState()
        .updateCatalog(cat.id, { url: 'https://other.example/opds' });
      expect(updated!.contentId).toBe(computeOpdsCatalogContentId('https://other.example/opds'));
      expect(updated!.contentId).not.toBe(cat.contentId);
    });

    test('no-op on tombstoned entry', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(cat.id);
      vi.clearAllMocks();
      const out = useCustomOPDSStore.getState().updateCatalog(cat.id, { name: 'X' });
      expect(out).toBeUndefined();
    });
  });

  describe('removeCatalog', () => {
    test('soft-deletes and publishes the tombstone', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      vi.clearAllMocks();
      const removed = useCustomOPDSStore.getState().removeCatalog(cat.id);
      expect(removed).toBe(true);
      const stored = useCustomOPDSStore.getState().getCatalog(cat.id);
      expect(stored?.deletedAt).toBeGreaterThan(0);
    });

    test('returns false when id is unknown', () => {
      expect(useCustomOPDSStore.getState().removeCatalog('nope')).toBe(false);
    });
  });

  describe('getAvailableCatalogs ordering', () => {
    const seed = (catalogs: OPDSCatalog[]) =>
      useCustomOPDSStore.setState({ catalogs, loading: false });

    test('sorts manually placed catalogs by ascending sortOrder', () => {
      seed([
        { id: 'a', name: 'A', url: 'https://a.example/opds', addedAt: 3, sortOrder: 2 },
        { id: 'b', name: 'B', url: 'https://b.example/opds', addedAt: 2, sortOrder: 0 },
        { id: 'c', name: 'C', url: 'https://c.example/opds', addedAt: 1, sortOrder: 1 },
      ]);
      expect(
        useCustomOPDSStore
          .getState()
          .getAvailableCatalogs()
          .map((c) => c.id),
      ).toEqual(['b', 'c', 'a']);
    });

    test('keeps the legacy newest-first order when nothing has been dragged', () => {
      seed([
        { id: 'old', name: 'Old', url: 'https://old.example/opds', addedAt: 1 },
        { id: 'new', name: 'New', url: 'https://new.example/opds', addedAt: 3 },
        { id: 'mid', name: 'Mid', url: 'https://mid.example/opds', addedAt: 2 },
      ]);
      expect(
        useCustomOPDSStore
          .getState()
          .getAvailableCatalogs()
          .map((c) => c.id),
      ).toEqual(['new', 'mid', 'old']);
    });

    test('a freshly added catalog still lands on top of a manually ordered list', () => {
      seed([
        { id: 'a', name: 'A', url: 'https://a.example/opds', addedAt: 1, sortOrder: 0 },
        { id: 'b', name: 'B', url: 'https://b.example/opds', addedAt: 2, sortOrder: 1 },
      ]);
      useCustomOPDSStore
        .getState()
        .addCatalog({ id: 'fresh', name: 'Fresh', url: 'https://fresh.example/opds' });
      expect(
        useCustomOPDSStore
          .getState()
          .getAvailableCatalogs()
          .map((c) => c.id),
      ).toEqual(['fresh', 'a', 'b']);
    });

    test('excludes tombstoned entries regardless of sortOrder', () => {
      seed([
        { id: 'a', name: 'A', url: 'https://a.example/opds', addedAt: 1, sortOrder: 0 },
        {
          id: 'dead',
          name: 'Dead',
          url: 'https://dead.example/opds',
          addedAt: 2,
          sortOrder: 1,
          deletedAt: 5,
        },
      ]);
      expect(
        useCustomOPDSStore
          .getState()
          .getAvailableCatalogs()
          .map((c) => c.id),
      ).toEqual(['a']);
    });
  });

  describe('reorderCatalogs', () => {
    const seedThree = () => {
      useCustomOPDSStore.setState({
        catalogs: [
          { id: 'a', contentId: 'ca', name: 'A', url: 'https://a.example/opds', addedAt: 3 },
          { id: 'b', contentId: 'cb', name: 'B', url: 'https://b.example/opds', addedAt: 2 },
          { id: 'c', contentId: 'cc', name: 'C', url: 'https://c.example/opds', addedAt: 1 },
        ],
        loading: false,
      });
    };

    test('stamps sortOrder 0..n-1 in the given id order', () => {
      seedThree();
      useCustomOPDSStore.getState().reorderCatalogs(['c', 'a', 'b']);
      const ordered = useCustomOPDSStore.getState().getAvailableCatalogs();
      expect(ordered.map((c) => c.id)).toEqual(['c', 'a', 'b']);
      expect(ordered.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    });

    test('ignores unknown ids and leaves omitted catalogs trailing in their prior order', () => {
      seedThree();
      useCustomOPDSStore.getState().reorderCatalogs(['b', 'nope']);
      const ordered = useCustomOPDSStore.getState().getAvailableCatalogs();
      expect(ordered.map((c) => c.id)).toEqual(['b', 'a', 'c']);
      expect(ordered.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    });

    test('does not stamp tombstoned entries', () => {
      seedThree();
      useCustomOPDSStore.getState().removeCatalog('b');
      vi.clearAllMocks();
      useCustomOPDSStore.getState().reorderCatalogs(['c', 'b', 'a']);
      expect(useCustomOPDSStore.getState().getCatalog('b')!.sortOrder).toBeUndefined();
      expect(
        useCustomOPDSStore
          .getState()
          .getAvailableCatalogs()
          .map((c) => c.id),
      ).toEqual(['c', 'a']);
    });
  });

  describe('saveCustomOPDSCatalogs', () => {
    test('strips tombstoned entries from the persisted settings list', async () => {
      const live = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'Live',
        url: 'https://example.com/opds',
      });
      const dead = useCustomOPDSStore.getState().addCatalog({
        id: 'l2',
        name: 'Dead',
        url: 'https://other.example/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(dead.id);
      await useCustomOPDSStore.getState().saveCustomOPDSCatalogs(makeEnvConfig());
      const persisted = useSettingsStore.getState().settings.opdsCatalogs!;
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.id).toBe(live.id);
    });
  });

  describe('loadCustomOPDSCatalogs', () => {
    test('backfills contentId on legacy entries and republishes them', async () => {
      const legacy: OPDSCatalog = {
        id: 'legacy-1',
        name: 'Legacy',
        url: 'https://legacy.example/opds',
      };
      useSettingsStore.setState({
        settings: makeSettings({ opdsCatalogs: [legacy] }),
      } as unknown as ReturnType<typeof useSettingsStore.getState>);
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(makeEnvConfig());
      const inMemory = useCustomOPDSStore.getState().getCatalog('legacy-1')!;
      expect(inMemory.contentId).toBe(computeOpdsCatalogContentId('https://legacy.example/opds'));
    });

    test('preserves the existing array order via descending addedAt timestamps', async () => {
      const legacy: OPDSCatalog[] = [
        { id: 'a', name: 'Alpha', url: 'https://a.example/opds' },
        { id: 'b', name: 'Bravo', url: 'https://b.example/opds' },
        { id: 'c', name: 'Charlie', url: 'https://c.example/opds' },
      ];
      useSettingsStore.setState({
        settings: makeSettings({ opdsCatalogs: legacy }),
      } as unknown as ReturnType<typeof useSettingsStore.getState>);
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(makeEnvConfig());
      const ordered = useCustomOPDSStore.getState().getAvailableCatalogs();
      expect(ordered.map((c) => c.id)).toEqual(['a', 'b', 'c']);
      // Strict descending — first entry strictly newer than next.
      expect(ordered[0]!.addedAt!).toBeGreaterThan(ordered[1]!.addedAt!);
      expect(ordered[1]!.addedAt!).toBeGreaterThan(ordered[2]!.addedAt!);
    });

    test('hydrates without backfilling when entries already carry contentId', async () => {
      useSettingsStore.setState({
        settings: makeSettings({
          opdsCatalogs: [
            {
              id: 'a',
              contentId: 'a',
              name: 'A',
              url: 'https://example.com/opds',
              addedAt: 1700000000000,
            },
          ],
        }),
      } as unknown as ReturnType<typeof useSettingsStore.getState>);
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(makeEnvConfig());
      expect(useCustomOPDSStore.getState().catalogs).toHaveLength(1);
    });
  });
});
