/**
 * Which of this machine's addresses a phone should dial, best first.
 *
 * `os.networkInterfaces()` order is arbitrary and a dev box usually has more
 * than one non-internal IPv4: on this one `eth1 100.104.201.34` (Tailscale,
 * 100.64/10 CGNAT) enumerates before `eth2 192.168.1.4`. Taking the first
 * non-internal address would hand the phone one it cannot reach, so rank by
 * "looks like a home/office LAN" and let the UI offer the rest.
 */

/** Structurally compatible with `os.NetworkInterfaceInfo` (keeps this file node-free). */
export interface LanInterfaceInfo {
  address: string;
  family: string;
  internal: boolean;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const octets = (ip: string): number[] | null => {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return parts.every((n) => n <= 255) ? parts : null;
};

/** Loopback means "this page was opened on the machine that hosts the server". */
export const isLoopbackHost = (host: string): boolean => {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  return octets(host)?.[0] === 127;
};

/** RFC1918 IPv4 — the shape of an address another device on the same LAN can reach. */
export const isPrivateIpv4 = (ip: string): boolean => {
  const o = octets(ip);
  if (!o) return false;
  const [a, b] = [o[0]!, o[1]!];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** Lower is better; ≥90 means "never show this to a phone". */
const rankOf = (ip: string): number => {
  const o = octets(ip);
  if (!o) return 99;
  const [a, b] = [o[0]!, o[1]!];
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  if (a === 100 && b >= 64 && b <= 127) return 90; // CGNAT / Tailscale
  if (a === 169 && b === 254) return 95; // link-local
  return 50;
};

/** Non-internal IPv4 addresses of this host, most LAN-like first, no duplicates. */
export const rankLanAddresses = (
  interfaces: Record<string, readonly LanInterfaceInfo[] | undefined>,
): string[] => {
  const ranked = new Map<string, number>();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || info.family !== 'IPv4' || ranked.has(info.address)) continue;
      const rank = rankOf(info.address);
      if (rank >= 90) continue;
      ranked.set(info.address, rank);
    }
  }
  return [...ranked.entries()].sort((a, b) => a[1] - b[1]).map(([ip]) => ip);
};
