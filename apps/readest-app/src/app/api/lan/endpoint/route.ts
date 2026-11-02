import os from 'node:os';
import { NextResponse } from 'next/server';
import { rankLanAddresses } from '@/utils/lanAddress';

/**
 * Addresses a phone on the same network can use to reach the WebDAV hub that
 * `scripts/lan/dev.sh` starts next to this server.
 *
 * The browser cannot know the host's LAN IP (`location.hostname` is
 * `localhost` when the PC reads in its own browser), so the PC page asks this
 * same-origin route. Only addresses and the port are exposed — credentials stay
 * in the client's settings.
 */

// The answer depends on the running process environment and host NICs, so it
// must never be prerendered into a frozen value at build time.
export const dynamic = 'force-dynamic';

const DEFAULT_HUB_PORT = 17322;

export async function GET() {
  const addresses = rankLanAddresses(os.networkInterfaces());
  const hubPort = Number(process.env['HUB_PORT']) || DEFAULT_HUB_PORT;
  return NextResponse.json({ addresses, hubPort }, { headers: { 'Cache-Control': 'no-store' } });
}
