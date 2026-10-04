import { useCallback, useEffect, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Empty, Segmented, timeAgo, Toggle, Icon, Modal } from '../components/ui';
import type { PlatformSettings, UpdatePost } from '../../../../shared/platform';
import { Avatar, Handle, ProfileCard } from '../components/ProfileCard';
import { BadgeIcon } from '../components/Badges';
import { BADGES, CATALOG, CATEGORIES, HOUSES } from '../../../../shared/badges';
import { STAFF_ACTIONS, DURATIONS, type StaffActionDef, type AuditEntry } from '../../../../shared/staffActions';
import { COSMETICS, TITLE_PRESETS, MAX_TITLES, RARITY_TONE } from '../../../../shared/economy';
import { Credits } from './Market';

type Tab = 'dashboard' | 'accounts' | 'queue' | 'reports' | 'platform' | 'audit' | 'invites';

interface Overview {
  stats: { accounts: number; online: number; openReports: number; suspended?: number; muted?: number };
  claims: { id: string; name: string; tier: string; status: string; current: string; accountId: string; createdAt: number; availableAt: number | null; accountCreated: number }[];
  reports: { id: string; reason: string; details: string; createdAt: number; targetId: string; target: string | null; reporter: string | null }[];
  audit?: AuditEntry[];
}
interface Row { id: string; username: string; displayName: string; createdAt: number; roles: string[]; avatar: string | null; theme: any; banned: boolean; muted: boolean; frozen: boolean; flagged: boolean; openReports: number }

const FILTERS = [
  { value: '', label: 'All' }, { value: 'reported', label: 'Reported' }, { value: 'suspended', label: 'Suspended' },
  { value: 'muted', label: 'Restricted' }, { value: 'locked', label: 'Locked' }, { value: 'new', label: 'New' },
  { value: 'short', label: 'Short names' }, { value: 'staff', label: 'Staff' }, { value: 'flagged', label: 'Flagged' },
];

const until = (t: number | null) => (!t ? '' : t > 8e15 ? 'until further notice' : `until ${new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
const EXTRA_LABELS: Record<string, string> = {
  grant_credits: 'Sent credits', set_titles: 'Set titles', grant_cosmetic: 'Gifted', revoke_cosmetic: 'Took back', remove_listing: 'Removed listing',
  grant_badge: 'Granted badge', revoke_badge: 'Revoked badge', set_supporter: 'Set supporter date', set_booster: 'Set booster date', set_house: 'Set house',
  set_roles: 'Set roles', platform: 'Changed platform settings', post_update: 'Posted update', delete_update: 'Deleted update', broadcast: 'Sent announcement',
  approve_claim: 'Approved claim', deny_claim: 'Denied claim', dismiss_report: 'Dismissed report', close_report: 'Handled report',
};
const actionLabel = (id: string) => EXTRA_LABELS[id] ?? STAFF_ACTIONS.find((a) => a.id === id)?.label ?? id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function Staff({ state }: { state: AppState }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [ov, setOv] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { run } = useAction();
  const load = useCallback(() => run(() => call<Overview>('staffOverview')).then((r) => r && setOv(r)), [run]);
  useEffect(() => { load(); }, [load]);
  const open = (id: string) => { setSelected(id); setTab('accounts'); };

  const s = ov?.stats;
  return (
    <div className="page staff wide">
      <header className="page-head">
        <h1>Staff</h1>
        {s && (
          <div className="stat-row">
            <span><b>{s.accounts}</b> accounts</span>
            <span><b>{s.online}</b> online</span>
            <span className={s.openReports ? 'warn' : ''}><b>{s.openReports}</b> open reports</span>
            <span><b>{ov!.claims.length}</b> in queue</span>
            {s.suspended != null && <span><b>{s.suspended}</b> suspended</span>}
            {s.muted != null && <span><b>{s.muted}</b> restricted</span>}
          </div>
        )}
      </header>
      <div className="tabs" role="tablist">
        {([['dashboard', 'Dashboard'], ['accounts', 'Accounts'], ['queue', `Short-name queue${ov?.claims.length ? ` (${ov.claims.length})` : ''}`], ['reports', `Reports${ov?.reports.length ? ` (${ov.reports.length})` : ''}`], ['platform', 'Platform'], ['audit', 'Audit log'], ['invites', 'Invites']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { if (id === 'accounts' && tab === 'accounts') setSelected(null); setTab(id); load(); }}>{label}</button>
        ))}
      </div>

      {tab === 'accounts' && <Accounts selected={selected} setSelected={setSelected} meId={state.me!.id} isFounder={!!state.me?.roles.includes('founder')} onChange={load} />}
      {tab === 'queue' && <Queue ov={ov} reload={load} open={open} />}
      {tab === 'reports' && <Reports ov={ov} reload={load} open={open} />}
      {tab === 'dashboard' && <Dashboard go={setTab} />}
      {tab === 'platform' && <Platform />}
      {tab === 'audit' && <Audit />}
      {tab === 'invites' && <Invites />}
    </div>
  );
}

// ------------------------------------------------------------------ accounts
function Accounts({ selected, setSelected, meId, isFounder, onChange }: { selected: string | null; setSelected: (id: string | null) => void; meId: string; isFounder: boolean; onChange: () => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const { run } = useAction();
  const search = useCallback(() => run(() => call<Row[]>('staffAccounts', q, filter)).then((r) => r && setRows(r)), [q, filter, run]);
  useEffect(() => { const t = setTimeout(search, 200); return () => clearTimeout(t); }, [search]);

  return (
    <div className={`staff-split ${selected ? 'has-detail' : ''}`}>
      <div className="acct-list">
        <div className="at-input inline"><b>@</b><input value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} placeholder="search username or display name" aria-label="Search accounts" /></div>
        <div className="filter-row">
          {FILTERS.map((f) => <button key={f.value} className={`chip ${filter === f.value ? 'accent' : ''}`} onClick={() => setFilter(f.value)}>{f.label}</button>)}
        </div>
        {rows?.length === 0 && <p className="muted small">No accounts match.</p>}
        <ul>
          {rows?.map((r) => (
            <li key={r.id}>
              <button className={`acct-row ${selected === r.id ? 'on' : ''}`} onClick={() => setSelected(r.id)}>
                <Avatar p={{ id: r.id, avatar: r.avatar, username: r.username, theme: r.theme }} size={32} />
                <span className="acct-main">
                  <Handle name={r.username} />
                  <small>{r.displayName || 'No display name'}, joined {timeAgo(r.createdAt)}</small>
                </span>
                <span className="flags">
                  {r.roles.includes('staff') && <i className="flag staff">Staff</i>}
                  {r.banned && <i className="flag bad">Suspended</i>}
                  {r.muted && <i className="flag warn">Restricted</i>}
                  {r.frozen && <i className="flag warn">Locked</i>}
                  {r.flagged && <i className="flag">Flagged</i>}
                  {r.openReports > 0 && <i className="flag bad">{r.openReports} report{r.openReports > 1 ? 's' : ''}</i>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="acct-detail">
        {selected ? <AccountDetail key={selected} id={selected} meId={meId} isFounder={isFounder} onChange={() => { search(); onChange(); }} onClose={() => setSelected(null)} />
          : <Empty title="Pick an account">Search on the left, or open one from a report or the queue.</Empty>}
      </div>
    </div>
  );
}

function AccountDetail({ id, meId, isFounder, onChange, onClose }: { id: string; meId: string; isFounder: boolean; onChange: () => void; onClose: () => void }) {
  const [a, setA] = useState<any>(null);
  const [tab, setTab] = useState<'overview' | 'actions' | 'perks' | 'badges' | 'history'>('overview');
  const { run } = useAction();
  useEffect(() => { run(() => call('staffAccount', id)).then((r) => r && setA(r)); }, [id, run]);
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await run(() => call('staffAction', id, body), ok);
    if (!r) return false;
    if (r.deleted) { onChange(); onClose(); return true; }
    setA(r); onChange();
    return true;
  };
  if (!a) return <Empty title="Loading" />;

  const states: string[] = [];
  if (a.banned) states.push(`Suspended ${until(a.bannedUntil) || 'until further notice'}${a.banReason ? `: ${a.banReason}` : ''}`);
  if (a.mutedUntil) states.push(`Messaging restricted ${until(a.mutedUntil)}`);
  if (a.frozenUntil) states.push(`Profile editing locked ${until(a.frozenUntil)}`);
  if (a.discoveryLocked) states.push('Hidden from discovery by staff');
  if (a.flaggedNetwork) states.push('Signed up from a flagged network');

  return (
    <div className="detail">
      <header className="detail-head">
        <button className="icon-btn back-btn show-narrow" aria-label="Back to list" onClick={onClose}>←</button>
        <Avatar p={a} size={40} presence={a.presence} />
        <span><Handle name={a.username} /><small>{a.displayName}</small></span>
        {a.id === meId && <i className="flag staff">You</i>}
      </header>
      {states.length > 0 && <ul className="state-list">{states.map((s) => <li key={s}>{s}</li>)}</ul>}
      <div className="subtabs" role="tablist">
        {(['overview', 'actions', 'perks', 'badges', 'history'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}{t === 'history' && a.audit.length ? ` (${a.audit.length})` : ''}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="overview">
          <ProfileCard p={a} />
          <dl className="facts-grid">
            <dt>Account id</dt><dd><code>{a.id}</code></dd>
            <dt>Joined</dt><dd>{new Date(a.createdAt).toLocaleDateString()} ({Math.floor((Date.now() - a.createdAt) / 86400000)} days)</dd>
            <dt>Active days</dt><dd>{a.activeDays}</dd>
            <dt>Roles</dt><dd>{a.roles.join(', ') || 'None'}</dd>
            <dt>Username changes</dt><dd>{a.usernameChanges}{a.originalUsername && a.originalUsername !== a.username ? `, created as @${a.originalUsername}` : ''}</dd>
            <dt>Pending claim</dt><dd>{a.pendingClaim ? `@${a.pendingClaim.name} (${a.pendingClaim.status === 'holding' ? 'on hold' : 'needs approval'})` : 'None'}</dd>
            <dt>Active sessions</dt><dd>{a.sessions}</dd>
            <dt>Unread warnings</dt><dd>{a.unackedWarnings}</dd>
            <dt>Badges</dt><dd>{a.earnedBadges.length} earned, {a.badges.length} equipped</dd>
            <dt>Credits</dt><dd><Credits n={a.credits ?? 0} /></dd>
            <dt>Titles</dt><dd>{a.titles?.map((x: any) => x.name).join(', ') || 'None'}</dd>
            <dt>Listing</dt><dd>{a.activeListing ? `Selling @${a.activeListing.name}` : 'None'}</dd>
          </dl>
          <h4>Reports about this account</h4>
          {a.reports.length === 0 ? <p className="muted small">None.</p> : (
            <ul className="mini-list">{a.reports.map((r: any) => <li key={r.id}><b>{r.reason}</b> from {r.reporter ? `@${r.reporter}` : 'deleted'}, {timeAgo(r.createdAt)} ({r.status}){r.details && <p>{r.details}</p>}</li>)}</ul>
          )}
        </div>
      )}

      {tab === 'actions' && <Actions a={a} meId={meId} isFounder={isFounder} act={act} />}
      {tab === 'perks' && <Perks a={a} act={act} />}
      {tab === 'badges' && <BadgeAdmin a={a} isFounder={isFounder} act={act} />}
      {tab === 'history' && (
        a.audit.length === 0 ? <p className="muted small">No staff actions on this account yet.</p> : <AuditList entries={a.audit} hideTarget />
      )}
    </div>
  );
}

function relevant(def: StaffActionDef, a: any): boolean {
  switch (def.id) {
    case 'suspend': return !a.banned;
    case 'unsuspend': return a.banned;
    case 'mute': return !a.mutedUntil;
    case 'unmute': return !!a.mutedUntil;
    case 'freeze_profile': return !a.frozenUntil;
    case 'unfreeze_profile': return !!a.frozenUntil;
    case 'hide_from_discovery': return !a.discoveryLocked;
    case 'allow_discovery': return a.discoveryLocked;
    case 'flag_network': return !a.flaggedNetwork;
    case 'unflag_network': return a.flaggedNetwork;
    case 'remove_avatar': return !!a.avatar;
    case 'remove_banner': return !!a.banner;
    case 'remove_background': return !!a.background;
    case 'reset_bio': return !!a.bio;
    case 'reset_status': return !!a.customStatus;
    case 'reset_display_name': return a.displayName !== a.username;
    case 'cancel_claim': return !!a.pendingClaim;
    case 'clear_cooldown': return true;
    case 'market_ban': return !a.marketBanned;
    case 'market_unban': return !!a.marketBanned;
    case 'reset_cosmetics': return !!(a.frame || a.effect || a.nameFx || a.accessory);
    default: return true;
  }
}

function Actions({ a, meId, isFounder, act }: { a: any; meId: string; isFounder: boolean; act: (b: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = ['Enforcement', 'Messaging', 'Profile', 'Username', 'Access', 'Records'] as const;
  const self = a.id === meId;
  return (
    <div className="actions">
      {groups.map((g) => {
        const defs = STAFF_ACTIONS.filter((d) => d.group === g && relevant(d, a) && !(d.danger && self) && !(d.danger && a.roles.includes('staff') && !isFounder));
        if (!defs.length) return null;
        return (
          <div key={g} className="action-group">
            <h4>{g}</h4>
            {defs.map((d) => (
              <ActionRow key={d.id} def={d} open={openId === d.id} onOpen={() => setOpenId(openId === d.id ? null : d.id)}
                onRun={async (params) => { if (await act({ action: d.id, ...params }, `${d.label}: done`)) setOpenId(null); }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ActionRow({ def, open, onOpen, onRun }: { def: StaffActionDef; open: boolean; onOpen: () => void; onRun: (p: Record<string, unknown>) => void }) {
  const [p, setP] = useState<Record<string, unknown>>({ duration: '1d' });
  const quick = def.params.length === 0;
  const missing = def.params.some((x) => 'required' in x && x.required && !String(p[x.key] ?? '').trim());
  return (
    <div className={`action-row ${open ? 'open' : ''} ${def.danger ? 'danger' : ''}`}>
      <div className="action-top">
        <span><b>{def.label}</b>{def.description && <small>{def.description}</small>}</span>
        {quick && !def.danger
          ? <button className="btn sm" onClick={() => onRun({})}>{def.label}</button>
          : <button className={`btn sm ${open ? 'ghost' : ''}`} onClick={onOpen} aria-expanded={open}>{open ? 'Cancel' : `${def.label}…`}</button>}
      </div>
      {open && (
        <form className="action-form" onSubmit={(e) => { e.preventDefault(); if (!missing) onRun(p); }}>
          {def.params.map((x) => (
            <label key={x.key} className="field">
              <span>{x.label}</span>
              {x.kind === 'duration' ? (
                <select value={String(p.duration)} onChange={(e) => setP({ ...p, duration: e.target.value })}>
                  {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              ) : x.kind === 'textarea' ? (
                <textarea rows={3} maxLength={500} value={String(p[x.key] ?? '')} onChange={(e) => setP({ ...p, [x.key]: e.target.value })} />
              ) : x.kind === 'number' ? (
                <input type="number" min={0} max={3650} value={String(p[x.key] ?? 0)} onChange={(e) => setP({ ...p, [x.key]: Number(e.target.value) })} />
              ) : (
                <input value={String(p[x.key] ?? '')} maxLength={x.kind === 'username' ? 24 : 200} spellCheck={x.kind !== 'username'}
                  onChange={(e) => setP({ ...p, [x.key]: x.kind === 'username' ? e.target.value.toLowerCase().replace(/^@/, '') : e.target.value })} />
              )}
            </label>
          ))}
          <div className="row end">
            <button type="submit" className={`btn ${def.danger ? 'danger' : 'primary'}`} disabled={missing}>{def.label}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function BadgeAdmin({ a, isFounder, act }: { a: any; isFounder: boolean; act: (b: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const granted = new Set<string>(a.grantedBadges);
  const earned = new Set<string>(a.earnedBadges);
  const hidden = new Set<string>(a.hiddenBadges);
  const [sup, setSup] = useState(a.supporterSince ? new Date(a.supporterSince).toISOString().slice(0, 10) : '');
  const [boost, setBoost] = useState(a.boosterSince ? new Date(a.boosterSince).toISOString().slice(0, 10) : '');
  return (
    <div className="badge-admin">
      <p className="muted small">Granted badges are switched on here. Automatic badges (age, name length, early supporter) follow the account. Supporter and Booster badges evolve from the start date you set. The user can still unequip anything.</p>
      <div className="tier-forms">
        <form onSubmit={(e) => { e.preventDefault(); act({ action: 'set_supporter', date: sup || null }, sup ? 'Supporter date set' : 'Supporter removed'); }}>
          <label className="field"><span>Supporter since</span><input type="date" value={sup} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSup(e.target.value)} /></label>
          <button className="btn sm" type="submit">{sup ? 'Save' : 'Remove'}</button>
        </form>
        <form onSubmit={(e) => { e.preventDefault(); act({ action: 'set_booster', date: boost || null }, boost ? 'Booster date set' : 'Booster removed'); }}>
          <label className="field"><span>Booster since</span><input type="date" value={boost} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBoost(e.target.value)} /></label>
          <button className="btn sm" type="submit">{boost ? 'Save' : 'Remove'}</button>
        </form>
        <label className="field"><span>House</span>
          <select value={a.house ?? ''} onChange={(e) => act({ action: 'set_house', house: e.target.value || null }, 'House updated')}>
            <option value="">None</option>
            {HOUSES.map((h) => <option key={h} value={h}>{h[0].toUpperCase() + h.slice(1)}</option>)}
          </select>
        </label>
      </div>
      {isFounder && (
        <div className="role-row">
          <h4>Roles</h4>
          <Segmented<string> label="Toggle role" value="" onChange={(r) => act({ action: 'set_roles', roles: a.roles.includes(r) ? a.roles.filter((x: string) => x !== r) : [...a.roles, r] }, 'Roles updated')}
            options={['staff', 'developer', 'founder'].map((r) => ({ value: r, label: `${a.roles.includes(r) ? '✓ ' : ''}${r[0].toUpperCase() + r.slice(1)}` }))} />
        </div>
      )}
      {CATEGORIES.map((cat) => {
        const list = CATALOG.filter((b) => b.category === cat);
        return (
          <div key={cat} className="badge-admin-group">
            <h4>{cat}</h4>
            <ul>
              {list.map((b) => {
                const grantable = b.source === 'granted';
                const on = grantable ? granted.has(b.id) : earned.has(b.id);
                return (
                  <li key={b.id} className={on ? 'on' : ''}>
                    <BadgeIcon id={b.id} size={18} />
                    <span><b>{b.label}</b><small>{grantable ? (on ? (hidden.has(b.id) ? 'Granted, unequipped by user' : 'Granted') : 'Not granted') : (on ? `${hidden.has(b.id) ? 'Earned, unequipped' : 'Earned'}` : b.howTo)}</small></span>
                    {grantable && (
                      <button type="button" role="switch" aria-checked={on} aria-label={`${on ? 'Revoke' : 'Grant'} ${b.label}`} className="switch"
                        onClick={() => act({ action: on ? 'revoke_badge' : 'grant_badge', badge: b.id }, `${b.label} ${on ? 'revoked' : 'granted'}`)}><i /></button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Perks({ a, act }: { a: any; act: (b: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [amount, setAmount] = useState(500);
  const [reason, setReason] = useState('');
  const [titles, setTitles] = useState<{ name: string; color: string }[]>(a.titles ?? []);
  const [custom, setCustom] = useState({ name: '', color: '#8b7cff' });
  const owned = new Set<string>(a.ownedCosmetics ?? []);
  const saveTitles = (next: { name: string; color: string }[]) => { setTitles(next); act({ action: 'set_titles', titles: next }, 'Titles updated'); };
  return (
    <div className="perks">
      <section>
        <h4>Credits</h4>
        <p className="muted small">Balance: <Credits n={a.credits ?? 0} />. Send credits as a gift, or enter a negative amount to take some back.</p>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); act({ action: 'grant_credits', amount, reason }, amount > 0 ? `Sent ${amount.toLocaleString()} credits` : 'Credits adjusted'); }}>
          {[100, 500, 1000, 5000].map((n) => <button key={n} type="button" className={`chip ${amount === n ? 'accent' : ''}`} onClick={() => setAmount(n)}>+{n.toLocaleString()}</button>)}
          <input className="num-input wide" type="number" value={amount} onChange={(e) => setAmount(Math.trunc(+e.target.value))} aria-label="Amount" />
          <input className="grow-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shows in their wallet)" maxLength={120} aria-label="Reason" />
          <button className="btn primary sm" type="submit" disabled={!amount}>{amount < 0 ? 'Take credits' : 'Send credits'}</button>
        </form>
      </section>

      <section>
        <h4>Titles <span className="muted small">{titles.length}/{MAX_TITLES}</span></h4>
        <p className="muted small">Titles are platform roles shown on their profile. Only staff can give them.</p>
        <div className="title-row">
          {titles.length === 0 && <span className="muted small">No titles yet.</span>}
          {titles.map((x) => (
            <span key={x.name} className="pc-title removable" style={{ ['--tc' as any]: x.color }}>{x.name}
              <button aria-label={`Remove ${x.name}`} onClick={() => saveTitles(titles.filter((y) => y.name !== x.name))}>×</button>
            </span>
          ))}
        </div>
        <div className="title-presets">
          {TITLE_PRESETS.filter((x) => !titles.some((y) => y.name === x.name)).map((x) => (
            <button key={x.name} className="pc-title" style={{ ['--tc' as any]: x.color }} disabled={titles.length >= MAX_TITLES} onClick={() => saveTitles([...titles, x])}>+ {x.name}</button>
          ))}
        </div>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); if (custom.name.trim()) { saveTitles([...titles, { name: custom.name.trim(), color: custom.color }]); setCustom({ ...custom, name: '' }); } }}>
          <input className="grow-input" value={custom.name} maxLength={20} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Custom title" aria-label="Custom title" />
          <span className="color-input"><input type="color" value={custom.color} onChange={(e) => setCustom({ ...custom, color: e.target.value })} aria-label="Title color" /></span>
          <button className="btn sm" type="submit" disabled={!custom.name.trim() || titles.length >= MAX_TITLES}>Add title</button>
        </form>
      </section>

      <section>
        <h4>Cosmetics</h4>
        <p className="muted small">Gift frames and animated themes for free. They can equip them from their profile.</p>
        <ul className="cosmetic-grants">
          {COSMETICS.filter((c) => !c.staffOnly).map((c) => {
            const on = owned.has(c.id);
            return (
              <li key={c.id} className={on ? 'on' : ''}>
                <i style={{ background: RARITY_TONE[c.rarity] }} />
                <span><b>{c.name}</b><small>{c.kind === 'frame' ? 'Frame' : 'Animated theme'}, {c.price.toLocaleString()} credits</small></span>
                <button type="button" role="switch" aria-checked={on} aria-label={`${on ? 'Take back' : 'Gift'} ${c.name}`} className="switch"
                  onClick={() => act({ action: on ? 'revoke_cosmetic' : 'grant_cosmetic', item: c.id }, on ? `${c.name} taken back` : `${c.name} gifted`)}><i /></button>
              </li>
            );
          })}
        </ul>
      </section>

      {a.activeListing && (
        <section>
          <h4>Marketplace</h4>
          <p className="muted small">They're selling @{a.activeListing.name}. Removing the listing refunds any bids.</p>
          <button className="btn danger ghost sm" onClick={() => act({ action: 'remove_listing' }, 'Listing removed')}>Remove listing</button>
        </section>
      )}

      {a.ledger?.length > 0 && (
        <section>
          <h4>Recent credit activity</h4>
          <ul className="ledger">{a.ledger.map((r: any, i: number) => <li key={i}><span>{r.reason}</span><b className={r.delta < 0 ? 'neg' : 'pos'}>{r.delta > 0 ? '+' : ''}{r.delta.toLocaleString()}</b><time>{timeAgo(r.at)}</time></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function AuditList({ entries, hideTarget }: { entries: AuditEntry[]; hideTarget?: boolean }) {
  return (
    <ul className="audit">
      {entries.map((e) => (
        <li key={e.id}>
          <time title={new Date(e.at).toLocaleString()}>{timeAgo(e.at)}</time>
          <span>
            <b>@{e.staff}</b> {actionLabel(e.action).toLowerCase()}{!hideTarget && e.target && <> on <b>@{e.target}</b></>}
            {e.detail && <small>{e.detail}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------- other tabs
function Queue({ ov, reload, open }: { ov: Overview | null; reload: () => void; open: (id: string) => void }) {
  const { busy, run } = useAction();
  if (!ov) return <Empty title="Loading" />;
  if (!ov.claims.length) return <Empty title="Queue is empty">Short-name holds and 1–2 letter requests show up here.</Empty>;
  return (
    <ul className="queue card-section">
      {ov.claims.map((c) => (
        <li key={c.id}>
          <span className="claim-name" data-len={c.name.length}>@{c.name}</span>
          <span className="queue-info">
            <span><button className="link" onClick={() => open(c.accountId)}><Handle name={c.current} /></button>, account {Math.floor((Date.now() - c.accountCreated) / 86400000)} days old</span>
            <small>{c.status === 'holding' ? `On public hold, settles ${c.availableAt ? new Date(c.availableAt).toLocaleString() : ''}` : 'Needs approval'}</small>
          </span>
          <button className="btn ghost sm" disabled={busy} onClick={() => run(() => call('staffDecide', c.id, false), 'Denied').then(reload)}>Deny</button>
          <button className="btn primary sm" disabled={busy} onClick={() => run(() => call('staffDecide', c.id, true), `@${c.name} granted`).then(reload)}>Grant now</button>
        </li>
      ))}
    </ul>
  );
}

function Reports({ ov, reload, open }: { ov: Overview | null; reload: () => void; open: (id: string) => void }) {
  const { run } = useAction();
  if (!ov) return <Empty title="Loading" />;
  if (!ov.reports.length) return <Empty title="No open reports">Reports about profiles show up here.</Empty>;
  return (
    <ul className="reports card-section">
      {ov.reports.map((r) => (
        <li key={r.id}>
          <div>
            <b>{r.reason}</b> on {r.target ? <Handle name={r.target} /> : 'a deleted account'}
            <small>from {r.reporter ? `@${r.reporter}` : 'a deleted account'}, {timeAgo(r.createdAt)}</small>
            {r.details && <p>{r.details}</p>}
          </div>
          {r.target && <button className="btn sm" onClick={() => open(r.targetId)}>Open account</button>}
          <button className="btn ghost sm" onClick={() => run(() => call('staffReport', r.id, 'dismissed'), 'Dismissed').then(reload)}>Dismiss</button>
          <button className="btn ghost sm" onClick={() => run(() => call('staffReport', r.id, 'actioned'), 'Marked handled').then(reload)}>Mark handled</button>
        </li>
      ))}
    </ul>
  );
}

function Audit() {
  const [list, setList] = useState<AuditEntry[] | null>(null);
  const { run } = useAction();
  useEffect(() => { run(() => call<AuditEntry[]>('staffAudit')).then((r) => r && setList(r)); }, [run]);
  if (!list) return <Empty title="Loading" />;
  if (!list.length) return <Empty title="No staff actions yet">Every moderation action is recorded here with who did it.</Empty>;
  return <div className="card-section"><AuditList entries={list} /></div>;
}

function Invites() {
  const [codes, setCodes] = useState<string[]>([]);
  const [n, setN] = useState(10);
  const { busy, run } = useAction();
  return (
    <section className="card-section">
      <p className="muted">Invite codes are single-use. Hand them out one at a time.</p>
      <div className="row">
        <input className="num-input" type="number" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Math.min(50, +e.target.value || 1)))} aria-label="How many" />
        <button className="btn" disabled={busy} onClick={() => run(() => call<{ codes: string[] }>('staffInvites', n)).then((r) => r && setCodes(r.codes))}>Create {n} invite code{n > 1 ? 's' : ''}</button>
        {codes.length > 0 && <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).catch(() => {})}>Copy all</button>}
      </div>
      {codes.length > 0 && <pre className="codes">{codes.join('\n')}</pre>}
    </section>
  );
}

export { BADGES };

// ----------------------------------------------------------------- dashboard
interface Stats {
  signups: { day: string; n: number }[];
  totals: { accounts: number; online: number; activeToday: number; spaces: number; creditsInCirculation: number; activeListings: number; sales: number; lockdown: number; openReports: number; pendingClaims: number };
}
function Dashboard({ go }: { go: (t: Tab) => void }) {
  const [st, setSt] = useState<Stats | null>(null);
  const { run } = useAction();
  useEffect(() => { run(() => call<Stats>('staffStats')).then((r) => r && setSt(r)); }, [run]);
  if (!st) return <Empty title="Loading" />;
  const t = st.totals;
  const max = Math.max(1, ...st.signups.map((d) => d.n));
  const total14 = st.signups.reduce((n, d) => n + d.n, 0);
  const tiles: [string, string | number, string?, Tab?][] = [
    ['Accounts', t.accounts.toLocaleString()], ['Online now', t.online], ['Active today', t.activeToday], ['Servers and groups', t.spaces],
    ['Open reports', t.openReports, t.openReports ? 'warn' : '', 'reports'], ['Short-name queue', t.pendingClaims, t.pendingClaims ? 'warn' : '', 'queue'],
    ['Credits in circulation', t.creditsInCirculation.toLocaleString()], ['Names for sale', t.activeListings], ['Names sold', t.sales],
    ['In Lockdown Mode', t.lockdown],
  ];
  return (
    <div className="dash">
      <div className="dash-tiles">
        {tiles.map(([label, v, tone, tab]) => (
          <button key={label} className={`dash-tile ${tone ?? ''}`} onClick={() => tab && go(tab)} disabled={!tab}>
            <b>{v}</b><span>{label}</span>
          </button>
        ))}
      </div>
      <section className="card-section">
        <div className="section-head"><h3>Sign-ups, last 14 days</h3><span className="muted small">{total14} total</span></div>
        <div className="bars" role="img" aria-label={`Sign-ups per day: ${st.signups.map((d) => `${d.day} ${d.n}`).join(', ')}`}>
          {st.signups.map((d) => (
            <div key={d.day} className="bar" title={`${d.day}: ${d.n}`}>
              <i style={{ height: `${(d.n / max) * 100}%` }} />
              <small>{new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric' })}</small>
            </div>
          ))}
        </div>
      </section>
      <p className="fine">Counts only. Staff can't see who is in Lockdown Mode, and nothing here comes from messages.</p>
    </div>
  );
}

// ------------------------------------------------------------------ platform
function Platform() {
  const [p, setP] = useState<PlatformSettings | null>(null);
  const [banner, setBanner] = useState({ text: '', tone: 'info' as 'info' | 'warn' | 'good' });
  const [post, setPost] = useState({ title: '', body: '', tag: 'feature' });
  const [notice, setNotice] = useState('');
  const [updates, setUpdates] = useState<UpdatePost[]>([]);
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => {
    run(() => call<PlatformSettings>('staffPlatform')).then((r) => { if (r) { setP(r); if (r.banner) setBanner(r.banner); } });
    call<UpdatePost[]>('updates').then(setUpdates, () => {});
  }, [run]);
  const save = (patch: Partial<PlatformSettings>, ok?: string) => run(() => call<PlatformSettings>('staffSetPlatform', patch), ok).then((r) => r && setP(r));
  if (!p) return <Empty title="Loading" />;
  return (
    <div className="platform">
      <section className="card-section">
        <h3>Sign-ups</h3>
        <Segmented label="Sign-ups" value={p.signups} onChange={(signups) => save({ signups }, 'Sign-ups updated')}
          options={[{ value: 'open', label: 'Open to anyone' }, { value: 'invite', label: 'Invite only' }, { value: 'paused', label: 'Paused' }]} />
        <p className="fine">{p.signups === 'open' ? 'Anyone with the link can make an account.' : p.signups === 'invite' ? 'New accounts need an invite code.' : 'Nobody can sign up. Existing accounts are unaffected.'}</p>
      </section>
      <section className="card-section">
        <h3>Switches</h3>
        <Toggle label="Raid mode" checked={p.raidMode} onChange={(raidMode) => save({ raidMode }, raidMode ? 'Raid mode on' : 'Raid mode off')}
          hint="Accounts less than a day old can read but not send messages or create servers. Use it when a wave of new accounts shows up to spam." />
        <Toggle label="Pause the marketplace" checked={p.marketPaused} onChange={(marketPaused) => save({ marketPaused })} hint="No new listings, bids or buys. Running auctions keep their bids; staff can still act." />
        <Toggle label="Pause the shop" checked={p.shopPaused} onChange={(shopPaused) => save({ shopPaused })} hint="Nobody can buy cosmetics. Equipping what you own still works." />
      </section>
      <section className="card-section">
        <h3>Site banner</h3>
        <p className="muted small">Shown at the top of the app for everyone, until you clear it.</p>
        <div className="row">
          <input className="grow-input" value={banner.text} maxLength={200} onChange={(e) => setBanner({ ...banner, text: e.target.value })} placeholder="Scheduled maintenance tonight at 9pm UTC" aria-label="Banner text" />
          <select value={banner.tone} onChange={(e) => setBanner({ ...banner, tone: e.target.value as any })} aria-label="Banner color"><option value="info">Info</option><option value="warn">Warning</option><option value="good">Good news</option></select>
        </div>
        <div className="row">
          <button className="btn primary" disabled={busy || !banner.text.trim()} onClick={() => save({ banner }, 'Banner is live')}>Show banner</button>
          {p.banner && <button className="btn ghost" onClick={() => { save({ banner: null }, 'Banner cleared'); setBanner({ text: '', tone: 'info' }); }}>Clear banner</button>}
        </div>
      </section>
      <section className="card-section">
        <h3>Post an update</h3>
        <p className="muted small">Shows at the top of Settings, What's new, for everyone.</p>
        <label className="field"><span>Title</span><input value={post.title} maxLength={80} onChange={(e) => setPost({ ...post, title: e.target.value })} placeholder="Name effects are here" /></label>
        <label className="field"><span>What changed</span><textarea rows={4} maxLength={2000} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} placeholder="Supports **bold**, *italic*, links and line breaks." /></label>
        <div className="row">
          <select value={post.tag} onChange={(e) => setPost({ ...post, tag: e.target.value })} aria-label="Kind of update">
            <option value="feature">New feature</option><option value="fix">Fix</option><option value="security">Security</option><option value="event">Event</option><option value="notice">Notice</option>
          </select>
          <button className="btn primary" disabled={busy || !post.title.trim() || !post.body.trim()}
            onClick={() => run(() => call<UpdatePost[]>('staffPostUpdate', post), 'Update posted').then((r) => { if (r) { setUpdates(r); setPost({ title: '', body: '', tag: 'feature' }); } })}>Post update</button>
        </div>
        {updates.length > 0 && (
          <ul className="mini-list">
            {updates.map((u) => (
              <li key={u.id}><b>{u.title}</b> <span className="muted small">by @{u.by}, {timeAgo(u.at)}</span>
                <button className="btn ghost sm" onClick={() => run(() => call<UpdatePost[]>('staffDeleteUpdate', u.id), 'Deleted').then((r) => r && setUpdates(r))}>Delete</button></li>
            ))}
          </ul>
        )}
      </section>
      <section className="card-section">
        <h3>Announce to everyone</h3>
        <p className="muted small">A notice every account sees once, next time they open Sigil, until they dismiss it.</p>
        <label className="field"><span>Message</span><textarea rows={3} maxLength={500} value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="We're restarting the server in 10 minutes." /></label>
        <button className="btn" disabled={!notice.trim()} onClick={() => setConfirmBroadcast(true)}><Icon name="bell" size={15} />Send to everyone…</button>
      </section>
      {confirmBroadcast && (
        <Modal title="Send to every account?" onClose={() => setConfirmBroadcast(false)}>
          <p className="muted">“{notice}”</p>
          <p className="fine">This is recorded in the audit log with your name.</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setConfirmBroadcast(false)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={() => run(() => call<{ sent: number }>('staffBroadcast', notice)).then((r) => { if (r) { setNotice(''); setConfirmBroadcast(false); } })}>Send</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
