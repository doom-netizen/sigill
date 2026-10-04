// Rate limits, velocity locks, network flags. Counters live in memory with
// TTLs (swap for Redis in production). IPs and device ids are only ever
// handled as keyed hashes.

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import { config } from './config';

export function fingerprint(kind: string, value: string): string {
  return crypto.createHmac('sha256', config.fingerprintSecret).update(`${kind}:${value}`).digest('hex').slice(0, 32);
}

export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

// ---------------------------------------------------------- sliding windows

const windows = new Map<string, number[]>();

/** Returns true if allowed (and records the hit). */
export function hit(bucket: string, key: string, limit: number, windowMs: number): boolean {
  const k = `${bucket}:${key}`;
  const now = Date.now();
  const arr = (windows.get(k) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { windows.set(k, arr); return false; }
  arr.push(now);
  windows.set(k, arr);
  return true;
}

export function peek(bucket: string, key: string, windowMs: number): number {
  const now = Date.now();
  return (windows.get(`${bucket}:${key}`) ?? []).filter((t) => now - t < windowMs).length;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of windows) if (!arr.some((t) => now - t < 7 * 24 * 3600e3)) windows.delete(k);
}, 10 * 60e3).unref();

export const LIMITS = {
  api: { limit: 240, window: 60e3 },                   // per IP per minute
  usernameCheck: { limit: 60, window: 60e3 },          // per IP per minute
  signupPerIp: { limit: Number(process.env.SIGNUP_PER_IP ?? 3), window: 24 * 3600e3 }, // override only for tests      // accounts per IP per day
  signupPerDevice: { limit: 2, window: 7 * 24 * 3600e3 },
  // velocity locks on short names
  shortClaimPerAccount: { limit: 1, window: 24 * 3600e3 },
  shortClaimPerIp: { limit: 2, window: 7 * 24 * 3600e3 },
  shortClaimGlobal: { limit: 20, window: 3600e3 },      // site-wide per hour
  messagesPerSender: { limit: 60, window: 60e3 },
  newConversationsPerSender: { limit: 20, window: 3600e3 },
  reportsPerAccount: { limit: 10, window: 24 * 3600e3 },
  uploadsPerAccount: { limit: 20, window: 3600e3 },
};

// ------------------------------------------------- datacenter / VPN ranges

type Cidr = { net: bigint; mask: bigint; v6: boolean };
let flagged: Cidr[] = [];

function toBig(ip: string): { n: bigint; v6: boolean } | null {
  if (net.isIPv4(ip)) return { n: ip.split('.').reduce((a, o) => (a << 8n) + BigInt(+o), 0n), v6: false };
  if (net.isIPv6(ip)) {
    if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) return toBig(ip.slice(7));
    const [h, t = ''] = ip.split('::');
    const hp = h ? h.split(':') : [];
    const tp = t ? t.split(':') : [];
    const parts = [...hp, ...Array(8 - hp.length - tp.length).fill('0'), ...tp];
    return { n: parts.reduce((a, p) => (a << 16n) + BigInt(parseInt(p || '0', 16)), 0n), v6: true };
  }
  return null;
}

export function loadNetworkFlags() {
  if (!config.networkFlagFile || !fs.existsSync(config.networkFlagFile)) return;
  flagged = [];
  for (const line of fs.readFileSync(config.networkFlagFile, 'utf8').split('\n')) {
    const s = line.split('#')[0].trim();
    if (!s) continue;
    const [ip, bitsStr] = s.split('/');
    const b = toBig(ip);
    if (!b) continue;
    const width = b.v6 ? 128 : 32;
    const bits = BigInt(bitsStr ? +bitsStr : width);
    const mask = ((1n << BigInt(width)) - 1n) ^ ((1n << (BigInt(width) - bits)) - 1n);
    flagged.push({ net: b.n & mask, mask, v6: b.v6 });
  }
}

/** Datacenter / VPN / hosting IP? Those users can use the site but not grab rare names. */
export function isFlaggedNetwork(ip: string): boolean {
  const b = toBig(ip);
  if (!b) return false;
  return flagged.some((c) => c.v6 === b.v6 && (b.n & c.mask) === c.net);
}
