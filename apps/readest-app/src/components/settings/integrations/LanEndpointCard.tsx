import React, { useCallback, useEffect, useState } from 'react';
import { MdRefresh, MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';
import type { WebDAVSettings } from '@/types/settings';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { isLoopbackHost, isPrivateIpv4 } from '@/utils/lanAddress';
import { SectionTitle } from '../primitives';

interface LanEndpoint {
  addresses: string[];
  hubPort: number;
}

const buttonClass =
  'text-base-content/60 hover:text-base-content hover:bg-base-200/60 rounded-sm p-1 transition-colors duration-150 focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2';

/** Parse a saved server URL, tolerating a missing scheme ("localhost:17322"). */
const parseServerUrl = (serverUrl: string): URL | null => {
  for (const candidate of [serverUrl, `http://${serverUrl}`]) {
    try {
      return new URL(candidate);
    } catch {
      // try the next form
    }
  }
  return null;
};

interface InfoRowProps {
  label: string;
  value: string;
  /** Shown instead of `value`; omit to show the value as-is. */
  display?: string;
  /** Render bigger and bolder — for the one thing you came here to copy. */
  emphasis?: boolean;
  /** Offer a show/hide toggle for a secret. */
  secret?: boolean;
}

/** One "label / value + copy" line. Copy feedback is the app-wide toast. */
const InfoRow: React.FC<InfoRowProps> = ({ label, value, display, emphasis, secret }) => {
  const _ = useTranslation();
  const [revealed, setRevealed] = useState(false);

  const handleCopy = async () => {
    const copied = await writeTextToClipboard(value);
    if (!copied) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      timeout: 2000,
    });
  };

  return (
    <div className='flex items-center justify-between gap-2 text-sm'>
      <span className='text-base-content/60 shrink-0'>{label}</span>
      <span className='flex min-w-0 items-center gap-1'>
        <code
          className={
            emphasis
              ? 'truncate font-mono text-sm font-semibold select-all'
              : 'truncate font-mono text-xs select-all'
          }
        >
          {secret && !revealed ? '•'.repeat(8) : (display ?? value)}
        </code>
        {secret && (
          <button
            type='button'
            onClick={() => setRevealed((v) => !v)}
            className={buttonClass}
            aria-label={revealed ? _('Hide password') : _('Show password')}
            title={revealed ? _('Hide password') : _('Show password')}
          >
            {revealed ? (
              <MdVisibilityOff className='h-4 w-4' />
            ) : (
              <MdVisibility className='h-4 w-4' />
            )}
          </button>
        )}
        <button type='button' onClick={handleCopy} className={buttonClass} title={_('Copy')}>
          {_('Copy')}
        </button>
      </span>
    </div>
  );
};

/**
 * "Phone Setup" card at the top of the WebDAV panel: the LAN address, username,
 * password and root path a phone on the same network must be configured with.
 *
 * The address is live (host NICs + hub port read on each mount), so a DHCP
 * address change shows up here instead of silently breaking the phone. Renders
 * nothing when the page has no server-side route (static export / Tauri build),
 * when no LAN address exists, or when the saved WebDAV server is some *remote*
 * host — in those cases the LAN address and those credentials are unrelated.
 */
const LanEndpointCard: React.FC<{ stored?: WebDAVSettings }> = ({ stored }) => {
  const _ = useTranslation();
  const [endpoint, setEndpoint] = useState<LanEndpoint | null>(null);
  const [pickedHost, setPickedHost] = useState<string>();

  const load = useCallback(async () => {
    if (!isWebAppPlatform()) return;
    try {
      const res = await fetch('/api/lan/endpoint', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as LanEndpoint;
      if (Array.isArray(data.addresses) && data.addresses.length > 0) setEndpoint(data);
    } catch {
      // No route (static export / Tauri) or a dead server — hide the card.
      // Nothing here is essential to syncing.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = stored?.serverUrl ? parseServerUrl(stored.serverUrl) : null;
  const savedHost = saved?.hostname ?? '';
  const savedPort = Number(saved?.port ?? 0);
  const candidates = endpoint?.addresses ?? [];
  const isSelfHosted = !savedHost || isLoopbackHost(savedHost) || isPrivateIpv4(savedHost);
  if (!endpoint || !candidates.length || !isSelfHosted) return null;

  const host = pickedHost && candidates.includes(pickedHost) ? pickedHost : candidates[0]!;
  const port = savedPort || endpoint.hubPort;
  const staleHost = !!savedHost && !isLoopbackHost(savedHost) && !candidates.includes(savedHost);
  const stalePort = savedPort > 0 && savedPort !== endpoint.hubPort;

  return (
    <div className='bg-base-200/40 eink-bordered space-y-2 rounded-lg p-3'>
      <div className='flex items-center justify-between'>
        <SectionTitle as='div'>{_('Phone Setup')}</SectionTitle>
        <button
          type='button'
          onClick={() => void load()}
          className={buttonClass}
          aria-label={_('Refresh')}
          title={_('Refresh')}
        >
          <MdRefresh className='h-4 w-4' />
        </button>
      </div>

      <InfoRow label={_('Server URL')} value={`http://${host}:${port}`} emphasis />

      {stored?.username && (
        <>
          <InfoRow label={_('Username')} value={stored.username} />
          <InfoRow label={_('Password')} value={stored.password} secret />
          <InfoRow label={_('Root Directory')} value={stored.rootPath || '/'} />
        </>
      )}

      {staleHost && (
        <p className='text-warning text-[0.85em]'>
          {_('The saved server URL {{host}} is not this machine any more.', { host: savedHost })}
        </p>
      )}
      {stalePort && (
        <p className='text-warning text-[0.85em]'>
          {_('The hub is on port {{port}}, the saved URL still says {{saved}}.', {
            port: endpoint.hubPort,
            saved: savedPort,
          })}
        </p>
      )}

      {candidates.length > 1 && (
        <div className='text-base-content/60 flex flex-wrap items-center gap-1.5 text-[0.85em]'>
          <span>{_('Other addresses')}</span>
          {candidates
            .filter((ip) => ip !== host)
            .map((ip) => (
              <button
                key={ip}
                type='button'
                onClick={() => setPickedHost(ip)}
                className='hover:text-base-content font-mono underline decoration-dotted'
              >
                {ip}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

export default LanEndpointCard;
