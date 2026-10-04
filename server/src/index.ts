import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, DAY, dayKey } from './config';
import { db, one, all, run, type Row } from './db';
import {
  ApiError, toMe, toPublicProfile, privacyOf, checkForAccount, claimUsername, cancelClaim,
  finalizeHolds, decideClaim, rareFeed, isStaff, rolesOf, parse, newId, touchActivity,
  liftExpired, suspendedMessage, assertNotFrozen, isFrozen, earnedOf,
} from './accounts';
import { applyStaffAction, staffDetail, listAccounts, recentAudit, audit } from './staff';
import * as spaces from './spaces';
import * as econ from './economy';
import { setDailyBonusHook } from './accounts';
setDailyBonusHook(econ.dailyBonus);
import { HOUSES } from '../../shared/badges';
import {
  newChallenge, register, login, accountForToken, revokeToken, setSignedPrekey, makeInviteCodes,
  consumeChallenge, listSessions, revokeSession, revokeOtherSessions,
} from './auth';
import { platform, setPlatform, listUpdates, postUpdate, deleteUpdate } from './platform';
import { lockdownOf, statusTextOf } from './accounts';
import { hasPublicPage } from '../../shared/lockdown';
import { mergePrivacy } from '../../shared/types';
import { COSMETIC_SLOTS, type CosmeticSlot } from '../../shared/economy';
import { LATEST_VERSION } from '../../shared/changelog';
import { clientIp, fingerprint, hit, LIMITS, loadNetworkFlags } from './abuse';
import { processUpload, deleteMedia, mediaPath } from './media';
import { handleUpgrade, notifyPresence, disconnectAccount, disconnectSessions, onlineCount } from './relay';
import { profilePage, notFoundPage, landingPage } from './publicPage';
import { canonicalize, USERNAME_RE, OLD_NAME_LOCK_DAYS } from '../../shared/usernames';
import { sanitizeTheme } from '../../shared/theme';
import { cleanText, BIO_MAX, DISPLAY_NAME_MAX, CUSTOM_STATUS_MAX } from '../../shared/markdown';
import { GRANTABLE } from '../../shared/badges';
import { DEFAULT_PRIVACY, type Privacy } from '../../shared/types';

loadNetworkFlags();

// ------------------------------------------------------------------ plumbing

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; ip: string; params: Record<string, string> };
type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
function route(method: string, pattern: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, h });
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw new ApiError(413, 'Request too large.');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
async function json(ctx: Ctx): Promise<any> {
  const b = await readBody(ctx.req, 64 * 1024);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw new ApiError(400, 'Invalid JSON.'); }
}
function bearer(ctx: Ctx): string | null {
  const h = ctx.req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}
function auth(ctx: Ctx, optional = false): Row {
  const t = bearer(ctx);
  const a = t ? accountForToken(t) : undefined;
  if (!a) { if (optional) return null as any; throw new ApiError(401, 'Sign in required.'); }
  const fresh = liftExpired(a);
  if (fresh.banned) throw new ApiError(403, suspendedMessage(fresh), 'banned');
  return fresh;
}
function staff(ctx: Ctx): Row {
  const a = auth(ctx);
  if (!isStaff(a)) throw new ApiError(403, 'Staff only.');
  return a;
}
const reload = (id: string) => one('SELECT * FROM accounts WHERE id = ?', id)!;

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'interest-cohort=()',
    ...extra,
  });
  res.end(body);
}
const HTML_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// --------------------------------------------------------------------- auth

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/config', () => {
  const p = platform();
  return {
    inviteOnly: p.signups === 'invite', signups: p.signups, banner: p.banner, marketPaused: p.marketPaused, shopPaused: p.shopPaused,
    raidMode: p.raidMode, iceServers: config.iceServers, origin: config.publicOrigin, version: LATEST_VERSION,
  };
});
route('GET', '/api/updates', () => listUpdates());
route('POST', '/api/auth/challenge', () => ({ nonce: newChallenge() }));
route('POST', '/api/auth/register', async (ctx) => register(await json(ctx), ctx.ip));
route('POST', '/api/auth/login', async (ctx) => login(await json(ctx), ctx.ip));
route('POST', '/api/auth/logout', (ctx) => { const t = bearer(ctx); if (t) revokeToken(t); return { ok: true }; });

// ----------------------------------------------------------------- username

route('GET', '/api/username/check', (ctx) => {
  const ipHash = fingerprint('ip', ctx.ip);
  if (!hit('ucheck', ipHash, LIMITS.usernameCheck.limit, LIMITS.usernameCheck.window)) throw new ApiError(429, 'Slow down.');
  finalizeHolds();
  return checkForAccount(ctx.url.searchParams.get('name') ?? '', auth(ctx, true), ipHash);
});
route('POST', '/api/username/claim', async (ctx) => {
  const a = auth(ctx);
  const body = await json(ctx);
  assertNotFrozen(a);
  const r = claimUsername(a, String(body.name ?? ''), fingerprint('ip', ctx.ip));
  return { ...r, me: toMe(reload(a.id)) };
});
route('POST', '/api/username/cancel', (ctx) => { const a = auth(ctx); cancelClaim(a); return { me: toMe(reload(a.id)) }; });
route('GET', '/api/rare', () => rareFeed());

// ------------------------------------------------------------------ profile

route('GET', '/api/me', (ctx) => { finalizeHolds(); const a = auth(ctx); touchActivity(a); return toMe(reload(a.id)); });

route('PATCH', '/api/me', async (ctx) => {
  const a = auth(ctx);
  const b = await json(ctx);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  const slots = Object.keys(COSMETIC_SLOTS) as CosmeticSlot[];
  if (['displayName', 'bio', 'customStatus', 'theme', 'pronouns', 'links', ...slots].some((k) => b[k] !== undefined)) assertNotFrozen(a);
  for (const slot of slots) if (b[slot] !== undefined) econ.equip(a, slot, b[slot]);
  if (typeof b.pronouns === 'string') set('pronouns', cleanText(b.pronouns, 24).replace(/\n/g, ' ').trim());
  if (Array.isArray(b.links)) {
    const links = b.links.slice(0, 3).map((l: any) => {
      const label = cleanText(String(l?.label ?? ''), 24).replace(/\n/g, ' ').trim();
      let url: URL;
      try { url = new URL(String(l?.url ?? '')); } catch { throw new ApiError(400, 'Links must be full https:// addresses.'); }
      if (url.protocol !== 'https:' || url.href.length > 200) throw new ApiError(400, 'Links must be https:// and under 200 characters.');
      return { label: label || url.hostname.replace(/^www\./, ''), url: url.href };
    });
    set('links_json', JSON.stringify(links));
  }
  if (Array.isArray(b.hiddenBadges)) {
    const earned = new Set(earnedOf(a));
    set('hidden_badges_json', JSON.stringify([...new Set(b.hiddenBadges.filter((x: unknown) => earned.has(x as string)))]));
  }
  if (b.house !== undefined) {
    if (b.house !== null && !(HOUSES as readonly string[]).includes(b.house)) throw new ApiError(400, 'Unknown house.');
    set('house', b.house);
  }
  if (typeof b.displayName === 'string') set('display_name', cleanText(b.displayName, DISPLAY_NAME_MAX).replace(/\n/g, ' ').trim());
  if (typeof b.bio === 'string') set('bio', cleanText(b.bio, BIO_MAX));
  if (typeof b.customStatus === 'string') set('custom_status', cleanText(b.customStatus, CUSTOM_STATUS_MAX).replace(/\n/g, ' '));
  if (['online', 'idle', 'dnd', 'invisible'].includes(b.status)) set('status', b.status);
  if (b.theme !== undefined) set('theme_json', JSON.stringify(sanitizeTheme(b.theme)));
  if (b.privacy && typeof b.privacy === 'object') {
    const p: Privacy = mergePrivacy(privacyOf(a), b.privacy);
    if (a.discovery_locked) p.discoverable = false;
    // Lockdown Mode: strangers can't open a conversation
    if (lockdownOf(a).enabled && p.whoCanMessage === 'everyone') p.whoCanMessage = 'friends';
    set('privacy_json', JSON.stringify(p));
  }
  if (sets.length) run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, ...vals, a.id);
  notifyPresence(a.id);
  return toMe(reload(a.id));
});

route('POST', '/api/me/keys', async (ctx) => {
  const a = auth(ctx);
  const b = await json(ctx);
  setSignedPrekey(a, String(b.spk), Number(b.spkId), String(b.spkSig));
  return { ok: true };
});

// Lockdown Mode. Turning it on is instant; anything that weakens it needs a
// fresh signature from the identity key, so a stolen session token alone can't.
route('POST', '/api/me/lockdown', async (ctx) => {
  const a = auth(ctx);
  const b = await json(ctx);
  const cur = lockdownOf(a);
  const enabled = typeof b.enabled === 'boolean' ? b.enabled : cur.enabled;
  const allowRequests = typeof b.allowRequests === 'boolean' ? b.allowRequests : cur.allowRequests;
  const weakens = (cur.enabled && !enabled) || (enabled && allowRequests && !cur.allowRequests && cur.enabled);
  if (weakens) consumeChallenge(String(b.nonce ?? ''), a.ed_pub, String(b.sig ?? ''), 'lockdown');
  const next = { enabled, allowRequests: enabled ? allowRequests : false, since: enabled ? (cur.enabled ? cur.since : Date.now()) : null };
  run('UPDATE accounts SET lockdown_json = ? WHERE id = ?', JSON.stringify(next), a.id);
  if (enabled && !cur.enabled) {
    const p = privacyOf(a);
    if (p.whoCanMessage === 'everyone') run('UPDATE accounts SET privacy_json = ? WHERE id = ?', JSON.stringify({ ...p, whoCanMessage: 'friends' }), a.id);
    disconnectSessions(a.id, revokeOtherSessions(a.id, a._sid ?? null));
  }
  notifyPresence(a.id);
  return toMe(reload(a.id));
});

// Devices: where you're signed in. Labels are chosen by the client ("Chrome on macOS"); no IPs are kept.
route('GET', '/api/me/sessions', (ctx) => { const a = auth(ctx); return listSessions(a.id, a._sid ?? null); });
route('DELETE', '/api/me/sessions/:sid', (ctx) => {
  const a = auth(ctx);
  revokeSession(a.id, ctx.params.sid);
  disconnectSessions(a.id, [ctx.params.sid]);
  return listSessions(a.id, a._sid ?? null);
});
route('POST', '/api/me/sessions/revoke-others', (ctx) => {
  const a = auth(ctx);
  disconnectSessions(a.id, revokeOtherSessions(a.id, a._sid ?? null));
  return listSessions(a.id, a._sid ?? null);
});

// Everything the server holds about you. (Messages aren't here because the server never had them.)
route('GET', '/api/me/export', (ctx) => {
  const a = auth(ctx);
  const { _sid, _seen, ...row } = a;
  return {
    exportedAt: new Date().toISOString(),
    note: 'This is every record Sigil\'s server keeps about your account. Message content, contacts, blocks and chat history are never sent to the server, so they are not here.',
    account: { ...row, ed_pub: a.ed_pub, x_pub: a.x_pub },
    sessions: listSessions(a.id, _sid ?? null),
    usernameClaims: all('SELECT name, tier, status, created_at, available_at FROM claim_requests WHERE account_id = ?', a.id),
    usernameLocksHeldForYou: all('SELECT name, until FROM username_locks WHERE owner_id = ?', a.id),
    invitesYouCreated: all('SELECT code, used_by IS NOT NULL AS used, created_at FROM invites WHERE created_by = ?', a.id),
    reportsYouFiled: all('SELECT reason, details, created_at, status FROM reports WHERE reporter_id = ?', a.id),
    creditLedger: all('SELECT delta, reason, at FROM credit_ledger WHERE account_id = ? ORDER BY at', a.id),
    marketListings: all('SELECT data_json FROM listings WHERE seller_id = ?', a.id).map((r) => JSON.parse(r.data_json)),
    spaces: spaces.mySpaces(a.id).map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    staffActionsOnYourAccount: all("SELECT action, at FROM staff_audit WHERE target_id = ? AND action != 'add_note' ORDER BY at", a.id),
  };
});

const SLOTS = ['avatar', 'banner', 'background'] as const;
route('PUT', '/api/me/media/:slot', async (ctx) => {
  const a = auth(ctx);
  const slot = ctx.params.slot as (typeof SLOTS)[number];
  if (!SLOTS.includes(slot)) throw new ApiError(404, 'Unknown slot.');
  assertNotFrozen(a);
  if (!hit('upload', a.id, LIMITS.uploadsPerAccount.limit, LIMITS.uploadsPerAccount.window)) throw new ApiError(429, 'Too many uploads. Try again later.');
  const buf = await readBody(ctx.req, config[slot].maxBytes + 1);
  const file = await processUpload(slot, buf);
  deleteMedia(a[slot]);
  run(`UPDATE accounts SET ${slot} = ? WHERE id = ?`, file, a.id);
  return toMe(reload(a.id));
});
route('DELETE', '/api/me/media/:slot', (ctx) => {
  const a = auth(ctx);
  const slot = ctx.params.slot as (typeof SLOTS)[number];
  if (!SLOTS.includes(slot)) throw new ApiError(404, 'Unknown slot.');
  assertNotFrozen(a);
  deleteMedia(a[slot]);
  run(`UPDATE accounts SET ${slot} = NULL WHERE id = ?`, a.id);
  return toMe(reload(a.id));
});

route('POST', '/api/me/notices/:id/ack', (ctx) => {
  const a = auth(ctx);
  const notices = parse<any[]>(a.notices_json, []).map((n) => (n.id === ctx.params.id ? { ...n, ack: true } : n));
  run('UPDATE accounts SET notices_json = ? WHERE id = ?', JSON.stringify(notices), a.id);
  return toMe(reload(a.id));
});

route('DELETE', '/api/me', (ctx) => {
  const a = auth(ctx);
  for (const s of SLOTS) deleteMedia(a[s]);
  run('INSERT OR REPLACE INTO username_locks (name, owner_id, until) VALUES (?, ?, ?)', a.username, 'deleted', Date.now() + OLD_NAME_LOCK_DAYS * DAY);
  disconnectAccount(a.id);
  run('DELETE FROM accounts WHERE id = ?', a.id);
  return { ok: true };
});

route('GET', '/api/u/:username', (ctx) => {
  const viewer = auth(ctx, true);
  const name = canonicalize(decodeURIComponent(ctx.params.username));
  const a = one('SELECT * FROM accounts WHERE username = ? AND banned = 0', name);
  if (!a || (!privacyOf(a).discoverable && viewer?.id !== a.id && !(viewer && isStaff(viewer)))) throw new ApiError(404, 'No profile with that username.');
  return toPublicProfile(a);
});
// By opaque id: used by clients to fetch keys for someone who messaged them.
route('GET', '/api/id/:id', (ctx) => {
  auth(ctx);
  const a = one('SELECT * FROM accounts WHERE id = ? AND banned = 0', ctx.params.id);
  if (!a) throw new ApiError(404, 'Unknown account.');
  return toPublicProfile(a);
});

route('POST', '/api/report', async (ctx) => {
  const a = auth(ctx);
  const b = await json(ctx);
  if (!hit('report', a.id, LIMITS.reportsPerAccount.limit, LIMITS.reportsPerAccount.window)) throw new ApiError(429, 'Too many reports today.');
  const reasons = ['username', 'avatar', 'banner', 'bio', 'impersonation', 'spam', 'harassment', 'other'];
  if (!reasons.includes(b.reason)) throw new ApiError(400, 'Pick a reason.');
  if (!one('SELECT 1 FROM accounts WHERE id = ?', String(b.targetId))) throw new ApiError(404, 'Unknown account.');
  run('INSERT INTO reports (id, reporter_id, target_id, reason, details, created_at) VALUES (?,?,?,?,?,?)',
    newId(), a.id, String(b.targetId), b.reason, cleanText(String(b.details ?? ''), 500), Date.now());
  return { ok: true };
});

// ------------------------------------------------------- shop + marketplace

/** Shop and marketplace access: platform pauses (staff exempt) and per-account bans. */
function marketGate(a: Row, which: 'market' | 'shop') {
  const p = platform();
  if (a.market_banned) throw new ApiError(403, 'Staff removed your marketplace access.', 'market_banned');
  if (!isStaff(a) && (which === 'market' ? p.marketPaused : p.shopPaused)) throw new ApiError(503, which === 'market' ? 'The marketplace is paused for maintenance. Your listings and bids are safe.' : 'The shop is closed for a moment. Try again soon.', 'paused');
}

route('GET', '/api/shop', (ctx) => econ.shop(auth(ctx)));
route('POST', '/api/shop/buy', async (ctx) => { const a = auth(ctx); marketGate(a, 'shop'); econ.buyItem(a, String((await json(ctx)).item ?? '')); return { ...econ.shop(reload(a.id)), me: toMe(reload(a.id)) }; });
route('GET', '/api/me/ledger', (ctx) => econ.ledger(auth(ctx).id));
route('GET', '/api/market', (ctx) => econ.market(auth(ctx).id, { kind: ctx.url.searchParams.get('kind') ?? '', sort: ctx.url.searchParams.get('sort') ?? '', search: ctx.url.searchParams.get('q') ?? '' }));
route('POST', '/api/market', async (ctx) => { const a = auth(ctx); assertNotFrozen(a); marketGate(a, 'market'); return econ.create(a.id, await json(ctx)); });
route('GET', '/api/market/:id', (ctx) => econ.getListing(auth(ctx).id, ctx.params.id));
route('POST', '/api/market/:id/bid', async (ctx) => { const a = auth(ctx); marketGate(a, 'market'); return econ.bid(a.id, ctx.params.id, Number((await json(ctx)).amount)); });
route('POST', '/api/market/:id/buy', (ctx) => { const a = auth(ctx); marketGate(a, 'market'); return econ.buy(a.id, ctx.params.id); });
route('POST', '/api/market/:id/cancel', (ctx) => econ.cancel(auth(ctx).id, ctx.params.id));

// ------------------------------------------------------------------- spaces

route('GET', '/api/spaces', (ctx) => spaces.mySpaces(auth(ctx).id));
route('POST', '/api/spaces', async (ctx) => spaces.create(auth(ctx).id, await json(ctx)));
route('POST', '/api/spaces/join', async (ctx) => spaces.join(auth(ctx).id, String((await json(ctx)).code ?? '')));
route('GET', '/api/spaces/:id', (ctx) => spaces.getSpace(ctx.params.id, auth(ctx).id));
route('POST', '/api/spaces/:id/op', async (ctx) => spaces.op(auth(ctx).id, ctx.params.id, await json(ctx)));

// -------------------------------------------------------------------- staff

route('GET', '/api/staff/overview', (ctx) => {
  staff(ctx);
  finalizeHolds();
  const claims = all(`SELECT c.*, a.username AS current, a.created_at AS acct_created FROM claim_requests c JOIN accounts a ON a.id = c.account_id
                      WHERE c.status IN ('holding','pending_staff') ORDER BY c.created_at`);
  const reports = all(`SELECT r.*, t.username AS target_username, p.username AS reporter_username FROM reports r
                       LEFT JOIN accounts t ON t.id = r.target_id LEFT JOIN accounts p ON p.id = r.reporter_id
                       WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 100`);
  return {
    stats: { accounts: one('SELECT count(*) n FROM accounts')!.n, online: onlineCount(), openReports: reports.length,
      suspended: one('SELECT count(*) n FROM accounts WHERE banned = 1')!.n, muted: one('SELECT count(*) n FROM accounts WHERE muted_until > ?', Date.now())!.n },
    audit: recentAudit().slice(0, 25),
    claims: claims.map((c) => ({ id: c.id, name: c.name, tier: c.tier, status: c.status, current: c.current, accountId: c.account_id, createdAt: c.created_at, availableAt: c.available_at, accountCreated: c.acct_created })),
    reports: reports.map((r) => ({ id: r.id, reason: r.reason, details: r.details, createdAt: r.created_at, targetId: r.target_id, target: r.target_username, reporter: r.reporter_username })),
  };
});
route('POST', '/api/staff/claims/:id', async (ctx) => {
  const s = staff(ctx);
  const b = await json(ctx);
  const c = one('SELECT name, account_id FROM claim_requests WHERE id = ?', ctx.params.id);
  decideClaim(s, ctx.params.id, !!b.approve);
  if (c) audit(s.id, c.account_id, b.approve ? 'approve_claim' : 'deny_claim', `@${c.name}`);
  return { ok: true };
});
route('GET', '/api/staff/accounts', (ctx) => {
  staff(ctx);
  return listAccounts((ctx.url.searchParams.get('q') ?? '').slice(0, 30), ctx.url.searchParams.get('filter') ?? '');
});
route('GET', '/api/staff/accounts/:id', (ctx) => {
  staff(ctx);
  const a = one('SELECT * FROM accounts WHERE id = ?', ctx.params.id);
  if (!a) throw new ApiError(404, 'Not found.');
  return staffDetail(liftExpired(a));
});
route('POST', '/api/staff/accounts/:id/action', async (ctx) => {
  const s = staff(ctx);
  applyStaffAction(s, ctx.params.id, await json(ctx));
  const a = one('SELECT * FROM accounts WHERE id = ?', ctx.params.id);
  return a ? staffDetail(a) : { deleted: true };
});
route('GET', '/api/staff/audit', (ctx) => { staff(ctx); return recentAudit(); });
route('GET', '/api/staff/lookup', (ctx) => {
  staff(ctx);
  const a = one('SELECT * FROM accounts WHERE username = ?', canonicalize(ctx.url.searchParams.get('username') ?? ''));
  if (!a) throw new ApiError(404, 'Not found.');
  return staffDetail(liftExpired(a));
});
route('POST', '/api/staff/accounts/:id', async (ctx) => {
  const s = staff(ctx);
  const b = await json(ctx);
  const a = one('SELECT * FROM accounts WHERE id = ?', ctx.params.id);
  if (!a) throw new ApiError(404, 'Not found.');
  audit(s.id, a.id, 'legacy_update', JSON.stringify(b).slice(0, 200));
  if (typeof b.banned === 'boolean') {
    if (a.id === s.id) throw new ApiError(400, "You can't ban yourself.");
    run('UPDATE accounts SET banned = ? WHERE id = ?', b.banned ? 1 : 0, a.id);
    if (b.banned) disconnectAccount(a.id);
  }
  if (Array.isArray(b.badges)) run('UPDATE accounts SET badges_json = ? WHERE id = ?', JSON.stringify(b.badges.filter((x: string) => GRANTABLE.includes(x as any))), a.id);
  if (Array.isArray(b.roles)) {
    if (!rolesOf(s).includes('founder')) throw new ApiError(403, 'Only founders can change roles.');
    run('UPDATE accounts SET roles_json = ? WHERE id = ?', JSON.stringify(b.roles.filter((x: string) => ['staff', 'developer', 'founder'].includes(x))), a.id);
  }
  if (SLOTS.includes(b.removeMedia)) { deleteMedia(a[b.removeMedia]); run(`UPDATE accounts SET ${b.removeMedia} = NULL WHERE id = ?`, a.id); }
  if (b.resetBio) run("UPDATE accounts SET bio = '', custom_status = '', display_name = '' WHERE id = ?", a.id);
  if (typeof b.forceUsername === 'string') {
    // staff rename (e.g. offensive name slipped through, or a brand verified)
    const n = canonicalize(b.forceUsername);
    if (!USERNAME_RE.test(n) || n.length > 24) throw new ApiError(400, 'Invalid username.');
    if (one('SELECT 1 FROM accounts WHERE username = ? AND id != ?', n, a.id)) throw new ApiError(409, 'Taken.');
    run('UPDATE accounts SET username = ? WHERE id = ?', n, a.id);
  }
  return { ok: true };
});
route('POST', '/api/staff/reports/:id', async (ctx) => {
  const s = staff(ctx);
  const b = await json(ctx);
  const r = one('SELECT target_id, reason FROM reports WHERE id = ?', ctx.params.id);
  run('UPDATE reports SET status = ? WHERE id = ?', b.status === 'dismissed' ? 'dismissed' : 'actioned', ctx.params.id);
  if (r) audit(s.id, r.target_id, b.status === 'dismissed' ? 'dismiss_report' : 'close_report', r.reason);
  return { ok: true };
});
route('GET', '/api/staff/platform', (ctx) => { staff(ctx); return platform(); });
route('POST', '/api/staff/platform', async (ctx) => {
  const s = staff(ctx);
  const before = platform();
  const next = setPlatform(await json(ctx));
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  if (changed.length) audit(s.id, null, 'platform', changed.map((k) => `${k}: ${JSON.stringify(next[k])}`).join(', '));
  return next;
});
route('POST', '/api/staff/updates', async (ctx) => {
  const s = staff(ctx);
  const b = await json(ctx);
  const u = postUpdate(s.id, b);
  audit(s.id, null, 'post_update', u.title);
  return listUpdates();
});
route('DELETE', '/api/staff/updates/:id', (ctx) => { const s = staff(ctx); deleteUpdate(ctx.params.id); audit(s.id, null, 'delete_update', ctx.params.id); return listUpdates(); });
route('POST', '/api/staff/broadcast', async (ctx) => {
  const s = staff(ctx);
  const msg = cleanText(String((await json(ctx)).message ?? ''), 500).trim();
  if (!msg) throw new ApiError(400, 'Write the notice first.');
  const ids = all('SELECT id, notices_json FROM accounts WHERE banned = 0');
  const notice = { id: newId(), message: msg, at: Date.now(), kind: 'broadcast' };
  for (const r of ids) run('UPDATE accounts SET notices_json = ? WHERE id = ?', JSON.stringify([...parse<any[]>(r.notices_json, []), notice].slice(-20)), r.id);
  audit(s.id, null, 'broadcast', msg.slice(0, 120));
  return { sent: ids.length };
});
route('GET', '/api/staff/stats', (ctx) => {
  staff(ctx);
  const day = 86400e3, now = Date.now();
  const signups = Array.from({ length: 14 }, (_, i) => {
    const start = now - (13 - i) * day - (now % day);
    return { day: new Date(start).toISOString().slice(0, 10), n: one('SELECT count(*) n FROM accounts WHERE created_at >= ? AND created_at < ?', start, start + day)!.n as number };
  });
  const n = (sql: string, ...p: unknown[]) => (one(sql, ...p)?.n as number) ?? 0;
  return {
    signups,
    totals: {
      accounts: n('SELECT count(*) n FROM accounts'), online: onlineCount(),
      activeToday: n('SELECT count(*) n FROM accounts WHERE last_active_day = ?', dayKey()),
      spaces: n('SELECT count(*) n FROM spaces'), creditsInCirculation: n('SELECT coalesce(sum(credits),0) n FROM accounts'),
      activeListings: n("SELECT count(*) n FROM listings WHERE status = 'active'"), sales: n("SELECT count(*) n FROM listings WHERE status = 'sold'"),
      // aggregate only: staff never see who is in Lockdown Mode
      lockdown: n("SELECT count(*) n FROM accounts WHERE lockdown_json LIKE '%\"enabled\":true%'"),
      openReports: n("SELECT count(*) n FROM reports WHERE status = 'open'"), pendingClaims: n("SELECT count(*) n FROM claim_requests WHERE status IN ('holding','pending_staff')"),
    },
  };
});
route('POST', '/api/staff/invites', async (ctx) => {
  const s = staff(ctx);
  const b = await json(ctx);
  return { codes: makeInviteCodes(s.id, Math.min(50, Math.max(1, Number(b.count) || 5))) };
});

// ------------------------------------------------------------------- server

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const ip = clientIp(req);
  const ctx: Ctx = { req, res, url, ip, params: {} };
  try {
    if (!hit('api', fingerprint('ip', ip), LIMITS.api.limit, LIMITS.api.window)) throw new ApiError(429, 'Slow down.');

    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        r.keys.forEach((k, i) => (ctx.params[k] = m[i + 1]));
        const out = await r.h(ctx);
        return send(res, 200, JSON.stringify(out ?? {}), 'application/json; charset=utf-8', { 'cache-control': 'no-store' });
      }
      throw new ApiError(404, 'Not found.');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'Method not allowed.');

    if (url.pathname.startsWith('/media/')) {
      const p = mediaPath(url.pathname.slice(7));
      if (!p) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, fs.readFileSync(p), 'image/webp', { 'cache-control': 'public, max-age=31536000, immutable', 'cross-origin-resource-policy': 'cross-origin' });
    }
    if (url.pathname === '/app') return send(res, 301, '', 'text/plain', { location: '/app/' + url.search });
    if (url.pathname.startsWith('/app/')) {
      const rel = url.pathname === '/app/' ? 'index.html' : url.pathname.slice(5);
      const file = path.resolve(config.webDir, rel);
      if (!file.startsWith(config.webDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (!fs.existsSync(path.join(config.webDir, 'index.html'))) return send(res, 404, 'Web app not built. Run: cd app && npm run build', 'text/plain');
        return send(res, 404, 'not found', 'text/plain');
      }
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      return send(res, 200, fs.readFileSync(file), type, {
        'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
    }
    if (url.pathname === '/') {
      return send(res, 200, landingPage({ accounts: one('SELECT count(*) n FROM accounts')!.n as number }), 'text/html; charset=utf-8', { 'content-security-policy': HTML_CSP });
    }
    if (url.pathname === '/favicon.ico') return send(res, 204, '', 'image/x-icon', { 'cache-control': 'public, max-age=86400' });
    if (url.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nAllow: /\n', 'text/plain');

    // /{username}
    const m = /^\/@?([A-Za-z0-9_]{1,24})\/?$/.exec(url.pathname);
    if (m) {
      const a = one('SELECT * FROM accounts WHERE username = ? AND banned = 0', m[1].toLowerCase());
      if (a && hasPublicPage(privacyOf(a), lockdownOf(a))) {
        return send(res, 200, profilePage(toPublicProfile(a, false)), 'text/html; charset=utf-8', { 'content-security-policy': HTML_CSP.replace("img-src 'self' data:", `img-src 'self' data: ${config.publicOrigin}`), 'cache-control': 'no-cache' });
      }
    }
    return send(res, 404, notFoundPage(), 'text/html; charset=utf-8', { 'content-security-policy': HTML_CSP });
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500;
    if (status === 500) console.error(e);
    const message = e instanceof ApiError ? e.message : 'Something went wrong.';
    send(res, status, JSON.stringify({ error: message, code: e?.code ?? 'error' }), 'application/json; charset=utf-8');
  }
}

const server = http.createServer(handle);
server.on('upgrade', (req, socket) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
  handleUpgrade(req, socket);
});

setInterval(finalizeHolds, 30e3).unref();

server.listen(config.port, config.host, () => {
  console.log(`sigil server on http://${config.host}:${config.port}  (invite-only: ${config.inviteOnly})`);
  const n = one('SELECT count(*) n FROM accounts')!.n;
  if (n === 0 && config.inviteOnly) {
    const existing = all('SELECT code FROM invites WHERE created_by IS NULL AND used_by IS NULL');
    const codes = existing.length ? existing.map((r) => r.code) : makeInviteCodes(null, 5);
    console.log(`\nFresh server. Bootstrap invite codes (the first account becomes founder/staff):\n  ${codes.join('\n  ')}\n`);
  }
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
export { server, DEFAULT_PRIVACY };
