// Electron main process: owns keys, crypto and network (via SigilCore).
// The renderer is sandboxed, has no Node, and its CSP blocks all network
// access except images, so it can't leak plaintext even if compromised.

import { app, BrowserWindow, ipcMain, safeStorage, shell, Notification, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SigilCore, ApiFailure } from '../core/client';
import { CORE_METHODS, type CoreMethod, type Vault, type VaultData } from '../core/types';

const PROTOCOL = 'sigil';
const userDir = app.getPath('userData');
const vaultFile = path.join(userDir, 'vault.bin');
const prefsFile = path.join(userDir, 'prefs.json');
const deviceFile = path.join(userDir, 'device-id');

nativeTheme.themeSource = 'dark';

// ------------------------------------------------------------ local vault
// Keys + contacts + (optional) history, encrypted with the OS keychain
// (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux).
class FileVault implements Vault {
  async load(): Promise<VaultData | null> {
    if (!fs.existsSync(vaultFile)) return null;
    const buf = fs.readFileSync(vaultFile);
    try {
      const json = buf[0] === 0x7b /* "{" plaintext fallback */ ? buf.toString('utf8') : safeStorage.decryptString(buf);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  async save(d: VaultData) {
    const json = JSON.stringify(d);
    const out = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json);
    const tmp = vaultFile + '.tmp';
    fs.writeFileSync(tmp, out, { mode: 0o600 });
    fs.renameSync(tmp, vaultFile);
  }
  async clear() { fs.rmSync(vaultFile, { force: true }); }
}

function prefs(): { serverUrl?: string } {
  try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; }
}
function deviceId(): string {
  try { return fs.readFileSync(deviceFile, 'utf8').trim(); } catch {
    const id = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(deviceFile, id);
    return id;
  }
}

const ALLOWED: ReadonlySet<CoreMethod> = new Set<CoreMethod>(CORE_METHODS);

let win: BrowserWindow | null = null;
let core: SigilCore;
let pendingDeepLink: string | null = null;

function handleDeepLink(url: string) {
  const m = /^sigil:\/\/u\/@?([a-z0-9_]{1,24})/i.exec(url);
  if (!m) return;
  if (win) { win.webContents.send('open-profile', m[1].toLowerCase()); win.show(); win.focus(); }
  else pendingDeepLink = m[1].toLowerCase();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#101116',
    title: 'Sigil',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Never navigate the app window; open https links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications'));

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('state', core.getState());
    if (pendingDeepLink) { win?.webContents.send('open-profile', pendingDeepLink); pendingDeepLink = null; }
  });
  win.on('closed', () => { win = null; });
}

// single instance + deep links
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
    else if (win) { win.show(); win.focus(); }
  });
  app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); });
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);

  app.whenReady().then(async () => {
    const serverUrl = process.env.SIGIL_SERVER ?? prefs().serverUrl ?? 'http://localhost:8787';
    core = new SigilCore({ serverUrl, vault: new FileVault(), deviceId: deviceId(), deviceLabel: `Sigil desktop on ${({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[process.platform] ?? process.platform}` });

    core.on('state', (s) => win?.webContents.send('state', s));
    core.on('signal', (s) => win?.webContents.send('signal', s));
    core.on('direct-send', (s) => win?.webContents.send('direct-send', s));
    core.on('server', (url) => fs.writeFileSync(prefsFile, JSON.stringify({ ...prefs(), serverUrl: url })));
    core.on('notify', (n: { username: string; request: boolean; text?: string; space?: string; channel?: string }) => {
      const st = core!.getState().settings;
      if (!st.notifications || win?.isFocused() || !Notification.isSupported()) return;
      if (n.request && !st.notifyRequests) return;
      // Message text only appears if the person chose "who and what they said".
      const where = n.space ? ` in ${n.space}${n.channel ? ` #${n.channel}` : ''}` : '';
      const body = st.notifyContent === 'none' ? 'New message'
        : st.notifyContent === 'full' && n.text ? `@${n.username}${where}: ${n.text}`
        : n.request ? `Message request from @${n.username}` : `New message from @${n.username}${where}`;
      new Notification({ title: 'Sigil', body, silent: !st.notifySound }).show();
    });

    ipcMain.handle('core', async (e, method: CoreMethod, args: unknown[]) => {
      if (e.sender !== win?.webContents) return { error: 'forbidden' };
      if (!ALLOWED.has(method)) return { error: 'unknown method' };
      try {
        const fn = (core as any)[method] as (...a: unknown[]) => unknown;
        return { ok: await fn.apply(core, Array.isArray(args) ? args : []) };
      } catch (err: any) {
        return { error: err instanceof ApiFailure || err?.message ? err.message : 'Something went wrong.', code: err?.code };
      }
    });
    ipcMain.handle('open-external', (_e, url: string) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

    createWindow();
    await core.init();
    const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
  });

  app.on('activate', () => { if (!win) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => core?.close());
}
