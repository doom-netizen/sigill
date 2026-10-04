// App-level overlays: the PIN lock screen, the privacy blur, and the Ctrl+K
// quick switcher.
import { useEffect, useMemo, useRef, useState } from 'react';
import { call, type AppState } from '../api';
import { Icon } from './ui';
import { Avatar } from './ProfileCard';

// ------------------------------------------------------------------ app lock
export function LockScreen({ state, onUnlock }: { state: AppState; onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [phraseMode, setPhraseMode] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [tries, setTries] = useState(0);
  const [wait, setWait] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [phraseMode]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const tryPin = async () => {
    if (wait > 0) return;
    if (await call<boolean>('checkPin', pin)) { onUnlock(); return; }
    const n = tries + 1;
    setTries(n);
    setPin('');
    if (n >= 5) { setWait(30); setErr('Too many tries. Wait 30 seconds, or use your recovery phrase.'); }
    else setErr("That's not your PIN.");
  };
  const tryPhrase = async () => {
    if (await call<boolean>('verifyPhrase', phrase)) {
      await call('setAppLock', { pin: null });
      onUnlock();
    } else setErr("That phrase doesn't match this account.");
  };
  const me = state.me;
  return (
    <div className="lockscreen" role="dialog" aria-modal="true" aria-label="Sigil is locked">
      <div className="lock-card">
        {me && <Avatar p={me} size={64} />}
        <h2>Sigil is locked</h2>
        {me && <p className="muted">@{me.username}</p>}
        {!phraseMode ? (
          <form onSubmit={(e) => { e.preventDefault(); tryPin(); }}>
            <input ref={input} className="pin-input" type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" value={pin} maxLength={12}
              disabled={wait > 0} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }} placeholder="PIN" />
            <button className="btn primary" type="submit" disabled={pin.length < 4 || wait > 0}>{wait > 0 ? `Wait ${wait}s` : 'Unlock'}</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); tryPhrase(); }}>
            <textarea ref={input as any} rows={3} value={phrase} onChange={(e) => { setPhrase(e.target.value); setErr(''); }} placeholder="Your 9-word recovery phrase" spellCheck={false} aria-label="Recovery phrase" />
            <button className="btn primary" type="submit" disabled={phrase.trim().split(/[\s,-]+/).length < 9}>Unlock and remove PIN</button>
          </form>
        )}
        {err && <p className="lock-err" role="alert">{err}</p>}
        <div className="row center">
          <button className="link small" onClick={() => { setPhraseMode(!phraseMode); setErr(''); }}>{phraseMode ? 'Use PIN' : 'Forgot PIN?'}</button>
          <button className="link small danger" onClick={() => call('panic')}>Wipe this device</button>
        </div>
      </div>
    </div>
  );
}

/** Locks after N idle minutes (and immediately on Ctrl/Cmd+Shift+L). */
export function useAppLock(state: AppState | null) {
  const lock = state?.settings.appLock;
  const [locked, setLocked] = useState(() => !!lock);
  const last = useRef(Date.now());
  useEffect(() => { if (!lock) setLocked(false); }, [lock]);
  useEffect(() => {
    if (!lock) return;
    const bump = () => { last.current = Date.now(); };
    const evs = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last.current > lock.timeoutMin * 60e3) setLocked(true); }, 5000);
    const onHide = () => { if (document.hidden) last.current = Math.min(last.current, Date.now()); };
    document.addEventListener('visibilitychange', onHide);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); document.removeEventListener('visibilitychange', onHide); };
  }, [lock]);
  return { locked: !!lock && locked, lockNow: () => lock && setLocked(true), unlock: () => { last.current = Date.now(); setLocked(false); } };
}

/** Covers the window when it loses focus (privacy screen). */
export function PrivacyBlur({ on }: { on: boolean }) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!on) { setAway(false); return; }
    const blur = () => setAway(true);
    const focus = () => setAway(false);
    const vis = () => setAway(document.hidden);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', vis); };
  }, [on]);
  if (!away) return null;
  return <div className="privacy-blur" onClick={() => setAway(false)}><div><Icon name="eye" size={28} /><b>Hidden while you're away</b><small>Click to show Sigil again.</small></div></div>;
}

// -------------------------------------------------------- quick switcher
export interface PaletteItem { id: string; label: string; hint?: string; icon?: string; group: string; run: () => void; keywords?: string }

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/^@/, '');
    const scored = items.map((it) => {
      const hay = `${it.label} ${it.keywords ?? ''} ${it.hint ?? ''}`.toLowerCase();
      if (!n) return { it, s: 1 };
      const idx = hay.indexOf(n);
      return { it, s: idx === 0 ? 3 : idx > 0 ? 2 : n.split('').every((c) => hay.includes(c)) ? 0.5 : 0 };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.slice(0, 12).map((x) => x.it);
  }, [q, items]);
  useEffect(() => { setI(0); }, [q]);
  const go = (it?: PaletteItem) => { if (!it) return; onClose(); it.run(); };
  return (
    <div className="modal-back palette-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Quick switcher">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a chat, server or setting"
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(list[i]); }
              else if (e.key === 'Escape') onClose();
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox">
          {list.length === 0 && <li className="palette-empty">Nothing matches “{q}”.</li>}
          {list.map((it, k) => (
            <li key={it.id} role="option" aria-selected={k === i}>
              <button className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => go(it)}>
                {it.icon && <Icon name={it.icon} size={16} />}<span>{it.label}</span>{it.hint && <small>{it.hint}</small>}<em>{it.group}</em>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
