import { useEffect, useMemo, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Modal } from '../components/ui';
import TextPressure from '../components/TextPressure';
import { checkUsername as localCheck, tierFor } from '../../../../shared/usernames';
import type { UsernameCheckResult } from '../../core/types';

type Step = 'welcome' | 'name' | 'phrase' | 'confirm' | 'restore';

const TIER_COPY: Record<string, string> = {
  legendary: 'Legendary. One or two characters, granted by staff.',
  rare: 'Rare. Three characters unlock after 14 days.',
  short: 'Short. Four characters unlock after 7 days.',
  standard: 'Yours today.',
};

/** The username, set huge. Size steps with rarity. */
export function Trophy({ name, status }: { name: string; status?: UsernameCheckResult['status'] | 'idle' }) {
  const shown = name || 'name';
  return (
    <div className="trophy" data-len={Math.min(shown.length, 9)} data-empty={!name} data-status={status ?? 'idle'}>
      <span className="trophy-at">@</span>
      <span className="trophy-name">{shown}</span>
    </div>
  );
}

export function Onboarding({ state }: { state: AppState }) {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [check, setCheck] = useState<UsernameCheckResult | null>(null);
  const [phrase, setPhrase] = useState('');
  const [confirm, setConfirm] = useState({ a: '', b: '' });
  const [restorePhrase, setRestorePhrase] = useState('');
  const [serverOpen, setServerOpen] = useState(false);
  const { busy, run } = useAction();

  // Live check: local rules instantly, server for availability.
  useEffect(() => {
    if (!name) { setCheck(null); return; }
    const local = localCheck(name);
    if (!local.ok) { setCheck({ name: local.name, status: local.reason === 'charset' || local.reason === 'too_long' ? 'invalid' : 'unavailable', message: local.message, tier: null }); return; }
    const t = setTimeout(() => {
      call<UsernameCheckResult>('checkUsername', name).then(setCheck).catch((e) => setCheck({ name, status: 'invalid', message: e.message, tier: null }));
    }, 220);
    return () => clearTimeout(t);
  }, [name]);

  const words = phrase ? phrase.split('-') : [];
  const askA = 2, askB = 6; // ask for the 3rd and 7th word
  const tier = name && localCheck(name).ok ? tierFor(localCheck(name).name) : null;

  const canContinueName = check?.status === 'available' && (!state.inviteOnly || invite.trim().length >= 6);
  const confirmOk = words.length === 9 && confirm.a.trim().toLowerCase() === words[askA] && confirm.b.trim().toLowerCase() === words[askB];

  const statusLine = useMemo(() => {
    if (!name) return 'Letters, numbers and underscores. Up to 24.';
    if (!check) return 'Checking…';
    if (check.status === 'available') return TIER_COPY.standard;
    if (check.status === 'locked' && tier) return TIER_COPY[tier];
    return check.message;
  }, [name, check, tier]);

  return (
    <div className="onboard">
      <div className="onboard-mark">sigil<span>.</span></div>

      {step === 'welcome' && (
        <section className="onboard-panel intro">
          <div className="pressure-hero" style={{ position: 'relative', height: '300px' }}>
            <TextPressure text="sigil" flex alpha={false} stroke={false} width weight italic textColor="#ffffff" strokeColor="#5227FF" minFontSize={36} />
          </div>
          <h1>Claim a name worth keeping.</h1>
          <p>Short usernames are scarce here, and every chat is end-to-end encrypted. Sigil doesn't store your messages.</p>
          <div className="row">
            <button className="btn primary lg" onClick={() => setStep('name')}>Create an account</button>
            <button className="btn ghost lg" onClick={() => setStep('restore')}>I have a recovery phrase</button>
          </div>
          <button className="link small" onClick={() => setServerOpen(true)}>Server: {state.serverUrl.replace(/^https?:\/\//, '')}</button>
        </section>
      )}

      {step === 'name' && (
        <section className="onboard-panel">
          <Trophy name={check?.name ?? name.toLowerCase()} status={name ? check?.status : 'idle'} />
          <label className="field big">
            <span>Username</span>
            <div className="at-input">
              <b>@</b>
              <input autoFocus value={name} maxLength={30} spellCheck={false} autoComplete="off"
                onChange={(e) => setName(e.target.value.replace(/^@/, '').toLowerCase())} placeholder="pick one" aria-describedby="name-status" />
            </div>
            <small id="name-status" className={`status-line ${check?.status ?? ''}`}>{statusLine}</small>
          </label>
          {state.inviteOnly && (
            <label className="field">
              <span>Invite code</span>
              <input value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} placeholder="8 characters" maxLength={12} spellCheck={false} />
              <small>Sigil is invite-only while it launches. Ask someone who's already here.</small>
            </label>
          )}
          <div className="row">
            <button className="btn ghost" onClick={() => setStep('welcome')}>Back</button>
            <button className="btn primary" disabled={!canContinueName || busy} onClick={async () => {
              const p = await run(() => call<string>('newPhrase'));
              if (p) { setPhrase(p); setStep('phrase'); }
            }}>Continue</button>
          </div>
          <p className="fine">Want a 1–4 character name? Start with a longer one. Short names unlock as your account ages, and you can request them from your profile.</p>
        </section>
      )}

      {step === 'phrase' && (
        <section className="onboard-panel">
          <h1>Your recovery phrase</h1>
          <p>These 9 words are your account. There's no password and no email reset. Lose them and the account is gone, so write them down somewhere offline.</p>
          <ol className="phrase">
            {words.map((w, i) => <li key={i}><span>{i + 1}</span>{w}</li>)}
          </ol>
          <div className="row">
            <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(phrase)}>Copy</button>
            <button className="btn primary" onClick={() => setStep('confirm')}>I wrote it down</button>
          </div>
        </section>
      )}

      {step === 'confirm' && (
        <section className="onboard-panel">
          <h1>Check your copy</h1>
          <p>Type two of the words to confirm you have them.</p>
          <div className="row two">
            <label className="field"><span>Word {askA + 1}</span><input autoFocus value={confirm.a} onChange={(e) => setConfirm({ ...confirm, a: e.target.value })} spellCheck={false} /></label>
            <label className="field"><span>Word {askB + 1}</span><input value={confirm.b} onChange={(e) => setConfirm({ ...confirm, b: e.target.value })} spellCheck={false} /></label>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => setStep('phrase')}>Show phrase again</button>
            <button className="btn primary" disabled={!confirmOk || busy} onClick={() =>
              run(() => call('register', { username: name, invite: invite.trim(), phraseConfirmed: true }))
            }>{busy ? 'Creating…' : `Claim @${check?.name ?? name}`}</button>
          </div>
        </section>
      )}

      {step === 'restore' && (
        <section className="onboard-panel">
          <h1>Sign in with your phrase</h1>
          <p>Enter your 9-word recovery phrase. Your keys are rebuilt on this device; chats from other devices don't come with them.</p>
          <label className="field">
            <span>Recovery phrase</span>
            <textarea autoFocus rows={3} value={restorePhrase} onChange={(e) => setRestorePhrase(e.target.value)} spellCheck={false} placeholder="lusab-babad-gutih-…" />
          </label>
          <div className="row">
            <button className="btn ghost" onClick={() => setStep('welcome')}>Back</button>
            <button className="btn primary" disabled={busy || restorePhrase.trim().split(/[\s,-]+/).length < 9} onClick={() => run(() => call('restore', { phrase: restorePhrase }))}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </section>
      )}

      {serverOpen && <ServerModal current={state.serverUrl} onClose={() => setServerOpen(false)} />}
    </div>
  );
}

function ServerModal({ current, onClose }: { current: string; onClose: () => void }) {
  const [url, setUrl] = useState(current);
  const { busy, run } = useAction();
  return (
    <Modal title="Server" onClose={onClose}>
      <p className="muted">Sigil is one network. Change this only if you run your own server or are testing.</p>
      <label className="field"><span>Server URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} /></label>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => call('setServer', url), 'Server updated')) onClose(); }}>Save server</button>
      </div>
    </Modal>
  );
}
