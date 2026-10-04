// Saves the demo world in this browser (IndexedDB), so your account, profile,
// cosmetics, servers and settings are still there next time you open it.
// Every call is guarded: if storage is blocked (private window, cleared site
// data), the demo still works, it just starts fresh each time.

import type { Vault, VaultData } from '../../core/types';

const DB = 'sigil-demo';
const STORE = 'kv';
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await open();
    if (!db) return null;
    return await new Promise<T | null>((resolve) => {
      try {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  } catch { return null; }
}

export const loadKey = <T = any>(key: string) => tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
export const saveKey = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key));
export const clearAll = () => tx('readwrite', (s) => s.clear());

/** The demo user's device vault (keys, contacts, settings), kept between visits. */
export class PersistentVault implements Vault {
  async load() { return (await loadKey<VaultData>('vault')) ?? null; }
  async save(d: VaultData) { await saveKey('vault', structuredClone(d)); }
  async clear() { await tx('readwrite', (s) => s.delete('vault')); }
}
