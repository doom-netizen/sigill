// Realtime: presence, WebRTC signaling and the encrypted relay.
//
// What this relay does NOT do:
//   - decrypt anything (it only ever sees opaque, end-to-end encrypted envelopes)
//   - store messages: if the recipient is offline the envelope is dropped and
//     the sender is told "offline". No queue, no history, no previews.
//   - log who talks to whom. Only short-TTL rate-limit counters exist in memory.

import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptUpgrade, type WsConn } from './ws';
import { one } from './db';
import { hit, LIMITS } from './abuse';
import { privacyOf, presenceOf, setPresenceSource, touchActivity, isMuted, liftExpired, statusTextOf } from './accounts';
import { platform } from './platform';
import { RAID_MIN_AGE_MS } from '../../shared/platform';
import { accountForToken } from './auth';
import { loadSpace, setSpaceNotifier } from './spaces';
import { canSendIn, recipientsOf } from '../../shared/spaces';

const MAX_ENVELOPE = 64 * 1024;

interface Client { conn: WsConn; accountId: string; sid: string | null; watching: Set<string> }

const byAccount = new Map<string, Set<Client>>();
const watchers = new Map<string, Set<Client>>(); // watched id -> clients
// short-TTL "has A contacted B recently" for the new-conversation rate limit.
// Keys are hashed with a per-boot salt and expire after an hour.
const recentPairs = new Map<string, number>();
const pairSalt = crypto.randomBytes(16);

setPresenceSource((id) => (byAccount.get(id)?.size ?? 0) > 0);

function pairKey(a: string, b: string) {
  return crypto.createHmac('sha256', pairSalt).update(`${a}>${b}`).digest('base64url').slice(0, 22);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of recentPairs) if (now - t > 3600e3) recentPairs.delete(k);
}, 60e3).unref();

export function notifyPresence(accountId: string) {
  const set = watchers.get(accountId);
  if (!set?.size) return;
  const a = one('SELECT * FROM accounts WHERE id = ?', accountId);
  if (!a) return;
  const msg = JSON.stringify({ t: 'presence', id: accountId, presence: presenceOf(a), customStatus: statusTextOf(a) });
  for (const c of set) c.conn.send(msg);
}

export function disconnectAccount(accountId: string) {
  for (const c of byAccount.get(accountId) ?? []) c.conn.close(4003, 'account disabled');
}

/** Close the sockets of specific sessions (signed out from another device). */
export function disconnectSessions(accountId: string, sids: string[]) {
  const gone = new Set(sids);
  for (const c of byAccount.get(accountId) ?? []) if (c.sid && gone.has(c.sid)) c.conn.close(4003, 'session ended');
}

/** Raid mode: brand-new accounts can read but not send. */
function raidBlocked(accountId: string): boolean {
  if (!platform().raidMode) return false;
  const a = one('SELECT created_at, roles_json FROM accounts WHERE id = ?', accountId);
  return !!a && Date.now() - a.created_at < RAID_MIN_AGE_MS && !String(a.roles_json).includes('staff');
}

function deliver(to: string, payload: object): boolean {
  const set = byAccount.get(to);
  if (!set?.size) return false;
  const s = JSON.stringify(payload);
  for (const c of set) c.conn.send(s);
  return true;
}

/** Can `from` reach `to`? Server-side policy: bans, "nobody". Friends/blocks are enforced on the recipient's device. */
function canReach(fromId: string, toId: string): { ok: boolean; reason?: string } {
  const to = one('SELECT id, banned, privacy_json FROM accounts WHERE id = ?', toId);
  if (!to || to.banned) return { ok: false, reason: 'unknown' };
  if (privacyOf(to).whoCanMessage === 'nobody') return { ok: false, reason: 'not_accepting' };
  const from = one('SELECT banned, muted_until FROM accounts WHERE id = ?', fromId);
  if (!from || from.banned) return { ok: false, reason: 'banned' };
  if (isMuted(from)) return { ok: false, reason: 'muted' };
  return { ok: true };
}

setSpaceNotifier((ids, msg) => { for (const id of ids) deliver(id, msg); });

const MAX_FANOUT = 100;

function onMessage(client: Client, raw: string) {
  let m: any;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;

  if (m.t === 'send') {
    const id = String(m.id ?? '').slice(0, 40);
    const ack = (ok: boolean, reason?: string) => client.conn.send(JSON.stringify({ t: 'ack', id, ok, reason }));
    if (typeof m.to !== 'string' || typeof m.env !== 'string' || m.env.length > MAX_ENVELOPE) return ack(false, 'invalid');
    if (m.to === client.accountId) return ack(false, 'invalid');
    if (!hit('msg', client.accountId, LIMITS.messagesPerSender.limit, LIMITS.messagesPerSender.window)) return ack(false, 'rate_limited');
    const reach = canReach(client.accountId, m.to);
    if (!reach.ok) return ack(false, reach.reason);
    if (raidBlocked(client.accountId)) return ack(false, 'raid');
    const pk = pairKey(client.accountId, m.to);
    if (!recentPairs.has(pk)) {
      if (!hit('newconv', client.accountId, LIMITS.newConversationsPerSender.limit, LIMITS.newConversationsPerSender.window)) return ack(false, 'rate_limited');
    }
    recentPairs.set(pk, Date.now());
    const ok = deliver(m.to, { t: 'msg', from: client.accountId, id, env: m.env });
    return ack(ok, ok ? undefined : 'offline');
  }

  // Channel message: the client encrypted it separately for each recipient.
  // We check the sender may post here and each recipient may read here,
  // then relay. Nothing is stored.
  if (m.t === 'gsend') {
    const id = String(m.id ?? '').slice(0, 40);
    const ack = (ok: boolean, extra: object = {}) => client.conn.send(JSON.stringify({ t: 'ack', id, ok, ...extra }));
    if (typeof m.space !== 'string' || typeof m.channel !== 'string' || !m.envs || typeof m.envs !== 'object') return ack(false, { reason: 'invalid' });
    const entries = Object.entries(m.envs as Record<string, unknown>);
    if (entries.length > MAX_FANOUT || entries.some(([, e]) => typeof e !== 'string' || (e as string).length > MAX_ENVELOPE)) return ack(false, { reason: 'invalid' });
    if (!hit('msg', client.accountId, LIMITS.messagesPerSender.limit, LIMITS.messagesPerSender.window)) return ack(false, { reason: 'rate_limited' });
    const sender = one('SELECT banned, muted_until FROM accounts WHERE id = ?', client.accountId);
    if (!sender || sender.banned) return ack(false, { reason: 'banned' });
    if (isMuted(sender)) return ack(false, { reason: 'muted' });
    if (raidBlocked(client.accountId)) return ack(false, { reason: 'raid' });
    const d = loadSpace(m.space);
    const ch = d?.channels.find((c) => c.id === m.channel);
    if (!d || !ch || !canSendIn(d, client.accountId, ch)) return ack(false, { reason: 'forbidden' });
    const allowed = new Set(recipientsOf(d, client.accountId, ch));
    let delivered = 0, offline = 0;
    for (const [to, env] of entries) {
      if (!allowed.has(to)) continue;
      if (deliver(to, { t: 'msg', from: client.accountId, id, env, ctx: { space: d.id, channel: ch.id } })) delivered++; else offline++;
    }
    return ack(true, { delivered, offline });
  }

  if (m.t === 'signal') {
    if (typeof m.to !== 'string' || JSON.stringify(m.data ?? null).length > 16 * 1024) return;
    if (!hit('signal', client.accountId, 200, 60e3)) return;
    if (!canReach(client.accountId, m.to).ok) return;
    deliver(m.to, { t: 'signal', from: client.accountId, data: m.data });
    return;
  }

  if (m.t === 'watch' && Array.isArray(m.ids)) {
    for (const old of client.watching) watchers.get(old)?.delete(client);
    client.watching = new Set(m.ids.filter((x: unknown) => typeof x === 'string').slice(0, 500));
    for (const id of client.watching) {
      if (!watchers.has(id)) watchers.set(id, new Set());
      watchers.get(id)!.add(client);
      const a = one('SELECT * FROM accounts WHERE id = ?', id);
      if (a) client.conn.send(JSON.stringify({ t: 'presence', id, presence: presenceOf(a), customStatus: statusTextOf(a) }));
    }
    return;
  }

  if (m.t === 'ping') client.conn.send('{"t":"pong"}');
}

export function handleUpgrade(req: IncomingMessage, socket: Duplex) {
  const conn = acceptUpgrade(req, socket);
  if (!conn) return;
  let client: Client | null = null;
  const authTimer = setTimeout(() => { if (!client) conn.close(4001, 'auth timeout'); }, 10e3);

  conn.on('message', (raw: string) => {
    if (!client) {
      let m: any;
      try { m = JSON.parse(raw); } catch { return conn.close(4001, 'auth'); }
      const row = m?.t === 'auth' && typeof m.token === 'string' ? accountForToken(m.token) : null;
      const a = row ? liftExpired(row) : null;
      if (!a || a.banned) return conn.close(4001, 'auth');
      clearTimeout(authTimer);
      client = { conn, accountId: a.id, sid: a._sid ?? null, watching: new Set() };
      if (!byAccount.has(a.id)) byAccount.set(a.id, new Set());
      byAccount.get(a.id)!.add(client);
      touchActivity(a);
      conn.send(JSON.stringify({ t: 'ready', id: a.id }));
      notifyPresence(a.id);
      return;
    }
    onMessage(client, raw);
  });

  conn.on('close', () => {
    clearTimeout(authTimer);
    if (!client) return;
    byAccount.get(client.accountId)?.delete(client);
    if (!byAccount.get(client.accountId)?.size) byAccount.delete(client.accountId);
    for (const id of client.watching) watchers.get(id)?.delete(client);
    notifyPresence(client.accountId);
  });
}

// keepalive
const heart = setInterval(() => {
  for (const set of byAccount.values()) for (const c of set) {
    if (!c.conn.alive) { c.conn.close(1001, 'timeout'); continue; }
    c.conn.alive = false;
    c.conn.ping();
  }
}, 30e3);
heart.unref();

export const onlineCount = () => byAccount.size;
