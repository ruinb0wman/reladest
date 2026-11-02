import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebDAVSettings } from '@/types/settings';

import LanEndpointCard from '@/components/settings/integrations/LanEndpointCard';

/**
 * The card is the only place that says "your phone must dial this". It has to
 * follow the live NIC list (so a DHCP change shows up) and stay silent rather
 * than lie when there is no server-side route — because the App Router API only
 * exists in dev/standalone, not in the static-export (Tauri) build.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) =>
    params ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k])) : key,
}));

vi.mock('@/services/environment', () => ({ isWebAppPlatform: () => true }));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(true),
}));

const baseSettings: WebDAVSettings = {
  enabled: true,
  serverUrl: 'http://localhost:17322',
  username: 'readest',
  password: 'lan-secret-12',
  rootPath: '/',
};

const okResponse = (addresses: string[], hubPort = 17322) =>
  ({ ok: true, json: async () => ({ addresses, hubPort }) }) as unknown as Response;

const renderCard = (stored: Partial<WebDAVSettings> = {}) =>
  render(<LanEndpointCard stored={{ ...baseSettings, ...stored }} />);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse(['192.168.1.4'])),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LanEndpointCard', () => {
  test('shows the live LAN address plus the credentials to type into the phone', async () => {
    renderCard();
    expect(await screen.findByText('http://192.168.1.4:17322')).toBeTruthy();
    expect(screen.getByText('readest')).toBeTruthy();
    expect(screen.getByText('/')).toBeTruthy();
    // Password starts masked; the reveal toggle is the only way it appears.
    expect(screen.getByText('•'.repeat(8))).toBeTruthy();
    expect(screen.queryByText('lan-secret-12')).toBeNull();
  });

  test('follows the port from the env-driven hub rather than the saved URL', async () => {
    renderCard({ serverUrl: 'http://localhost' });
    expect(await screen.findByText('http://192.168.1.4:17322')).toBeTruthy();
    expect(screen.queryByText(/The hub is on port/)).toBeNull();
  });

  test('warns when the saved URL points at an address this machine no longer has', async () => {
    renderCard({ serverUrl: 'http://192.168.1.20:17322' });
    expect(
      await screen.findByText('The saved server URL 192.168.1.20 is not this machine any more.'),
    ).toBeTruthy();
  });

  test('warns when the saved port drifted from the hub port', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(['192.168.1.4'], 17323)),
    );
    renderCard();
    expect(
      await screen.findByText('The hub is on port 17323, the saved URL still says 17322.'),
    ).toBeTruthy();
  });

  test('offers the remaining interfaces as alternatives, Tailscale included', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(['192.168.1.4', '100.104.201.34'])),
    );
    renderCard();
    expect(await screen.findByText('http://192.168.1.4:17322')).toBeTruthy();
    expect(screen.getByText('100.104.201.34')).toBeTruthy();
  });

  test('renders nothing when the page has no API route (static export / Tauri)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response),
    );
    const { container } = renderCard();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });

  test('stays silent when the PC syncs to some other host, not to itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(['192.168.1.4'])),
    );
    const { container } = renderCard({ serverUrl: 'https://dav.example.com' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });
});
