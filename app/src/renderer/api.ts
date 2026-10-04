import type { AppState, CoreMethod } from '../core/types';

/** The UI talks to SigilCore through this bridge: Electron preload (desktop) or an in-page adapter (web). */
export interface Bridge {
  call(method: CoreMethod, ...args: unknown[]): Promise<any>;
  on(channel: 'state' | 'signal' | 'direct-send' | 'open-profile' | 'notify', fn: (payload: any) => void): () => void;
  openExternal(url: string): Promise<void>;
  platform: string;
}

declare global { interface Window { sigil: Bridge } }

// Resolved at call time so web entries can install the bridge before first use.
export const sigil: Bridge = {
  call: (m, ...a) => window.sigil.call(m, ...a),
  on: (ch, fn) => window.sigil.on(ch, fn),
  openExternal: (u) => window.sigil.openExternal(u),
  get platform() { return window.sigil?.platform ?? 'web'; },
};
export const call = <T = any>(method: CoreMethod, ...args: unknown[]): Promise<T> => sigil.call(method, ...args);
export type { AppState };
