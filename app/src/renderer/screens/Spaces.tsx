import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Modal, Empty, Icon, Toggle, Segmented, timeAgo } from '../components/ui';
import { Avatar, Handle, ProfileCard } from '../components/ProfileCard';
import { PERMS, PERM_LABELS, type SpaceView, type Role, type Channel, type Perm } from '../../../../shared/spaces';
import type { ChatMessage, PublicProfile } from '../../core/types';
import { usePrefs } from '../components/Prefs';
import { MessageText, Reactions, MsgActions, ReplyQuote, Composer } from '../components/Messages';

const has = (sp: SpaceView, p: Perm) => sp.myPerms.includes(p);

/** Icon tile for a space (emoji on its color). */
export function SpaceIcon({ sp, size = 44 }: { sp: Pick<SpaceView, 'icon' | 'name'>; size?: number }) {
  return (
    <span className="space-icon" style={{ width: size, height: size, ['--sc' as any]: sp.icon.color, fontSize: size * 0.48 }} aria-hidden="true">
      {sp.icon.emoji}
    </span>
  );
}

// ------------------------------------------------------------ create / join
export function NewSpaceModal({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<'server' | 'group' | 'join'>('server');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🌙');
  const [color, setColor] = useState('#8b7cff');
  const [people, setPeople] = useState('');
  const [code, setCode] = useState('');
  const { busy, run } = useAction();
  const submit = async () => {
    const r = mode === 'join'
      ? await run(() => call<SpaceView>('spaceJoin', code), 'Joined')
      : await run(() => call<SpaceView>('spaceCreate', { kind: mode, name, emoji, color, members: people.split(/[\s,]+/).map((x) => x.replace(/^@/, '')).filter(Boolean) }), mode === 'server' ? 'Server created' : 'Group created');
    if (r) { onOpen(r.id); onClose(); }
  };
  return (
    <Modal title="Add a space" onClose={onClose}>
      <Segmented label="What to do" value={mode} onChange={setMode}
        options={[{ value: 'server', label: 'Create a server' }, { value: 'group', label: 'Start a group' }, { value: 'join', label: 'Join with invite' }]} />
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {mode === 'join' ? (
          <>
            <p className="muted small">Paste an invite code someone gave you.</p>
            <label className="field"><span>Invite code</span><input autoFocus value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="aB3xK9pQ" spellCheck={false} /></label>
          </>
        ) : (
          <>
            <p className="muted small">{mode === 'server'
              ? 'Servers have channels, roles and invites. Up to 100 members.'
              : 'A small private chat for up to 10 people. Anyone in the group can add people.'}</p>
            <div className="icon-pick">
              <SpaceIcon sp={{ icon: { emoji, color }, name }} size={56} />
              <label className="field"><span>Icon</span><input value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji icon" /></label>
              <label className="field color"><span>Color</span><span className="color-input"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></span></label>
            </div>
            <label className="field"><span>Name</span><input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={mode === 'server' ? 'Night Shift' : 'Optional'} /></label>
            {mode === 'group' && <label className="field"><span>People</span><input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="@nova, @kyo" spellCheck={false} /><small>Usernames, separated by commas.</small></label>}
          </>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || (mode === 'join' ? !code : mode === 'server' && !name.trim())}>
            {mode === 'join' ? 'Join' : mode === 'server' ? 'Create server' : 'Start group'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ space
export function SpaceScreen({ state, spaceId, onLeft, openDm }: { state: AppState; spaceId: string; onLeft: () => void; openDm: (username: string) => void }) {
  const sp = state.spaces.find((s) => s.id === spaceId);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(() => window.innerWidth > 1100);
  const [modal, setModal] = useState<null | 'settings' | 'invite' | { profile: string }>(null);
  const [menu, setMenu] = useState(false);
  const [mobileView, setMobileView] = useState<'channels' | 'chat'>('channels');
  const { run } = useAction();

  useEffect(() => { if (!sp) onLeft(); }, [sp, onLeft]);
  const channels = sp?.channels ?? [];
  const current = channels.find((c) => c.id === channelId) ?? channels.find((c) => c.kind === 'text') ?? channels[0];
  useEffect(() => { if (current && state.channels[current.id]?.unread) call('markChannelRead', current.id); }, [current?.id, state.channels[current?.id ?? '']?.unread]);
  if (!sp || !current) return <Empty title="Loading" />;

  const grouped = channels.reduce<Record<string, Channel[]>>((acc, c) => { (acc[c.category || ''] ??= []).push(c); return acc; }, {});
  const canManage = sp.kind === 'server' && (['manage_space', 'manage_channels', 'manage_roles', 'manage_members'] as Perm[]).some((p) => has(sp, p));
  const isOwner = sp.ownerId === state.me?.id;

  return (
    <div className={`space ${showMembers ? 'with-members' : ''} mv-${mobileView}`}>
      <aside className="space-side">
        <header className="space-head">
          <button className="space-title" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <span>{sp.name}</span><Icon name="more" size={16} />
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              {has(sp, 'create_invites') && <button onClick={() => { setMenu(false); setModal('invite'); }}>{sp.kind === 'group' ? 'Add people' : 'Invite people'}</button>}
              {(canManage || sp.kind === 'group') && <button onClick={() => { setMenu(false); setModal('settings'); }}>{sp.kind === 'group' ? 'Group settings' : 'Server settings'}</button>}
              {isOwner
                ? <button className="danger" onClick={() => { setMenu(false); setModal('settings'); }}>{sp.kind === 'group' ? 'Delete group' : 'Delete server'}…</button>
                : <button className="danger" onClick={() => { setMenu(false); run(() => call('spaceOp', sp.id, { op: 'leave' }), `Left ${sp.name}`).then(onLeft); }}>Leave</button>}
            </div>
          )}
        </header>
        {sp.description && <p className="space-desc">{sp.description}</p>}
        <nav className="channel-list" aria-label="Channels">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat || '_'} className="channel-group">
              {cat && <h4>{cat}</h4>}
              {list.map((c) => {
                const unread = state.channels[c.id]?.unread ?? 0;
                return (
                  <button key={c.id} className={`channel ${c.id === current.id ? 'on' : ''} ${unread ? 'unread' : ''}`} onClick={() => { setChannelId(c.id); setMobileView('chat'); }}>
                    <span className="ch-glyph" aria-hidden="true">{c.kind === 'announcement' ? '📣' : '#'}</span>
                    <span className="ch-name">{c.name}</span>
                    {c.private && <Icon name="lock" size={12} />}
                    {unread > 0 && <span className="pill">{unread}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <ChannelChat key={current.id} sp={sp} ch={current} state={state} onBack={() => setMobileView('channels')}
        toggleMembers={() => setShowMembers(!showMembers)} showMembers={showMembers} openProfile={(u) => setModal({ profile: u })} />

      {showMembers && <MemberList sp={sp} openProfile={(u) => setModal({ profile: u })} />}

      {modal === 'settings' && <SpaceSettings sp={sp} meId={state.me!.id} onClose={() => setModal(null)} onGone={onLeft} />}
      {modal === 'invite' && <InviteModal sp={sp} onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && <MemberProfileModal username={modal.profile} sp={sp} meId={state.me!.id} onClose={() => setModal(null)} openDm={openDm} />}
    </div>
  );
}

function topRole(sp: SpaceView, roles: string[]): Role | undefined {
  return sp.roles.filter((r) => roles.includes(r.id)).sort((a, b) => b.position - a.position)[0];
}

function ChannelChat({ sp, ch, state, onBack, toggleMembers, showMembers, openProfile }: {
  sp: SpaceView; ch: Channel; state: AppState; onBack: () => void; toggleMembers: () => void; showMembers: boolean; openProfile: (u: string) => void;
}) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const { run } = useAction();
  const { time } = usePrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const box = state.channels[ch.id]?.messages ?? [];
  const members = useMemo(() => new Map(sp.members.map((m) => [m.id, m])), [sp.members]);
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [box.length]);
  useEffect(() => { setReplyTo(null); setEditing(null); }, [ch.id]);
  const canSend = sp.canSend[ch.id];
  const where = { spaceId: sp.id, channelId: ch.id };
  const meId = state.me!.id;
  const nameOf = (id: string) => { const m = members.get(id); return m ? (m.nickname || m.displayName || `@${m.username}`) : 'Former member'; };
  const jump = (id: string) => document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <section className="channel-chat">
      <header className="thread-head">
        <button className="icon-btn back-btn" aria-label="Back to channels" onClick={onBack}><Icon name="back" /></button>
        <div className="ch-title">
          <b>{ch.kind === 'announcement' ? '📣' : '#'} {ch.name}</b>
          {ch.topic && <small>{ch.topic}</small>}
        </div>
        <div className="thread-tools">
          <span className="chip" title="Messages are end-to-end encrypted for each member who can read this channel"><Icon name="lock" size={14} />Encrypted</span>
          <button className={`icon-btn ${showMembers ? 'on' : ''}`} aria-label="Members" aria-pressed={showMembers} onClick={toggleMembers}><Icon name="user" /></button>
        </div>
      </header>
      <div className="messages" ref={scroller}>
        <div className="channel-hello">
          <span className="ch-big">{ch.kind === 'announcement' ? '📣' : '#'}</span>
          <h3>Welcome to #{ch.name}</h3>
          <p>Messages here are end-to-end encrypted separately for each member who can read this channel. Only members online right now receive them, and Sigil doesn't keep a copy.</p>
        </div>
        {box.map((m, i) => {
          const mem = members.get(m.author ?? '');
          const prev = box[i - 1];
          const grouped = prev && prev.author === m.author && m.ts - prev.ts < 300_000 && !m.replyTo;
          const role = mem ? topRole(sp, mem.roles) : undefined;
          const mentionsMe = !m.deleted && new RegExp(`(^|\\W)@${state.me!.username}\\b`).test(m.text);
          return (
            <div key={m.id} id={`m-${m.id}`} className={`cmsg ${grouped ? 'grouped' : ''} ${m.status} ${mentionsMe ? 'mention' : ''} ${replyTo?.id === m.id || editing?.id === m.id ? 'targeted' : ''} ${tapped === m.id ? 'show-actions' : ''}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) setTapped(tapped === m.id ? null : m.id); }}>
              <MsgActions m={m} where={where} mine={m.author === meId} onReply={() => { setEditing(null); setReplyTo(m); }} onEdit={() => { setReplyTo(null); setEditing(m); }} />
              {m.replyTo && <div className="cmsg-reply"><ReplyQuote r={m.replyTo} nameOf={nameOf} onJump={() => jump(m.replyTo!.id)} /></div>}
              {!grouped ? (
                <button className="cmsg-av" onClick={() => mem && openProfile(mem.username)} aria-label={mem ? `@${mem.username}` : 'Unknown member'}>
                  <Avatar p={{ id: mem?.id, avatar: mem?.avatar ?? null, username: mem?.username ?? '?', theme: { accent: mem?.accent } as any }} size={36} />
                </button>
              ) : <span className="cmsg-gutter" />}
              <div className="cmsg-body">
                {!grouped && (
                  <div className="cmsg-head">
                    <button className="cmsg-name" style={{ color: role?.color }} onClick={() => mem && openProfile(mem.username)}>{mem?.nickname || mem?.displayName || 'Former member'}</button>
                    {mem && <span className="cmsg-handle">@{mem.username}</span>}
                    <time>{time(m.ts)}</time>
                  </div>
                )}
                <div className="cmsg-text"><MessageText m={m} /></div>
                <Reactions m={m} where={where} nameOf={nameOf} />
                {m.note && <div className={`cmsg-note ${m.status === 'failed' ? 'bad' : ''}`}>{m.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {canSend ? (
        <Composer placeholder={`Message #${ch.name}`} disabled={state.connection !== 'online'} nameOf={nameOf}
          replyTo={replyTo} setReplyTo={setReplyTo} editing={editing} setEditing={setEditing}
          onSend={(t, r) => run(() => call('sendChannel', sp.id, ch.id, t, r))}
          onEdit={(id, t) => run(() => call('editMessage', where, id, t))} />
      ) : (
        <div className="composer-locked">{ch.kind === 'announcement' ? 'Only people who manage channels can post announcements.' : "You don't have permission to send messages here."}</div>
      )}
    </section>
  );
}

function MemberList({ sp, openProfile }: { sp: SpaceView; openProfile: (u: string) => void }) {
  const hoisted = sp.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
  const groups: { title: string; color?: string; list: SpaceView['members'] }[] = [];
  const placed = new Set<string>();
  const online = (m: SpaceView['members'][number]) => m.presence && m.presence !== 'offline';
  for (const r of hoisted) {
    const list = sp.members.filter((m) => !placed.has(m.id) && online(m) && topRole(sp, m.roles.filter((x) => hoisted.some((h) => h.id === x)))?.id === r.id);
    list.forEach((m) => placed.add(m.id));
    if (list.length) groups.push({ title: r.name, color: r.color, list });
  }
  const rest = sp.members.filter((m) => !placed.has(m.id));
  const on = rest.filter(online), off = rest.filter((m) => !online(m));
  if (on.length) groups.push({ title: 'Online', list: on });
  if (off.length) groups.push({ title: 'Offline', list: off });
  return (
    <aside className="member-list" aria-label="Members">
      {groups.map((g) => (
        <div key={g.title} className="member-group">
          <h4>{g.title}, {g.list.length}</h4>
          {g.list.map((m) => {
            const role = topRole(sp, m.roles);
            return (
              <button key={m.id} className={`member ${online(m) ? '' : 'off'}`} onClick={() => openProfile(m.username)}>
                <Avatar p={{ id: m.id, avatar: m.avatar, username: m.username, theme: { accent: m.accent } as any }} size={30} presence={m.presence} />
                <span><b style={{ color: role?.color }}>{m.nickname || m.displayName}</b>{m.isOwner && <i title="Owner">👑</i>}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

function MemberProfileModal({ username, sp, meId, onClose, openDm }: { username: string; sp: SpaceView; meId: string; onClose: () => void; openDm: (u: string) => void }) {
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call<PublicProfile>('lookup', username).then(setP).catch((e) => setErr(e.message)); }, [username]);
  const mem = sp.members.find((m) => m.username === username);
  const roles = sp.roles.filter((r) => mem?.roles.includes(r.id));
  return (
    <Modal title={`@${username}`} onClose={onClose}>
      {err && <p className="muted">{err === 'No profile with that username.' ? 'This member keeps their profile private.' : err}</p>}
      {p && <div className="modal-card"><ProfileCard p={p} actions={p.id !== meId ? <button className="pc-btn" onClick={() => { openDm(username); onClose(); }}>Message</button> : undefined} /></div>}
      {roles.length > 0 && <div className="role-chips">{roles.map((r) => <span key={r.id} className="role-chip" style={{ ['--rc' as any]: r.color }}>{r.name}</span>)}</div>}
    </Modal>
  );
}

function InviteModal({ sp, onClose }: { sp: SpaceView; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [people, setPeople] = useState('');
  const [maxUses, setMaxUses] = useState(0);
  const [hours, setHours] = useState(24);
  const [copied, setCopied] = useState(false);
  const { busy, run } = useAction();
  if (sp.kind === 'group') {
    return (
      <Modal title="Add people" onClose={onClose}>
        <label className="field"><span>Usernames</span><input autoFocus value={people} onChange={(e) => setPeople(e.target.value)} placeholder="@nova, @kyo" /></label>
        <div className="row end">
          <button className="btn primary" disabled={busy || !people.trim()} onClick={async () => {
            if (await run(() => call('spaceOp', sp.id, { op: 'add_members', usernames: people.split(/[\s,]+/).map((x) => x.replace(/^@/, '')).filter(Boolean) }), 'Added')) onClose();
          }}>Add to group</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Invite people to ${sp.name}`} onClose={onClose}>
      <p className="muted small">Anyone with the code can join until it expires or runs out of uses.</p>
      <div className="row two">
        <label className="field"><span>Expires</span>
          <select value={hours} onChange={(e) => setHours(+e.target.value)}>
            <option value={1}>1 hour</option><option value={24}>1 day</option><option value={168}>7 days</option><option value={0}>Never</option>
          </select>
        </label>
        <label className="field"><span>Max uses</span>
          <select value={maxUses} onChange={(e) => setMaxUses(+e.target.value)}>
            <option value={0}>No limit</option><option value={1}>1 use</option><option value={5}>5 uses</option><option value={25}>25 uses</option><option value={100}>100 uses</option>
          </select>
        </label>
      </div>
      {code ? (
        <div className="invite-code">
          <code>{code}</code>
          <button className="btn sm" onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {})}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      ) : (
        <div className="row end">
          <button className="btn primary" disabled={busy} onClick={async () => {
            const r = await run(() => call<SpaceView>('spaceOp', sp.id, { op: 'create_invite', maxUses: maxUses || null, expiresHours: hours || null }));
            const newest = r?.invites?.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
            if (newest) setCode(newest.code);
          }}>Create invite code</button>
        </div>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------- settings
type STab = 'overview' | 'roles' | 'channels' | 'members' | 'invites' | 'bans' | 'danger';

function SpaceSettings({ sp, meId, onClose, onGone }: { sp: SpaceView; meId: string; onClose: () => void; onGone: () => void }) {
  const isOwner = sp.ownerId === meId;
  const tabs: [STab, string, boolean][] = [
    ['overview', 'Overview', sp.kind === 'group' || has(sp, 'manage_space')],
    ['roles', 'Roles', sp.kind === 'server' && has(sp, 'manage_roles')],
    ['channels', 'Channels', sp.kind === 'server' && has(sp, 'manage_channels')],
    ['members', 'Members', has(sp, 'manage_members') || has(sp, 'manage_roles') || sp.kind === 'group'],
    ['invites', 'Invites', sp.kind === 'server' && !!sp.invites],
    ['bans', 'Bans', sp.kind === 'server' && !!sp.bans],
    ['danger', isOwner ? 'Ownership' : 'Leave', true],
  ];
  const visible = tabs.filter((t) => t[2]);
  const [tab, setTab] = useState<STab>(visible[0][0]);
  const { run } = useAction();
  const op = (o: Record<string, unknown>, ok?: string) => run(() => call('spaceOp', sp.id, o), ok);

  return (
    <Modal title={sp.kind === 'group' ? 'Group settings' : 'Server settings'} onClose={onClose} wide>
      <div className="settings-split">
        <nav className="settings-nav" role="tablist">
          {visible.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <div className="settings-body">
          {tab === 'overview' && <OverviewTab sp={sp} op={op} />}
          {tab === 'roles' && <RolesTab sp={sp} op={op} />}
          {tab === 'channels' && <ChannelsTab sp={sp} op={op} />}
          {tab === 'members' && <MembersTab sp={sp} meId={meId} op={op} />}
          {tab === 'invites' && <InvitesTab sp={sp} op={op} />}
          {tab === 'bans' && <BansTab sp={sp} op={op} />}
          {tab === 'danger' && <DangerTab sp={sp} meId={meId} op={op} onGone={() => { onClose(); onGone(); }} />}
        </div>
      </div>
    </Modal>
  );
}

type Op = (o: Record<string, unknown>, ok?: string) => Promise<unknown>;

function OverviewTab({ sp, op }: { sp: SpaceView; op: Op }) {
  const [f, setF] = useState({ name: sp.name, description: sp.description, emoji: sp.icon.emoji, color: sp.icon.color });
  const dirty = f.name !== sp.name || f.description !== sp.description || f.emoji !== sp.icon.emoji || f.color !== sp.icon.color;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); op({ op: 'update_space', ...f }, 'Saved'); }}>
      <div className="icon-pick">
        <SpaceIcon sp={{ icon: { emoji: f.emoji, color: f.color }, name: f.name }} size={64} />
        <label className="field"><span>Icon</span><input value={f.emoji} maxLength={4} onChange={(e) => setF({ ...f, emoji: e.target.value })} /></label>
        <label className="field color"><span>Color</span><span className="color-input"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></span></label>
      </div>
      <label className="field"><span>Name</span><input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Description <em>{f.description.length}/300</em></span><textarea rows={3} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="row end"><button className="btn primary" disabled={!dirty} type="submit">Save changes</button></div>
    </form>
  );
}

function RolesTab({ sp, op }: { sp: SpaceView; op: Op }) {
  const [sel, setSel] = useState<string | null>(sp.roles.find((r) => !r.isDefault)?.id ?? sp.roles[0].id);
  const role = sp.roles.find((r) => r.id === sel);
  const counts = (id: string) => sp.members.filter((m) => m.roles.includes(id)).length;
  return (
    <div className="roles-split">
      <div className="role-col">
        <button className="btn sm" onClick={() => op({ op: 'create_role', name: 'new role', color: '#9aa0b5', perms: ['send_messages'] }, 'Role created')}>Create role</button>
        <ul>
          {sp.roles.map((r) => (
            <li key={r.id}><button className={sel === r.id ? 'on' : ''} onClick={() => setSel(r.id)}><i style={{ background: r.color }} />{r.name}<small>{r.isDefault ? 'everyone' : counts(r.id)}</small></button></li>
          ))}
        </ul>
        <p className="fine">Higher roles outrank lower ones. You can only edit roles below your own.</p>
      </div>
      {role && <RoleEditor key={role.id} role={role} op={op} />}
    </div>
  );
}

function RoleEditor({ role, op }: { role: Role; op: Op }) {
  const [f, setF] = useState({ name: role.name, color: role.color, hoist: role.hoist, perms: role.perms });
  const toggle = (p: Perm) => setF({ ...f, perms: f.perms.includes(p) ? f.perms.filter((x) => x !== p) : [...f.perms, p] });
  return (
    <form className="role-edit stack" onSubmit={(e) => { e.preventDefault(); op({ op: 'update_role', roleId: role.id, ...(role.isDefault ? { color: f.color, perms: f.perms } : f) }, 'Role saved'); }}>
      <div className="row two">
        <label className="field"><span>Name</span><input value={f.name} maxLength={24} disabled={role.isDefault} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field color"><span>Color</span><span className="color-input"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /><code>{f.color}</code></span></label>
      </div>
      {!role.isDefault && <Toggle label="Show separately in the member list" checked={f.hoist} onChange={(hoist) => setF({ ...f, hoist })} />}
      <h4>Permissions</h4>
      {PERMS.map((p) => <Toggle key={p} label={PERM_LABELS[p].label} hint={PERM_LABELS[p].description} checked={f.perms.includes(p)} onChange={() => toggle(p)} />)}
      <div className="row end wrap">
        {!role.isDefault && <>
          <button type="button" className="btn ghost sm" onClick={() => op({ op: 'move_role', roleId: role.id, dir: 1 })}>Move up</button>
          <button type="button" className="btn ghost sm" onClick={() => op({ op: 'move_role', roleId: role.id, dir: -1 })}>Move down</button>
          <button type="button" className="btn danger ghost sm" onClick={() => op({ op: 'delete_role', roleId: role.id }, 'Role deleted')}>Delete role</button>
        </>}
        <button type="submit" className="btn primary sm">Save role</button>
      </div>
    </form>
  );
}

function ChannelsTab({ sp, op }: { sp: SpaceView; op: Op }) {
  const [sel, setSel] = useState<string | null>(null);
  const ch = sp.channels.find((c) => c.id === sel);
  return (
    <div className="roles-split">
      <div className="role-col">
        <button className="btn sm" onClick={() => op({ op: 'create_channel', name: 'new-channel', category: sp.channels.at(-1)?.category ?? '' }, 'Channel created')}>Create channel</button>
        <ul>
          {sp.channels.map((c) => (
            <li key={c.id}><button className={sel === c.id ? 'on' : ''} onClick={() => setSel(c.id)}><span className="ch-glyph">{c.kind === 'announcement' ? '📣' : '#'}</span>{c.name}{c.private && <Icon name="lock" size={12} />}<small>{c.category}</small></button></li>
          ))}
        </ul>
      </div>
      {ch ? <ChannelEditor key={ch.id} ch={ch} sp={sp} op={op} onDeleted={() => setSel(null)} /> : <p className="muted small">Pick a channel to edit it.</p>}
    </div>
  );
}

function ChannelEditor({ ch, sp, op, onDeleted }: { ch: Channel; sp: SpaceView; op: Op; onDeleted: () => void }) {
  const [f, setF] = useState({ name: ch.name, topic: ch.topic, category: ch.category, kind: ch.kind, private: ch.private, allowedRoles: ch.allowedRoles });
  const roles = sp.roles.filter((r) => !r.isDefault);
  return (
    <form className="role-edit stack" onSubmit={(e) => { e.preventDefault(); op({ op: 'update_channel', channelId: ch.id, ...f }, 'Channel saved'); }}>
      <div className="row two">
        <label className="field"><span>Name</span><input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Category</span><input value={f.category} maxLength={24} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="None" /></label>
      </div>
      <label className="field"><span>Topic</span><input value={f.topic} maxLength={200} onChange={(e) => setF({ ...f, topic: e.target.value })} /></label>
      <div className="field"><span>Type</span>
        <Segmented label="Type" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'text', label: 'Text' }, { value: 'announcement', label: 'Announcement' }]} />
      </div>
      <Toggle label="Private channel" hint="Only the roles you pick (and administrators) can see it." checked={f.private} onChange={(v) => setF({ ...f, private: v })} />
      {f.private && (
        <div className="role-picks">
          {roles.length === 0 && <p className="fine">Create a role first.</p>}
          {roles.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={f.allowedRoles.includes(r.id)} onChange={() => setF({ ...f, allowedRoles: f.allowedRoles.includes(r.id) ? f.allowedRoles.filter((x) => x !== r.id) : [...f.allowedRoles, r.id] })} />
              <i style={{ background: r.color }} />{r.name}
            </label>
          ))}
        </div>
      )}
      <div className="row end wrap">
        <button type="button" className="btn ghost sm" onClick={() => op({ op: 'move_channel', channelId: ch.id, dir: -1 })}>Move up</button>
        <button type="button" className="btn ghost sm" onClick={() => op({ op: 'move_channel', channelId: ch.id, dir: 1 })}>Move down</button>
        <button type="button" className="btn danger ghost sm" onClick={async () => { if (await op({ op: 'delete_channel', channelId: ch.id }, 'Channel deleted')) onDeleted(); }}>Delete channel</button>
        <button type="submit" className="btn primary sm">Save channel</button>
      </div>
    </form>
  );
}

function MembersTab({ sp, meId, op }: { sp: SpaceView; meId: string; op: Op }) {
  const [sel, setSel] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const m = sp.members.find((x) => x.id === sel);
  const roles = sp.roles.filter((r) => !r.isDefault);
  return (
    <div className="roles-split">
      <div className="role-col">
        <ul>
          {sp.members.map((x) => (
            <li key={x.id}><button className={sel === x.id ? 'on' : ''} onClick={() => setSel(x.id)}>
              <Avatar p={{ id: x.id, avatar: x.avatar, username: x.username, theme: { accent: x.accent } as any }} size={22} />{x.nickname || x.displayName}<small>@{x.username}{x.isOwner ? ' 👑' : ''}</small>
            </button></li>
          ))}
        </ul>
      </div>
      {m ? (
        <div className="role-edit stack" key={m.id}>
          <div className="row"><Avatar p={{ id: m.id, avatar: m.avatar, username: m.username, theme: { accent: m.accent } as any }} size={40} /><span><Handle name={m.username} /></span></div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('nick'); op({ op: 'set_nickname', accountId: m.id, nickname: String(v ?? '') }, 'Nickname saved'); }}>
            <label className="field grow"><span>Nickname in this {sp.kind}</span><input name="nick" defaultValue={m.nickname} maxLength={32} placeholder={m.displayName} /></label>
            <button className="btn sm" type="submit">Save</button>
          </form>
          {sp.kind === 'server' && has(sp, 'manage_roles') && (
            <>
              <h4>Roles</h4>
              <div className="role-picks">
                {roles.map((r) => (
                  <label key={r.id} className="check">
                    <input type="checkbox" checked={m.roles.includes(r.id)} onChange={() => op({ op: 'set_member_roles', accountId: m.id, roles: m.roles.includes(r.id) ? m.roles.filter((x) => x !== r.id) : [...m.roles, r.id] })} />
                    <i style={{ background: r.color }} />{r.name}
                  </label>
                ))}
              </div>
            </>
          )}
          {m.id !== meId && !m.isOwner && (
            <>
              <h4>Moderation</h4>
              <div className="row wrap">
                <button className="btn ghost sm" onClick={() => op({ op: 'kick', accountId: m.id }, `Removed @${m.username}`).then(() => setSel(null))}>{sp.kind === 'group' ? 'Remove from group' : 'Kick'}</button>
                {sp.kind === 'server' && <>
                  <input className="grow-input" value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="Ban reason (optional)" maxLength={200} aria-label="Ban reason" />
                  <button className="btn danger sm" onClick={() => op({ op: 'ban', accountId: m.id, reason: banReason }, `Banned @${m.username}`).then(() => setSel(null))}>Ban</button>
                </>}
              </div>
            </>
          )}
        </div>
      ) : <p className="muted small">Pick a member.</p>}
    </div>
  );
}

function InvitesTab({ sp, op }: { sp: SpaceView; op: Op }) {
  const list = sp.invites ?? [];
  return (
    <div className="stack">
      <div className="row"><button className="btn sm" onClick={() => op({ op: 'create_invite', expiresHours: 168 }, 'Invite created')}>Create a 7-day invite</button></div>
      {list.length === 0 ? <p className="muted small">No active invites.</p> : (
        <ul className="invite-list">
          {list.map((i) => {
            const by = sp.members.find((m) => m.id === i.createdBy);
            return (
              <li key={i.code}>
                <code>{i.code}</code>
                <span>{i.uses}{i.maxUses ? `/${i.maxUses}` : ''} uses, {i.expiresAt ? `expires ${timeAgo(i.expiresAt).replace('just now', 'soon')}` : 'never expires'}{by ? `, by @${by.username}` : ''}</span>
                <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(i.code).catch(() => {})}>Copy</button>
                <button className="btn ghost sm" onClick={() => op({ op: 'revoke_invite', code: i.code }, 'Invite revoked')}>Revoke</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BansTab({ sp, op }: { sp: SpaceView; op: Op }) {
  const list = sp.bans ?? [];
  if (!list.length) return <p className="muted small">Nobody is banned.</p>;
  return (
    <ul className="invite-list">
      {list.map((b) => (
        <li key={b.accountId}><Handle name={b.username} /><span>{b.reason || 'No reason given'}, {timeAgo(b.at)}</span><button className="btn ghost sm" onClick={() => op({ op: 'unban', accountId: b.accountId }, 'Unbanned')}>Unban</button></li>
      ))}
    </ul>
  );
}

function DangerTab({ sp, meId, op, onGone }: { sp: SpaceView; meId: string; op: Op; onGone: () => void }) {
  const isOwner = sp.ownerId === meId;
  const [to, setTo] = useState('');
  const [confirm, setConfirm] = useState('');
  if (!isOwner) {
    return (
      <div className="stack">
        <p className="muted">Leaving removes you from {sp.name}. You'll need a new invite to come back.</p>
        <div className="row"><button className="btn danger" onClick={async () => { if (await op({ op: 'leave' }, `Left ${sp.name}`)) onGone(); }}>Leave {sp.kind}</button></div>
      </div>
    );
  }
  const others = sp.members.filter((m) => m.id !== meId);
  return (
    <div className="stack">
      <h4>Transfer ownership</h4>
      <div className="row">
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="New owner"><option value="">Pick a member</option>{others.map((m) => <option key={m.id} value={m.id}>@{m.username}</option>)}</select>
        <button className="btn sm" disabled={!to} onClick={() => op({ op: 'transfer_ownership', accountId: to }, 'Ownership transferred')}>Transfer</button>
      </div>
      {sp.kind === 'group' && others.length > 0 && <div className="row"><button className="btn ghost" onClick={async () => { if (await op({ op: 'leave' }, 'Left the group')) onGone(); }}>Leave group (the next member becomes owner)</button></div>}
      <h4>Delete {sp.kind}</h4>
      <p className="muted small">This deletes {sp.name} for everyone. Type its name to confirm.</p>
      <div className="row">
        <input className="grow-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={sp.name} aria-label="Type the name to confirm" />
        <button className="btn danger" disabled={confirm !== sp.name} onClick={async () => { if (await op({ op: 'delete_space' }, 'Deleted')) onGone(); }}>Delete</button>
      </div>
    </div>
  );
}
