import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {}, envConfig: {} }),
}));
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));
import CustomFonts from '@/components/settings/CustomFonts';
import { useCustomFontStore } from '@/store/customFontStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import type { CustomFont } from '@/styles/fonts';
import type { SystemSettings } from '@/types/settings';

const cloudFont = (overrides: Partial<CustomFont> = {}): CustomFont => ({
  id: 'inter-regular',
  contentId: 'hash-regular',
  name: 'Inter Regular',
  family: 'Inter',
  bundleDir: 'inter-regular',
  path: 'inter-regular/Inter-Regular.ttf',
  unavailable: true,
  ...overrides,
});

beforeEach(() => {
  useSettingsStore.setState({
    settings: {
      globalViewSettings: { defaultFont: 'Sans-serif', serifFont: '', sansSerifFont: '' },
    } as unknown as SystemSettings,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CustomFonts family selection', () => {
  it('selects a font family for the book when its row is tapped', () => {
    useCustomFontStore.setState({ fonts: [cloudFont({ unavailable: undefined })] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));

    expect(saveViewSettings).toHaveBeenCalledWith({}, '', 'sansSerifFont', 'Inter');
  });

  it('writes to the serif slot when the reader is using a serif default', () => {
    useSettingsStore.setState({
      settings: {
        globalViewSettings: { defaultFont: 'Serif', serifFont: '', sansSerifFont: '' },
      } as unknown as SystemSettings,
    });
    useCustomFontStore.setState({ fonts: [cloudFont({ unavailable: undefined })] });
    render(<CustomFonts bookKey='' onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Inter'));

    expect(saveViewSettings).toHaveBeenCalledWith({}, '', 'serifFont', 'Inter');
  });
});
