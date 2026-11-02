import { describe, expect, test } from 'vitest';
import { isLoopbackHost, isPrivateIpv4, rankLanAddresses } from '@/utils/lanAddress';

/**
 * The card's correctness rides entirely on picking the right address: a dev box
 * here enumerates Tailscale (`100.104.201.34`) before the real LAN NIC
 * (`192.168.1.4`), and handing the phone the former makes sync silently
 * unreachable. Also guards the "is this URL pointing at me?" gate.
 */

describe('rankLanAddresses', () => {
  test('prefers a 192.168 address over a Tailscale CGNAT address listed first', () => {
    const addresses = rankLanAddresses({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth1: [{ address: '100.104.201.34', family: 'IPv4', internal: false }],
      eth2: [{ address: '192.168.1.4', family: 'IPv4', internal: false }],
    });
    expect(addresses).toEqual(['192.168.1.4']);
  });

  test('orders 192.168 > 10 > 172.16/12 and drops link-local, internal and IPv6', () => {
    const addresses = rankLanAddresses({
      a: [{ address: '172.20.0.5', family: 'IPv4', internal: false }],
      b: [{ address: '169.254.10.10', family: 'IPv4', internal: false }],
      c: [{ address: '10.1.2.3', family: 'IPv4', internal: false }],
      d: [{ address: '192.168.0.9', family: 'IPv4', internal: false }],
      e: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
      f: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    });
    expect(addresses).toEqual(['192.168.0.9', '10.1.2.3', '172.20.0.5']);
  });

  test('dedupes an address that appears on several interfaces and survives junk', () => {
    const addresses = rankLanAddresses({
      a: [{ address: '192.168.1.4', family: 'IPv4', internal: false }],
      b: [
        { address: '192.168.1.4', family: 'IPv4', internal: false },
        { address: 'not-an-ip', family: 'IPv4', internal: false },
      ],
      c: undefined,
    });
    expect(addresses).toEqual(['192.168.1.4']);
  });

  test('returns nothing when the only addresses are unreachable ones', () => {
    expect(
      rankLanAddresses({ eth0: [{ address: '100.104.201.34', family: 'IPv4', internal: false }] }),
    ).toEqual([]);
  });
});

describe('isLoopbackHost', () => {
  test.each(['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])('%s is loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  test.each(['192.168.1.4', 'dav.example.com', '10.0.0.2', '1270.0.0.1'])('%s is not', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('isPrivateIpv4', () => {
  test.each(['192.168.1.4', '10.0.0.2', '172.16.5.5', '172.31.255.1'])('%s is private', (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });

  test.each(['172.32.0.1', '8.8.8.8', 'dav.example.com', '100.104.201.34'])('%s is not', (ip) => {
    expect(isPrivateIpv4(ip)).toBe(false);
  });
});
