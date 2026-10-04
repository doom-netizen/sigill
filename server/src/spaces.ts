// Spaces (servers + group chats) storage. Each space is one JSON document;
// two index tables make "my spaces" and invite lookups fast. Rules live in
// shared/spaces.ts. Message text never touches this file.

import crypto from 'node:crypto';
import { db, one, all, run, tx } from './db';
import { ApiError, newId, presenceOf, toPublicProfile, privacyOf, lockdownOf } from './accounts';
import { acceptsSpaceAdds } from '../../shared/lockdown';
import { platform } from './platform';
import { RAID_MIN_AGE_MS } from '../../shared/platform';

/** People can opt out of being added directly (and Lockdown Mode always opts out). */
function assertAddable(ids: string[]) {
  for (const id of ids) {
    const a = one('SELECT * FROM accounts WHERE id = ?', id);
    if (a && !acceptsSpaceAdds(privacyOf(a), lockdownOf(a))) throw new ApiError(403, `@${a.username} only joins servers and groups with an invite link. Send them one instead.`);
  }
}
import { hit } from './abuse';
import {
  createSpace, applyOp, joinWithInvite, viewFor, LIMITS, SpaceError, type SpaceDoc, type SpaceOp, type SpaceView, type SpaceKind,
} from '../../shared/spaces';
import { canonicalize } from '../../shared/usernames';

db.exec(`
CREATE TABLE IF NOT EXISTS spaces (
  id         TEXT PRIMARY KEY,
  data_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS space_members (
  space_id   TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (space_id, account_id)
);
CREATE INDEX IF NOT EXISTS space_members_by_account ON space_members(account_id);
CREATE TABLE IF NOT EXISTS space_invites (
  code     TEXT PRIMARY KEY,
  space_id TEXT NOT NULL
);
`);

// relay registers how to tell clients a space changed
let notify: (accountIds: string[], msg: object) => void = () => {};
export function setSpaceNotifier(fn: typeof notify) { notify = fn; }

export function loadSpace(id: string): SpaceDoc | null {
  const r = one('SELECT data_json FROM spaces WHERE id = ?', id);
  return r ? (JSON.parse(r.data_json) as SpaceDoc) : null;
}

function saveSpace(d: SpaceDoc) {
  run('INSERT OR REPLACE INTO spaces (id, data_json, updated_at) VALUES (?,?,?)', d.id, JSON.stringify(d), Date.now());
  run('DELETE FROM space_members WHERE space_id = ?', d.id);
  for (const m of Object.keys(d.members)) run('INSERT INTO space_members (space_id, account_id) VALUES (?,?)', d.id, m);
  run('DELETE FROM space_invites WHERE space_id = ?', d.id);
  for (const i of d.invites) run('INSERT OR REPLACE INTO space_invites (code, space_id) VALUES (?,?)', i.code, d.id);
}

function deleteSpace(id: string) {
  run('DELETE FROM spaces WHERE id = ?', id);
  run('DELETE FROM space_members WHERE space_id = ?', id);
  run('DELETE FROM space_invites WHERE space_id = ?', id);
}

const inviteCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);

function profileFor(id: string) {
  const a = one('SELECT * FROM accounts WHERE id = ?', id);
  if (!a) return null;
  const p = toPublicProfile(a, false);
  return { id, username: p.username, displayName: p.displayName, avatar: p.avatar, accent: p.theme.accent, presence: presenceOf(a) };
}

export const view = (d: SpaceDoc, viewer: string): SpaceView => viewFor(d, viewer, profileFor);

function wrap<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if (e instanceof SpaceError) throw new ApiError(e.status, e.message);
    throw e;
  }
}

export function mySpaces(accountId: string): SpaceView[] {
  return all('SELECT space_id FROM space_members WHERE account_id = ?', accountId)
    .map((r) => loadSpace(r.space_id)).filter((d): d is SpaceDoc => !!d)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((d) => view(d, accountId));
}

export function getSpace(id: string, accountId: string): SpaceView {
  const d = loadSpace(id);
  if (!d || !d.members[accountId]) throw new ApiError(404, 'Space not found.');
  return view(d, accountId);
}

export function create(accountId: string, body: { kind?: string; name?: string; emoji?: string; color?: string; members?: string[] }): SpaceView {
  if (!hit('spaceCreate', accountId, 10, 3600e3)) throw new ApiError(429, 'You\'re creating a lot of spaces. Try again later.');
  const count = (one('SELECT count(*) n FROM space_members WHERE account_id = ?', accountId)?.n as number) ?? 0;
  if (count >= LIMITS.spacesPerAccount) throw new ApiError(400, `You can be in up to ${LIMITS.spacesPerAccount} servers and groups.`);
  const kind: SpaceKind = body.kind === 'group' ? 'group' : 'server';
  if (platform().raidMode) {
    const me = one('SELECT created_at, roles_json FROM accounts WHERE id = ?', accountId);
    if (me && Date.now() - me.created_at < RAID_MIN_AGE_MS && !String(me.roles_json).includes('staff')) throw new ApiError(403, 'Raid mode is on: new accounts can\'t create servers or groups for their first day.');
  }
  return tx(() => wrap(() => {
    const d = createSpace({ id: newId(), kind, name: String(body.name ?? ''), ownerId: accountId, icon: { emoji: body.emoji, color: body.color }, newId });
    if (kind === 'group' && Array.isArray(body.members)) {
      const ids = body.members.map((u) => one('SELECT id FROM accounts WHERE username = ? AND banned = 0', canonicalize(String(u)))?.id).filter(Boolean) as string[];
      assertAddable(ids);
      applyOp(d, accountId, { op: 'add_members', accountIds: ids }, { newId, inviteCode });
    }
    saveSpace(d);
    notify(Object.keys(d.members).filter((m) => m !== accountId), { t: 'space', id: d.id });
    return view(d, accountId);
  }));
}

export function op(accountId: string, spaceId: string, body: SpaceOp & { usernames?: string[] }): SpaceView | { deleted: true } | { left: true } {
  if (!hit('spaceOp', accountId, 120, 60e3)) throw new ApiError(429, 'Slow down.');
  return tx(() => wrap(() => {
    const d = loadSpace(spaceId);
    if (!d || !d.members[accountId]) throw new ApiError(404, 'Space not found.');
    const before = Object.keys(d.members);
    let o = body as SpaceOp;
    if (o.op === 'add_members' && Array.isArray(body.usernames)) {
      o = { op: 'add_members', accountIds: body.usernames.map((u) => one('SELECT id FROM accounts WHERE username = ? AND banned = 0', canonicalize(String(u)))?.id).filter(Boolean) as string[] };
      if (!o.accountIds.length) throw new ApiError(404, 'No accounts with those usernames.');
    }
    if (o.op === 'add_members') assertAddable(o.accountIds.filter((x) => !d.members[x]));
    const r = applyOp(d, accountId, o, { newId, inviteCode });
    if (r.deleted) {
      deleteSpace(d.id);
      notify(before, { t: 'space_removed', id: d.id });
      return { deleted: true as const };
    }
    saveSpace(d);
    if (r.removed?.length) notify(r.removed, { t: 'space_removed', id: d.id });
    notify(Object.keys(d.members), { t: 'space', id: d.id });
    if (r.removed?.includes(accountId)) return { left: true as const };
    return view(d, accountId);
  }));
}

export function join(accountId: string, code: string): SpaceView {
  if (!hit('spaceJoin', accountId, 30, 3600e3)) throw new ApiError(429, 'Too many join attempts.');
  const c = String(code ?? '').trim().replace(/^.*\//, '');
  const r = one('SELECT space_id FROM space_invites WHERE code = ?', c);
  if (!r) throw new ApiError(404, 'That invite is invalid or expired.');
  return tx(() => wrap(() => {
    const d = loadSpace(r.space_id)!;
    joinWithInvite(d, accountId, c);
    saveSpace(d);
    notify(Object.keys(d.members), { t: 'space', id: d.id });
    return view(d, accountId);
  }));
}
