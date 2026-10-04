import { useEffect, useState, type ReactNode } from 'react';
import { call, type AppState } from '../api';
import { useAction, Toggle, Segmented, Modal, Icon, SelectRow, timeAgo, useToast } from '../components/ui';
import { Avatar, Handle } from '../components/ProfileCard';
import { usePrefs } from '../components/Prefs';
import { LockdownSection, SecuritySection } from './Lockdown';
import { Updates, Credits } from './About';
import { LATEST_VERSION } from '../../../../shared/changelog';
import type { MessagePolicy, StatusChoice } from '../../../../shared/types';

export type SettingsPage =
  | 'account' | 'devices' | 'privacy' | 'lockdown' | 'security' | 'notifications'
  | 'appearance' | 'accessibility' | 'chats' | 'keybinds' | 'data' | 'updates' | 'credits';

const PAGES: { id: SettingsPage; label: string; icon: string; group: string }[] = [
  { id: 'account', label: 'My account', icon: 'user', group: 'Account' },
  { id: 'devices', label: 'Devices', icon: 'monitor', group: 'Account' },
  { id: 'privacy', label: 'Privacy & safety', icon: 'eye', group: 'Privacy' },
  { id: 'lockdown', label: 'Lockdown Mode', icon: 'shield', group: 'Privacy' },
  { id: 'security', label: 'App lock & panic', icon: 'key', group: 'Privacy' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', group: 'App' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App' },
  { id: 'accessibility', label: 'Accessibility', icon: 'access', group: 'App' },
  { id: 'chats', label: 'Chats & messages', icon: 'chat', group: 'App' },
  { id: 'keybinds', label: 'Keyboard shortcuts', icon: 'keyboard', group: 'App' },
  { id: 'data', label: 'Data & storage', icon: 'download', group: 'App' },
  { id: 'updates', label: "What's new", icon: 'sparkle', group: 'About' },
  { id: 'credits', label: 'Credits', icon: 'heart', group: 'About' },
];
export const SETTINGS_PAGES = PAGES;

export function Settings({ state, page: initial, onLockNow, goProfile }: { state: AppState; page?: SettingsPage | null; onLockNow: () => void; goProfile: () => void }) {
  const [page, setPage] = useState<SettingsPage | null>(initial ?? null);
  useEffect(() => { if (initial) setPage(initial); }, [initial]);
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches;
  const current = page ?? (narrow ? null : 'account');
  const groups = [...new Set(PAGES.map((p) => p.group))];
  const unseen = state.settings.lastSeenUpdate !== LATEST_VERSION;
  const meta = PAGES.find((p) => p.id === current);

  return (
    <div className={`settings-shell ${current ? 'has-page' : ''}`}>
      <nav className="sx-nav" aria-label="Settings sections">
        <h1>Settings</h1>
        {groups.map((g) => (
          <div key={g} className="sn-group">
            <h4>{g}</h4>
            {PAGES.filter((p) => p.group === g).map((p) => (
              <button key={p.id} className={`sn-item ${current === p.id ? 'on' : ''} ${p.id === 'lockdown' && state.lockdown ? 'ld-on' : ''}`} onClick={() => setPage(p.id)} aria-current={current === p.id ? 'page' : undefined}>
                <Icon name={p.icon} size={17} /><span>{p.label}</span>
                {p.id === 'updates' && unseen && <i className="dot" aria-label="New" />}
                {p.id === 'lockdown' && state.lockdown && <span className="on-chip">On</span>}
              </button>
            ))}
          </div>
        ))}
        <button className="sn-item danger" onClick={() => call('logout')}><Icon name="logout" size={17} /><span>Sign out</span></button>
      </nav>
      {current && (
        <div className="settings-page page" key={current}>
          <header className="page-head">
            <button className="icon-btn back-btn" aria-label="All settings" onClick={() => setPage(null)}><Icon name="back" /></button>
            <h1>{meta?.label}</h1>
          </header>
          {current === 'account' && <AccountPage state={state} goProfile={goProfile} />}
          {current === 'devices' && <DevicesPage />}
          {current === 'privacy' && <PrivacyPage state={state} />}
          {current === 'lockdown' && <LockdownSection state={state} />}
          {current === 'security' && <SecuritySection state={state} onLockNow={onLockNow} />}
          {current === 'notifications' && <NotificationsPage state={state} />}
          {current === 'appearance' && <AppearancePage state={state} />}
          {current === 'accessibility' && <AccessibilityPage state={state} />}
          {current === 'chats' && <ChatsPage state={state} />}
          {current === 'keybinds' && <KeybindsPage />}
          {current === 'data' && <DataPage state={state} />}
          {current === 'updates' && <Updates />}
          {current === 'credits' && <Credits />}
        </div>
      )}
    </div>
  );
}

const setS = (patch: Record<string, unknown>) => call('setSettings', patch);
function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return <section className="card-section"><h3>{title}</h3>{children}{note && <p className="fine">{note}</p>}</section>;
}

// ---------------------------------------------------------------- account
function AccountPage({ state, goProfile }: { state: AppState; goProfile: () => void }) {
  const me = state.me!;
  const { busy, run } = useAction();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!phrase) return;
    const t = setTimeout(() => setPhrase(null), 60_000); // don't leave it on screen
    return () => clearTimeout(t);
  }, [phrase]);
  return (
    <>
      <section className="card-section acct-card">
        <Avatar p={me} size={56} />
        <div className="acct-id"><b>{me.displayName}</b><Handle name={me.username} /><small className="muted">{me.accountAgeDays} days on Sigil · {me.credits.toLocaleString()} credits</small></div>
        <button className="btn" onClick={goProfile}>Edit profile</button>
      </section>
      <Section title="Status">
        <Segmented<StatusChoice> label="Status" value={me.status} onChange={(status) => run(() => call('updateProfile', { status }))}
          options={[{ value: 'online', label: 'Online' }, { value: 'idle', label: 'Idle' }, { value: 'dnd', label: 'Do not disturb' }, { value: 'invisible', label: 'Invisible' }]} />
      </Section>
      <Section title="Recovery phrase" note="These 9 words are your account. Anyone who has them can sign in as you, so never paste them into a chat.">
        <div className="row">
          <button className="btn" onClick={() => run(() => call<string>('revealPhrase')).then((p) => p && setPhrase(p))}>Show recovery phrase</button>
        </div>
      </Section>
      <Section title="Your invites">
        {me.invites.length === 0 ? <p className="muted">No invite codes yet.</p> : (
          <ul className="invites">
            {me.invites.map((i) => (
              <li key={i.code}>
                <code>{i.code}</code>
                {i.usedBy ? <span>Used by <Handle name={i.usedBy} /></span> : <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(i.code).then(() => toast('Copied'))}>Copy</button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Sign out or delete">
        <div className="row">
          <button className="btn ghost" disabled={busy} onClick={() => run(() => call('logout'))}>Sign out of this device</button>
          <button className="btn danger ghost" onClick={() => setConfirmDelete(true)}>Delete account</button>
        </div>
      </Section>
      {phrase && (
        <Modal title="Recovery phrase" onClose={() => setPhrase(null)}>
          <p className="muted">Anyone with these words controls your account. This closes by itself after a minute.</p>
          <ol className="phrase">{phrase.split('-').map((w, i) => <li key={i}><span>{i + 1}</span>{w}</li>)}</ol>
        </Modal>
      )}
      {confirmDelete && (
        <Modal title="Delete account" onClose={() => setConfirmDelete(false)}>
          <p className="muted">This deletes @{me.username}, your profile and images from Sigil. Your username stays locked for 60 days, then becomes claimable. This can't be undone.</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep my account</button>
            <button className="btn danger" disabled={busy} onClick={() => run(() => call('deleteAccount'), 'Account deleted')}>Delete @{me.username}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- devices
interface SessionRow { id: string; label: string; createdAt: number; lastSeen: number; current: boolean }
function DevicesPage() {
  const [list, setList] = useState<SessionRow[] | null>(null);
  const { busy, run } = useAction();
  useEffect(() => { run(() => call<SessionRow[]>('listSessions')).then((r) => r && setList(r)); }, [run]);
  const others = list?.filter((s) => !s.current) ?? [];
  return (
    <>
      <Section title="Signed in" note="Labels show only the browser or app and the system. Sigil doesn't keep IP addresses or locations for sessions.">
        {!list ? <p className="muted">Loading…</p> : (
          <ul className="device-list">
            {list.map((s) => (
              <li key={s.id} className={s.current ? 'current' : ''}>
                <Icon name="monitor" size={20} />
                <div><b>{s.label}</b><small>{s.current ? 'This device' : `Active ${timeAgo(s.lastSeen)}`} · signed in {new Date(s.createdAt).toLocaleDateString()}</small></div>
                {!s.current && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => call<SessionRow[]>('revokeSession', s.id), 'Signed out').then((r) => r && setList(r))}>Sign out</button>}
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && <button className="btn" disabled={busy} onClick={() => run(() => call<SessionRow[]>('revokeOtherSessions'), 'Signed out everywhere else').then((r) => r && setList(r))}>Sign out all other devices</button>}
      </Section>
      <Section title="One device at a time">
        <p className="muted small">Your recovery phrase works anywhere, but the device you signed in on most recently is the one that receives new chats. Signing out other devices hands that back to this one.</p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- privacy
function PrivacyPage({ state }: { state: AppState }) {
  const me = state.me!;
  const s = state.settings;
  const { run } = useAction();
  const setPrivacy = (patch: Partial<typeof me.privacy>) => run(() => call('updateProfile', { privacy: { ...me.privacy, ...patch } }));
  const ld = me.lockdown.enabled;
  return (
    <>
      {ld && <div className="ld-banner"><Icon name="shield" size={16} />Lockdown Mode is on, so some of these are locked.</div>}
      <Section title="Who can find you">
        <Toggle label="Discoverable by username" checked={me.privacy.discoverable} disabled={me.restrictions.discoveryLocked} onChange={(discoverable) => setPrivacy({ discoverable })}
          hint={me.restrictions.discoveryLocked ? 'Staff turned discovery off for this account.' : 'When off, lookups and your public page return nothing. People you already chat with can still reach you.'} />
        <Toggle label="Public web page" checked={me.privacy.publicPage && me.privacy.discoverable && !ld} disabled={!me.privacy.discoverable || ld} onChange={(publicPage) => setPrivacy({ publicPage })}
          hint="Your profile at /{username} on the web, for people without Sigil. Search engines are asked not to index it." />
      </Section>
      <Section title="What your profile shows">
        <Toggle label="Online status and custom status" checked={me.privacy.showStatus && !ld} disabled={ld} onChange={(showStatus) => setPrivacy({ showStatus })} hint="Hide online, idle, away and your custom status from everyone." />
        <Toggle label="Join date" checked={me.privacy.showJoinDate && !ld} disabled={ld} onChange={(showJoinDate) => setPrivacy({ showJoinDate })} hint="How long you've had your account says a lot about you." />
        <Toggle label="Badges" checked={me.privacy.showBadges} onChange={(showBadges) => setPrivacy({ showBadges })} hint="Hide every badge at once. To hide just some, unequip them on your profile." />
        <Toggle label="Links" checked={me.privacy.showLinks && !ld} disabled={ld} onChange={(showLinks) => setPrivacy({ showLinks })} />
        <Toggle label="Appear offline" checked={me.status === 'invisible'} onChange={(v) => run(() => call('updateProfile', { status: v ? 'invisible' : 'online' }))}
          hint="You'll still receive messages while you're connected." />
      </Section>
      <Section title="Who can reach you">
        <div className="toggle-row">
          <span className="toggle-text"><span>Who can message you</span><small>“People I've accepted” is enforced on your device: everyone else's messages are dropped without opening.</small></span>
          <Segmented<MessagePolicy> label="Who can message you" value={me.privacy.whoCanMessage} onChange={(whoCanMessage) => setPrivacy({ whoCanMessage })}
            options={[...(ld ? [] : [{ value: 'everyone' as MessagePolicy, label: 'Everyone' }]), { value: 'friends', label: "People I've accepted" }, { value: 'nobody', label: 'Nobody' }]} />
        </div>
        <Toggle label="Let people add me to groups and servers" checked={me.privacy.allowSpaceAdds && !ld} disabled={ld} onChange={(allowSpaceAdds) => setPrivacy({ allowSpaceAdds })}
          hint="When off, you only join with an invite link you choose to open." />
      </Section>
      <Section title="On this device">
        <Toggle label="Hide message previews" checked={s.hidePreviews} onChange={(hidePreviews) => setS({ hidePreviews })} hint="The chat list shows “Message” instead of the text, for when people can see your screen." />
        <Toggle label="Blur Sigil when I switch away" checked={s.blurOnLeave} onChange={(blurOnLeave) => setS({ blurOnLeave })} hint="Covers the window when it loses focus, so it isn't readable in screenshots of your desktop or over your shoulder." />
        <Toggle label="Remove tracking from links I send" checked={s.stripTracking} onChange={(stripTracking) => setS({ stripTracking })} hint="Strips utm_, fbclid, gclid and similar from links before they're encrypted." />
        <Toggle label="Warn before opening links" checked={s.linkWarning} onChange={(linkWarning) => setS({ linkWarning })} hint="Shows the real address first. Lockdown Mode makes links unclickable instead." />
      </Section>
      <Section title="Blocked">
        {state.blocked.length === 0 ? <p className="muted">You haven't blocked anyone. Blocks are stored only on this device; blocked people aren't told.</p> : (
          <ul className="blocked-list">
            {state.blocked.map((b) => (
              <li key={b.id}><Handle name={b.username} /><button className="btn ghost sm" onClick={() => run(() => call('unblock', b.id), 'Unblocked')}>Unblock</button></li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------- notifications
function NotificationsPage({ state }: { state: AppState }) {
  const s = state.settings;
  const toast = useToast();
  const web = typeof Notification !== 'undefined' && (window as any).sigil?.platform === 'web';
  const enable = async (v: boolean) => {
    if (v && web && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission().catch(() => 'denied');
      if (p !== 'granted') { toast('Your browser blocked notifications. Allow them in the site settings, then try again.', 'error'); return; }
    }
    setS({ notifications: v });
  };
  return (
    <>
      <Section title="Desktop notifications" note="Notifications only show while Sigil is open in the background. Sigil has no push service, because that would mean a third party knowing when you get messages.">
        <Toggle label="Show notifications" checked={s.notifications} onChange={enable} />
        <SelectRow label="What they show" value={s.notifyContent} disabled={!s.notifications} onChange={(notifyContent) => setS({ notifyContent })}
          hint="Your operating system may keep a history of notifications, so less is more private."
          options={[{ value: 'none', label: 'Just “New message”' }, { value: 'name', label: 'Who it’s from' }, { value: 'full', label: 'Who and what they said' }]} />
        <Toggle label="Message requests" checked={s.notifyRequests} disabled={!s.notifications} onChange={(notifyRequests) => setS({ notifyRequests })} hint="Notify when someone new messages you." />
        <Toggle label="Sound" checked={s.notifySound} disabled={!s.notifications} onChange={(notifySound) => setS({ notifySound })} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------- appearance
function AppearancePage({ state }: { state: AppState }) {
  const s = state.settings;
  const { run } = useAction();
  return (
    <>
      <Section title="Theme" note="Appearance is saved on this device only.">
        <div className="appearance-pick" role="radiogroup" aria-label="App theme">
          {([['dark', 'Dark', 'Graphite with your accent color.'], ['black', 'Pitch black', 'True black. Easiest on OLED screens at night.']] as const).map(([v, label, hint]) => (
            <button key={v} role="radio" aria-checked={s.appearance === v} className={`appearance ${v} ${s.appearance === v ? 'on' : ''}`}
              onClick={() => run(() => setS({ appearance: v }))}>
              <span className="ap-swatch"><i /><i /><i /></span>
              <b>{label}</b><small>{hint}</small>
            </button>
          ))}
        </div>
        <Toggle label="Liquid glass" checked={s.liquidGlass} onChange={(liquidGlass) => setS({ liquidGlass })}
          hint="Frosted, light-bending panels over a slowly moving backdrop. Looks best in Chrome or Edge; uses a bit more battery." />
      </Section>
      <Section title="Layout">
        <div className="toggle-row">
          <span className="toggle-text"><span>Message density</span><small>Compact fits more on screen.</small></span>
          <Segmented label="Message density" value={s.density} onChange={(density) => setS({ density })} options={[{ value: 'cozy', label: 'Cozy' }, { value: 'compact', label: 'Compact' }]} />
        </div>
        <Toggle label="24-hour time" checked={s.time24} onChange={(time24) => setS({ time24 })} />
      </Section>
    </>
  );
}

function AccessibilityPage({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <>
      <Section title="Text">
        <div className="toggle-row">
          <span className="toggle-text"><span>Text size</span><small>Scales the whole app.</small></span>
          <Segmented label="Text size" value={String(s.fontScale)} onChange={(v) => setS({ fontScale: Number(v) })}
            options={[{ value: '90', label: 'Small' }, { value: '100', label: 'Default' }, { value: '112', label: 'Large' }, { value: '125', label: 'Larger' }]} />
        </div>
        <Toggle label="Underline links" checked={s.underlineLinks} onChange={(underlineLinks) => setS({ underlineLinks })} />
      </Section>
      <Section title="Color and motion">
        <Toggle label="High contrast" checked={s.highContrast} onChange={(highContrast) => setS({ highContrast })} hint="Brighter text and stronger borders." />
        <Toggle label="Status shapes" checked={s.presenceShapes} onChange={(presenceShapes) => setS({ presenceShapes })} hint="Online, idle and do-not-disturb get different shapes, not just colors." />
        <Toggle label="Reduce motion" checked={s.reduceMotion} onChange={(reduceMotion) => setS({ reduceMotion })}
          hint="Turns off animations, including animated frames, themes and name effects. Your system setting is respected either way." />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ chats
const TTLS: { value: string; label: string }[] = [
  { value: 'off', label: 'Off' }, { value: '3600', label: '1 hour' }, { value: '86400', label: '1 day' }, { value: '604800', label: '1 week' },
];
function ChatsPage({ state }: { state: AppState }) {
  const s = state.settings;
  const ld = state.lockdown;
  return (
    <>
      <Section title="Writing">
        <Toggle label="Enter sends" checked={s.enterToSend} onChange={(enterToSend) => setS({ enterToSend })} hint={s.enterToSend ? 'Shift+Enter for a new line.' : 'Ctrl+Enter (⌘+Enter on Mac) sends; Enter adds a line.'} />
        <Toggle label="Format messages" checked={s.renderMarkdown} onChange={(renderMarkdown) => setS({ renderMarkdown })}
          hint="**bold**, *italic*, ~~strike~~, `code`, ```code blocks```, > quotes and ||spoilers||." />
      </Section>
      <Section title="Disappearing messages">
        <SelectRow label="For new chats" value={ld ? '86400' : s.defaultTtl ? String(s.defaultTtl) : 'off'} disabled={ld}
          hint={ld ? 'Lockdown Mode starts every new chat at 1 day.' : 'You can still change the timer in each chat.'}
          onChange={(v) => setS({ defaultTtl: v === 'off' ? null : Number(v) })} options={TTLS} />
      </Section>
      <Section title="Storage and connections">
        <Toggle label="Keep chat history on this device" checked={s.keepHistory} disabled={ld} onChange={(keepHistory) => setS({ keepHistory })}
          hint={ld ? 'Off in Lockdown Mode.' : 'Off by default: chats vanish when you close Sigil. When on, history is encrypted on this device and never backed up to Sigil.'} />
        <Toggle label="Direct connections" checked={s.directConnections} disabled={ld} onChange={(directConnections) => setS({ directConnections })}
          hint={ld ? 'Off in Lockdown Mode.' : "Connect straight to the other person (WebRTC) when you're both online. Faster, but it shows your IP address to them."} />
      </Section>
    </>
  );
}

function KeybindsPage() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const k = mac ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    [`${k}+K`, 'Quick switcher: jump to a chat, server or setting'],
    ['Enter', 'Send (or Shift+Enter, depending on your Chats setting)'],
    ['Esc', 'Cancel a reply or edit, close a dialog'],
    [`${k}+,`, 'Open settings'],
    [`${k}+Shift+L`, 'Lock Sigil now (when app lock is on)'],
    [`${k}+Shift+X`, 'Panic: wipe this device (when turned on)'],
  ];
  return (
    <Section title="Shortcuts">
      <table className="keys"><tbody>{rows.map(([key, what]) => <tr key={key}><td><kbd>{key}</kbd></td><td>{what}</td></tr>)}</tbody></table>
    </Section>
  );
}

// ------------------------------------------------------------------- data
function DataPage({ state }: { state: AppState }) {
  const { busy, run } = useAction();
  const download = async () => {
    const d = await run(() => call('exportData'));
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sigil-${state.me!.username}-data.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <>
      <Section title="Your data" note="The file includes your public keys and settings. It never contains messages: the server never had them.">
        <p className="muted small">Download everything Sigil's server keeps about your account: profile, privacy settings, sessions, username history, credits, listings and staff actions on your account.</p>
        <button className="btn" disabled={busy} onClick={download}><Icon name="download" size={15} />Download my data</button>
      </Section>
      <Section title="What Sigil keeps">
        <div className="keeps">
          <div>
            <h4>Stored on the server</h4>
            <ul>
              <li>Your username, profile, theme and images</li>
              <li>Your public keys</li>
              <li>Credits, purchases and marketplace listings</li>
              <li>Device labels and last-active times (no IPs)</li>
              <li>Short-lived rate-limit counters and hashed network fingerprints, for anti-abuse</li>
            </ul>
          </div>
          <div>
            <h4>Never stored on the server</h4>
            <ul>
              <li>Message text, reactions or edits</li>
              <li>Chat history or last-message previews</li>
              <li>Your contact or block lists</li>
              <li>Your app lock PIN</li>
            </ul>
          </div>
        </div>
        <p className="fine">The relay can see which accounts are exchanging messages while it passes them along. It doesn't log that. Sigil doesn't hide your IP address from the server; use a VPN or Tor if you need that.</p>
      </Section>
      <Section title="Server">
        <p className="muted small">Connected to <code>{state.serverUrl.replace(/^https?:\/\//, '')}</code>, version {state.platform.version || LATEST_VERSION}.</p>
      </Section>
    </>
  );
}
