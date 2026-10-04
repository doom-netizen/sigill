import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, sigil, type AppState } from './api';
import { ToastHost, Icon, useToast } from './components/ui';
import { Avatar } from './components/ProfileCard';
import { Onboarding } from './screens/Onboarding';
import { Chats } from './screens/Chats';
import { Find, Rare } from './screens/Find';
import { Profile } from './screens/Profile';
import { Settings, SETTINGS_PAGES, type SettingsPage } from './screens/Settings';
import { PrefsProvider } from './components/Prefs';
import { LockScreen, useAppLock, PrivacyBlur, Palette, type PaletteItem } from './components/Overlays';
import { LATEST_VERSION } from '../../../shared/changelog';
import { Staff } from './screens/Staff';
import { Market } from './screens/Market';
import { SpaceScreen, SpaceIcon, NewSpaceModal } from './screens/Spaces';
import { DirectManager } from './direct';
import { themeToCssVars } from '../../../shared/theme';

const fmtUntil = (t: number) => (t > 8e15 ? 'until further notice' : `until ${new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);

type Tab = 'chats' | 'requests' | 'find' | 'rare' | 'market' | 'profile' | 'settings' | 'staff' | 'space';

/** Liquid-glass refraction filter (used by Chromium; other engines fall back to blur). */
function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="liquid-glass" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="38" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('chats');
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [openPeer, setOpenPeer] = useState<string | null>(null);
  const [findName, setFindName] = useState<string | null>(null);
  const [newSpace, setNewSpace] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const [palette, setPalette] = useState(false);
  const direct = useRef<DirectManager | null>(null);
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;
  const appLock = useAppLock(state?.phase === 'ready' ? state : null);

  useEffect(() => {
    const off1 = sigil.on('state', (s: AppState) => setState(s));
    const off2 = sigil.on('open-profile', (name: string) => { setFindName(name); setTab('find'); });
    // Web notifications (the desktop app shows its own from the main process).
    const off3 = sigil.on('notify', (n: { username: string; request: boolean; text?: string; space?: string; channel?: string }) => {
      const st = stateRef.current?.settings;
      if (!st?.notifications || sigil.platform !== 'web' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      if (document.hasFocus() || (n.request && !st.notifyRequests)) return;
      const where = n.space ? ` in ${n.space}${n.channel ? ` #${n.channel}` : ''}` : '';
      const body = st.notifyContent === 'none' ? 'New message' : st.notifyContent === 'name' || !n.text
        ? (n.request ? `Message request from @${n.username}` : `New message from @${n.username}${where}`)
        : `@${n.username}${where}: ${n.text}`;
      try { new Notification('Sigil', { body, silent: !st.notifySound, tag: 'sigil' }); } catch { /* not allowed */ }
    });
    call<AppState>('getState').then(setState);
    direct.current = new DirectManager();
    return () => { off1(); off2(); off3(); };
  }, []);

  // Global shortcuts: quick switcher, settings, lock, panic.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || stateRef.current?.phase !== 'ready') return;
      const key = e.key.toLowerCase();
      if (key === 'k' && !e.shiftKey) { e.preventDefault(); setPalette((v) => !v); }
      else if (key === ',') { e.preventDefault(); setTab('settings'); }
      else if (e.shiftKey && key === 'l') { e.preventDefault(); appLock.lockNow(); }
      else if (e.shiftKey && key === 'x' && stateRef.current?.settings.panicShortcut) { e.preventDefault(); call('panic'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [appLock]);

  useEffect(() => { if (state) direct.current?.sync(state); }, [state]);

  const settings = state?.settings;
  // Appearance applies to the whole document (also behind modals and the onboarding screens).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.appearance = settings?.appearance ?? 'dark';
    root.dataset.glass = settings?.liquidGlass ? 'on' : 'off';
    root.dataset.motion = settings?.reduceMotion ? 'reduced' : 'full';
    root.dataset.density = settings?.density ?? 'cozy';
    root.dataset.contrast = settings?.highContrast ? 'high' : 'normal';
    root.dataset.links = settings?.underlineLinks ? 'underline' : 'plain';
    root.dataset.shapes = settings?.presenceShapes ? 'on' : 'off';
    root.style.fontSize = `${settings?.fontScale ?? 100}%`;
    const chromium = !!(navigator as any).userAgentData?.brands?.some((b: { brand: string }) => /Chromium/.test(b.brand));
    root.dataset.engine = chromium ? 'chromium' : 'other';
  }, [settings?.appearance, settings?.liquidGlass, settings?.reduceMotion, settings?.density, settings?.highContrast, settings?.underlineLinks, settings?.presenceShapes, settings?.fontScale]);

  // The app chrome picks up your own accent color.
  const accentVars = useMemo(() => {
    if (!state?.me) return {};
    const v = themeToCssVars(state.me.theme);
    return { '--accent': v['--p-accent'], '--accent-soft': v['--p-accent-soft'] } as React.CSSProperties;
  }, [state?.me?.theme]);

  const openSpace = useCallback((id: string) => { setSpaceId(id); setTab('space'); }, []);
  const leftSpace = useCallback(() => { setSpaceId(null); setTab('chats'); }, []);

  const openSettings = useCallback((p: SettingsPage | null) => { setSettingsPage(p); setTab('settings'); }, []);

  if (!state || state.phase === 'loading') return <div className="boot"><div className="onboard-mark">sigil<span>.</span></div></div>;
  if (state.phase === 'welcome') return <ToastHost><PrefsProvider state={state}><GlassDefs /><Onboarding state={state} /></PrefsProvider></ToastHost>;

  const me = state.me;
  const requests = state.conversations.filter((c) => c.status === 'request');
  const unread = state.conversations.filter((c) => c.status === 'active').reduce((n, c) => n + c.unread, 0);
  const isStaff = me?.roles.includes('staff');
  const spaceUnread = (id: string) => (state.spaces.find((s) => s.id === id)?.channels ?? []).reduce((n, c) => n + (state.channels[c.id]?.unread ?? 0), 0);

  const nav: { id: Tab; icon: string; label: string; count?: number }[] = [
    { id: 'chats', icon: 'chat', label: 'Chats', count: unread },
    { id: 'requests', icon: 'inbox', label: 'Requests', count: requests.length },
    { id: 'find', icon: 'search', label: 'Find' },
    { id: 'market', icon: 'tag', label: 'Marketplace' },
    { id: 'rare', icon: 'gem', label: 'Rare claims' },
    ...(isStaff ? [{ id: 'staff' as Tab, icon: 'shield', label: 'Staff' }] : []),
    { id: 'settings', icon: 'gear', label: 'Settings' },
  ];

  const openDm = async (username: string) => {
    const s = await call<AppState>('openConversation', username).catch(() => null);
    const c = s?.conversations.find((x) => x.peer.username === username);
    if (c) { setOpenPeer(c.peerId); setTab('chats'); }
  };

  const view = tab === 'space' && spaceId ? `space-${spaceId}` : tab;
  const unseenUpdate = state.settings.lastSeenUpdate !== LATEST_VERSION;

  const paletteItems: PaletteItem[] = [
    ...state.conversations.map((c) => ({ id: `c-${c.peerId}`, label: `@${c.peer.username}`, hint: c.peer.displayName, icon: 'chat', group: c.status === 'request' ? 'Request' : 'Chat',
      run: () => { setOpenPeer(c.peerId); setTab(c.status === 'request' ? 'requests' : 'chats'); } })),
    ...state.spaces.flatMap((s) => [
      { id: `s-${s.id}`, label: s.name, icon: 'users', group: s.kind === 'group' ? 'Group' : 'Server', run: () => openSpace(s.id) },
    ]),
    ...nav.map((n) => ({ id: `n-${n.id}`, label: n.label, icon: n.icon, group: 'Go to', run: () => setTab(n.id) })),
    { id: 'n-profile', label: 'Your profile', icon: 'user', group: 'Go to', run: () => setTab('profile') },
    ...SETTINGS_PAGES.map((p) => ({ id: `p-${p.id}`, label: p.label, icon: p.icon, group: 'Settings', keywords: 'settings', run: () => openSettings(p.id) })),
  ];

  return (
    <ToastHost>
     <PrefsProvider state={state}>
      <GlassDefs />
      {settings?.liquidGlass && <div className="glass-ambient" aria-hidden="true"><i /><i /><i /></div>}
      <div className={`shell ${sigil.platform === 'darwin' ? 'mac' : ''}`} style={accentVars}>
        <nav className="rail" aria-label="Main">
          <div className="rail-mark" aria-hidden="true">s<span>.</span></div>
          {nav.map((n) => (
            <button key={n.id} className={`rail-btn ${tab === n.id ? 'on' : ''}`} onClick={() => (n.id === 'settings' ? openSettings(null) : setTab(n.id))} aria-label={n.label} title={n.label} aria-current={tab === n.id ? 'page' : undefined}>
              <Icon name={n.icon} size={20} />
              {!!n.count && <span className="rail-count">{n.count > 99 ? '99+' : n.count}</span>}
              {n.id === 'settings' && unseenUpdate && <span className="rail-dot" aria-label="What's new" />}
            </button>
          ))}
          <div className="rail-sep" />
          <div className="rail-spaces" aria-label="Servers and groups">
            {state.spaces.map((s) => {
              const u = spaceUnread(s.id);
              return (
                <button key={s.id} className={`rail-space ${tab === 'space' && spaceId === s.id ? 'on' : ''}`} onClick={() => openSpace(s.id)} aria-label={s.name} title={s.name}>
                  <SpaceIcon sp={s} size={40} />
                  {u > 0 && <span className="rail-count">{u > 99 ? '99+' : u}</span>}
                </button>
              );
            })}
            <button className="rail-btn add" onClick={() => setNewSpace(true)} aria-label="Create or join a server" title="Create or join a server"><span aria-hidden="true">+</span></button>
          </div>
          <div className="rail-spacer" />
          {state.lockdown && <button className="rail-ld" onClick={() => openSettings('lockdown')} aria-label="Lockdown Mode is on" title="Lockdown Mode is on"><Icon name="shield" size={16} /></button>}
          <span className={`conn ${state.connection}`} title={state.connection === 'online' ? 'Connected' : state.connection === 'connecting' ? 'Connecting…' : 'Offline. Retrying.'} />
          {me && (
            <button className={`rail-me ${tab === 'profile' ? 'on' : ''}`} onClick={() => setTab('profile')} aria-label="Your profile" title={`@${me.username}`}>
              <Avatar p={me} size={38} presence={me.status === 'invisible' ? 'offline' : me.status} />
            </button>
          )}
        </nav>
        <main className="main">
          {state.connection === 'offline' && <div className="offline-bar">Can't reach Sigil. Messages can't be sent until you're back online; nothing is queued.</div>}
          {state.platform.banner && <div className={`site-banner ${state.platform.banner.tone}`} role="status"><Icon name="info" size={15} /><span>{state.platform.banner.text}</span></div>}
          {me?.notices?.map((n) => (
            <div key={n.id} className={`notice-bar ${n.kind === 'broadcast' ? 'broadcast' : 'warn'}`} role="alert">
              <span><b>{n.kind === 'broadcast' ? 'Announcement from Sigil.' : 'Warning from Sigil staff.'}</b> {n.message}</span>
              <button className="btn sm" onClick={() => call('ackNotice', n.id)}>{n.kind === 'broadcast' ? 'Got it' : 'I understand'}</button>
            </div>
          ))}
          {me?.restrictions?.mutedUntil && (
            <div className="notice-bar"><span><b>Messaging is restricted</b> {fmtUntil(me.restrictions.mutedUntil)}.{me.restrictions.muteReason ? ` Reason: ${me.restrictions.muteReason}` : ''} You can still read messages.</span></div>
          )}
          {me?.restrictions?.frozenUntil && (
            <div className="notice-bar"><span><b>Profile editing is locked</b> {fmtUntil(me.restrictions.frozenUntil)}.{me.restrictions.freezeReason ? ` Reason: ${me.restrictions.freezeReason}` : ''}</span></div>
          )}
          <div className="view" key={view}>
            {(tab === 'chats' || tab === 'requests') && (
              <Chats state={state} mode={tab} openPeer={openPeer} setOpenPeer={setOpenPeer} goFind={() => setTab('find')} />
            )}
            {tab === 'find' && <Find state={state} initial={findName} onMessage={(id) => { setOpenPeer(id); setTab('chats'); setFindName(null); }} />}
            {tab === 'market' && <Market state={state} />}
            {tab === 'rare' && <Rare onOpen={(n) => { setFindName(n); setTab('find'); }} />}
            {tab === 'profile' && me && <Profile state={state} />}
            {tab === 'settings' && me && <Settings state={state} page={settingsPage} onLockNow={appLock.lockNow} goProfile={() => setTab('profile')} />}
            {tab === 'staff' && isStaff && <Staff state={state} />}
            {tab === 'space' && spaceId && <SpaceScreen state={state} spaceId={spaceId} onLeft={leftSpace} openDm={openDm} />}
          </div>
        </main>
      </div>
      {newSpace && <NewSpaceModal onClose={() => setNewSpace(false)} onOpen={openSpace} />}
      {palette && <Palette items={paletteItems} onClose={() => setPalette(false)} />}
      <PrivacyBlur on={state.settings.blurOnLeave} />
      {appLock.locked && <LockScreen state={state} onUnlock={appLock.unlock} />}
     </PrefsProvider>
    </ToastHost>
  );
}

export { useToast };
