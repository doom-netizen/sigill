// SigilCore: everything that touches keys, plaintext or the network.
// Platform-neutral (WebCrypto, fetch, WebSocket): runs in the Electron main
// process for the desktop app, and in the page for the web app. The UI only
// gets snapshots (AppState) and calls methods by name.

import { Emitter } from './emitter';
import { utf8, fromUtf8, b64, unb64, hex, unhex, randomBytes, randomId, type Bytes } from './bytes';
import {
  identityFromEntropy, xGenerate, xFromRaw, sign, spkMessage, initiateSession, acceptSession,
  encrypt, decrypt, safetyNumber, type Identity, type Session, type Envelope, type XPair,
} from './crypto';
import { encodePhrase, decodePhrase } from '../../../shared/proquint';
import type { SpaceView, Channel } from '../../../shared/spaces';
import { stripTracking } from '../../../shared/markdown';
import {
  DEFAULT_SETTINGS, type AppState, type ChatMessage, type ConversationView, type Settings, type Vault,
  type VaultData, type Me, type PublicProfile, type UsernameCheckResult, type PlatformInfo, type Where,
} from './types';

const MAX_TEXT = 4000;
const MAX_REQUEST_MESSAGES = 20;
const MAX_MESSAGES_PER_CHAT = 500;
const PAD_BLOCK = 256;
const LOCKDOWN_TTL = 86400;
const EMOJI_MAX = 16;

/**
 * Pad the plaintext to a multiple of 256 bytes before encryption, so the
 * relay can't tell "ok" from a paragraph by the ciphertext length.
 */
export function padded(inner: Record<string, unknown>): Uint8Array {
  const base = utf8(JSON.stringify(inner)).length;
  const extra = 8; // ,"_p":""
  const pad = Math.ceil((base + extra) / PAD_BLOCK) * PAD_BLOCK - base - extra;
  return utf8(JSON.stringify({ ...inner, _p: ' '.repeat(pad) }));
}
const cleanEmoji = (e: unknown) => (typeof e === 'string' && e.length > 0 && e.length <= EMOJI_MAX && !/[<>&"']/.test(e) ? e : null);
const snippet = (t: string) => t.replace(/\s+/g, ' ').slice(0, 140);

export class ApiFailure extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

interface Conv {
  peer: PublicProfile;
  status: 'active' | 'request';
  messages: ChatMessage[];
  unread: number;
  presence: PublicProfile['presence'];
  customStatus: string;
  direct: boolean;
  keyChanged: boolean;
}

export interface CoreOptions {
  serverUrl: string;
  vault: Vault;
  deviceId: string;
  /** coarse label for the Devices list, e.g. "Firefox on Linux" */
  deviceLabel?: string;
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
}

type Timer = ReturnType<typeof setTimeout>;

export class SigilCore extends Emitter {
  private serverUrl: string;
  private vault: Vault;
  private deviceId: string;
  private deviceLabel: string;
  private WS: typeof WebSocket;
  private fetchFn: typeof fetch;
  /** All ratchet operations (send + receive) run one at a time, in order. */
  private lane: Promise<unknown> = Promise.resolve();

  private data: VaultData | null = null;
  private id: Identity | null = null;
  private pendingEntropy: Bytes | null = null;
  private me: Me | null = null;
  private phase: AppState['phase'] = 'loading';
  private connection: AppState['connection'] = 'offline';
  private ws: WebSocket | null = null;
  private wsRetry = 0;
  private wsTimer: Timer | null = null;
  /**
   * Per-peer sessions, most recently working first. Keeping a few (like
   * Signal does) means two people who start a handshake at the same moment,
   * or whose first message was dropped, still converge instead of deadlocking.
   */
  private sessions = new Map<string, Session[]>();
  private convs = new Map<string, Conv>();
  private peerCache = new Map<string, { p: PublicProfile; at: number }>();
  private spaces = new Map<string, SpaceView>();
  private channels = new Map<string, { messages: ChatMessage[]; unread: number }>();
  private pendingAcks = new Map<string, { peerId: string; msgId: string | null; channel?: string }>();
  private iceServers: AppState['iceServers'] = [];
  private inviteOnly = true;
  private platform: PlatformInfo = { signups: 'invite', banner: null, marketPaused: false, shopPaused: false, raidMode: false, version: '' };
  private emitTimer: Timer | null = null;
  private sweeper: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(opts: CoreOptions) {
    super();
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.vault = opts.vault;
    this.deviceId = opts.deviceId;
    this.deviceLabel = opts.deviceLabel ?? 'Unknown device';
    this.WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
    this.fetchFn = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.sweeper = setInterval(() => this.sweepExpired(), 1000);
    (this.sweeper as any).unref?.();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lane.then(fn, fn);
    this.lane = run.catch(() => {});
    return run;
  }

  // ================================================================ lifecycle

  async init(): Promise<void> {
    this.data = await this.vault.load();
    this.loadConfig().catch(() => {});
    if (this.data?.entropy && this.data.token) {
      this.id = await identityFromEntropy(unhex(this.data.entropy));
      this.restoreHistory();
      try {
        await this.afterSignIn();
      } catch (e) {
        if (e instanceof ApiFailure && (e.status === 401 || e.status === 403)) {
          // token expired: sign in again with the stored key
          try { await this.signInWithKey(); } catch { this.phase = 'welcome'; }
        } else {
          // server unreachable: stay signed in, keep retrying
          this.phase = 'ready';
          this.connection = 'offline';
          this.scheduleReconnect();
        }
      }
    } else {
      this.phase = 'welcome';
    }
    this.emitState();
  }

  close() {
    this.closed = true;
    clearInterval(this.sweeper);
    if (this.wsTimer) clearTimeout(this.wsTimer);
    this.ws?.close();
  }

  private async loadConfig() {
    const c = await this.api('GET', '/api/config');
    this.iceServers = c.iceServers ?? [];
    this.inviteOnly = !!c.inviteOnly;
    this.platform = {
      signups: c.signups ?? (c.inviteOnly ? 'invite' : 'open'), banner: c.banner ?? null, marketPaused: !!c.marketPaused,
      shopPaused: !!c.shopPaused, raidMode: !!c.raidMode, version: c.version ?? '',
    };
    this.emitState();
  }

  // ===================================================================== http

  private async api(method: string, path: string, body?: unknown, raw?: Bytes): Promise<any> {
    const headers: Record<string, string> = {};
    if (this.data?.token) headers.authorization = `Bearer ${this.data.token}`;
    let payload: BodyInit | undefined;
    if (raw) { headers['content-type'] = 'application/octet-stream'; payload = raw as any; }
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res: Response;
    try {
      res = await this.fetchFn(this.serverUrl + path, { method, headers, body: payload });
    } catch {
      throw new ApiFailure(0, "Can't reach the Sigil server.", 'network');
    }
    const text = await res.text();
    let out: any = {};
    try { out = text ? JSON.parse(text) : {}; } catch { /* non-json */ }
    if (!res.ok) throw new ApiFailure(res.status, out.error ?? `Request failed (${res.status}).`, out.code);
    return out;
  }

  /** Lockdown Mode (set on your account) overrides some device settings. */
  private get locked(): boolean { return !!this.me?.lockdown?.enabled; }
  private effective(): Settings {
    const s = { ...DEFAULT_SETTINGS, ...(this.data?.settings ?? {}) };
    if (this.locked) { s.keepHistory = false; s.directConnections = false; s.defaultTtl = s.defaultTtl ?? LOCKDOWN_TTL; }
    return s;
  }

  private async save() {
    if (!this.data) return;
    if (this.effective().keepHistory) {
      const history: VaultData['history'] = {};
      for (const [peerId, c] of this.convs) {
        if (c.status !== 'active') continue;
        history[peerId] = { peer: c.peer, messages: c.messages.filter((m) => m.from !== 'system' && m.status !== 'sending').slice(-MAX_MESSAGES_PER_CHAT) };
      }
      this.data.history = history;
    } else {
      delete this.data.history;
    }
    await this.vault.save(this.data);
  }

  private restoreHistory() {
    if (!this.data?.settings.keepHistory || !this.data.history) return;
    const now = Date.now();
    for (const [peerId, h] of Object.entries(this.data.history)) {
      this.convs.set(peerId, {
        peer: h.peer, status: 'active', unread: 0, presence: null, customStatus: '', direct: false, keyChanged: !!this.data.contacts[peerId]?.keyChanged,
        messages: h.messages.filter((m) => !m.expiresAt || m.expiresAt > now),
      });
    }
  }

  // ================================================================ snapshots

  getState(): AppState {
    const conversations: ConversationView[] = [...this.convs.entries()]
      .map(([peerId, c]) => ({
        peerId, peer: c.peer, status: c.status, messages: c.messages, unread: c.unread,
        ttl: this.data?.ttl[peerId] ?? null, verified: !!this.data?.contacts[peerId]?.verified,
        presence: c.presence, customStatus: c.customStatus, direct: c.direct, keyChanged: c.keyChanged,
      }))
      .sort((a, b) => (b.messages.at(-1)?.ts ?? 0) - (a.messages.at(-1)?.ts ?? 0));
    return {
      phase: this.phase,
      serverUrl: this.serverUrl,
      connection: this.connection,
      me: this.me,
      settings: this.effective(),
      blocked: Object.entries(this.data?.blocked ?? {}).map(([id, v]) => ({ id, username: v.username })),
      conversations,
      iceServers: this.iceServers,
      inviteOnly: this.inviteOnly,
      spaces: [...this.spaces.values()],
      channels: Object.fromEntries(this.channels),
      platform: this.platform,
      contacts: Object.keys(this.data?.contacts ?? {}),
      lockdown: this.locked,
    };
  }

  private emitState() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('state', this.getState());
    }, 16);
  }

  // =========================================================== account flow

  newPhrase(): string {
    this.pendingEntropy = randomBytes(16);
    return encodePhrase(this.pendingEntropy);
  }

  async checkUsername(name: string): Promise<UsernameCheckResult> {
    return this.api('GET', `/api/username/check?name=${encodeURIComponent(name)}`);
  }

  private async authPayload(id: Identity) {
    const { nonce } = await this.api('POST', '/api/auth/challenge');
    return { ed: b64(id.ed), nonce, sig: b64(await sign(id, `sigil-auth:${nonce}`)) };
  }

  private freshVault(entropy: Bytes): VaultData {
    return {
      entropy: hex(entropy), token: null, accountId: null, spks: [], contacts: {}, blocked: {},
      settings: { ...DEFAULT_SETTINGS }, ttl: {},
    };
  }

  async register(input: { username: string; invite?: string; phraseConfirmed: boolean }): Promise<AppState> {
    if (!this.pendingEntropy) throw new ApiFailure(400, 'Generate a recovery phrase first.');
    if (!input.phraseConfirmed) throw new ApiFailure(400, 'Confirm you saved your recovery phrase.');
    const id = await identityFromEntropy(this.pendingEntropy);
    const auth = await this.authPayload(id);
    const r = await this.api('POST', '/api/auth/register', {
      ...auth, x: b64(id.x.pub), username: input.username, invite: input.invite, deviceId: this.deviceId, deviceLabel: this.deviceLabel,
    });
    this.data = { ...this.freshVault(this.pendingEntropy), token: r.token, accountId: r.accountId };
    this.id = id;
    this.pendingEntropy = null;
    await this.save();
    await this.afterSignIn();
    return this.getState();
  }

  async restore(input: { phrase: string }): Promise<AppState> {
    let entropy: Bytes;
    try { entropy = decodePhrase(input.phrase); } catch (e: any) { throw new ApiFailure(400, e.message); }
    this.id = await identityFromEntropy(entropy);
    this.data = this.freshVault(entropy);
    try {
      await this.signInWithKey();
    } catch (e) {
      this.id = null; this.data = null;
      throw e;
    }
    return this.getState();
  }

  private async signInWithKey() {
    const r = await this.api('POST', '/api/auth/login', { ...(await this.authPayload(this.id!)), deviceLabel: this.deviceLabel });
    this.data!.token = r.token;
    this.data!.accountId = r.accountId;
    await this.save();
    await this.afterSignIn();
  }

  private async afterSignIn() {
    this.me = await this.api('GET', '/api/me');
    this.data!.accountId = this.me!.id;
    await this.ensurePrekey();
    await this.loadSpaces().catch(() => {});
    this.phase = 'ready';
    this.connect();
    this.emitState();
  }

  /** Rotate the signed prekey on every sign-in; keep the previous 2 for in-flight handshakes. */
  private async ensurePrekey() {
    const d = this.data!;
    const spk = await xGenerate(true);
    const id = (d.spks.at(-1)?.id ?? 0) + 1;
    d.spks = [...d.spks.slice(-2), { id, priv: b64(spk.raw!), pub: b64(spk.pub) }];
    await this.api('POST', '/api/me/keys', { spk: b64(spk.pub), spkId: id, spkSig: b64(await sign(this.id!, spkMessage(id, spk.pub))) });
    await this.save();
  }

  private async spkById(id: number): Promise<XPair | null> {
    const s = this.data?.spks.find((k) => k.id === id);
    return s ? xFromRaw(unb64(s.priv)) : null;
  }

  revealPhrase(): string {
    if (!this.data) throw new ApiFailure(400, 'Not signed in.');
    return encodePhrase(unhex(this.data.entropy));
  }

  /** Does this phrase belong to the signed-in account? (Checked on this device only.) */
  verifyPhrase(phrase: string): boolean {
    if (!this.data) return false;
    try { return hex(decodePhrase(phrase)) === this.data.entropy; } catch { return false; }
  }

  // ------------------------------------------------------------ security

  async setLockdown(input: { enabled?: boolean; allowRequests?: boolean; phrase?: string }): Promise<Me> {
    if (!this.data || !this.id || !this.me) throw new ApiFailure(400, 'Not signed in.');
    const cur = this.me.lockdown;
    const enabled = input.enabled ?? cur.enabled;
    const allowRequests = input.allowRequests ?? cur.allowRequests;
    const weakens = (cur.enabled && !enabled) || (cur.enabled && enabled && allowRequests && !cur.allowRequests);
    const body: Record<string, unknown> = { enabled, allowRequests };
    if (weakens) {
      if (!input.phrase || !this.verifyPhrase(input.phrase)) throw new ApiFailure(403, "That recovery phrase doesn't match this account.");
      const { nonce } = await this.api('POST', '/api/auth/challenge');
      body.nonce = nonce;
      body.sig = b64(await sign(this.id, `sigil-lockdown:${nonce}`));
    }
    this.me = await this.api('POST', '/api/me/lockdown', body);
    if (enabled) {
      // other devices were signed out: make sure our prekey is the published one
      if (!cur.enabled) await this.ensurePrekey().catch(() => {});
      // drop anything this device was keeping, and close direct connections
      if (this.data.history) { delete this.data.history; }
      for (const c of this.convs.values()) c.direct = false;
      this.emit('lockdown', true);
    }
    await this.save();
    this.emitState();
    return this.me!;
  }

  private async pinHash(pin: string, salt: Uint8Array): Promise<string> {
    const key = await crypto.subtle.importKey('raw', utf8(pin) as BufferSource, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 150_000 }, key, 256);
    return b64(new Uint8Array(bits));
  }

  /** Screen lock for this device. `pin: null` turns it off. */
  async setAppLock(input: { pin: string | null; timeoutMin?: number }): Promise<AppState> {
    if (!this.data) throw new ApiFailure(400, 'Not signed in.');
    if (input.pin === null) {
      this.data.settings = { ...this.data.settings, appLock: null };
    } else {
      if (!/^\d{4,12}$/.test(input.pin)) throw new ApiFailure(400, 'Use 4 to 12 digits.');
      const salt = randomBytes(16);
      this.data.settings = { ...this.data.settings, appLock: { hash: await this.pinHash(input.pin, salt), salt: b64(salt), timeoutMin: input.timeoutMin ?? 5 } };
    }
    await this.save();
    this.emitState();
    return this.getState();
  }

  async checkPin(pin: string): Promise<boolean> {
    const l = this.data?.settings.appLock;
    if (!l) return true;
    return (await this.pinHash(String(pin), unb64(l.salt))) === l.hash;
  }

  /** Panic: sign this device out and erase its keys and chats, immediately. */
  async panic(): Promise<AppState> {
    const token = this.data?.token;
    this.resetLocal();
    await this.vault.clear();
    if (token) this.fetchFn(this.serverUrl + '/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    return this.getState();
  }

  listSessions() { return this.api('GET', '/api/me/sessions'); }
  revokeSession(id: string) { return this.api('DELETE', `/api/me/sessions/${encodeURIComponent(id)}`); }
  async revokeOtherSessions() {
    const r = await this.api('POST', '/api/me/sessions/revoke-others');
    await this.ensurePrekey().catch(() => {}); // the newest sign-in owns the prekey; take it back
    return r;
  }
  exportData() { return this.api('GET', '/api/me/export'); }
  updates() { return this.api('GET', '/api/updates'); }

  async logout(): Promise<AppState> {
    try { await this.api('POST', '/api/auth/logout'); } catch { /* offline is fine */ }
    this.resetLocal();
    await this.vault.clear();
    return this.getState();
  }

  async deleteAccount(): Promise<AppState> {
    await this.api('DELETE', '/api/me');
    this.resetLocal();
    await this.vault.clear();
    return this.getState();
  }

  private resetLocal() {
    this.ws?.close();
    this.ws = null;
    this.data = null; this.id = null; this.me = null;
    this.sessions.clear(); this.convs.clear(); this.peerCache.clear(); this.spaces.clear(); this.channels.clear();
    this.phase = 'welcome';
    this.connection = 'offline';
    this.emitState();
  }

  async setServer(url: string): Promise<AppState> {
    if (this.phase === 'ready') throw new ApiFailure(400, 'Sign out before switching servers.');
    if (!/^https?:\/\/[^\s]+$/.test(url)) throw new ApiFailure(400, 'Enter a server URL like https://sigil.example');
    this.serverUrl = url.replace(/\/+$/, '');
    await this.loadConfig().catch(() => {});
    this.emit('server', this.serverUrl);
    return this.getState();
  }

  // ================================================================ profile

  async refreshMe(): Promise<Me> {
    this.me = await this.api('GET', '/api/me');
    this.emitState();
    return this.me!;
  }

  async updateProfile(patch: Record<string, unknown>): Promise<Me> {
    this.me = await this.api('PATCH', '/api/me', patch);
    this.emitState();
    return this.me!;
  }

  async uploadMedia(slot: string, bytes: ArrayBuffer | Uint8Array): Promise<Me> {
    this.me = await this.api('PUT', `/api/me/media/${slot}`, undefined, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    this.emitState();
    return this.me!;
  }

  async removeMedia(slot: string): Promise<Me> {
    this.me = await this.api('DELETE', `/api/me/media/${slot}`);
    this.emitState();
    return this.me!;
  }

  async claimUsername(name: string) {
    const r = await this.api('POST', '/api/username/claim', { name });
    this.me = r.me;
    this.emitState();
    return r;
  }

  async cancelClaim() {
    const r = await this.api('POST', '/api/username/cancel');
    this.me = r.me;
    this.emitState();
    return r.me;
  }

  async lookup(username: string): Promise<PublicProfile> {
    const p = await this.api('GET', `/api/u/${encodeURIComponent(username.replace(/^@/, ''))}`);
    this.peerCache.set(p.id, { p, at: Date.now() });
    return p;
  }

  rareFeed() { return this.api('GET', '/api/rare'); }
  report(targetId: string, reason: string, details = '') { return this.api('POST', '/api/report', { targetId, reason, details }); }

  // ================================================================== staff

  staffOverview() { return this.api('GET', '/api/staff/overview'); }
  staffDecide(id: string, approve: boolean) { return this.api('POST', `/api/staff/claims/${id}`, { approve }); }
  staffLookup(username: string) { return this.api('GET', `/api/staff/lookup?username=${encodeURIComponent(username)}`); }
  staffUpdate(id: string, patch: unknown) { return this.api('POST', `/api/staff/accounts/${id}`, patch); }
  staffInvites(count: number) { return this.api('POST', '/api/staff/invites', { count }); }
  staffReport(id: string, status: string) { return this.api('POST', `/api/staff/reports/${id}`, { status }); }
  staffAccounts(q = '', filter = '') { return this.api('GET', `/api/staff/accounts?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`); }
  staffAccount(id: string) { return this.api('GET', `/api/staff/accounts/${encodeURIComponent(id)}`); }
  async staffAction(id: string, body: Record<string, unknown>) {
    const r = await this.api('POST', `/api/staff/accounts/${encodeURIComponent(id)}/action`, body);
    if (id === this.me?.id) await this.refreshMe().catch(() => {});
    return r;
  }
  staffAudit() { return this.api('GET', '/api/staff/audit'); }
  staffPlatform() { return this.api('GET', '/api/staff/platform'); }
  async staffSetPlatform(patch: Record<string, unknown>) {
    const r = await this.api('POST', '/api/staff/platform', patch);
    await this.loadConfig().catch(() => {});
    return r;
  }
  staffPostUpdate(body: Record<string, unknown>) { return this.api('POST', '/api/staff/updates', body); }
  staffDeleteUpdate(id: string) { return this.api('DELETE', `/api/staff/updates/${encodeURIComponent(id)}`); }
  async staffBroadcast(message: string) { const r = await this.api('POST', '/api/staff/broadcast', { message }); await this.refreshMe().catch(() => {}); return r; }
  staffStats() { return this.api('GET', '/api/staff/stats'); }

  // ============================================================= economy
  shop() { return this.api('GET', '/api/shop'); }
  async shopBuy(item: string) {
    const r = await this.api('POST', '/api/shop/buy', { item });
    this.me = r.me; this.emitState();
    return r;
  }
  ledger() { return this.api('GET', '/api/me/ledger'); }
  market(q: { kind?: string; sort?: string; q?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return this.api('GET', `/api/market?${p}`);
  }
  marketGet(id: string) { return this.api('GET', `/api/market/${encodeURIComponent(id)}`); }
  private async afterMarket<T>(p: Promise<T>): Promise<T> { const r = await p; await this.refreshMe().catch(() => {}); return r; }
  marketCreate(input: Record<string, unknown>) { return this.afterMarket(this.api('POST', '/api/market', input)); }
  marketBid(id: string, amount: number) { return this.afterMarket(this.api('POST', `/api/market/${encodeURIComponent(id)}/bid`, { amount })); }
  marketBuy(id: string) { return this.afterMarket(this.api('POST', `/api/market/${encodeURIComponent(id)}/buy`)); }
  marketCancel(id: string) { return this.afterMarket(this.api('POST', `/api/market/${encodeURIComponent(id)}/cancel`)); }

  async ackNotice(id: string): Promise<Me> {
    this.me = await this.api('POST', `/api/me/notices/${encodeURIComponent(id)}/ack`);
    this.emitState();
    return this.me!;
  }

  // ================================================================ settings

  async setSettings(patch: Partial<Settings>): Promise<AppState> {
    if (!this.data) throw new ApiFailure(400, 'Not signed in.');
    this.data.settings = { ...this.data.settings, ...patch };
    await this.save();
    this.emitState();
    return this.getState();
  }

  async block(peerId: string): Promise<AppState> {
    const username = this.convs.get(peerId)?.peer.username ?? this.peerCache.get(peerId)?.p.username ?? peerId;
    this.data!.blocked[peerId] = { username };
    delete this.data!.contacts[peerId];
    this.convs.delete(peerId);
    this.sessions.delete(peerId);
    await this.save();
    this.watchPresence();
    this.emitState();
    return this.getState();
  }

  async unblock(peerId: string): Promise<AppState> {
    delete this.data!.blocked[peerId];
    await this.save();
    this.emitState();
    return this.getState();
  }

  // ================================================================ realtime

  private connect() {
    if (this.closed || !this.data?.token) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.connection = 'connecting';
    this.emitState();
    const url = this.serverUrl.replace(/^http/, 'ws') + '/ws';
    let ws: WebSocket;
    try { ws = new this.WS(url); } catch { return this.scheduleReconnect(); }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: this.data?.token }));
    ws.onmessage = (ev: MessageEvent) => this.onWs(String(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connection = 'offline';
      for (const c of this.convs.values()) c.direct = false;
      this.emitState();
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* close follows */ };
  }

  private scheduleReconnect() {
    if (this.closed || !this.data?.token || this.wsTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.wsRetry++) + Math.random() * 500;
    this.wsTimer = setTimeout(() => { this.wsTimer = null; this.connect(); }, delay);
    (this.wsTimer as any).unref?.();
  }

  private wsSend(obj: unknown): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  private watchPresence() {
    const ids = new Set<string>(this.convs.keys());
    for (const sp of this.spaces.values()) for (const m of sp.members) if (m.id !== this.me?.id) ids.add(m.id);
    this.wsSend({ t: 'watch', ids: [...ids].slice(0, 500) });
  }

  private onWs(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'ready':
        this.wsRetry = 0;
        this.connection = 'online';
        this.watchPresence();
        this.emitState();
        break;
      case 'presence': {
        const c = this.convs.get(m.id);
        if (c) { c.presence = m.presence; c.customStatus = m.customStatus ?? ''; }
        for (const sp of this.spaces.values()) for (const mem of sp.members) if (mem.id === m.id) mem.presence = m.presence;
        this.emitState();
        break;
      }
      case 'space':
        this.spaceRefresh(m.id).catch(() => {});
        break;
      case 'space_removed':
        if (this.spaces.delete(m.id)) { this.watchPresence(); this.emitState(); }
        break;
      case 'ack': {
        const p = this.pendingAcks.get(m.id);
        if (!p) break;
        this.pendingAcks.delete(m.id);
        if (!p.msgId) break;
        const msg = this.convs.get(p.peerId)?.messages.find((x) => x.id === p.msgId);
        const chMsg = !msg && p.channel ? this.channels.get(p.channel)?.messages.find((x) => x.id === p.msgId) : undefined;
        if (chMsg) {
          chMsg.status = m.ok ? 'sent' : 'failed';
          if (!m.ok) chMsg.note = m.reason === 'muted' || m.reason === 'raid' ? ackReason(m.reason, '') : m.reason === 'forbidden' ? "You can't post in this channel." : 'Not delivered.';
          else if (m.offline > 0) chMsg.note = `${m.offline} member${m.offline === 1 ? ' was' : 's were'} offline and won't see this. Sigil doesn't store messages.`;
          this.emitState();
        }
        if (msg) {
          msg.status = m.ok ? 'sent' : 'failed';
          if (!m.ok) msg.note = ackReason(m.reason, this.convs.get(p.peerId)?.peer.username ?? '');
          this.emitState();
          this.save().catch(() => {});
        }
        break;
      }
      case 'msg':
        // serialize decryption so ratchet state updates in order
        this.serial(() => this.receive(m.from, m.env, 'relay', m.ctx)).catch(() => {});
        break;
      case 'signal':
        if (this.data?.blocked[m.from]) break;
        if (m.data?.k === 'reset') {
          // peer couldn't decrypt (e.g. they restarted): drop our session so the next message re-handshakes
          this.serial(async () => { this.sessions.delete(m.from); });
          break;
        }
        if (!this.effective().directConnections) break;
        this.emit('signal', { from: m.from, data: m.data });
        break;
    }
  }

  // =================================================================== chat

  private async peerById(id: string, fresh = false): Promise<PublicProfile> {
    const cached = this.peerCache.get(id);
    if (cached && !fresh && Date.now() - cached.at < 10 * 60e3) return cached.p;
    const p = await this.api('GET', `/api/id/${encodeURIComponent(id)}`);
    this.peerCache.set(id, { p, at: Date.now() });
    return p;
  }

  async openConversation(username: string): Promise<AppState> {
    const p = await this.lookup(username);
    if (p.id === this.me?.id) throw new ApiFailure(400, "That's you.");
    if (this.data!.blocked[p.id]) throw new ApiFailure(400, `You blocked @${p.username}. Unblock them in Settings first.`);
    if (!this.convs.has(p.id)) {
      this.convs.set(p.id, { peer: p, status: 'active', messages: [], unread: 0, presence: p.presence, customStatus: p.customStatus, direct: false, keyChanged: !!this.data!.contacts[p.id]?.keyChanged });
      this.applyDefaultTtl(p.id);
    } else {
      this.convs.get(p.id)!.peer = p;
    }
    this.watchPresence();
    this.emitState();
    return this.getState();
  }

  private ensureContact(peerId: string, username: string) {
    if (!this.data!.contacts[peerId]) {
      const ed = this.peerCache.get(peerId)?.p.keys?.ed ?? this.convs.get(peerId)?.peer.keys?.ed;
      this.data!.contacts[peerId] = { username, addedAt: Date.now(), ed };
    }
  }

  /** New chats start with your default disappearing timer (1 day in Lockdown Mode). */
  private applyDefaultTtl(peerId: string) {
    const d = this.effective().defaultTtl;
    if (d && this.data && this.data.ttl[peerId] === undefined) this.data.ttl[peerId] = d;
  }

  /**
   * Trust on first use: remember a contact's identity key, and flag it loudly
   * if it changes (new device, reinstall... or someone in the middle).
   */
  private checkKey(peerId: string, p: PublicProfile) {
    const c = this.data?.contacts[peerId];
    const ed = p.keys?.ed;
    if (!c || !ed) return;
    if (!c.ed) { c.ed = ed; return; }
    if (c.ed === ed) return;
    c.ed = ed;
    c.verified = false;
    c.keyChanged = true;
    const conv = this.convs.get(peerId);
    if (conv) {
      conv.keyChanged = true;
      conv.messages.push(systemMsg(`@${p.username}'s safety number changed. They may have reinstalled Sigil or used their phrase on a new device. Compare safety numbers before sharing anything sensitive.`));
    }
    this.save().catch(() => {});
    this.emitState();
  }

  async ackKeyChange(peerId: string): Promise<AppState> {
    if (this.locked) throw new ApiFailure(403, 'In Lockdown Mode, verify the new safety number instead.');
    const c = this.data?.contacts[peerId];
    if (c) c.keyChanged = false;
    const conv = this.convs.get(peerId);
    if (conv) conv.keyChanged = false;
    await this.save();
    this.emitState();
    return this.getState();
  }

  private async sessionFor(peerId: string): Promise<Session> {
    const s = this.sessions.get(peerId)?.[0];
    if (s) return s;
    const p = await this.peerById(peerId, true);
    if (!p.keys) throw new ApiFailure(400, `@${p.username} hasn't set up encryption yet.`);
    this.checkKey(peerId, p);
    const sess = await initiateSession(this.id!, {
      ed: unb64(p.keys.ed), x: unb64(p.keys.x), spk: unb64(p.keys.spk), spkId: p.keys.spkId, spkSig: unb64(p.keys.spkSig),
    });
    this.promote(peerId, sess);
    return sess;
  }

  /** Put a session at the front of the peer's list (max 4 kept). */
  private promote(peerId: string, sess: Session, replacing?: Session) {
    const list = (this.sessions.get(peerId) ?? []).filter((x) => x !== sess && x !== replacing);
    this.sessions.set(peerId, [sess, ...list].slice(0, 4));
  }

  /** Encrypt an inner payload and hand it to the transport (direct channel if open, else relay). */
  private sendPayload(peerId: string, inner: Record<string, unknown>, msgId: string | null) {
    return this.serial(() => this.sendPayloadNow(peerId, inner, msgId));
  }

  private async sendPayloadNow(peerId: string, inner: Record<string, unknown>, msgId: string | null) {
    const sess = await this.sessionFor(peerId);
    const env = await encrypt(sess, padded(inner));
    const envStr = b64(utf8(JSON.stringify(env)));
    const conv = this.convs.get(peerId);
    if (conv?.direct && this.effective().directConnections) {
      this.emit('direct-send', { to: peerId, env: envStr });
      if (msgId) {
        const m = conv.messages.find((x) => x.id === msgId);
        if (m) { m.status = 'sent'; m.via = 'direct'; }
      }
      return;
    }
    const wireId = randomId(9);
    this.pendingAcks.set(wireId, { peerId, msgId });
    if (!this.wsSend({ t: 'send', to: peerId, id: wireId, env: envStr })) {
      this.pendingAcks.delete(wireId);
      throw new ApiFailure(0, "You're offline.");
    }
  }

  private outgoing(text: string): string {
    let body = text.replace(/\s+$/, '').slice(0, MAX_TEXT);
    if (this.effective().stripTracking) body = stripTracking(body);
    return body;
  }

  private replyRef(list: ChatMessage[], replyTo?: string | null): ChatMessage['replyTo'] {
    if (!replyTo) return null;
    const m = list.find((x) => x.id === replyTo && x.from !== 'system' && !x.deleted);
    if (!m) return null;
    const author = m.author ?? (m.from === 'me' ? this.me!.id : '');
    return { id: m.id, author, text: snippet(m.text) };
  }

  async sendText(peerId: string, text: string, replyTo?: string | null): Promise<AppState> {
    const conv = this.convs.get(peerId);
    if (!conv) throw new ApiFailure(404, 'No such conversation.');
    const body = this.outgoing(text);
    if (!body.trim()) return this.getState();
    if (this.locked && conv.keyChanged && !this.data!.contacts[peerId]?.verified) {
      throw new ApiFailure(403, `@${conv.peer.username}'s safety number changed. Lockdown Mode won't send until you verify it.`);
    }
    if (conv.status === 'request') await this.acceptRequest(peerId);
    this.ensureContact(peerId, conv.peer.username);
    this.applyDefaultTtl(peerId);
    const ttl = this.data!.ttl[peerId] ?? null;
    const reply = this.replyRef(conv.messages, replyTo);
    if (reply && !reply.author) reply.author = peerId;
    const msg: ChatMessage = {
      id: randomId(9), from: 'me', author: this.me!.id, text: body, ts: Date.now(),
      expiresAt: ttl ? Date.now() + ttl * 1000 : null, status: 'sending', via: 'relay', replyTo: reply,
    };
    conv.messages.push(msg);
    trim(conv);
    this.emitState();
    try {
      await this.sendPayload(peerId, { k: 'text', id: msg.id, text: body, ts: msg.ts, ttl, reply }, msg.id);
    } catch (e: any) {
      msg.status = 'failed';
      msg.note = e.message;
    }
    await this.save();
    this.emitState();
    return this.getState();
  }

  async acceptRequest(peerId: string): Promise<AppState> {
    const conv = this.convs.get(peerId);
    if (!conv) return this.getState();
    conv.status = 'active';
    this.ensureContact(peerId, conv.peer.username);
    await this.save();
    try { await this.sendPayload(peerId, { k: 'accept' }, null); } catch { /* best effort */ }
    this.emitState();
    return this.getState();
  }

  async declineRequest(peerId: string): Promise<AppState> {
    this.convs.delete(peerId);
    this.sessions.delete(peerId);
    this.watchPresence();
    this.emitState();
    return this.getState();
  }

  async setDisappearing(peerId: string, ttl: number | null): Promise<AppState> {
    const allowed = [null, 30, 300, 3600, 86400, 604800];
    if (!allowed.includes(ttl)) throw new ApiFailure(400, 'Unsupported timer.');
    this.data!.ttl[peerId] = ttl;
    const conv = this.convs.get(peerId);
    if (conv) conv.messages.push(systemMsg(ttl ? `You set disappearing messages to ${fmtTtl(ttl)}.` : 'You turned off disappearing messages.'));
    await this.save();
    this.emitState();
    try { await this.sendPayload(peerId, { k: 'ttl', ttl }, null); } catch { /* applies locally either way */ }
    return this.getState();
  }

  async clearConversation(peerId: string): Promise<AppState> {
    const conv = this.convs.get(peerId);
    if (conv) conv.messages = [];
    await this.save();
    this.emitState();
    return this.getState();
  }

  markRead(peerId: string) {
    const conv = this.convs.get(peerId);
    if (conv && conv.unread) { conv.unread = 0; this.emitState(); }
  }

  async safetyNumber(peerId: string): Promise<{ number: string; peer: string; verified: boolean }> {
    const p = await this.peerById(peerId, true);
    if (!p.keys || !this.me) throw new ApiFailure(400, 'No keys for this account.');
    const number = await safetyNumber(
      { id: this.me.id, ed: this.id!.ed, x: this.id!.x.pub },
      { id: p.id, ed: unb64(p.keys.ed), x: unb64(p.keys.x) },
    );
    return { number, peer: p.username, verified: !!this.data?.contacts[peerId]?.verified };
  }

  async setVerified(peerId: string, verified: boolean): Promise<AppState> {
    const conv = this.convs.get(peerId);
    this.ensureContact(peerId, conv?.peer.username ?? peerId);
    this.data!.contacts[peerId].verified = verified;
    if (verified) {
      this.data!.contacts[peerId].keyChanged = false;
      if (conv) conv.keyChanged = false;
      const fresh = await this.peerById(peerId, true).catch(() => null);
      if (fresh?.keys) this.data!.contacts[peerId].ed = fresh.keys.ed;
    }
    await this.save();
    this.emitState();
    return this.getState();
  }

  // ---------------------------------------------------------------- receive

  private async receive(from: string, envB64: string, via: 'relay' | 'direct', ctx?: { space: string; channel: string }) {
    if (!this.data || !this.id || !this.me) return;
    if (this.data.blocked[from]) return;
    let env: Envelope;
    try { env = JSON.parse(fromUtf8(unb64(envB64))); } catch { return; }
    if (!env || env.v !== 1 || !env.h || typeof env.ct !== 'string') return;

    // Channel messages: only from people who are members of a space we're in.
    let space: SpaceView | undefined;
    if (ctx) {
      space = this.spaces.get(ctx.space);
      if (!space || !space.members.some((x) => x.id === from)) {
        await this.spaceRefresh(ctx.space).catch(() => {});
        space = this.spaces.get(ctx.space);
        if (!space || !space.members.some((x) => x.id === from)) return;
      }
      if (!space.channels.some((c) => c.id === ctx.channel)) return;
    }

    const isContact = !!this.data.contacts[from];
    const policy = this.me.privacy.whoCanMessage;
    // Device-side policy for DMs: "friends" means only people you've already accepted/messaged.
    // Lockdown Mode can still let text-only requests through if you chose that (e.g. for sources).
    const requestsOpen = policy === 'everyone' || (this.locked && this.me.lockdown.allowRequests && policy !== 'nobody');
    if (!ctx && !isContact && !requestsOpen) return;

    let peer: PublicProfile;
    try { peer = await this.peerById(from); } catch { return; }
    if (!peer.keys) return;

    const known = this.sessions.get(from) ?? [];
    let candidates: Session[];
    if (env.init) {
      const existing = known.find((x) => x.fromEk === env.init!.ek);
      if (existing) candidates = [existing];
      else {
        // A new handshake from them. Accept it alongside any session we started.
        const spk = await this.spkById(env.init.spkId);
        if (!spk) return this.failedDecrypt(from, peer);
        try {
          // keys from the server profile, re-fetched to avoid a stale cache
          const fresh = await this.peerById(from, true);
          if (!ctx) this.checkKey(from, fresh);
          candidates = [await acceptSession(this.id, spk, { ed: unb64(fresh.keys!.ed), x: unb64(fresh.keys!.x) }, env.init)];
        } catch { return this.failedDecrypt(from, peer); }
      }
    } else {
      candidates = known;
    }

    let inner: any;
    let opened = false;
    for (const cand of candidates) {
      try {
        const r = await decrypt(cand, env);
        this.promote(from, r.session, cand);
        inner = JSON.parse(fromUtf8(r.plaintext));
        opened = true;
        break;
      } catch { /* try the next session */ }
    }
    if (!opened) {
      // With sessions in hand this is a duplicate or stale message: drop it quietly.
      // With none, we lost our state (e.g. restarted): ask them to start over.
      if (!candidates.length || env.init) return this.failedDecrypt(from, peer);
      return;
    }

    if (ctx || inner?.k === 'ch') {
      // channel message: must match the relay's routing, both inside and outside the encryption
      if (!ctx || inner?.k !== 'ch' || inner.s !== ctx.space || inner.c !== ctx.channel || typeof inner.text !== 'string') return;
      const ch = this.channels.get(ctx.channel) ?? { messages: [], unread: 0 };
      this.channels.set(ctx.channel, ch);
      if (inner.x && typeof inner.x === 'object') {
        if (this.applyOp(ch.messages, from, inner.x)) this.emitState();
        return;
      }
      if (ch.messages.some((x) => x.id === inner.id)) return;
      ch.messages.push({
        id: String(inner.id ?? randomId(9)).slice(0, 40), from: 'peer', author: from, text: inner.text.slice(0, MAX_TEXT), ts: Date.now(),
        expiresAt: null, status: 'received', via, replyTo: cleanReply(inner.reply),
      });
      if (ch.messages.length > MAX_MESSAGES_PER_CHAT) ch.messages.splice(0, ch.messages.length - MAX_MESSAGES_PER_CHAT);
      ch.unread++;
      const chName = space!.channels.find((c) => c.id === ctx.channel)?.name ?? '';
      this.emit('notify', { peerId: from, username: peer.username, request: false, space: space!.name, channel: chName, text: inner.text.slice(0, 200), mention: !!this.me && new RegExp(`(^|\\W)@${this.me.username}\\b`).test(inner.text) });
      this.emitState();
      return;
    }

    let conv = this.convs.get(from);
    if (!conv && inner?.k !== 'text') return; // only a message can start a conversation
    if (!conv) {
      conv = { peer, status: isContact ? 'active' : 'request', messages: [], unread: 0, presence: peer.presence, customStatus: peer.customStatus, direct: false, keyChanged: !!this.data.contacts[from]?.keyChanged };
      this.convs.set(from, conv);
      this.watchPresence();
    }
    conv.peer = peer;

    switch (inner?.k) {
      case 'text': {
        if (typeof inner.text !== 'string') return;
        const ttl = typeof inner.ttl === 'number' ? inner.ttl : null;
        if (conv.status === 'request' && conv.messages.length >= MAX_REQUEST_MESSAGES) return;
        const id = String(inner.id ?? randomId(9)).slice(0, 40);
        if (conv.messages.some((x) => x.id === id)) return;
        conv.messages.push({
          id, from: 'peer', author: from, text: inner.text.slice(0, MAX_TEXT),
          ts: Date.now(), expiresAt: ttl ? Date.now() + ttl * 1000 : null, status: 'received', via, replyTo: cleanReply(inner.reply),
        });
        if (ttl !== (this.data.ttl[from] ?? null) && conv.status === 'active') this.data.ttl[from] = ttl;
        conv.unread++;
        trim(conv);
        this.emit('notify', { peerId: from, username: peer.username, request: conv.status === 'request', text: inner.text.slice(0, 200) });
        break;
      }
      case 'op':
        // reactions, edits and unsends. Requests can't use them.
        if (conv.status !== 'active' || !inner.x || !this.applyOp(conv.messages, from, inner.x)) return;
        break;
      case 'accept':
        if (conv.status === 'active') conv.messages.push(systemMsg(`@${peer.username} accepted your message request.`));
        break;
      case 'ttl': {
        const ttl = typeof inner.ttl === 'number' ? inner.ttl : null;
        if (conv.status !== 'active') break;
        this.data.ttl[from] = ttl;
        conv.messages.push(systemMsg(ttl ? `@${peer.username} set disappearing messages to ${fmtTtl(ttl)}.` : `@${peer.username} turned off disappearing messages.`));
        break;
      }
      default:
        return;
    }
    await this.save();
    this.emitState();
  }

  private lastReset = new Map<string, number>();

  private failedDecrypt(from: string, peer: PublicProfile) {
    // Most likely: one side restarted and lost the session. Start fresh on both ends.
    this.sessions.delete(from);
    if (Date.now() - (this.lastReset.get(from) ?? 0) > 30e3) {
      this.lastReset.set(from, Date.now());
      this.wsSend({ t: 'signal', to: from, data: { k: 'reset' } });
    }
    const conv = this.convs.get(from);
    if (conv && conv.status === 'active') {
      const last = conv.messages.at(-1);
      if (!(last?.from === 'system' && last.text.startsWith('A message from'))) {
        conv.messages.push(systemMsg(`A message from @${peer.username} couldn't be decrypted. Your next message starts a fresh secure session.`));
        this.emitState();
      }
    }
  }

  private sweepExpired() {
    const now = Date.now();
    let changed = false;
    for (const c of this.convs.values()) {
      const before = c.messages.length;
      c.messages = c.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
      if (c.messages.length !== before) changed = true;
    }
    if (changed) { this.emitState(); this.save().catch(() => {}); }
  }

  // ================================================================= spaces

  private async loadSpaces() {
    const list: SpaceView[] = await this.api('GET', '/api/spaces');
    this.spaces = new Map(list.map((s) => [s.id, s]));
    this.watchPresence();
    this.emitState();
  }

  async spaceRefresh(id: string): Promise<SpaceView | null> {
    try {
      const v: SpaceView = await this.api('GET', `/api/spaces/${encodeURIComponent(id)}`);
      this.spaces.set(id, v);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) this.spaces.delete(id); else throw e;
    }
    this.watchPresence();
    this.emitState();
    return this.spaces.get(id) ?? null;
  }

  async spaceCreate(body: { kind: 'server' | 'group'; name?: string; emoji?: string; color?: string; members?: string[] }): Promise<SpaceView> {
    const v: SpaceView = await this.api('POST', '/api/spaces', body);
    this.spaces.set(v.id, v);
    this.watchPresence();
    this.emitState();
    return v;
  }

  async spaceJoin(code: string): Promise<SpaceView> {
    const v: SpaceView = await this.api('POST', '/api/spaces/join', { code });
    this.spaces.set(v.id, v);
    this.watchPresence();
    this.emitState();
    return v;
  }

  async spaceOp(id: string, op: Record<string, unknown>): Promise<any> {
    const r = await this.api('POST', `/api/spaces/${encodeURIComponent(id)}/op`, op);
    if (r.deleted || r.left) this.spaces.delete(id);
    else this.spaces.set(id, r);
    this.watchPresence();
    this.emitState();
    return r;
  }

  markChannelRead(channelId: string) {
    const c = this.channels.get(channelId);
    if (c?.unread) { c.unread = 0; this.emitState(); }
  }

  /** Who may read this channel, judged from the space view (mirrors shared/spaces canSeeChannel). */
  private channelReaders(sp: SpaceView, ch: Channel): string[] {
    const adminRoles = new Set(sp.roles.filter((r) => r.perms.includes('admin')).map((r) => r.id));
    return sp.members.filter((m) => m.id !== this.me?.id).filter((m) => {
      if (!ch.private || m.id === sp.ownerId) return true;
      return m.roles.some((r) => adminRoles.has(r) || ch.allowedRoles.includes(r));
    }).map((m) => m.id);
  }

  /** Encrypt one payload separately for every member who can read the channel, then hand it to the relay. */
  private async broadcastChannel(sp: SpaceView, ch: Channel, inner: Record<string, unknown>, wireId: string, msg: ChatMessage | null) {
    await this.serial(async () => {
      const envs: Record<string, string> = {};
      for (const peer of this.channelReaders(sp, ch)) {
        if (this.data?.blocked[peer]) continue;
        try {
          const sess = await this.sessionFor(peer);
          const env = await encrypt(sess, padded({ k: 'ch', s: sp.id, c: ch.id, ...inner }));
          envs[peer] = b64(utf8(JSON.stringify(env)));
        } catch { /* member without keys yet: skip */ }
      }
      if (!Object.keys(envs).length) { if (msg) { msg.status = 'sent'; msg.note = 'Nobody else can read this channel yet.'; } return; }
      if (msg) this.pendingAcks.set(wireId, { peerId: '', msgId: msg.id, channel: ch.id });
      if (!this.wsSend({ t: 'gsend', id: wireId, space: sp.id, channel: ch.id, envs })) {
        this.pendingAcks.delete(wireId);
        throw new ApiFailure(0, "You're offline.");
      }
    });
  }

  async sendChannel(spaceId: string, channelId: string, text: string, replyTo?: string | null): Promise<AppState> {
    const sp = this.spaces.get(spaceId);
    const ch = sp?.channels.find((c) => c.id === channelId);
    if (!sp || !ch) throw new ApiFailure(404, 'No such channel.');
    if (!sp.canSend[channelId]) throw new ApiFailure(403, "You can't post in this channel.");
    const body = this.outgoing(text);
    if (!body.trim()) return this.getState();
    const box = this.channels.get(channelId) ?? { messages: [], unread: 0 };
    const reply = this.replyRef(box.messages, replyTo);
    const msg: ChatMessage = { id: randomId(9), from: 'me', author: this.me!.id, text: body, ts: Date.now(), expiresAt: null, status: 'sending', replyTo: reply };
    box.messages.push(msg);
    this.channels.set(channelId, box);
    this.emitState();
    try {
      await this.broadcastChannel(sp, ch, { id: msg.id, text: body, ts: msg.ts, reply }, msg.id, msg);
    } catch (e: any) {
      msg.status = 'failed';
      msg.note = e.message;
    }
    this.emitState();
    return this.getState();
  }

  // ------------------------------------------------- reactions, edits, unsend

  /** Apply a reaction / edit / unsend from `who`. Returns true if anything changed. */
  private applyOp(list: ChatMessage[], who: string, x: any): boolean {
    const m = list.find((v) => v.id === String(x?.target ?? ''));
    if (!m || m.from === 'system') return false;
    const author = m.author ?? (m.from === 'me' ? this.me?.id : undefined);
    switch (x.op) {
      case 'react': {
        const e = cleanEmoji(x.emoji);
        if (!e || m.deleted) return false;
        const r = (m.reactions ??= {});
        const set = new Set(r[e] ?? []);
        if (x.on === false) set.delete(who); else {
          if (!set.has(who) && Object.keys(r).length >= 20 && !r[e]) return false;
          set.add(who);
        }
        if (set.size) r[e] = [...set]; else delete r[e];
        return true;
      }
      case 'edit':
        if (author !== who || m.deleted || typeof x.text !== 'string' || !x.text.trim()) return false;
        m.text = x.text.slice(0, MAX_TEXT);
        m.edited = Date.now();
        return true;
      case 'unsend':
        if (author !== who) return false;
        m.deleted = true; m.text = ''; m.reactions = {}; m.replyTo = null;
        return true;
      default:
        return false;
    }
  }

  private listFor(where: Where): { list: ChatMessage[]; send: (x: Record<string, unknown>) => Promise<void> } {
    if ('peerId' in where) {
      const conv = this.convs.get(where.peerId);
      if (!conv) throw new ApiFailure(404, 'No such conversation.');
      if (conv.status !== 'active') throw new ApiFailure(400, 'Accept the request first.');
      return { list: conv.messages, send: async (x) => { await this.sendPayload(where.peerId, { k: 'op', x }, null); await this.save(); } };
    }
    const sp = this.spaces.get(where.spaceId);
    const ch = sp?.channels.find((c) => c.id === where.channelId);
    if (!sp || !ch) throw new ApiFailure(404, 'No such channel.');
    const box = this.channels.get(ch.id) ?? { messages: [], unread: 0 };
    this.channels.set(ch.id, box);
    return { list: box.messages, send: (x) => this.broadcastChannel(sp, ch, { id: randomId(9), text: '', x }, randomId(9), null) };
  }

  async react(where: Where, msgId: string, emoji: string): Promise<AppState> {
    const e = cleanEmoji(emoji);
    if (!e) throw new ApiFailure(400, 'Pick an emoji.');
    const { list, send } = this.listFor(where);
    const m = list.find((v) => v.id === msgId);
    if (!m || m.deleted) throw new ApiFailure(404, 'Message not found.');
    const on = !(m.reactions?.[e] ?? []).includes(this.me!.id);
    const x = { op: 'react', target: msgId, emoji: e, on };
    this.applyOp(list, this.me!.id, x);
    this.emitState();
    await send(x).catch(() => {});
    return this.getState();
  }

  async editMessage(where: Where, msgId: string, text: string): Promise<AppState> {
    const body = this.outgoing(text);
    if (!body.trim()) throw new ApiFailure(400, 'Message is empty. Unsend it instead.');
    const { list, send } = this.listFor(where);
    const x = { op: 'edit', target: msgId, text: body };
    if (!this.applyOp(list, this.me!.id, x)) throw new ApiFailure(400, 'You can only edit your own messages.');
    this.emitState();
    await send(x);
    return this.getState();
  }

  async unsendMessage(where: Where, msgId: string): Promise<AppState> {
    const { list, send } = this.listFor(where);
    const x = { op: 'unsend', target: msgId };
    if (!this.applyOp(list, this.me!.id, x)) throw new ApiFailure(400, 'You can only unsend your own messages.');
    this.emitState();
    await send(x);
    return this.getState();
  }

  /** Remove a message from this device only. */
  async deleteLocal(where: Where, msgId: string): Promise<AppState> {
    const list = 'peerId' in where ? this.convs.get(where.peerId)?.messages : this.channels.get(where.channelId)?.messages;
    if (list) { const i = list.findIndex((m) => m.id === msgId); if (i >= 0) list.splice(i, 1); }
    await this.save();
    this.emitState();
    return this.getState();
  }

  // ========================================================= direct (WebRTC)
  // The renderer owns RTCPeerConnection; we only pass opaque signaling and
  // already-encrypted envelopes. The server never sees direct traffic.

  sendSignal(to: string, data: unknown) {
    if (!this.effective().directConnections || this.data?.blocked[to]) return;
    this.wsSend({ t: 'signal', to, data });
  }

  receiveDirect(from: string, env: string) {
    if (!this.convs.has(from)) return; // direct channels only for open conversations
    this.serial(() => this.receive(from, env, 'direct')).catch(() => {});
  }

  setDirect(peerId: string, open: boolean) {
    const c = this.convs.get(peerId);
    if (c && c.direct !== open) { c.direct = open; this.emitState(); }
  }
}

// ------------------------------------------------------------------ helpers

function cleanReply(r: any): ChatMessage['replyTo'] {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.text !== 'string') return null;
  return { id: r.id.slice(0, 40), author: String(r.author ?? '').slice(0, 40), text: snippet(r.text) };
}

function trim(c: Conv) { if (c.messages.length > MAX_MESSAGES_PER_CHAT) c.messages.splice(0, c.messages.length - MAX_MESSAGES_PER_CHAT); }

function systemMsg(text: string): ChatMessage {
  return { id: randomId(6), from: 'system', text, ts: Date.now(), expiresAt: null, status: 'received' };
}

export function fmtTtl(s: number): string {
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${s / 60} minutes`;
  if (s < 86400) return `${s / 3600} hour${s === 3600 ? '' : 's'}`;
  return `${s / 86400} day${s === 86400 ? '' : 's'}`;
}

function ackReason(reason: string | undefined, username: string): string {
  switch (reason) {
    case 'offline': return `Not delivered — @${username} is offline. Sigil doesn't store messages, so try again when they're online.`;
    case 'not_accepting': return `@${username} isn't accepting messages.`;
    case 'rate_limited': return "You're sending too fast. Wait a moment.";
    case 'muted': return "Staff restricted messaging on your account, so this wasn't sent.";
    case 'raid': return 'Raid mode is on: accounts less than a day old can read but not send for now.';
    case 'unknown': return 'This account no longer exists.';
    default: return 'Not delivered.';
  }
}
