// Device preferences and Lockdown Mode, available to every component, plus
// the "you're leaving Sigil" link guard.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, type MouseEvent } from 'react';
import { sigil, type AppState } from '../api';
import { Modal } from './ui';
import { DEFAULT_SETTINGS, type Settings } from '../../core/types';

interface Prefs {
  settings: Settings;
  lockdown: boolean;
  meId: string | null;
  meName: string | null;
  contacts: Set<string>;
  /** may this person's images load? (Lockdown Mode: only people you've accepted) */
  mediaOk: (id?: string | null) => boolean;
  time: (ts: number) => string;
  openLink: (url: string) => void;
  /** onClick handler for containers of rendered markdown: routes <a> clicks through openLink */
  linkClicks: (e: MouseEvent) => void;
}

const Ctx = createContext<Prefs>({
  settings: DEFAULT_SETTINGS, lockdown: false, meId: null, meName: null, contacts: new Set(), mediaOk: () => true,
  time: (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), openLink: () => {}, linkClicks: () => {},
});
export const usePrefs = () => useContext(Ctx);

export function PrefsProvider({ state, children }: { state: AppState | null; children: ReactNode }) {
  const [pending, setPending] = useState<string | null>(null);
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const lockdown = !!state?.lockdown;
  const meId = state?.me?.id ?? null;
  const contactsKey = (state?.contacts ?? []).join(',');
  const contacts = useMemo(() => new Set(contactsKey ? contactsKey.split(',') : []), [contactsKey]);

  const openLink = useCallback((url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    if (lockdown) return; // links are plain text in Lockdown Mode
    if (settings.linkWarning) setPending(url); else sigil.openExternal(url);
  }, [lockdown, settings.linkWarning]);

  const value = useMemo<Prefs>(() => ({
    settings, lockdown, meId, meName: state?.me?.username ?? null, contacts,
    mediaOk: (id) => !lockdown || (!!id && (id === meId || contacts.has(id))),
    time: (ts) => new Date(ts).toLocaleTimeString([], { hour: settings.time24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !settings.time24 }),
    openLink,
    linkClicks: (e) => {
      const a = (e.target as HTMLElement).closest?.('a');
      if (!a) return;
      e.preventDefault();
      openLink(a.getAttribute('href') ?? '');
    },
  }), [settings, lockdown, meId, state?.me?.username, contacts, openLink]);

  let host = '';
  try { host = pending ? new URL(pending).hostname : ''; } catch { /* shown raw */ }
  return (
    <Ctx.Provider value={value}>
      {children}
      {pending && (
        <Modal title="Leaving Sigil" onClose={() => setPending(null)}>
          <p className="muted">This link opens in your browser. Check it goes where you expect: links can be made to look like something they're not.</p>
          <div className="link-preview"><b>{host}</b><code>{pending}</code></div>
          <div className="row end">
            <button className="btn ghost" onClick={() => setPending(null)}>Go back</button>
            <button className="btn primary" onClick={() => { sigil.openExternal(pending); setPending(null); }}>Open link</button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
