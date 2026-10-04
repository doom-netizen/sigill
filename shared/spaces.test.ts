import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpace, applyOp, joinWithInvite, can, canSeeChannel, canSendIn, recipientsOf, viewFor, type SpaceDoc } from './spaces';

let n = 0;
const ctx = { newId: () => `id${++n}`, inviteCode: () => `CODE${++n}` };
const op = (d: SpaceDoc, actor: string, o: any) => applyOp(d, actor, o, ctx);

function server() {
  const d = createSpace({ id: 's1', kind: 'server', name: 'Night Shift', ownerId: 'own', newId: ctx.newId });
  const inv = op(d, 'own', { op: 'create_invite' }).invite!;
  for (const u of ['mod', 'mem', 'mem2']) joinWithInvite(d, u, inv.code);
  const modRole = d.roles.find((r) => r.name === 'Moderator')!;
  op(d, 'own', { op: 'set_member_roles', accountId: 'mod', roles: [modRole.id] });
  return { d, modRole };
}

test('defaults: channels, @everyone, owner has everything', () => {
  const { d } = server();
  assert.deepEqual(d.channels.map((c) => c.name), ['welcome', 'general', 'mods']);
  assert.ok(can(d, 'own', 'admin'));
  assert.ok(!can(d, 'mem', 'manage_channels'));
  assert.ok(can(d, 'mem', 'send_messages'));
});

test('private channels and announcements', () => {
  const { d } = server();
  const [welcome, general, mods] = d.channels;
  assert.ok(canSeeChannel(d, 'mod', mods));
  assert.ok(!canSeeChannel(d, 'mem', mods));
  assert.ok(!canSendIn(d, 'mem', welcome), 'announcements are staff-only');
  assert.ok(canSendIn(d, 'mod', welcome), 'manage_channels can post announcements');
  assert.deepEqual(recipientsOf(d, 'mod', mods).sort(), ['own']);
  assert.deepEqual(recipientsOf(d, 'mem', general).sort(), ['mem2', 'mod', 'own']);
  const v = viewFor(d, 'mem', (id) => ({ id, username: id, displayName: id, avatar: null, accent: '#fff', presence: null }));
  assert.ok(!v.channels.some((c) => c.name === 'mods'), 'hidden channels are not in the view');
  assert.equal(v.invites?.length, 1, 'members with create_invites see invites');
  assert.equal(v.bans, null, 'members without manage_members do not see bans');
});

test('role hierarchy', () => {
  const { d, modRole } = server();
  op(d, 'own', { op: 'create_role', name: 'Regular', color: '#ff0000', perms: ['send_messages'] });
  const regular = d.roles.find((r) => r.name === 'Regular')!;
  assert.ok(regular.position > modRole.position, 'owner creates roles at the top');
  // mod can't kick owner, can kick members, can't touch roles (no manage_roles)
  assert.throws(() => op(d, 'mod', { op: 'kick', accountId: 'own' }), /below/);
  assert.throws(() => op(d, 'mod', { op: 'set_member_roles', accountId: 'mem', roles: [] }), /Manage roles/);
  op(d, 'mod', { op: 'kick', accountId: 'mem2' });
  assert.ok(!d.members.mem2);
  // give mod manage_roles: can only assign roles below their top
  op(d, 'own', { op: 'update_role', roleId: modRole.id, perms: [...modRole.perms, 'manage_roles'] });
  assert.throws(() => op(d, 'mod', { op: 'set_member_roles', accountId: 'mem', roles: [regular.id] }), /below your highest/);
  op(d, 'own', { op: 'move_role', roleId: regular.id, dir: -1 });
  op(d, 'mod', { op: 'set_member_roles', accountId: 'mem', roles: [regular.id] });
  assert.deepEqual(d.members.mem.roles, [regular.id]);
  assert.throws(() => op(d, 'mod', { op: 'create_role', name: 'Boss', perms: ['admin'] }), /administrators/);
});

test('bans block rejoining; invites expire and run out', () => {
  const { d } = server();
  const inv = op(d, 'own', { op: 'create_invite', maxUses: 1 }).invite!;
  op(d, 'own', { op: 'ban', accountId: 'mem', reason: 'spam' });
  assert.throws(() => joinWithInvite(d, 'mem', inv.code), /banned/);
  joinWithInvite(d, 'new1', inv.code);
  assert.throws(() => joinWithInvite(d, 'new2', inv.code), /invalid or expired/);
  op(d, 'own', { op: 'unban', accountId: 'mem' });
});

test('channel names, slurs, limits', () => {
  const { d } = server();
  op(d, 'own', { op: 'create_channel', name: 'Late Night Talk!!' });
  assert.ok(d.channels.some((c) => c.name === 'late-night-talk'));
  assert.throws(() => op(d, 'own', { op: 'create_channel', name: 'f4ggots' }), /isn't allowed/);
  assert.throws(() => createSpace({ id: 'x', kind: 'server', name: 'n1gg3r club', ownerId: 'a', newId: ctx.newId }), /isn't allowed/);
  assert.throws(() => op(d, 'mem', { op: 'update_space', name: 'mine now' }), /Manage server/);
});

test('groups: add members, cap, owner leaves -> handed over', () => {
  const g = createSpace({ id: 'g1', kind: 'group', name: '', ownerId: 'a', newId: ctx.newId });
  assert.equal(g.name, 'Group chat');
  op(g, 'a', { op: 'add_members', accountIds: ['b', 'c'] });
  op(g, 'b', { op: 'add_members', accountIds: ['d'] });
  assert.equal(Object.keys(g.members).length, 4);
  assert.throws(() => op(g, 'a', { op: 'add_members', accountIds: Array.from({ length: 7 }, (_, i) => `x${i}`) }), /up to 10/);
  assert.throws(() => op(g, 'b', { op: 'kick', accountId: 'c' }), /owner/);
  op(g, 'a', { op: 'leave' });
  assert.equal(g.ownerId, 'b');
  assert.throws(() => op(g, 'a', { op: 'update_space', name: 'x' }), /not a member/);
});
