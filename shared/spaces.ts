// Servers ("spaces") and group chats: one storage-agnostic rules engine,
// used by the real server (stored as JSON documents in SQLite) and by the
// demo's in-browser server. It owns membership, roles, permissions, the
// role hierarchy, channels, invites and bans.
//
// Message text is NOT here: channel messages are end-to-end encrypted on the
// sender's device, once per recipient, and relayed without being stored. The
// server only uses this module to decide who may send to / receive from a
// channel.

import { cleanText } from './markdown';
import { isSlur } from './usernames';

export type SpaceKind = 'server' | 'group';
export const PERMS = ['admin', 'manage_space', 'manage_channels', 'manage_roles', 'manage_members', 'create_invites', 'send_messages'] as const;
export type Perm = (typeof PERMS)[number];
export const PERM_LABELS: Record<Perm, { label: string; description: string }> = {
  admin: { label: 'Administrator', description: 'Every permission, and sees every channel. Give this carefully.' },
  manage_space: { label: 'Manage server', description: 'Change the name, icon and description, and revoke invites.' },
  manage_channels: { label: 'Manage channels', description: 'Create, edit, reorder and delete channels. Can post in announcement channels.' },
  manage_roles: { label: 'Manage roles', description: 'Create and edit roles below their own, and assign them.' },
  manage_members: { label: 'Manage members', description: 'Kick and ban members below their own top role.' },
  create_invites: { label: 'Create invites', description: 'Make invite codes for this server.' },
  send_messages: { label: 'Send messages', description: 'Post in text channels they can see.' },
};

export const LIMITS = { serverMembers: 100, groupMembers: 10, channels: 50, roles: 25, invites: 25, spacesPerAccount: 50 };

export interface Role { id: string; name: string; color: string; perms: Perm[]; position: number; isDefault?: boolean; hoist: boolean }
export interface Channel { id: string; name: string; topic: string; kind: 'text' | 'announcement'; category: string; private: boolean; allowedRoles: string[]; position: number }
export interface Member { joinedAt: number; roles: string[]; nickname: string }
export interface Invite { code: string; createdBy: string; uses: number; maxUses: number | null; expiresAt: number | null; createdAt: number }
export interface Ban { reason: string; at: number; by: string }

export interface SpaceDoc {
  id: string;
  kind: SpaceKind;
  name: string;
  description: string;
  icon: { emoji: string; color: string };
  ownerId: string;
  createdAt: number;
  members: Record<string, Member>;
  roles: Role[];
  channels: Channel[];
  invites: Invite[];
  bans: Record<string, Ban>;
}

export class SpaceError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, msg: string): never => { throw new SpaceError(status, msg); };

// ------------------------------------------------------------- sanitizing
const HEX = /^#[0-9a-f]{6}$/i;
export const cleanName = (s: unknown, max: number) => cleanText(String(s ?? ''), max).replace(/\s+/g, ' ').trim();
export function channelName(s: unknown): string {
  const n = String(s ?? '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '').replace(/-{2,}/g, '-').slice(0, 32);
  return n || fail(400, 'Channel names use a–z, 0–9, - and _.');
}
function noSlurs(s: string, what: string) {
  const letters = s.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (letters && isSlur(letters.slice(0, 24))) fail(400, `That ${what} isn't allowed.`);
}
const emoji = (s: unknown) => { const e = String(s ?? '').trim(); return [...e].slice(0, 2).join('') || '✦'; };
const color = (s: unknown, d: string) => (typeof s === 'string' && HEX.test(s) ? s.toLowerCase() : d);
const perms = (p: unknown): Perm[] => (Array.isArray(p) ? [...new Set(p.filter((x): x is Perm => (PERMS as readonly string[]).includes(x as string)))] : []);

// ---------------------------------------------------------------- create
export function createSpace(opts: { id: string; kind: SpaceKind; name: string; ownerId: string; icon?: { emoji?: string; color?: string }; newId: () => string; now?: number }): SpaceDoc {
  const now = opts.now ?? Date.now();
  const name = cleanName(opts.name, 40) || (opts.kind === 'group' ? 'Group chat' : fail(400, 'Give your server a name.'));
  noSlurs(name, 'name');
  const everyone: Role = { id: `${opts.id}-everyone`, name: '@everyone', color: '#b9b6c8', perms: opts.kind === 'group' ? ['send_messages', 'create_invites'] : ['send_messages', 'create_invites'], position: 0, isDefault: true, hoist: false };
  const doc: SpaceDoc = {
    id: opts.id, kind: opts.kind, name, description: '', ownerId: opts.ownerId, createdAt: now,
    icon: { emoji: emoji(opts.icon?.emoji ?? (opts.kind === 'group' ? '💬' : '✦')), color: color(opts.icon?.color, '#8b7cff') },
    members: { [opts.ownerId]: { joinedAt: now, roles: [], nickname: '' } },
    roles: [everyone], channels: [], invites: [], bans: {},
  };
  if (opts.kind === 'server') {
    const mod: Role = { id: opts.newId(), name: 'Moderator', color: '#5ee7ff', perms: ['manage_members', 'manage_channels', 'create_invites', 'send_messages'], position: 1, hoist: true };
    doc.roles.push(mod);
    doc.channels.push(
      { id: opts.newId(), name: 'welcome', topic: 'Start here.', kind: 'announcement', category: 'Info', private: false, allowedRoles: [], position: 0 },
      { id: opts.newId(), name: 'general', topic: 'Talk about anything.', kind: 'text', category: 'Chat', private: false, allowedRoles: [], position: 1 },
      { id: opts.newId(), name: 'mods', topic: 'Moderator-only.', kind: 'text', category: 'Chat', private: true, allowedRoles: [mod.id], position: 2 },
    );
  } else {
    doc.channels.push({ id: opts.newId(), name: 'chat', topic: '', kind: 'text', category: '', private: false, allowedRoles: [], position: 0 });
  }
  return doc;
}

// ------------------------------------------------------------ permissions
export const isMember = (d: SpaceDoc, id: string) => !!d.members[id];
export const memberCap = (d: SpaceDoc) => (d.kind === 'group' ? LIMITS.groupMembers : LIMITS.serverMembers);

export function rolesOfMember(d: SpaceDoc, id: string): Role[] {
  const m = d.members[id];
  if (!m) return [];
  return d.roles.filter((r) => r.isDefault || m.roles.includes(r.id));
}
export function topPosition(d: SpaceDoc, id: string): number {
  if (d.ownerId === id) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, ...rolesOfMember(d, id).map((r) => r.position));
}
export function permsOf(d: SpaceDoc, id: string): Set<Perm> {
  if (!d.members[id]) return new Set();
  if (d.ownerId === id) return new Set(PERMS);
  const p = new Set<Perm>(rolesOfMember(d, id).flatMap((r) => r.perms));
  if (p.has('admin')) return new Set(PERMS);
  return p;
}
export const can = (d: SpaceDoc, id: string, p: Perm) => permsOf(d, id).has(p);

export function canSeeChannel(d: SpaceDoc, id: string, ch: Channel): boolean {
  if (!d.members[id]) return false;
  if (!ch.private) return true;
  if (can(d, id, 'admin')) return true;
  const mine = new Set(rolesOfMember(d, id).map((r) => r.id));
  return ch.allowedRoles.some((r) => mine.has(r));
}
export function canSendIn(d: SpaceDoc, id: string, ch: Channel): boolean {
  if (!canSeeChannel(d, id, ch)) return false;
  if (!can(d, id, 'send_messages')) return false;
  if (ch.kind === 'announcement') return can(d, id, 'manage_channels');
  return true;
}
/** Who should receive a message in this channel (excluding the sender). */
export const recipientsOf = (d: SpaceDoc, sender: string, ch: Channel) => Object.keys(d.members).filter((m) => m !== sender && canSeeChannel(d, m, ch));

function outranks(d: SpaceDoc, actor: string, target: string) {
  return d.ownerId !== target && topPosition(d, actor) > topPosition(d, target);
}

// ------------------------------------------------------------------- ops
export type SpaceOp =
  | { op: 'update_space'; name?: string; description?: string; emoji?: string; color?: string }
  | { op: 'create_channel'; name: string; topic?: string; kind?: 'text' | 'announcement'; category?: string; private?: boolean; allowedRoles?: string[] }
  | { op: 'update_channel'; channelId: string; name?: string; topic?: string; kind?: 'text' | 'announcement'; category?: string; private?: boolean; allowedRoles?: string[] }
  | { op: 'move_channel'; channelId: string; dir: -1 | 1 }
  | { op: 'delete_channel'; channelId: string }
  | { op: 'create_role'; name: string; color?: string; perms?: Perm[]; hoist?: boolean }
  | { op: 'update_role'; roleId: string; name?: string; color?: string; perms?: Perm[]; hoist?: boolean }
  | { op: 'move_role'; roleId: string; dir: -1 | 1 }
  | { op: 'delete_role'; roleId: string }
  | { op: 'set_member_roles'; accountId: string; roles: string[] }
  | { op: 'set_nickname'; accountId: string; nickname: string }
  | { op: 'kick'; accountId: string }
  | { op: 'ban'; accountId: string; reason?: string }
  | { op: 'unban'; accountId: string }
  | { op: 'create_invite'; maxUses?: number | null; expiresHours?: number | null }
  | { op: 'revoke_invite'; code: string }
  | { op: 'add_members'; accountIds: string[] }
  | { op: 'transfer_ownership'; accountId: string }
  | { op: 'leave' }
  | { op: 'delete_space' };

export interface OpResult { deleted?: boolean; removed?: string[]; added?: string[]; invite?: Invite }

const need = (d: SpaceDoc, actor: string, p: Perm) => { if (!can(d, actor, p)) fail(403, `You need the "${PERM_LABELS[p].label}" permission.`); };
const serverOnly = (d: SpaceDoc) => { if (d.kind !== 'server') fail(400, 'Group chats don\'t have that.'); };
const findChannel = (d: SpaceDoc, id: string) => d.channels.find((c) => c.id === id) ?? fail(404, 'No such channel.');
const findRole = (d: SpaceDoc, id: string) => d.roles.find((r) => r.id === id) ?? fail(404, 'No such role.');
const reindex = <T extends { position: number }>(xs: T[]) => xs.sort((a, b) => a.position - b.position).forEach((x, i) => (x.position = i));
const validRoles = (d: SpaceDoc, ids: unknown) => (Array.isArray(ids) ? ids.filter((r) => d.roles.some((x) => x.id === r && !x.isDefault)) as string[] : []);

/**
 * Apply one operation. Mutates `d`. Throws SpaceError on anything invalid.
 * `inviteCode` must be supplied (fresh random) for create_invite.
 */
export function applyOp(d: SpaceDoc, actor: string, op: SpaceOp, ctx: { newId: () => string; inviteCode: () => string; now?: number }): OpResult {
  const now = ctx.now ?? Date.now();
  if (!isMember(d, actor)) fail(403, "You're not a member of this space.");
  switch (op.op) {
    case 'update_space': {
      if (d.kind === 'server') need(d, actor, 'manage_space');
      if (op.name !== undefined) { const n = cleanName(op.name, 40); if (!n) fail(400, 'Name can\'t be empty.'); noSlurs(n, 'name'); d.name = n; }
      if (op.description !== undefined) d.description = cleanText(String(op.description), 300);
      if (op.emoji !== undefined) d.icon.emoji = emoji(op.emoji);
      if (op.color !== undefined) d.icon.color = color(op.color, d.icon.color);
      return {};
    }
    case 'create_channel': {
      serverOnly(d); need(d, actor, 'manage_channels');
      if (d.channels.length >= LIMITS.channels) fail(400, `Servers can have up to ${LIMITS.channels} channels.`);
      const name = channelName(op.name); noSlurs(name, 'channel name');
      d.channels.push({ id: ctx.newId(), name, topic: cleanText(String(op.topic ?? ''), 200), kind: op.kind === 'announcement' ? 'announcement' : 'text',
        category: cleanName(op.category, 24), private: !!op.private, allowedRoles: validRoles(d, op.allowedRoles), position: d.channels.length });
      return {};
    }
    case 'update_channel': {
      serverOnly(d); need(d, actor, 'manage_channels');
      const c = findChannel(d, op.channelId);
      if (op.name !== undefined) { c.name = channelName(op.name); noSlurs(c.name, 'channel name'); }
      if (op.topic !== undefined) c.topic = cleanText(String(op.topic), 200);
      if (op.kind !== undefined) c.kind = op.kind === 'announcement' ? 'announcement' : 'text';
      if (op.category !== undefined) c.category = cleanName(op.category, 24);
      if (op.private !== undefined) c.private = !!op.private;
      if (op.allowedRoles !== undefined) c.allowedRoles = validRoles(d, op.allowedRoles);
      return {};
    }
    case 'move_channel': {
      serverOnly(d); need(d, actor, 'manage_channels');
      const c = findChannel(d, op.channelId);
      reindex(d.channels);
      const j = c.position + (op.dir < 0 ? -1 : 1);
      const other = d.channels.find((x) => x.position === j);
      if (other) { other.position = c.position; c.position = j; }
      return {};
    }
    case 'delete_channel': {
      serverOnly(d); need(d, actor, 'manage_channels');
      findChannel(d, op.channelId);
      if (d.channels.length <= 1) fail(400, 'A server needs at least one channel.');
      d.channels = d.channels.filter((c) => c.id !== op.channelId);
      reindex(d.channels);
      return {};
    }
    case 'create_role': {
      serverOnly(d); need(d, actor, 'manage_roles');
      if (d.roles.length >= LIMITS.roles) fail(400, `Up to ${LIMITS.roles} roles.`);
      const name = cleanName(op.name, 24) || fail(400, 'Give the role a name.');
      noSlurs(name, 'role name');
      const p = perms(op.perms);
      if (p.includes('admin') && !can(d, actor, 'admin')) fail(403, 'Only administrators can create administrator roles.');
      // new roles go just below the actor's top role
      const pos = Math.min(topPosition(d, actor), Math.max(...d.roles.map((r) => r.position)) + 1);
      for (const r of d.roles) if (!r.isDefault && r.position >= pos) r.position++;
      d.roles.push({ id: ctx.newId(), name, color: color(op.color, '#9aa0b5'), perms: p, position: pos, hoist: !!op.hoist });
      return {};
    }
    case 'update_role': {
      serverOnly(d); need(d, actor, 'manage_roles');
      const r = findRole(d, op.roleId);
      if (!r.isDefault && r.position >= topPosition(d, actor)) fail(403, 'You can only edit roles below your highest role.');
      if (r.isDefault && op.name !== undefined) fail(400, "@everyone can't be renamed.");
      if (op.name !== undefined) { const n = cleanName(op.name, 24); if (!n) fail(400, 'Role names can\'t be empty.'); noSlurs(n, 'role name'); r.name = n; }
      if (op.color !== undefined) r.color = color(op.color, r.color);
      if (op.hoist !== undefined && !r.isDefault) r.hoist = !!op.hoist;
      if (op.perms !== undefined) {
        const p = perms(op.perms);
        if (p.includes('admin') && !r.perms.includes('admin') && !can(d, actor, 'admin')) fail(403, 'Only administrators can grant Administrator.');
        r.perms = p;
      }
      return {};
    }
    case 'move_role': {
      serverOnly(d); need(d, actor, 'manage_roles');
      const r = findRole(d, op.roleId);
      if (r.isDefault) fail(400, "@everyone is always at the bottom.");
      const list = d.roles.filter((x) => !x.isDefault).sort((a, b) => a.position - b.position);
      const i = list.indexOf(r), j = i + (op.dir < 0 ? -1 : 1);
      const other = list[j];
      if (!other) return {};
      const limit = topPosition(d, actor);
      if (r.position >= limit || other.position >= limit) fail(403, 'You can only move roles below your highest role.');
      [r.position, other.position] = [other.position, r.position];
      return {};
    }
    case 'delete_role': {
      serverOnly(d); need(d, actor, 'manage_roles');
      const r = findRole(d, op.roleId);
      if (r.isDefault) fail(400, "@everyone can't be deleted.");
      if (r.position >= topPosition(d, actor)) fail(403, 'You can only delete roles below your highest role.');
      d.roles = d.roles.filter((x) => x.id !== r.id);
      for (const m of Object.values(d.members)) m.roles = m.roles.filter((x) => x !== r.id);
      for (const c of d.channels) c.allowedRoles = c.allowedRoles.filter((x) => x !== r.id);
      return {};
    }
    case 'set_member_roles': {
      serverOnly(d); need(d, actor, 'manage_roles');
      const m = d.members[op.accountId] ?? fail(404, 'Not a member.');
      const limit = topPosition(d, actor);
      if (op.accountId !== actor && !outranks(d, actor, op.accountId) && d.ownerId !== actor) fail(403, 'You can only change roles for members below you.');
      const next = validRoles(d, op.roles);
      // can't add or remove roles at/above your own top role
      const touched = [...next.filter((x) => !m.roles.includes(x)), ...m.roles.filter((x) => !next.includes(x))];
      for (const id of touched) if (findRole(d, id).position >= limit) fail(403, 'You can only assign roles below your highest role.');
      m.roles = next;
      return {};
    }
    case 'set_nickname': {
      const m = d.members[op.accountId] ?? fail(404, 'Not a member.');
      if (op.accountId !== actor) { need(d, actor, 'manage_members'); if (!outranks(d, actor, op.accountId)) fail(403, 'You can only rename members below you.'); }
      const n = cleanName(op.nickname, 32); noSlurs(n, 'nickname'); m.nickname = n;
      return {};
    }
    case 'kick': case 'ban': {
      if (d.kind === 'group') { if (d.ownerId !== actor) fail(403, 'Only the group owner can remove people.'); }
      else need(d, actor, 'manage_members');
      if (op.accountId === actor) fail(400, 'Use Leave instead.');
      if (!outranks(d, actor, op.accountId)) fail(403, 'You can only remove members below your highest role.');
      if (op.op === 'ban') { serverOnly(d); d.bans[op.accountId] = { reason: cleanText(String(op.reason ?? ''), 200), at: now, by: actor }; }
      else if (!d.members[op.accountId]) fail(404, 'Not a member.');
      delete d.members[op.accountId];
      return { removed: [op.accountId] };
    }
    case 'unban': {
      serverOnly(d); need(d, actor, 'manage_members');
      delete d.bans[op.accountId];
      return {};
    }
    case 'create_invite': {
      need(d, actor, 'create_invites');
      d.invites = d.invites.filter((i) => !inviteDead(i, now));
      if (d.invites.length >= LIMITS.invites) fail(400, 'Too many active invites. Revoke some first.');
      const maxUses = op.maxUses ? Math.max(1, Math.min(1000, Math.floor(op.maxUses))) : null;
      const hours = op.expiresHours ? Math.max(1, Math.min(24 * 30, Math.floor(op.expiresHours))) : null;
      const inv: Invite = { code: ctx.inviteCode(), createdBy: actor, uses: 0, maxUses, expiresAt: hours ? now + hours * 3600e3 : null, createdAt: now };
      d.invites.push(inv);
      return { invite: inv };
    }
    case 'revoke_invite': {
      const inv = d.invites.find((i) => i.code === op.code) ?? fail(404, 'No such invite.');
      if (inv.createdBy !== actor) need(d, actor, 'manage_space');
      d.invites = d.invites.filter((i) => i.code !== op.code);
      return {};
    }
    case 'add_members': {
      if (d.kind !== 'group') fail(400, 'Servers grow through invites.');
      const ids = [...new Set(op.accountIds)].filter((id) => !d.members[id]);
      if (Object.keys(d.members).length + ids.length > memberCap(d)) fail(400, `Group chats hold up to ${LIMITS.groupMembers} people.`);
      for (const id of ids) d.members[id] = { joinedAt: now, roles: [], nickname: '' };
      return { added: ids };
    }
    case 'transfer_ownership': {
      if (d.ownerId !== actor) fail(403, 'Only the owner can transfer ownership.');
      if (!d.members[op.accountId]) fail(404, 'Not a member.');
      d.ownerId = op.accountId;
      return {};
    }
    case 'leave': {
      if (d.ownerId === actor) {
        const others = Object.keys(d.members).filter((m) => m !== actor);
        if (d.kind === 'server' || others.length === 0) fail(400, d.kind === 'server' ? 'Transfer ownership or delete the server first.' : 'Delete the group instead.');
        d.ownerId = others.sort((a, b) => d.members[a].joinedAt - d.members[b].joinedAt)[0];
      }
      delete d.members[actor];
      return { removed: [actor] };
    }
    case 'delete_space': {
      if (d.ownerId !== actor) fail(403, 'Only the owner can delete this.');
      return { deleted: true };
    }
    default:
      return fail(400, 'Unknown operation.');
  }
}

export const inviteDead = (i: Invite, now = Date.now()) => (i.expiresAt !== null && i.expiresAt <= now) || (i.maxUses !== null && i.uses >= i.maxUses);

/** Use an invite code. Mutates d. */
export function joinWithInvite(d: SpaceDoc, accountId: string, code: string, now = Date.now()) {
  const inv = d.invites.find((i) => i.code === code);
  if (!inv || inviteDead(inv, now)) fail(404, 'That invite is invalid or expired.');
  if (d.bans[accountId]) fail(403, "You're banned from this server.");
  if (d.members[accountId]) return;
  if (Object.keys(d.members).length >= memberCap(d)) fail(400, 'This space is full.');
  inv!.uses++;
  d.members[accountId] = { joinedAt: now, roles: [], nickname: '' };
}

// ------------------------------------------------------------------ views
export interface MemberView { id: string; username: string; displayName: string; avatar: string | null; accent: string; nickname: string; roles: string[]; presence: string | null; isOwner: boolean }
export interface SpaceView {
  id: string; kind: SpaceKind; name: string; description: string; icon: { emoji: string; color: string }; ownerId: string; createdAt: number;
  roles: Role[]; channels: Channel[]; members: MemberView[]; myPerms: Perm[]; canSend: Record<string, boolean>;
  invites: Invite[] | null; bans: { accountId: string; username: string; reason: string; at: number }[] | null;
}

/** What `viewer` is allowed to see of a space. */
export function viewFor(d: SpaceDoc, viewer: string, profile: (id: string) => Omit<MemberView, 'nickname' | 'roles' | 'isOwner'> | null): SpaceView {
  const p = permsOf(d, viewer);
  const channels = d.channels.filter((c) => canSeeChannel(d, viewer, c)).sort((a, b) => a.position - b.position);
  const members: MemberView[] = [];
  for (const [id, m] of Object.entries(d.members)) {
    const prof = profile(id);
    if (prof) members.push({ ...prof, nickname: m.nickname, roles: m.roles, isOwner: d.ownerId === id });
  }
  return {
    id: d.id, kind: d.kind, name: d.name, description: d.description, icon: d.icon, ownerId: d.ownerId, createdAt: d.createdAt,
    roles: [...d.roles].sort((a, b) => b.position - a.position), channels, members, myPerms: [...p],
    canSend: Object.fromEntries(channels.map((c) => [c.id, canSendIn(d, viewer, c)])),
    invites: p.has('create_invites') || p.has('manage_space') ? d.invites.filter((i) => !inviteDead(i)) : null,
    bans: p.has('manage_members') ? Object.entries(d.bans).map(([accountId, b]) => ({ accountId, username: profile(accountId)?.username ?? 'deleted', reason: b.reason, at: b.at })) : null,
  };
}
