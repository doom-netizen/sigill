// The only bridge between the sandboxed UI and the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const CHANNELS = new Set(['state', 'signal', 'direct-send', 'open-profile']);

contextBridge.exposeInMainWorld('sigil', {
  call: async (method: string, ...args: unknown[]) => {
    const r = await ipcRenderer.invoke('core', method, args);
    if (r && 'error' in r) throw Object.assign(new Error(r.error), { code: r.code });
    return r.ok;
  },
  on: (channel: string, fn: (payload: unknown) => void) => {
    if (!CHANNELS.has(channel)) return () => {};
    const h = (_e: IpcRendererEvent, payload: unknown) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  platform: process.platform,
});
