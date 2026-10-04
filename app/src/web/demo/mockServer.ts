// In-browser stand-in for the Sigil server, used only by the demo build.
// It implements the same HTTP + WebSocket API as server/src, reuses the same
// shared rules (usernames, blocklists, theme validation, badges, bio
// rendering) and verifies the same Ed25519 signatures. Like the real relay,
// it only ever handles ciphertext and drops messages for offline recipients.

import {
  checkUsername, canonicalize, tierFor, TIER_RULES, UNAVAILABLE_MESSAGE, USERNAME_RE,
  USERNAME_CHANGE_COOLDOWN_DAYS, OLD_NAME_LOCK_DAYS, type Tier,
} from '../../../../shared/usernames';
import { sanitizeTheme, DEFAULT_THEME } from '../../../../shared/theme';
import { renderBio, cleanText, BIO_MAX, DISPLAY_NAME_MAX, CUSTOM_STATUS_MAX } from '../../../../shared/markdown';
import { earnedBadges, visibleBadges, GRANTABLE, HOUSES, BADGES, type BadgeId } from '../../../../shared/badges';
import { STAFF_ACTIONS, durationUntil, type Duration, type AuditEntry } from '../../../../shared/staffActions';
import { DEFAULT_PRIVACY, mergePrivacy, type Privacy, type PublicProfile, type Me, type UsernameCheckResult, type Lockdown } from '../../../../shared/types';
import { LOCKDOWN_OFF, publicView, acceptsSpaceAdds } from '../../../../shared/lockdown';
import { PLATFORM_DEFAULTS, mergePlatform, cleanUpdate, RAID_MIN_AGE_MS, type PlatformSettings, type UpdatePost } from '../../../../shared/platform';
import { LATEST_VERSION } from '../../../../shared/changelog';
import { verify, spkMessage } from '../../core/crypto';
import {
  createListing, placeBid, buyNow, cancelListing, settleDue, buyCosmetic, listingView, owns, cleanTitle, MAX_TITLES,
  COSMETICS, COSMETIC_BY_ID, COSMETIC_SLOTS, ECONOMY, EconomyError, type EconomyStore, type Listing, type CosmeticSlot,
} from '../../../../shared/economy';
import { createSpace, applyOp, joinWithInvite, viewFor, canSendIn, recipientsOf, LIMITS as SPACE_LIMITS, SpaceError, type SpaceDoc } from '../../../../shared/spaces';
import { unb64, utf8, randomId, concat } from '../../core/bytes';

const DAY = 86_400_000;
export const DEMO_HOLD_MS = 25_000;
export const DEMO_INVITE = 'DEMO2026';

export interface Acct {
  id: string; username: string; createdAt: number;
  ed: string; x: string; spk: string | null; spkId: number | null; spkSig: string | null;
  displayName: string; bio: string; status: string; customStatus: string;
  theme: any; privacy: Privacy; avatar: string | null; banner: string | null; background: string | null;
  roles: string[]; badges: string[]; usernameChanges: number; lastChange: number | null;
  activeDays: number; banned: boolean;
  hiddenBadges: string[]; house: string | null; supporterSince: number | null; boosterSince: number | null;
  previousUsername: string | null; originalUsername: string | null; bannedUntil: number | null; banReason: string | null;
  mutedUntil: number | null; muteReason: string | null; frozenUntil: number | null; freezeReason: string | null;
  discoveryLocked: boolean; notices: { id: string; message: string; at: number; ack?: boolean; kind?: 'warning' | 'broadcast' }[]; flagged: boolean;
  credits: number; owned: string[]; frame: string | null; effect: string | null; titles: { name: string; color: string }[];
  pronouns: string; links: { label: string; url: string }[]; ledger: { delta: number; reason: string; at: number }[];
  nameFx: string | null; accessory: string | null; lockdown: Lockdown; marketBanned: boolean;
}
export const ACCT_DEFAULTS = {
  hiddenBadges: [] as string[], house: null, supporterSince: null, boosterSince: null, previousUsername: null, originalUsername: null,
  bannedUntil: null, banReason: null, mutedUntil: null, muteReason: null, frozenUntil: null, freezeReason: null,
  discoveryLocked: false, notices: [] as any[], flagged: false,
  credits: ECONOMY.startingCredits, owned: [] as string[], frame: null, effect: null, titles: [] as any[], pronouns: '', links: [] as any[], ledger: [] as any[],
  nameFx: null, accessory: null, lockdown: { ...LOCKDOWN_OFF }, marketBanned: false,
};
const live = (t: number | null) => !!t && t > Date.now();
const fmtUntil = (t: number) => (t > 8e15 ? 'until further notice' : `until ${new Date(t).toUTCString().replace(/:\d\d GMT/, ' UTC')}`);
interface Claim { id: string; accountId: string; name: string; tier: Tier; status: string; createdAt: number; availableAt: number | null }
interface Report { id: string; reporter: string; target: string; reason: string; details: string; createdAt: number; status: string }

class HttpError extends Error { constructor(public status: number, message: string, public code = 'error') { super(message); } }

export class MockServer {
  accounts = new Map<string, Acct>();
  sessions = new Map<string, string>();
  sessionMeta = new Map<string, { sid: string; label: string; createdAt: number; lastSeen: number }>();
  platform: PlatformSettings = PLATFORM_DEFAULTS(true);
  updates: UpdatePost[] = [];
  challenges = new Set<string>();
  claims: Claim[] = [];
  locks = new Map<string, { owner: string; until: number }>();
  reports: Report[] = [];
  invites = new Map<string, string | null>([[DEMO_INVITE, null], ['SEEDSEED', null]]);
  sockets = new Map<string, Set<MockSocket>>();
  watchers = new Map<string, Set<MockSocket>>();
  spaces = new Map<string, SpaceDoc>();
  /** accounts created by the person using the demo (they get staff so they can see moderation) */
  humanIds = new Set<string>();
  greeted = new Set<string>();
  onHumanSignup: ((a: Acct) => void) | null = null;

  /** called after anything that changes saved state (the demo persists the world) */
  onChange: (() => void) | null = null;

  constructor() { setInterval(() => this.finalizeHolds(), 1000); }

  /** Everything worth keeping between visits, as plain data. */
  snapshot() {
    return {
      v: 1,
      accounts: [...this.accounts.values()],
      sessions: [...this.sessions].filter(([, id]) => this.humanIds.has(id)),
      sessionMeta: [...this.sessionMeta].filter(([t]) => this.humanIds.has(this.sessions.get(t) ?? '')),
      claims: this.claims, locks: [...this.locks], reports: this.reports, invites: [...this.invites],
      spaces: [...this.spaces.values()], listings: [...this.listings.values()],
      humanIds: [...this.humanIds], greeted: [...this.greeted],
      audit: this.audit, auditByTarget: [...this.auditByTarget],
      platform: this.platform, updates: this.updates,
    };
  }
  restore(snap: ReturnType<MockServer['snapshot']>) {
    this.accounts = new Map(snap.accounts.map((a) => [a.id, { ...structuredClone(ACCT_DEFAULTS), ...a }]));
    // Older saves: work out the creation name. (The demo's @hack was seeded with a made-up old name; it was always @hack.)
    for (const a of this.accounts.values()) {
      if (a.username === 'hack' && a.previousUsername === 'hacker_og') {
        a.previousUsername = null;
        a.originalUsername = 'hack';
        if (!a.badges.includes('legacy_username')) a.badges = [...a.badges, 'legacy_username'];
      }
      if (!a.originalUsername || a.originalUsername.startsWith('seed_')) a.originalUsername = a.previousUsername && !a.previousUsername.startsWith('seed_') ? a.previousUsername : a.username;
    }
    this.sessions = new Map(snap.sessions);
    this.sessionMeta = new Map(snap.sessionMeta);
    this.claims = snap.claims; this.locks = new Map(snap.locks); this.reports = snap.reports; this.invites = new Map(snap.invites);
    this.spaces = new Map(snap.spaces.map((d) => [d.id, d]));
    this.listings = new Map(snap.listings.map((l) => [l.id, l]));
    this.humanIds = new Set(snap.humanIds); this.greeted = new Set(snap.greeted);
    this.audit = snap.audit; this.auditByTarget = new Map(snap.auditByTarget);
    this.platform = snap.platform; this.updates = snap.updates;
  }

  // ------------------------------------------------------------ helpers
  byName(n: string) { for (const a of this.accounts.values()) if (a.username === n) return a; return undefined; }
  isOnline(id: string) { return (this.sockets.get(id)?.size ?? 0) > 0; }
  presenceOf(a: Acct): PublicProfile['presence'] {
    if (!a.privacy.showStatus || a.lockdown.enabled) return null;
    if (!this.isOnline(a.id) || a.status === 'invisible') return 'offline';
    return a.status as any;
  }
  earned(a: Acct): BadgeId[] {
    return earnedBadges({ roles: a.roles, granted: a.badges, createdAt: a.createdAt, username: a.username, originalUsername: a.originalUsername ?? a.previousUsername ?? a.username, renamed: a.usernameChanges > 0 || !!a.previousUsername,
      house: a.house, supporterSince: a.supporterSince, boosterSince: a.boosterSince, earlyCutoff: Date.parse('2027-03-01') });
  }
  badgesOf(a: Acct): BadgeId[] { return visibleBadges(this.earned(a), a.hiddenBadges); }
  audit: AuditEntry[] = [];
  auditByTarget = new Map<string, AuditEntry[]>();
  log(staff: Acct, target: Acct | null, action: string, detail = '') {
    const e: AuditEntry = { id: randomId(6), at: Date.now(), staff: staff.username, target: target?.username ?? null, action, detail: detail.slice(0, 500) };
    this.audit.unshift(e);
    if (target) {
      if (!this.auditByTarget.has(target.id)) this.auditByTarget.set(target.id, []);
      this.auditByTarget.get(target.id)!.unshift(e);
    }
  }
  liftExpired(a: Acct) { if (a.banned && a.bannedUntil && a.bannedUntil <= Date.now()) { a.banned = false; a.bannedUntil = null; a.banReason = null; } }
  suspendedMsg(a: Acct) { return `This account is suspended ${a.bannedUntil ? fmtUntil(a.bannedUntil) : 'until further notice'}.${a.banReason ? ` Reason: ${a.banReason}` : ''}`; }
  assertNotFrozen(a: Acct) {
    if (live(a.frozenUntil)) throw new HttpError(403, `Staff locked profile editing on this account ${fmtUntil(a.frozenUntil!)}.${a.freezeReason ? ` Reason: ${a.freezeReason}` : ''}`, 'frozen');
  }
  statusText(a: Acct) { return a.privacy.showStatus && !a.lockdown.enabled ? a.customStatus : ''; }
  /** what other people see */
  pub(a: Acct): PublicProfile { return publicView(this.raw(a), { ...DEFAULT_PRIVACY, ...a.privacy }, a.lockdown); }
  raw(a: Acct): PublicProfile {
    return {
      id: a.id, username: a.username, displayName: a.displayName || a.username, bio: a.bio, bioHtml: renderBio(a.bio),
      presence: this.presenceOf(a), customStatus: a.privacy.showStatus ? a.customStatus : '', theme: sanitizeTheme(a.theme),
      avatar: a.avatar, banner: a.banner, background: a.background, badges: this.badgesOf(a),
      legacyUsername: this.badgesOf(a).includes('legacy_username') ? (a.originalUsername ?? a.previousUsername ?? a.username) : null, messagePolicy: a.privacy.whoCanMessage,
      pronouns: a.pronouns, links: a.links, titles: a.titles, frame: a.frame, effect: a.effect, nameFx: a.nameFx, accessory: a.accessory,
      createdAt: a.createdAt, tier: tierFor(a.username),
      keys: a.spk ? { ed: a.ed, x: a.x, spk: a.spk, spkId: a.spkId!, spkSig: a.spkSig! } : null,
    };
  }
  ageDays(a: Acct) { return Math.floor((Date.now() - a.createdAt) / DAY); }
  activity(a: Acct) {
    const breakdown = [
      { label: 'Display name set', points: a.displayName ? 1 : 0 },
      { label: 'Avatar set', points: a.avatar ? 1 : 0 },
      { label: 'Bio written', points: a.bio ? 1 : 0 },
      { label: `Active days (${a.activeDays}, max 7)`, points: Math.min(7, a.activeDays) },
    ];
    return { total: breakdown.reduce((n, b) => n + b.points, 0), breakdown };
  }
  nextChange(a: Acct) {
    if (!a.lastChange) return null;
    const t = a.lastChange + USERNAME_CHANGE_COOLDOWN_DAYS * DAY;
    return t > Date.now() ? t : null;
  }
  claimOf(c?: Claim) { return c ? { id: c.id, name: c.name, tier: c.tier, status: c.status as any, createdAt: c.createdAt, availableAt: c.availableAt } : null; }
  me(a: Acct): Me {
    const act = this.activity(a);
    return {
      ...this.raw(a), status: a.status as any, privacy: { ...DEFAULT_PRIVACY, ...a.privacy }, roles: a.roles, accountAgeDays: this.ageDays(a),
      lockdown: a.lockdown, marketBanned: a.marketBanned,
      activity: act.total, activityBreakdown: act.breakdown, lastUsernameChange: a.lastChange, usernameChanges: a.usernameChanges,
      nextUsernameChangeAt: this.nextChange(a),
      pendingClaim: this.claimOf(this.claims.find((c) => c.accountId === a.id && ['holding', 'pending_staff'].includes(c.status))),
      flaggedNetwork: a.flagged,
      invites: [{ code: 'FRIEND01', usedBy: null }, { code: 'FRIEND02', usedBy: null }],
      earnedBadges: this.earned(a), hiddenBadges: a.hiddenBadges, house: a.house,
      credits: a.credits, ownedCosmetics: a.roles.includes('staff') ? COSMETICS.map((c) => c.id) : a.owned,
      notices: a.notices.filter((n) => !n.ack).map(({ id, message, at, kind }) => ({ id, message, at, kind: kind ?? 'warning' })),
      restrictions: {
        mutedUntil: live(a.mutedUntil) ? a.mutedUntil : null, muteReason: live(a.mutedUntil) ? a.muteReason : null,
        frozenUntil: live(a.frozenUntil) ? a.frozenUntil : null, freezeReason: live(a.frozenUntil) ? a.freezeReason : null,
        discoveryLocked: a.discoveryLocked,
      },
    };
  }
  held(name: string, self: string | null) {
    const a = this.byName(name);
    if (a && a.id !== self) return true;
    const l = this.locks.get(name);
    if (l && l.until > Date.now() && l.owner !== self) return true;
    return this.claims.some((c) => c.name === name && ['holding', 'pending_staff'].includes(c.status) && c.accountId !== self);
  }

  check(raw: string, a: Acct | null): UsernameCheckResult {
    const s = checkUsername(raw);
    if (!s.ok) return { name: s.name, status: ['empty', 'too_long', 'charset'].includes(s.reason) ? 'invalid' : 'unavailable', message: s.message, tier: null };
    const name = s.name, tier = s.tier!;
    if (a && a.username === name) return { name, status: 'yours', message: "That's your username.", tier };
    if (this.held(name, a?.id ?? null)) return { name, status: 'unavailable', message: UNAVAILABLE_MESSAGE, tier };
    const rule = TIER_RULES[tier];
    if (!a) {
      if (tier === 'standard') return { name, status: 'available', message: 'Available.', tier };
      return { name, status: 'locked', tier, message: `${rule.label} names unlock after your account is ${rule.minAccountAgeDays} days old. Pick a 5+ character name to start.`,
        requirements: [{ label: `Account at least ${rule.minAccountAgeDays} days old`, met: false }] };
    }
    const reqs = [
      { label: `Username change cooldown (${USERNAME_CHANGE_COOLDOWN_DAYS} days)`, met: this.nextChange(a) === null },
      { label: 'No other claim in progress', met: !this.claims.some((c) => c.accountId === a.id && ['holding', 'pending_staff'].includes(c.status)) },
    ];
    if (tier !== 'standard') {
      const age = this.ageDays(a), act = this.activity(a).total;
      reqs.push({ label: `Account at least ${rule.minAccountAgeDays} days old (you: ${age})`, met: age >= rule.minAccountAgeDays });
      reqs.push({ label: `Activity score ${rule.minActivity}+ (you: ${act})`, met: act >= rule.minActivity });
      reqs.push({ label: 'Not signed up from a datacenter / VPN network', met: true });
    }
    if (reqs.some((r) => !r.met)) return { name, status: 'locked', tier, message: 'Not yet — requirements below.', requirements: reqs };
    if (rule.staffApproval) return { name, status: 'staff', tier, requirements: reqs, message: '1–2 character names are granted by staff. You can submit a request.' };
    if (rule.holdHours) return { name, status: 'hold', tier, requirements: reqs, message: "Rare name: goes on a public hold before it's yours (24h on Sigil, 25 seconds in this demo)." };
    return { name, status: 'available', tier, requirements: reqs, message: 'Available.' };
  }
  rename(a: Acct, name: string) {
    this.locks.set(a.username, { owner: a.id, until: Date.now() + OLD_NAME_LOCK_DAYS * DAY });
    this.locks.delete(name);
    a.previousUsername ??= a.username;
    a.username = name;
    a.usernameChanges++;
    a.lastChange = Date.now();
    this.notifyPresence(a.id);
  }
  finalizeHolds() {
    for (const c of this.claims) {
      if (c.status !== 'holding' || (c.availableAt ?? 0) > Date.now()) continue;
      const a = this.accounts.get(c.accountId);
      if (a && !this.byName(c.name)) { this.rename(a, c.name); c.status = 'finalized'; } else c.status = 'cancelled';
    }
  }

  // ------------------------------------------------------------- fetch
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? null;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 80)); // feel like a network
    try {
      const body = init.body;
      const out = await this.route(method, url, token, body);
      if (method !== 'GET' || url.pathname === '/api/me' || url.pathname.startsWith('/api/market') || url.pathname === '/api/shop') this.onChange?.();
      return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return new Response(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Something went wrong.', code: e?.code }), { status });
    }
  };

  issue(a: Acct, label?: unknown): string {
    const t = randomId(24);
    this.sessions.set(t, a.id);
    this.sessionMeta.set(t, { sid: randomId(9), label: cleanText(String(label ?? ''), 40).trim() || 'Unknown device', createdAt: Date.now(), lastSeen: Date.now() });
    return t;
  }
  sidOf(token: string | null) { return token ? this.sessionMeta.get(token)?.sid ?? null : null; }
  listSessions(a: Acct, token: string | null) {
    const cur = this.sidOf(token);
    return [...this.sessions].filter(([, id]) => id === a.id).map(([t]) => this.sessionMeta.get(t)!).filter(Boolean)
      .sort((x, y) => y.lastSeen - x.lastSeen).map((m) => ({ id: m.sid, label: m.label, createdAt: m.createdAt, lastSeen: m.lastSeen, current: m.sid === cur }));
  }
  endSessions(a: Acct, keepToken: string | null, onlySid?: string) {
    for (const [t, id] of [...this.sessions]) {
      if (id !== a.id || t === keepToken) continue;
      const sid = this.sessionMeta.get(t)?.sid;
      if (onlySid && sid !== onlySid) continue;
      this.sessions.delete(t); this.sessionMeta.delete(t);
      for (const k of [...(this.sockets.get(a.id) ?? [])]) if (k.token === t) k.close();
    }
  }
  raidBlocked(a: Acct | undefined) { return !!a && this.platform.raidMode && Date.now() - a.createdAt < RAID_MIN_AGE_MS && !a.roles.includes('staff'); }
  marketGate(a: Acct, which: 'market' | 'shop') {
    if (a.marketBanned) throw new HttpError(403, 'Staff removed your marketplace access.', 'market_banned');
    if (!a.roles.includes('staff') && (which === 'market' ? this.platform.marketPaused : this.platform.shopPaused)) throw new HttpError(503, which === 'market' ? 'The marketplace is paused for maintenance. Your listings and bids are safe.' : 'The shop is closed for a moment. Try again soon.');
  }
  assertAddable(ids: string[]) {
    for (const id of ids) {
      const a = this.accounts.get(id);
      if (a && !acceptsSpaceAdds({ ...DEFAULT_PRIVACY, ...a.privacy }, a.lockdown)) throw new HttpError(403, `@${a.username} only joins servers and groups with an invite link. Send them one instead.`);
    }
  }

  private auth(token: string | null, optional = false): Acct {
    const id = token ? this.sessions.get(token) : undefined;
    const meta = token ? this.sessionMeta.get(token) : undefined;
    if (meta) meta.lastSeen = Date.now();
    const a = id ? this.accounts.get(id) : undefined;
    if (!a) { if (optional) return null as any; throw new HttpError(401, 'Sign in required.'); }
    this.liftExpired(a);
    if (a.banned) throw new HttpError(403, this.suspendedMsg(a), 'banned');
    return a;
  }
  private staff(token: string | null) {
    const a = this.auth(token);
    if (!a.roles.includes('staff')) throw new HttpError(403, 'Staff only.');
    return a;
  }
  private json(body: unknown): any {
    if (typeof body !== 'string') return {};
    try { return JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  }
  private async checkSig(ed: string, nonce: string, sig: string, purpose = 'auth') {
    if (!this.challenges.delete(nonce)) throw new HttpError(401, 'Challenge expired. Try again.');
    if (!(await verify(unb64(ed), utf8(`sigil-${purpose}:${nonce}`), unb64(String(sig ?? ''))))) throw new HttpError(401, 'Signature check failed.');
  }

  private async route(method: string, url: URL, token: string | null, rawBody: any): Promise<any> {
    const p = url.pathname;
    const b = () => this.json(rawBody);
    let m: RegExpExecArray | null;

    if (method === 'GET' && p === '/api/config') {
      const pl = this.platform;
      return { inviteOnly: pl.signups === 'invite', signups: pl.signups, banner: pl.banner, marketPaused: pl.marketPaused, shopPaused: pl.shopPaused, raidMode: pl.raidMode, iceServers: [], version: LATEST_VERSION };
    }
    if (method === 'GET' && p === '/api/updates') return this.updates;
    if (method === 'POST' && p === '/api/auth/challenge') { const n = randomId(18); this.challenges.add(n); return { nonce: n }; }
    if (method === 'POST' && p === '/api/auth/register') {
      const i = b();
      await this.checkSig(i.ed, i.nonce, i.sig);
      if ([...this.accounts.values()].some((a) => a.ed === i.ed)) throw new HttpError(409, 'This recovery phrase already has an account. Sign in instead.');
      const code = String(i.invite ?? '').trim().toUpperCase();
      if (code !== 'SEEDSEED' && this.platform.signups === 'paused') throw new HttpError(403, 'Sign-ups are paused right now. Try again later.', 'signups_paused');
      if (code !== 'SEEDSEED' && this.platform.signups === 'open') { /* no invite needed */ } else if (!this.invites.has(code)) throw new HttpError(403, `That invite code is invalid or already used. (Demo code: ${DEMO_INVITE})`, 'invite');
      const chk = this.check(i.username, null);
      if (chk.status !== 'available') throw new HttpError(409, chk.message, chk.status);
      const a: Acct = {
        id: randomId(9), username: chk.name, createdAt: Date.now(), ed: i.ed, x: i.x, spk: null, spkId: null, spkSig: null,
        displayName: '', bio: '', status: 'online', customStatus: '', theme: DEFAULT_THEME, privacy: { ...DEFAULT_PRIVACY },
        avatar: null, banner: null, background: null, roles: [], badges: [], usernameChanges: 0, lastChange: null, activeDays: 1, banned: false,
        ...structuredClone(ACCT_DEFAULTS),
      };
      a.originalUsername = a.username; // the creation name: it's what the Originally Known As badge shows
      if (code !== 'SEEDSEED') { a.roles = ['staff']; this.humanIds.add(a.id); }
      this.accounts.set(a.id, a);
      const t = this.issue(a, i.deviceLabel);
      if (this.humanIds.has(a.id)) { this.greeted.add(a.id); setTimeout(() => this.onHumanSignup?.(a), 0); }
      return { token: t, accountId: a.id };
    }
    if (method === 'POST' && p === '/api/auth/login') {
      const i = b();
      await this.checkSig(i.ed, i.nonce, i.sig);
      const a = [...this.accounts.values()].find((x) => x.ed === i.ed);
      if (!a) throw new HttpError(404, 'No account for this recovery phrase. (Demo accounts are saved in this browser; resetting the demo erases them.)', 'no_account');
      this.liftExpired(a);
      if (a.banned) throw new HttpError(403, this.suspendedMsg(a), 'banned');
      const t = this.issue(a, i.deviceLabel);
      if (this.humanIds.has(a.id) && !this.greeted.has(a.id)) { this.greeted.add(a.id); setTimeout(() => this.onHumanSignup?.(a), 0); }
      return { token: t, accountId: a.id };
    }
    if (method === 'POST' && p === '/api/auth/logout') { if (token) { this.sessions.delete(token); this.sessionMeta.delete(token); } return { ok: true }; }

    if (method === 'GET' && p === '/api/username/check') return this.check(url.searchParams.get('name') ?? '', this.auth(token, true));
    if (method === 'POST' && p === '/api/username/claim') {
      const a = this.auth(token);
      this.assertNotFrozen(a);
      const chk = this.check(String(b().name ?? ''), a);
      if (chk.status === 'available') { this.rename(a, chk.name); return { result: 'renamed', me: this.me(a) }; }
      if (chk.status === 'hold' || chk.status === 'staff') {
        const c: Claim = { id: randomId(9), accountId: a.id, name: chk.name, tier: chk.tier!, status: chk.status === 'hold' ? 'holding' : 'pending_staff', createdAt: Date.now(), availableAt: chk.status === 'hold' ? Date.now() + DEMO_HOLD_MS : null };
        this.claims.push(c);
        return { result: chk.status, claim: this.claimOf(c), me: this.me(a) };
      }
      throw new HttpError(chk.status === 'invalid' ? 400 : 409, chk.status === 'yours' ? "That's already your username." : chk.message, chk.status);
    }
    if (method === 'POST' && p === '/api/username/cancel') {
      const a = this.auth(token);
      for (const c of this.claims) if (c.accountId === a.id && ['holding', 'pending_staff'].includes(c.status)) c.status = 'cancelled';
      return { me: this.me(a) };
    }
    if (method === 'GET' && p === '/api/rare') {
      return this.claims.filter((c) => ['holding', 'pending_staff', 'finalized'].includes(c.status) && c.name.length <= 4)
        .sort((x, y) => y.createdAt - x.createdAt)
        .map((c) => ({ name: c.name, tier: c.tier, status: c.status, by: this.accounts.get(c.accountId)?.username ?? '?', createdAt: c.createdAt, availableAt: c.availableAt }));
    }

    if (method === 'GET' && p === '/api/me') return this.me(this.auth(token));
    if (method === 'PATCH' && p === '/api/me') {
      const a = this.auth(token);
      const i = b();
      const slots = Object.keys(COSMETIC_SLOTS) as CosmeticSlot[];
      if (['displayName', 'bio', 'customStatus', 'theme', 'pronouns', 'links', ...slots].some((k) => i[k] !== undefined)) this.assertNotFrozen(a);
      for (const slot of slots) {
        if (i[slot] === undefined) continue;
        if (!i[slot]) { a[slot] = null; continue; }
        const c = COSMETIC_BY_ID[i[slot]];
        if (!c || c.kind !== slot) throw new HttpError(400, 'Unknown item.');
        if (!owns({ owned: a.owned, staff: a.roles.includes('staff') }, c.id)) throw new HttpError(403, 'Buy it in the shop first.');
        a[slot] = c.id;
      }
      if (typeof i.pronouns === 'string') a.pronouns = cleanText(i.pronouns, 24).replace(/\n/g, ' ').trim();
      if (Array.isArray(i.links)) {
        a.links = i.links.slice(0, 3).map((l: any) => {
          let u: URL;
          try { u = new URL(String(l?.url ?? '')); } catch { throw new HttpError(400, 'Links must be full https:// addresses.'); }
          if (u.protocol !== 'https:' || u.href.length > 200) throw new HttpError(400, 'Links must be https:// and under 200 characters.');
          return { label: cleanText(String(l?.label ?? ''), 24).trim() || u.hostname.replace(/^www\./, ''), url: u.href };
        });
      }
      if (Array.isArray(i.hiddenBadges)) { const e = new Set(this.earned(a)); a.hiddenBadges = [...new Set<string>(i.hiddenBadges.filter((x: string) => e.has(x)))]; }
      if (i.house !== undefined) {
        if (i.house !== null && !(HOUSES as readonly string[]).includes(i.house)) throw new HttpError(400, 'Unknown house.');
        a.house = i.house;
      }
      if (typeof i.displayName === 'string') a.displayName = cleanText(i.displayName, DISPLAY_NAME_MAX).replace(/\n/g, ' ').trim();
      if (typeof i.bio === 'string') a.bio = cleanText(i.bio, BIO_MAX);
      if (typeof i.customStatus === 'string') a.customStatus = cleanText(i.customStatus, CUSTOM_STATUS_MAX).replace(/\n/g, ' ');
      if (['online', 'idle', 'dnd', 'invisible'].includes(i.status)) a.status = i.status;
      if (i.theme !== undefined) a.theme = sanitizeTheme(i.theme);
      if (i.privacy && typeof i.privacy === 'object') {
        a.privacy = mergePrivacy({ ...DEFAULT_PRIVACY, ...a.privacy }, i.privacy);
        if (a.discoveryLocked) a.privacy.discoverable = false;
        if (a.lockdown.enabled && a.privacy.whoCanMessage === 'everyone') a.privacy.whoCanMessage = 'friends';
      }
      this.notifyPresence(a.id);
      return this.me(a);
    }
    if (method === 'POST' && p === '/api/me/keys') {
      const a = this.auth(token);
      const i = b();
      if (!(await verify(unb64(a.ed), spkMessage(Number(i.spkId), unb64(i.spk)), unb64(i.spkSig)))) throw new HttpError(400, 'Prekey signature invalid.');
      a.spk = i.spk; a.spkId = Number(i.spkId); a.spkSig = i.spkSig;
      return { ok: true };
    }
    if (method === 'POST' && p === '/api/me/lockdown') {
      const a = this.auth(token);
      const i = b();
      const cur = a.lockdown;
      const enabled = typeof i.enabled === 'boolean' ? i.enabled : cur.enabled;
      const allowRequests = typeof i.allowRequests === 'boolean' ? i.allowRequests : cur.allowRequests;
      const weakens = (cur.enabled && !enabled) || (cur.enabled && enabled && allowRequests && !cur.allowRequests);
      if (weakens) await this.checkSig(a.ed, String(i.nonce ?? ''), i.sig, 'lockdown');
      a.lockdown = { enabled, allowRequests: enabled ? allowRequests : false, since: enabled ? (cur.enabled ? cur.since : Date.now()) : null };
      if (enabled && !cur.enabled) {
        if (a.privacy.whoCanMessage === 'everyone') a.privacy = { ...a.privacy, whoCanMessage: 'friends' };
        this.endSessions(a, token);
      }
      this.notifyPresence(a.id);
      return this.me(a);
    }
    if (method === 'GET' && p === '/api/me/sessions') { const a = this.auth(token); return this.listSessions(a, token); }
    if (method === 'POST' && p === '/api/me/sessions/revoke-others') { const a = this.auth(token); this.endSessions(a, token); return this.listSessions(a, token); }
    if (method === 'DELETE' && (m = /^\/api\/me\/sessions\/([^/]+)$/.exec(p))) { const a = this.auth(token); this.endSessions(a, token, m[1]); return this.listSessions(a, token); }
    if (method === 'GET' && p === '/api/me/export') {
      const a = this.auth(token);
      const { ledger, ...account } = a;
      return {
        exportedAt: new Date().toISOString(),
        note: "This is every record Sigil's server keeps about your account. Message content, contacts, blocks and chat history are never sent to the server, so they are not here.",
        account, sessions: this.listSessions(a, token),
        usernameClaims: this.claims.filter((c) => c.accountId === a.id),
        creditLedger: ledger,
        marketListings: [...this.listings.values()].filter((l) => l.sellerId === a.id),
        spaces: [...this.spaces.values()].filter((d) => d.members[a.id]).map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
        reportsYouFiled: this.reports.filter((r) => r.reporter === a.id).map(({ reason, details, createdAt, status }) => ({ reason, details, createdAt, status })),
        staffActionsOnYourAccount: (this.auditByTarget.get(a.id) ?? []).filter((e) => e.action !== 'add_note').map((e) => ({ action: e.action, at: e.at })),
      };
    }
    if ((m = /^\/api\/me\/media\/(avatar|banner|background)$/.exec(p))) {
      const a = this.auth(token);
      const slot = m[1] as 'avatar' | 'banner' | 'background';
      this.assertNotFrozen(a);
      if (method === 'DELETE') { a[slot] = null; return this.me(a); }
      const bytes = rawBody as Uint8Array;
      const max = slot === 'avatar' ? 8 << 20 : 12 << 20;
      if (!(bytes instanceof Uint8Array)) throw new HttpError(400, 'No file.');
      if (bytes.length > max) throw new HttpError(413, `File too large (max ${max >> 20} MB).`);
      const type = sniff(bytes);
      if (!type) throw new HttpError(415, 'Use a PNG, JPEG, GIF or WebP image.');
      // a data: URL rather than a blob: URL, so the image is still there after a reload
      a[slot] = dataUrl(bytes, type);
      return this.me(a);
    }
    if (method === 'DELETE' && p === '/api/me') {
      const a = this.auth(token);
      this.locks.set(a.username, { owner: 'deleted', until: Date.now() + OLD_NAME_LOCK_DAYS * DAY });
      for (const s of this.sockets.get(a.id) ?? []) s.close();
      this.accounts.delete(a.id);
      return { ok: true };
    }
    if (method === 'GET' && (m = /^\/api\/u\/([^/]+)$/.exec(p))) {
      const viewer = this.auth(token, true);
      const a = this.byName(canonicalize(decodeURIComponent(m[1])));
      if (!a || a.banned || (!a.privacy.discoverable && viewer?.id !== a.id && !viewer?.roles.includes('staff'))) throw new HttpError(404, 'No profile with that username.');
      return this.pub(a);
    }
    if (method === 'GET' && (m = /^\/api\/id\/([^/]+)$/.exec(p))) {
      this.auth(token);
      const a = this.accounts.get(decodeURIComponent(m[1]));
      if (!a || a.banned) throw new HttpError(404, 'Unknown account.');
      return this.pub(a);
    }
    if (method === 'POST' && (m = /^\/api\/me\/notices\/([^/]+)\/ack$/.exec(p))) {
      const a = this.auth(token);
      for (const n of a.notices) if (n.id === m[1]) n.ack = true;
      return this.me(a);
    }
    if (method === 'POST' && p === '/api/report') {
      const a = this.auth(token);
      const i = b();
      if (!this.accounts.has(i.targetId)) throw new HttpError(404, 'Unknown account.');
      this.reports.unshift({ id: randomId(9), reporter: a.id, target: i.targetId, reason: String(i.reason), details: cleanText(String(i.details ?? ''), 500), createdAt: Date.now(), status: 'open' });
      return { ok: true };
    }

    // economy
    if (p === '/api/shop' || p.startsWith('/api/shop/') || p.startsWith('/api/market') || p === '/api/me/ledger') return this.econRoute(method, p, url, token, b);

    // spaces
    if (p === '/api/spaces' || p.startsWith('/api/spaces/')) return this.spaceRoute(method, p, token, b);

    // staff
    if (method === 'GET' && p === '/api/staff/overview') {
      this.staff(token);
      const open = this.reports.filter((r) => r.status === 'open');
      return {
        stats: { accounts: this.accounts.size, online: [...this.sockets.values()].filter((s) => s.size).length, openReports: open.length,
          suspended: [...this.accounts.values()].filter((a) => a.banned).length, muted: [...this.accounts.values()].filter((a) => live(a.mutedUntil)).length },
        audit: this.audit.slice(0, 25),
        claims: this.claims.filter((c) => ['holding', 'pending_staff'].includes(c.status)).map((c) => {
          const a = this.accounts.get(c.accountId)!;
          return { id: c.id, name: c.name, tier: c.tier, status: c.status, current: a?.username, accountId: c.accountId, createdAt: c.createdAt, availableAt: c.availableAt, accountCreated: a?.createdAt };
        }),
        reports: open.map((r) => ({ id: r.id, reason: r.reason, details: r.details, createdAt: r.createdAt, targetId: r.target, target: this.accounts.get(r.target)?.username ?? null, reporter: this.accounts.get(r.reporter)?.username ?? null })),
      };
    }
    if (method === 'POST' && (m = /^\/api\/staff\/claims\/([^/]+)$/.exec(p))) {
      this.staff(token);
      const c = this.claims.find((x) => x.id === m![1] && ['holding', 'pending_staff'].includes(x.status));
      if (!c) throw new HttpError(404, 'No open claim with that id.');
      const s = this.staff(token);
      const target = this.accounts.get(c.accountId) ?? null;
      if (b().approve) {
        if (this.byName(c.name)) throw new HttpError(409, 'Name already taken.');
        this.rename(target!, c.name);
        c.status = 'finalized';
      } else c.status = 'denied';
      this.log(s, target, b().approve ? 'approve_claim' : 'deny_claim', `@${c.name}`);
      return { ok: true };
    }
    if (method === 'GET' && p === '/api/staff/accounts') {
      this.staff(token);
      const q = (url.searchParams.get('q') ?? '').toLowerCase(), f = url.searchParams.get('filter') ?? '';
      return [...this.accounts.values()].filter((a) => {
        if (q && !a.username.includes(q) && !a.displayName.toLowerCase().includes(q)) return false;
        const rep = this.reports.some((r) => r.target === a.id && r.status === 'open');
        return !f || (f === 'suspended' && a.banned) || (f === 'muted' && live(a.mutedUntil)) || (f === 'locked' && live(a.frozenUntil))
          || (f === 'staff' && a.roles.includes('staff')) || (f === 'flagged' && a.flagged) || (f === 'reported' && rep)
          || (f === 'new' && Date.now() - a.createdAt < 7 * DAY) || (f === 'short' && a.username.length <= 4);
      }).sort((x, y) => y.createdAt - x.createdAt).map((a) => ({
        id: a.id, username: a.username, displayName: a.displayName, createdAt: a.createdAt, roles: a.roles, avatar: a.avatar, theme: sanitizeTheme(a.theme),
        banned: a.banned, muted: live(a.mutedUntil), frozen: live(a.frozenUntil), flagged: a.flagged,
        openReports: this.reports.filter((r) => r.target === a.id && r.status === 'open').length,
      }));
    }
    if (method === 'GET' && (m = /^\/api\/staff\/accounts\/([^/]+)$/.exec(p))) {
      this.staff(token);
      const a = this.accounts.get(m[1]);
      if (!a) throw new HttpError(404, 'Not found.');
      this.liftExpired(a);
      return this.detail(a);
    }
    if (method === 'POST' && (m = /^\/api\/staff\/accounts\/([^/]+)\/action$/.exec(p))) {
      const s = this.staff(token);
      this.staffAction(s, m[1], b());
      const a = this.accounts.get(m[1]);
      return a ? this.detail(a) : { deleted: true };
    }
    if (method === 'GET' && p === '/api/staff/audit') { this.staff(token); return this.audit.slice(0, 100); }
    if (method === 'GET' && p === '/api/staff/lookup') {
      this.staff(token);
      const a = this.byName(canonicalize(url.searchParams.get('username') ?? ''));
      if (!a) throw new HttpError(404, 'Not found.');
      return this.detail(a);
    }
    if (method === 'POST' && (m = /^\/api\/staff\/accounts\/([^/]+)$/.exec(p))) {
      const s = this.staff(token);
      const a = this.accounts.get(m[1]);
      if (!a) throw new HttpError(404, 'Not found.');
      const i = b();
      if (typeof i.banned === 'boolean') {
        if (a.id === s.id) throw new HttpError(400, "You can't ban yourself.");
        a.banned = i.banned;
        if (a.banned) for (const k of this.sockets.get(a.id) ?? []) k.close();
      }
      if (Array.isArray(i.badges)) a.badges = i.badges.filter((x: string) => GRANTABLE.includes(x as BadgeId));
      if (Array.isArray(i.roles)) {
        if (!s.roles.includes('founder')) throw new HttpError(403, 'Only founders can change roles.');
        a.roles = i.roles;
      }
      if (['avatar', 'banner', 'background'].includes(i.removeMedia)) (a as any)[i.removeMedia] = null;
      if (i.resetBio) { a.bio = ''; a.customStatus = ''; a.displayName = ''; }
      if (typeof i.forceUsername === 'string' && USERNAME_RE.test(i.forceUsername)) a.username = i.forceUsername;
      return { ok: true };
    }
    if (method === 'POST' && (m = /^\/api\/staff\/reports\/([^/]+)$/.exec(p))) {
      this.staff(token);
      const r = this.reports.find((x) => x.id === m![1]);
      if (r) { r.status = b().status === 'dismissed' ? 'dismissed' : 'actioned'; this.log(this.auth(token), this.accounts.get(r.target) ?? null, r.status === 'dismissed' ? 'dismiss_report' : 'close_report', r.reason); }
      return { ok: true };
    }
    if (method === 'GET' && p === '/api/staff/platform') { this.staff(token); return this.platform; }
    if (method === 'POST' && p === '/api/staff/platform') {
      const s = this.staff(token);
      const before = this.platform;
      this.platform = mergePlatform(before, b());
      const changed = (Object.keys(this.platform) as (keyof PlatformSettings)[]).filter((k) => JSON.stringify(this.platform[k]) !== JSON.stringify(before[k]));
      if (changed.length) this.log(s, null, 'platform', changed.map((k) => `${k}: ${JSON.stringify(this.platform[k])}`).join(', '));
      return this.platform;
    }
    if (method === 'POST' && p === '/api/staff/updates') {
      const s = this.staff(token);
      let u;
      try { u = cleanUpdate(b()); } catch (e: any) { throw new HttpError(400, e.message); }
      this.updates.unshift({ id: randomId(9), ...u, at: Date.now(), by: s.username });
      this.log(s, null, 'post_update', u.title);
      return this.updates;
    }
    if (method === 'DELETE' && (m = /^\/api\/staff\/updates\/([^/]+)$/.exec(p))) {
      const s = this.staff(token);
      this.updates = this.updates.filter((u) => u.id !== m![1]);
      this.log(s, null, 'delete_update', m[1]);
      return this.updates;
    }
    if (method === 'POST' && p === '/api/staff/broadcast') {
      const s = this.staff(token);
      const msg = cleanText(String(b().message ?? ''), 500).trim();
      if (!msg) throw new HttpError(400, 'Write the notice first.');
      const n = { id: randomId(6), message: msg, at: Date.now(), kind: 'broadcast' as const };
      for (const a of this.accounts.values()) if (!a.banned) a.notices = [...a.notices, { ...n }].slice(-20);
      this.log(s, null, 'broadcast', msg.slice(0, 120));
      return { sent: this.accounts.size };
    }
    if (method === 'GET' && p === '/api/staff/stats') {
      this.staff(token);
      const all = [...this.accounts.values()];
      const now = Date.now();
      return {
        signups: Array.from({ length: 14 }, (_, k) => {
          const start = now - (13 - k) * DAY - (now % DAY);
          return { day: new Date(start).toISOString().slice(0, 10), n: all.filter((a) => a.createdAt >= start && a.createdAt < start + DAY).length };
        }),
        totals: {
          accounts: all.length, online: [...this.sockets.values()].filter((x) => x.size).length,
          activeToday: all.filter((a) => this.isOnline(a.id)).length, spaces: this.spaces.size,
          creditsInCirculation: all.reduce((n, a) => n + a.credits, 0),
          activeListings: this.econ.activeListings().length, sales: [...this.listings.values()].filter((l) => l.status === 'sold').length,
          lockdown: all.filter((a) => a.lockdown.enabled).length,
          openReports: this.reports.filter((r) => r.status === 'open').length,
          pendingClaims: this.claims.filter((c) => ['holding', 'pending_staff'].includes(c.status)).length,
        },
      };
    }
    if (method === 'POST' && p === '/api/staff/invites') {
      this.staff(token);
      const codes = Array.from({ length: Math.min(50, Number(b().count) || 5) }, () => randomId(6).toUpperCase().replace(/[-_]/g, 'X').slice(0, 8));
      for (const c of codes) this.invites.set(c, null);
      return { codes };
    }
    throw new HttpError(404, 'Not found.');
  }

  // ----------------------------------------------------------- economy
  listings = new Map<string, Listing>();
  econ: EconomyStore = {
    account: (id) => {
      const a = this.accounts.get(id);
      return a ? { id, username: a.username, credits: a.credits, createdAt: a.createdAt, lastUsernameChange: a.lastChange, flagged: a.flagged, banned: a.banned, staff: a.roles.includes('staff'), owned: a.owned } : null;
    },
    credit: (id, delta, reason) => {
      const a = this.accounts.get(id)!;
      if (a.credits + delta < 0) throw new HttpError(402, 'Not enough credits.');
      a.credits += delta;
      a.ledger.unshift({ delta, reason, at: Date.now() });
    },
    setOwned: (id, owned) => { this.accounts.get(id)!.owned = owned; },
    nameFree: (name, self) => { const x = this.byName(name); return (!x || x.id === self) && !this.held(name, self); },
    lockName: (name, owner, until) => this.locks.set(name, { owner, until }),
    unlockName: (name, owner) => { if (this.locks.get(name)?.owner === owner) this.locks.delete(name); },
    transferName: ({ sellerId, buyerId, name, fallback, now }) => {
      const sl = this.accounts.get(sellerId)!, by = this.accounts.get(buyerId)!;
      this.locks.delete(fallback);
      sl.previousUsername ??= sl.username; sl.username = fallback; sl.lastChange = now; sl.usernameChanges++;
      this.locks.set(by.username, { owner: by.id, until: now + OLD_NAME_LOCK_DAYS * DAY });
      by.previousUsername ??= by.username; by.username = name; by.lastChange = now; by.usernameChanges++;
      this.notifyPresence(sellerId); this.notifyPresence(buyerId);
    },
    getListing: (id) => this.listings.get(id) ?? null,
    saveListing: (l) => { this.listings.set(l.id, l); },
    activeListings: () => [...this.listings.values()].filter((l) => l.status === 'active'),
    newId: () => randomId(9),
  };
  private econRoute(method: string, p: string, url: URL, token: string | null, b: () => any): any {
    const me = this.auth(token);
    const wrap = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof EconomyError) throw new HttpError(e.status, e.message); throw e; } };
    const nameOf = (id: string) => this.accounts.get(id)?.username ?? null;
    const view = (l: Listing) => listingView(l, me.id, nameOf);
    wrap(() => settleDue(this.econ));
    if (method === 'GET' && p === '/api/shop') return { items: COSMETICS.map((c) => ({ ...c, owned: owns({ owned: me.owned, staff: me.roles.includes('staff') }, c.id) })), credits: me.credits, frame: me.frame, effect: me.effect, nameFx: me.nameFx, accessory: me.accessory };
    if (method === 'POST' && p === '/api/shop/buy') { this.marketGate(me, 'shop'); wrap(() => buyCosmetic(this.econ, me.id, String(b().item))); return { me: this.me(me) }; }
    if (method === 'GET' && p === '/api/me/ledger') return me.ledger.slice(0, 50);
    if (method === 'GET' && p === '/api/market') {
      let list = this.econ.activeListings();
      const kind = url.searchParams.get('kind'), q = (url.searchParams.get('q') ?? '').toLowerCase().replace(/^@/, ''), sort = url.searchParams.get('sort') ?? 'newest';
      if (kind === 'auction' || kind === 'fixed') list = list.filter((l) => l.kind === kind);
      if (q) list = list.filter((l) => l.name.includes(q));
      const price = (l: Listing) => (l.kind === 'fixed' ? l.price : Math.max(l.price, ...l.bids.map((x) => x.amount)));
      const sorters: Record<string, (x: Listing, y: Listing) => number> = {
        ending: (x, y) => (x.endsAt ?? Infinity) - (y.endsAt ?? Infinity), price_low: (x, y) => price(x) - price(y),
        price_high: (x, y) => price(y) - price(x), shortest: (x, y) => x.name.length - y.name.length || price(y) - price(x), newest: (x, y) => y.createdAt - x.createdAt,
      };
      list.sort(sorters[sort] ?? sorters.newest);
      const all = [...this.listings.values()];
      return {
        listings: list.map(view),
        recentSales: all.filter((l) => l.status === 'sold').sort((x, y) => (y.closedAt ?? 0) - (x.closedAt ?? 0)).slice(0, 10).map(view),
        mine: all.filter((l) => l.sellerId === me.id).sort((x, y) => y.createdAt - x.createdAt).slice(0, 10).map(view),
      };
    }
    if (method === 'POST' && p === '/api/market') { this.assertNotFrozen(me); this.marketGate(me, 'market'); return wrap(() => view(createListing(this.econ, me.id, b()))); }
    let m: RegExpExecArray | null;
    if ((m = /^\/api\/market\/([^/]+)(?:\/(bid|buy|cancel))?$/.exec(p))) {
      const id = m[1];
      if (method === 'GET' && !m[2]) { const l = this.listings.get(id); if (!l) throw new HttpError(404, 'Listing not found.'); return view(l); }
      if (method === 'POST' && (m[2] === 'bid' || m[2] === 'buy')) this.marketGate(me, 'market');
      if (method === 'POST' && m[2] === 'bid') return wrap(() => view(placeBid(this.econ, id, me.id, Number(b().amount))));
      if (method === 'POST' && m[2] === 'buy') return wrap(() => view(buyNow(this.econ, id, me.id)));
      if (method === 'POST' && m[2] === 'cancel') return wrap(() => view(cancelListing(this.econ, id, me.id)));
    }
    throw new HttpError(404, 'Not found.');
  }

  // ------------------------------------------------------------ spaces
  spaceProfile = (id: string) => {
    const a = this.accounts.get(id);
    if (!a) return null;
    return { id, username: a.username, displayName: a.displayName || a.username, avatar: a.avatar, accent: sanitizeTheme(a.theme).accent, presence: this.presenceOf(a) };
  };
  spaceView(d: SpaceDoc, viewer: string) { return viewFor(d, viewer, this.spaceProfile); }
  notifySpace(ids: string[], msg: object) { for (const id of ids) for (const s of this.sockets.get(id) ?? []) s.deliver(JSON.stringify(msg)); }
  private inviteCode = () => randomId(6).replace(/[-_]/g, 'x').slice(0, 8);
  createSpaceFor(owner: string, body: any): SpaceDoc {
    const d = createSpace({ id: randomId(9), kind: body.kind === 'group' ? 'group' : 'server', name: String(body.name ?? ''), ownerId: owner, icon: { emoji: body.emoji, color: body.color }, newId: () => randomId(9) });
    if (d.kind === 'group' && Array.isArray(body.members)) {
      const ids = body.members.map((u: string) => this.byName(canonicalize(String(u)))?.id).filter(Boolean);
      this.assertAddable(ids);
      applyOp(d, owner, { op: 'add_members', accountIds: ids }, { newId: () => randomId(9), inviteCode: this.inviteCode });
    }
    this.spaces.set(d.id, d);
    this.notifySpace(Object.keys(d.members).filter((m) => m !== owner), { t: 'space', id: d.id });
    return d;
  }
  private spaceRoute(method: string, p: string, token: string | null, b: () => any): any {
    const me = this.auth(token);
    const wrap = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof SpaceError) throw new HttpError(e.status, e.message); throw e; } };
    const mine = () => [...this.spaces.values()].filter((d) => d.members[me.id]);
    if (method === 'GET' && p === '/api/spaces') return mine().sort((x, y) => x.createdAt - y.createdAt).map((d) => this.spaceView(d, me.id));
    if (method === 'POST' && p === '/api/spaces') {
      if (this.raidBlocked(me)) throw new HttpError(403, "Raid mode is on: new accounts can't create servers or groups for their first day.");
      if (mine().length >= SPACE_LIMITS.spacesPerAccount) throw new HttpError(400, `You can be in up to ${SPACE_LIMITS.spacesPerAccount} servers and groups.`);
      return wrap(() => this.spaceView(this.createSpaceFor(me.id, b()), me.id));
    }
    if (method === 'POST' && p === '/api/spaces/join') {
      const code = String(b().code ?? '').trim().replace(/^.*\//, '');
      const d = [...this.spaces.values()].find((x) => x.invites.some((i) => i.code === code));
      if (!d) throw new HttpError(404, 'That invite is invalid or expired.');
      return wrap(() => { joinWithInvite(d, me.id, code); this.notifySpace(Object.keys(d.members), { t: 'space', id: d.id }); return this.spaceView(d, me.id); });
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/api\/spaces\/([^/]+)(\/op)?$/.exec(p))) {
      const d = this.spaces.get(m[1]);
      if (!d || !d.members[me.id]) throw new HttpError(404, 'Space not found.');
      if (method === 'GET' && !m[2]) return this.spaceView(d, me.id);
      if (method === 'POST' && m[2]) {
        return wrap(() => {
          const body = b();
          const before = Object.keys(d.members);
          let o = body;
          if (o.op === 'add_members' && Array.isArray(body.usernames)) {
            o = { op: 'add_members', accountIds: body.usernames.map((u: string) => this.byName(canonicalize(String(u)))?.id).filter(Boolean) };
            if (!o.accountIds.length) throw new HttpError(404, 'No accounts with those usernames.');
          }
          if (o.op === 'add_members') this.assertAddable(o.accountIds.filter((x: string) => !d.members[x]));
          const r = applyOp(d, me.id, o, { newId: () => randomId(9), inviteCode: this.inviteCode });
          if (r.deleted) { this.spaces.delete(d.id); this.notifySpace(before, { t: 'space_removed', id: d.id }); return { deleted: true }; }
          if (r.removed?.length) this.notifySpace(r.removed, { t: 'space_removed', id: d.id });
          this.notifySpace(Object.keys(d.members), { t: 'space', id: d.id });
          if (r.removed?.includes(me.id)) return { left: true };
          return this.spaceView(d, me.id);
        });
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  // ------------------------------------------------------------- staff
  detail(a: Acct) {
    const claim = this.claims.find((c) => c.accountId === a.id && ['holding', 'pending_staff'].includes(c.status));
    return {
      ...this.pub(a), createdAt: a.createdAt, marketBanned: a.marketBanned, roles: a.roles, grantedBadges: a.badges, earnedBadges: this.earned(a), hiddenBadges: a.hiddenBadges,
      house: a.house, supporterSince: a.supporterSince, boosterSince: a.boosterSince, previousUsername: a.previousUsername, originalUsername: a.originalUsername,
      banned: a.banned, bannedUntil: a.banned ? a.bannedUntil : null, banReason: a.banned ? a.banReason : null,
      mutedUntil: live(a.mutedUntil) ? a.mutedUntil : null, frozenUntil: live(a.frozenUntil) ? a.frozenUntil : null,
      discoveryLocked: a.discoveryLocked, flaggedNetwork: a.flagged, activeDays: a.activeDays, usernameChanges: a.usernameChanges,
      lastUsernameChange: a.lastChange, pendingClaim: claim ? { name: claim.name, status: claim.status } : null,
      sessions: [...this.sessions.values()].filter((x) => x === a.id).length, unackedWarnings: a.notices.filter((n) => !n.ack).length,
      reports: this.reports.filter((r) => r.target === a.id).map((r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, reporter: this.accounts.get(r.reporter)?.username ?? null, createdAt: r.createdAt })),
      audit: this.auditByTarget.get(a.id) ?? [],
      credits: a.credits, ownedCosmetics: a.owned, titles: a.titles,
      activeListing: [...this.listings.values()].find((l) => l.sellerId === a.id && l.status === 'active') ?? null,
      ledger: a.ledger.slice(0, 15),
    };
  }
  staffAction(s: Acct, id: string, body: any) {
    const t = this.accounts.get(id);
    if (!t) throw new HttpError(404, 'Account not found.');
    const action = String(body.action ?? '');
    const def = STAFF_ACTIONS.find((d) => d.id === action);
    const txt = (v: unknown, n = 300) => cleanText(String(v ?? ''), n).trim();
    if (def) {
      for (const p of def.params) if ('required' in p && p.required && !txt(body[p.key])) throw new HttpError(400, `${p.label} is required.`);
      if (def.danger && t.id === s.id) throw new HttpError(400, "You can't do that to your own account.");
      if (def.danger && t.roles.includes('staff') && !s.roles.includes('founder')) throw new HttpError(403, 'Only founders can do that to staff accounts.');
    }
    const reason = txt(body.reason, 200);
    const dur = (['1h', '1d', '7d', '30d', 'permanent'].includes(body.duration) ? body.duration : '1d') as Duration;
    const kick = () => { for (const [tok, aid] of this.sessions) if (aid === t.id) this.sessions.delete(tok); for (const k of [...(this.sockets.get(t.id) ?? [])]) k.close(); };
    const date = (v: unknown) => { if (!v) return null; const d = Date.parse(String(v)); if (!Number.isFinite(d) || d > Date.now()) throw new HttpError(400, 'Pick a date in the past.'); return d; };
    let detail = reason;
    switch (action) {
      case 'warn': detail = txt(body.message, 500); t.notices.push({ id: randomId(6), message: detail, at: Date.now() }); break;
      case 'suspend': t.banned = true; t.bannedUntil = dur === 'permanent' ? null : durationUntil(dur); t.banReason = reason; kick(); detail = `${dur}: ${reason}`; break;
      case 'unsuspend': t.banned = false; t.bannedUntil = null; t.banReason = null; break;
      case 'delete_account': kick(); this.locks.set(t.username, { owner: 'deleted', until: Date.now() + OLD_NAME_LOCK_DAYS * DAY }); this.accounts.delete(t.id); detail = `@${t.username}: ${reason}`; break;
      case 'mute': t.mutedUntil = durationUntil(dur); t.muteReason = reason || null; detail = dur + (reason ? `: ${reason}` : ''); break;
      case 'unmute': t.mutedUntil = null; t.muteReason = null; break;
      case 'freeze_profile': t.frozenUntil = durationUntil(dur); t.freezeReason = reason || null; detail = dur + (reason ? `: ${reason}` : ''); break;
      case 'unfreeze_profile': t.frozenUntil = null; t.freezeReason = null; break;
      case 'reset_display_name': detail = t.displayName; t.displayName = ''; break;
      case 'reset_bio': detail = t.bio; t.bio = ''; break;
      case 'reset_status': detail = t.customStatus; t.customStatus = ''; break;
      case 'reset_theme': t.theme = DEFAULT_THEME; break;
      case 'remove_avatar': t.avatar = null; break;
      case 'remove_banner': t.banner = null; break;
      case 'remove_background': t.background = null; break;
      case 'hide_from_discovery': t.discoveryLocked = true; t.privacy = { ...t.privacy, discoverable: false }; break;
      case 'allow_discovery': t.discoveryLocked = false; break;
      case 'rename': {
        const n = canonicalize(String(body.username));
        if (!USERNAME_RE.test(n) || n.length > 24) throw new HttpError(400, 'Use 1–24 characters: a–z, 0–9, _.');
        if (checkUsername(n).reason === 'slur') throw new HttpError(400, 'That name is on the slur list.');
        if (this.byName(n) && this.byName(n) !== t) throw new HttpError(409, 'Someone already has that username.');
        detail = `@${t.username} → @${n}: ${reason}`;
        this.rename(t, n);
        break;
      }
      case 'reserve_name': {
        const n = canonicalize(String(body.username));
        if (!USERNAME_RE.test(n) || n.length > 24) throw new HttpError(400, 'Use 1–24 characters: a–z, 0–9, _.');
        if (this.byName(n)) throw new HttpError(409, 'Someone already has that username.');
        const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
        this.locks.set(n, { owner: 'staff', until: days ? Date.now() + days * DAY : Number.MAX_SAFE_INTEGER });
        detail = `@${n} for ${days ? `${days} days` : 'ever'}`;
        break;
      }
      case 'clear_cooldown': t.lastChange = null; break;
      case 'cancel_claim': for (const c of this.claims) if (c.accountId === t.id && ['holding', 'pending_staff'].includes(c.status)) c.status = 'cancelled'; break;
      case 'force_logout': kick(); break;
      case 'flag_network': t.flagged = true; break;
      case 'unflag_network': t.flagged = false; break;
      case 'add_note': detail = txt(body.note, 500); break;
      case 'grant_badge': case 'revoke_badge': {
        const bd = String(body.badge);
        if (!GRANTABLE.includes(bd)) throw new HttpError(400, "That badge can't be granted by hand.");
        t.badges = action === 'grant_badge' ? [...new Set([...t.badges, bd])] : t.badges.filter((x) => x !== bd);
        detail = BADGES[bd].label;
        break;
      }
      case 'set_supporter': t.supporterSince = date(body.date); detail = t.supporterSince ? new Date(t.supporterSince).toISOString().slice(0, 10) : 'removed'; break;
      case 'set_booster': t.boosterSince = date(body.date); detail = t.boosterSince ? new Date(t.boosterSince).toISOString().slice(0, 10) : 'removed'; break;
      case 'set_house': {
        const h = body.house || null;
        if (h && !(HOUSES as readonly string[]).includes(h)) throw new HttpError(400, 'Unknown house.');
        t.house = h; detail = h ?? 'none'; break;
      }
      case 'set_roles': {
        if (!s.roles.includes('founder')) throw new HttpError(403, 'Only founders can change roles.');
        t.roles = (Array.isArray(body.roles) ? body.roles : []).filter((r: string) => ['staff', 'developer', 'founder'].includes(r));
        detail = t.roles.join(', ') || 'none';
        break;
      }
      case 'grant_credits': {
        const amt = Math.trunc(Number(body.amount));
        if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1_000_000) throw new HttpError(400, 'Amount must be between -1,000,000 and 1,000,000.');
        if (amt < 0 && t.credits + amt < 0) throw new HttpError(400, `They only have ${t.credits} credits.`);
        this.econ.credit(t.id, amt, `${amt > 0 ? 'Gift' : 'Adjustment'} from staff${reason ? `: ${reason}` : ''}`);
        detail = `${amt > 0 ? '+' : ''}${amt}${reason ? `: ${reason}` : ''}`;
        break;
      }
      case 'set_titles': {
        try { t.titles = (Array.isArray(body.titles) ? body.titles : []).slice(0, MAX_TITLES).map(cleanTitle); }
        catch (e) { if (e instanceof EconomyError) throw new HttpError(e.status, e.message); throw e; }
        detail = t.titles.map((x) => x.name).join(', ') || 'none';
        break;
      }
      case 'grant_cosmetic': case 'revoke_cosmetic': {
        const item = COSMETIC_BY_ID[String(body.item)];
        if (!item || item.staffOnly) throw new HttpError(400, 'Unknown item.');
        t.owned = action === 'grant_cosmetic' ? [...new Set([...t.owned, item.id])] : t.owned.filter((x) => x !== item.id);
        if (action === 'revoke_cosmetic' && t[item.kind] === item.id) t[item.kind] = null;
        detail = item.name;
        break;
      }
      case 'reset_cosmetics': t.frame = null; t.effect = null; t.nameFx = null; t.accessory = null; break;
      case 'market_ban': {
        t.marketBanned = true;
        const l = [...this.listings.values()].find((x) => x.sellerId === t.id && x.status === 'active');
        if (l) cancelListing(this.econ, l.id, s.id, true);
        for (const x of this.econ.activeListings()) {
          const top = x.bids.reduce<any>((mx, bd) => (!mx || bd.amount > mx.amount ? bd : mx), null);
          if (top?.bidderId === t.id) { this.econ.credit(t.id, top.amount, `Refund: marketplace access removed (@${x.name})`); x.bids = []; }
        }
        break;
      }
      case 'market_unban': t.marketBanned = false; break;
      case 'remove_listing': {
        const l = [...this.listings.values()].find((x) => x.sellerId === t.id && x.status === 'active');
        if (!l) throw new HttpError(404, 'No active listing.');
        cancelListing(this.econ, l.id, s.id, true);
        break;
      }
      default: throw new HttpError(400, 'Unknown action.');
    }
    this.log(s, action === 'delete_account' ? null : t, action, detail);
    this.notifyPresence(t.id);
  }

  // ------------------------------------------------------------- relay
  notifyPresence(id: string) {
    const a = this.accounts.get(id);
    if (!a) return;
    const msg = JSON.stringify({ t: 'presence', id, presence: this.presenceOf(a), customStatus: this.statusText(a) });
    for (const s of this.watchers.get(id) ?? []) s.deliver(msg);
  }
  attach(sock: MockSocket, raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (!sock.accountId) {
      const id = m.t === 'auth' ? this.sessions.get(m.token) : undefined;
      const a = id ? this.accounts.get(id) : undefined;
      if (!a || a.banned) return sock.close();
      sock.accountId = a.id;
      sock.token = m.token;
      if (!this.sockets.has(a.id)) this.sockets.set(a.id, new Set());
      this.sockets.get(a.id)!.add(sock);
      sock.deliver(JSON.stringify({ t: 'ready', id: a.id }));
      this.notifyPresence(a.id);
      return;
    }
    const from = sock.accountId;
    if (m.t === 'send') {
      const ack = (ok: boolean, reason?: string) => sock.deliver(JSON.stringify({ t: 'ack', id: m.id, ok, reason }));
      const to = this.accounts.get(m.to);
      if (!to || to.banned) return ack(false, 'unknown');
      if (live(this.accounts.get(from)?.mutedUntil ?? null)) return ack(false, 'muted');
      if (to.privacy.whoCanMessage === 'nobody') return ack(false, 'not_accepting');
      if (this.raidBlocked(this.accounts.get(from))) return ack(false, 'raid');
      const set = this.sockets.get(m.to);
      if (!set?.size) return ack(false, 'offline');
      // Only the opaque, end-to-end encrypted envelope passes through. Nothing is kept.
      for (const s of set) s.deliver(JSON.stringify({ t: 'msg', from, id: m.id, env: m.env }));
      this.lastRelayed = { from, to: m.to, env: m.env, at: Date.now() };
      return ack(true);
    }
    if (m.t === 'gsend') {
      const ack = (ok: boolean, extra: object = {}) => sock.deliver(JSON.stringify({ t: 'ack', id: m.id, ok, ...extra }));
      if (live(this.accounts.get(from)?.mutedUntil ?? null)) return ack(false, { reason: 'muted' });
      if (this.raidBlocked(this.accounts.get(from))) return ack(false, { reason: 'raid' });
      const d = this.spaces.get(m.space);
      const ch = d?.channels.find((c) => c.id === m.channel);
      if (!d || !ch || !canSendIn(d, from, ch)) return ack(false, { reason: 'forbidden' });
      const allowed = new Set(recipientsOf(d, from, ch));
      let delivered = 0, offline = 0;
      for (const [to, env] of Object.entries(m.envs ?? {})) {
        if (!allowed.has(to)) continue;
        const set = this.sockets.get(to);
        if (!set?.size) { offline++; continue; }
        for (const s of set) s.deliver(JSON.stringify({ t: 'msg', from, id: m.id, env, ctx: { space: d.id, channel: ch.id } }));
        delivered++;
        this.lastRelayed = { from, to, env: env as string, at: Date.now() };
      }
      return ack(true, { delivered, offline });
    }
    if (m.t === 'signal') {
      for (const s of this.sockets.get(m.to) ?? []) s.deliver(JSON.stringify({ t: 'signal', from, data: m.data }));
      return;
    }
    if (m.t === 'watch' && Array.isArray(m.ids)) {
      for (const old of sock.watching) this.watchers.get(old)?.delete(sock);
      sock.watching = new Set(m.ids);
      for (const id of sock.watching) {
        if (!this.watchers.has(id)) this.watchers.set(id, new Set());
        this.watchers.get(id)!.add(sock);
        const a = this.accounts.get(id);
        if (a) sock.deliver(JSON.stringify({ t: 'presence', id, presence: this.presenceOf(a), customStatus: this.statusText(a) }));
      }
    }
  }
  detach(sock: MockSocket) {
    if (!sock.accountId) return;
    this.sockets.get(sock.accountId)?.delete(sock);
    for (const id of sock.watching) this.watchers.get(id)?.delete(sock);
    this.notifyPresence(sock.accountId);
  }
  /** The last thing the relay saw, so the demo can show exactly what the server handles. */
  lastRelayed: { from: string; to: string; env: string; at: number } | null = null;

  /** WebSocket class bound to this server, passed to SigilCore as WebSocketImpl. */
  socketClass(): typeof WebSocket {
    const server = this;
    return class extends MockSocket { constructor() { super(server); } } as any;
  }
}

export class MockSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  accountId: string | null = null;
  token: string | null = null;
  watching = new Set<string>();
  constructor(private server: MockServer) {
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 30);
  }
  send(data: string) {
    if (this.readyState !== 1) return;
    setTimeout(() => this.server.attach(this, data), 15 + Math.random() * 40);
  }
  deliver(data: string) {
    if (this.readyState !== 1) return;
    setTimeout(() => this.onmessage?.({ data }), 15 + Math.random() * 40);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.server.detach(this);
    setTimeout(() => this.onclose?.(), 0);
  }
}

function dataUrl(b: Uint8Array, type: string): string {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

function sniff(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (/^GIF8[79]a$/.test(s(0, 6))) return 'image/gif';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

export { concat };
