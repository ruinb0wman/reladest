import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { getDefaultViewSettings } from '@/services/settingsService';
import { useSettingsStore } from '@/store/settingsStore';
import ControlPanel from '@/components/settings/ControlPanel';

const storageKey = 'control-panel-update-reset';
const defaultViewSettings = getDefaultViewSettings({
  fs: {} as FileSystem,
  isMobile: false,
  isAppDataSandbox: false,
});
const appService = {
  isMobileApp: false,
  supportsViewTransitionGroup: true,
  getDefaultViewSettings: () => defaultViewSettings,
  saveSettings: async (settings: SystemSettings) => {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  },
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => appService }, appService }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const readerState = {
  bookKeys: [],
  getView: () => null,
  getViews: () => [],
  getViewSettings: () => undefined,
  getViewState: () => undefined,
  setViewSettings: vi.fn(),
  recreateViewer: vi.fn(),
};
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(() => readerState, { getState: () => readerState }),
}));
const bookState = {
  getBookData: () => undefined,
  getConfig: () => undefined,
  saveConfig: vi.fn(),
};
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: Object.assign(() => bookState, { getState: () => bookState }),
}));
vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: () => ({ applyEinkMode: vi.fn() }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/share', () => ({ canShareText: () => true }));
vi.mock('@/utils/telemetry', () => ({ optInTelemetry: vi.fn(), optOutTelemetry: vi.fn() }));
vi.mock('@/components/settings/PageTurnerSettings', () => ({ default: () => null }));
vi.mock('@/utils/style', () => ({ getStyles: () => '' }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: vi.fn() }));

const savedSettings = (): SystemSettings => JSON.parse(localStorage.getItem(storageKey)!);

beforeEach(() => {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      globalViewSettings: { ...defaultViewSettings },
      telemetryEnabled: false,
      gamepadEnabled: false,
    } as SystemSettings,
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(storageKey);
});

describe('Behavior animation reset', () => {
  it.each([
    'slide',
    'curl',
  ] as const)('restores the push animation style from %s', async (style) => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        globalViewSettings: { ...defaultViewSettings, animated: true, pageTurnStyle: style },
      },
    });
    const registerReset = vi.fn<(reset: () => void) => void>();
    render(<ControlPanel bookKey='' onRegisterReset={registerReset} />);
    const styleSelect = () =>
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Animation Style' });
    expect(styleSelect().value).toBe(style);

    await act(async () => registerReset.mock.calls[0]![0]());

    expect(styleSelect().value).toBe('push');
    expect(savedSettings().globalViewSettings).toMatchObject({
      animated: false,
      pageTurnStyle: 'push',
    });
  });
});
