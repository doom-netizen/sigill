// In-page bridge: same interface as the Electron preload, but SigilCore runs
// right here in the browser tab. Keys stay in WebCrypto (non-extractable
// where possible) and the vault is encrypted at rest in IndexedDB.

import type { SigilCore } from '../core/client';
import type { Bridge } from '../renderer/api';
import { CORE_METHODS, type CoreMethod, type Vault, type VaultData } from '../core/types';

const ALLOWED = new Set<CoreMethod>(CORE_METHODS);

export function installBridge(core: SigilCore, platform = 'web'): Bridge {
  const listeners = new Map<string, Set<(p: any) => void>>();
  const fire = (ch: string, p: unknown) => listeners.get(ch)?.forEach((f) => f(p));
  for (const ch of ['state', 'signal', 'direct-send', 'notify']) core.on(ch, (p: unknown) => fire(ch, p));
  const bridge: Bridge = {
    async call(method, ...args) {
      if (!ALLOWED.has(method)) throw new Error('unknown method');
      return (core as any)[method](...args);
    },
    on(ch, fn) {
      if (!listeners.has(ch)) listeners.set(ch, new Set());
      listeners.get(ch)!.add(fn);
      return () => listeners.get(ch)?.delete(fn);
    },
    async openExternal(url) { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
    platform,
  };
  window.sigil = bridge;
  // Deep links inside the web app: /app#u=username
  const m = /[#&]u=([a-z0-9_]{1,24})/i.exec(location.hash);
  if (m) setTimeout(() => fire('open-profile', m[1].toLowerCase()), 300);
  return bridge;
}

export class MemoryVault implements Vault {
  private d: VaultData | null = null;
  async load() { return this.d ? structuredClone(this.d) : null; }
  async save(d: VaultData) { this.d = structuredClone(d); }
  async clear() { this.d = null; }
}

/**
 * Vault in IndexedDB, AES-GCM encrypted with a non-extractable key that also
 * lives in IndexedDB. Script on another origin can't read it, and the raw key
 * can't be exported even by this page's own code.
 */
export class IndexedDbVault implements Vault {
  private dbp: Promise<IDBDatabase>;
  constructor(name = 'sigil') {
    this.dbp = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.dbp;
    return new Promise((res, rej) => {
      const req = fn(db.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  private async key(): Promise<CryptoKey> {
    let k = await this.tx<CryptoKey | undefined>('readonly', (s) => s.get('key') as IDBRequest<CryptoKey | undefined>);
    if (!k) {
      k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await this.tx('readwrite', (s) => s.put(k, 'key'));
    }
    return k;
  }
  async load(): Promise<VaultData | null> {
    try {
      const rec = await this.tx<{ iv: Uint8Array; ct: ArrayBuffer } | undefined>('readonly', (s) => s.get('vault') as any);
      if (!rec) return null;
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv as BufferSource }, await this.key(), rec.ct);
      return JSON.parse(new TextDecoder().decode(pt));
    } catch { return null; }
  }
  async save(d: VaultData) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(), new TextEncoder().encode(JSON.stringify(d)));
    await this.tx('readwrite', (s) => s.put({ iv, ct }, 'vault'));
  }
  async clear() { await this.tx('readwrite', (s) => s.delete('vault')); }
}

/** A coarse label for the Devices list: browser family and OS only. */
export function deviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('sigil-device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('sigil-device', id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
