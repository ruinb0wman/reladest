import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  isCredentialsSyncEnabled,
  isSyncCategoryEnabled,
  isSyncCategoryLocked,
} from '@/services/sync/syncCategories';
import { useSettingsStore } from '@/store/settingsStore';
import type { SyncCategory, SystemSettings } from '@/types/settings';

const setSettings = (patch: Partial<SystemSettings>): void => {
  useSettingsStore.setState({
    settings: { ...patch } as SystemSettings,
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
  } as ReturnType<typeof useSettingsStore.getState>);
};

const clearSettings = (): void => {
  useSettingsStore.setState({
    settings: undefined,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
};

beforeEach(() => clearSettings());
afterEach(() => clearSettings());

describe('isSyncCategoryEnabled', () => {
  test('defaults to true when settings are not loaded yet', () => {
    expect(isSyncCategoryEnabled('book')).toBe(true);
    expect(isSyncCategoryEnabled('dictionary')).toBe(true);
  });

  test('defaults to true when syncCategories map is missing', () => {
    setSettings({});
    expect(isSyncCategoryEnabled('book')).toBe(true);
    expect(isSyncCategoryEnabled('opds_catalog')).toBe(true);
  });

  test('returns true when category is explicitly true', () => {
    setSettings({ syncCategories: { dictionary: true } });
    expect(isSyncCategoryEnabled('dictionary')).toBe(true);
  });

  test('returns false only when category is explicitly false', () => {
    setSettings({ syncCategories: { dictionary: false } });
    expect(isSyncCategoryEnabled('dictionary')).toBe(false);
    // Other unset categories still default to true.
    expect(isSyncCategoryEnabled('font')).toBe(true);
  });

  // The provider gate (book/progress/note off while a third-party provider was
  // selected, #4380) belonged to the Readest Cloud channels and is gone with
  // them: the user's own toggles are the whole answer.
  test('a selected file-sync backend does not gate the book categories', () => {
    setSettings({
      webdav: { enabled: true },
      syncCategories: { book: true, progress: true },
    } as Partial<SystemSettings>);
    expect(isSyncCategoryEnabled('book')).toBe(true);
    expect(isSyncCategoryEnabled('progress')).toBe(true);
    expect(isSyncCategoryEnabled('note')).toBe(true);
    // Legacy aliases resolve to the same categories.
    expect(isSyncCategoryEnabled('books')).toBe(true);
    expect(isSyncCategoryEnabled('configs')).toBe(true);
    expect(isSyncCategoryEnabled('notes')).toBe(true);
  });

  test('settings is togglable on its own', () => {
    setSettings({
      syncCategories: { settings: false, dictionary: false } as Partial<
        Record<SyncCategory, boolean>
      >,
    });
    // With dictionary off, the user's settings:false stands.
    expect(isSyncCategoryEnabled('settings')).toBe(false);
  });

  test('settings is FORCED on when dictionary is enabled (dependency cascade)', () => {
    setSettings({
      syncCategories: { settings: false, dictionary: true } as Partial<
        Record<SyncCategory, boolean>
      >,
    });
    // Dictionary's providerOrder / providerEnabled / webSearches live
    // inside the settings replica, so disabling settings while
    // dictionary is on would silently break dictionary cross-device
    // sync. The cascade prevents that footgun.
    expect(isSyncCategoryEnabled('settings')).toBe(true);
  });

  test('infrastructure kinds outside SYNC_CATEGORIES are always enabled', () => {
    setSettings({
      syncCategories: { progress: false } as Partial<Record<SyncCategory, boolean>>,
    });
    expect(isSyncCategoryEnabled('font_metadata')).toBe(true); // unknown id
  });

  describe('isSyncCategoryLocked', () => {
    test('returns false for categories with no dependents', () => {
      expect(isSyncCategoryLocked('book')).toBe(false);
      expect(isSyncCategoryLocked('font')).toBe(false);
    });

    test('returns false for `settings` when dictionary is disabled', () => {
      setSettings({
        syncCategories: { dictionary: false } as Partial<Record<SyncCategory, boolean>>,
      });
      expect(isSyncCategoryLocked('settings')).toBe(false);
    });

    test('returns true for `settings` when dictionary is enabled', () => {
      setSettings({
        syncCategories: { dictionary: true } as Partial<Record<SyncCategory, boolean>>,
      });
      expect(isSyncCategoryLocked('settings')).toBe(true);
    });

    test('returns true for `settings` when dictionary defaults to enabled (no map)', () => {
      setSettings({});
      expect(isSyncCategoryLocked('settings')).toBe(true);
    });
  });

  describe('credentials category', () => {
    test('defaults to OFF when settings are not loaded', () => {
      // Unique among categories: credentials must be opt-in, so the
      // default for an absent map / missing key is false rather than the
      // global "missing key → on" default.
      expect(isSyncCategoryEnabled('credentials')).toBe(false);
      expect(isCredentialsSyncEnabled()).toBe(false);
    });

    test('defaults to OFF when syncCategories map is missing', () => {
      setSettings({});
      expect(isSyncCategoryEnabled('credentials')).toBe(false);
      expect(isCredentialsSyncEnabled()).toBe(false);
    });

    test('defaults to OFF when explicitly absent from a populated map', () => {
      setSettings({ syncCategories: { book: true, settings: true } });
      expect(isSyncCategoryEnabled('credentials')).toBe(false);
      expect(isCredentialsSyncEnabled()).toBe(false);
    });

    test('returns true only when explicitly opted in', () => {
      setSettings({ syncCategories: { credentials: true } });
      expect(isSyncCategoryEnabled('credentials')).toBe(true);
      expect(isCredentialsSyncEnabled()).toBe(true);
    });

    test('returns false when explicitly false', () => {
      setSettings({ syncCategories: { credentials: false } });
      expect(isSyncCategoryEnabled('credentials')).toBe(false);
      expect(isCredentialsSyncEnabled()).toBe(false);
    });
  });

  test('legacy SyncType ids map to categories (configs → progress, books → book, notes → note)', () => {
    setSettings({ syncCategories: { progress: false, book: false, note: false } });
    expect(isSyncCategoryEnabled('configs')).toBe(false);
    expect(isSyncCategoryEnabled('config')).toBe(false);
    expect(isSyncCategoryEnabled('books')).toBe(false);
    expect(isSyncCategoryEnabled('notes')).toBe(false);
  });

  // The provider gate that used to keep the native book/progress/note channels
  // off while Readest Cloud was unchecked is gone with that provider: the
  // user's own category toggles are the whole answer now.
  test('a file-sync backend does not gate the book categories', () => {
    setSettings({ webdav: { enabled: true } } as unknown as Partial<SystemSettings>);
    expect(isSyncCategoryEnabled('book')).toBe(true);
    expect(isSyncCategoryEnabled('progress')).toBe(true);
    expect(isSyncCategoryEnabled('note')).toBe(true);
    expect(isSyncCategoryEnabled('settings')).toBe(true);
  });
});
