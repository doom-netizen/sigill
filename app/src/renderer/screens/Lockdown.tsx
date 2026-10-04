// Lockdown Mode and device security (app lock, panic) settings.
import { useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Modal, Toggle, Icon, SelectRow } from '../components/ui';
import { LOCKDOWN_RULES } from '../../../../shared/lockdown';

function PhraseField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>Recovery phrase</span>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" placeholder="nine words, separated by dashes or spaces" />
    </label>
  );
}

export function LockdownSection({ state }: { state: AppState }) {
  const me = state.me!;
  const on = me.lockdown.enabled;
  const [modal, setModal] = useState<null | 'on' | 'off' | 'requests'>(null);
  const [phrase, setPhrase] = useState('');
  const { busy, run } = useAction();
  const close = () => { setModal(null); setPhrase(''); };

  return (
    <div className="lockdown">
      <section className={`lockdown-hero ${on ? 'on' : ''}`}>
        <div className="ld-icon" aria-hidden="true"><Icon name="shield" size={34} /></div>
        <div>
          <h2>Lockdown Mode {on && <span className="ld-state">On</span>}</h2>
          <p>
            An extreme, optional protection for people who might be personally targeted: staff, journalists, activists,
            or anyone dealing with harassment. Sigil gives up some convenience so there's much less anyone can reach.
            Most people never need it.
          </p>
          {on && me.lockdown.since && <p className="muted small">On since {new Date(me.lockdown.since).toLocaleString()}</p>}
          <div className="row">
            {on
              ? <button className="btn" onClick={() => setModal('off')}>Turn off Lockdown Mode…</button>
              : <button className="btn primary" onClick={() => setModal('on')}>Turn on Lockdown Mode…</button>}
          </div>
        </div>
      </section>

      {on && (
        <section className="card-section">
          <h3>While it's on</h3>
          <Toggle label="Allow message requests" checked={me.lockdown.allowRequests}
            hint="For journalists and others who need strangers to reach them. Requests stay text-only, images from them don't load, and links aren't clickable. Turning this on needs your recovery phrase."
            onChange={(v) => (v ? setModal('requests') : run(() => call('setLockdown', { allowRequests: false }), 'Requests closed'))} />
        </section>
      )}

      <section className="card-section">
        <h3>What changes</h3>
        <ul className="ld-rules">
          {LOCKDOWN_RULES.map((r) => (
            <li key={r.id}>
              <span className={`ld-where ${r.where}`}>{r.where === 'server' ? 'Enforced by the server' : r.where === 'device' ? 'On this device' : 'Server and device'}</span>
              <b>{r.title}</b>
              <p>{r.detail}</p>
            </li>
          ))}
        </ul>
        <p className="fine">
          What it can't do: hide that you use Sigil, protect a device that's already compromised, or stop someone you've accepted from screenshotting a chat.
          Server rules apply wherever you're signed in. Device rules apply on every device once it loads your account.
        </p>
      </section>

      {modal === 'on' && (
        <Modal title="Turn on Lockdown Mode?" onClose={close}>
          <ul className="facts">
            <li>Everyone you haven't accepted is cut off, and you look offline to everybody.</li>
            <li>Every other device signed in to @{me.username} is signed out now.</li>
            <li>Chat history on this device is deleted, and new chats disappear after a day.</li>
            <li>You'll need your recovery phrase to turn it off. Make sure you have it.</li>
          </ul>
          <div className="row end">
            <button className="btn ghost" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={() => run(() => call('setLockdown', { enabled: true }), 'Lockdown Mode is on').then((r) => r && close())}>Turn on and sign out other devices</button>
          </div>
        </Modal>
      )}
      {(modal === 'off' || modal === 'requests') && (
        <Modal title={modal === 'off' ? 'Turn off Lockdown Mode' : 'Allow message requests'} onClose={close}>
          <p className="muted">{modal === 'off'
            ? 'Enter your recovery phrase. This proves it\'s you, not someone who picked up your unlocked device.'
            : 'Strangers will be able to send you text-only message requests. Enter your recovery phrase to confirm.'}</p>
          <PhraseField value={phrase} onChange={setPhrase} />
          <div className="row end">
            <button className="btn ghost" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={busy || phrase.trim().split(/[\s,-]+/).length < 9}
              onClick={() => run(() => call('setLockdown', modal === 'off' ? { enabled: false, phrase } : { allowRequests: true, phrase }), modal === 'off' ? 'Lockdown Mode is off' : 'Requests allowed').then((r) => r && close())}>
              {modal === 'off' ? 'Turn off' : 'Allow requests'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function SecuritySection({ state, onLockNow }: { state: AppState; onLockNow: () => void }) {
  const s = state.settings;
  const [pinModal, setPinModal] = useState(false);
  const [panicModal, setPanicModal] = useState(false);
  const [pin, setPin] = useState({ a: '', b: '' });
  const { busy, run } = useAction();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <section className="card-section">
        <h3>App lock</h3>
        <p className="muted small">A PIN screen for this device, after you've been away. It keeps someone at your unlocked computer out of Sigil. Your PIN stays on this device and is never sent anywhere.</p>
        {s.appLock ? (
          <>
            <SelectRow label="Lock after" value={s.appLock.timeoutMin} onChange={(v) => run(() => call('setSettings', { appLock: { ...s.appLock!, timeoutMin: v } }))}
              options={[{ value: 1, label: '1 minute away' }, { value: 5, label: '5 minutes away' }, { value: 15, label: '15 minutes away' }, { value: 60, label: '1 hour away' }]} />
            <div className="row">
              <button className="btn" onClick={onLockNow}><Icon name="lock" size={15} />Lock now</button>
              <button className="btn ghost" onClick={() => setPinModal(true)}>Change PIN</button>
              <button className="btn ghost danger" onClick={() => run(() => call('setAppLock', { pin: null }), 'App lock off')}>Turn off</button>
            </div>
          </>
        ) : <button className="btn" onClick={() => setPinModal(true)}>Set a PIN</button>}
      </section>

      <section className="card-section">
        <h3>Panic</h3>
        <p className="muted small">Instantly sign this device out and erase its keys and chats. Your account is fine: sign back in later with your recovery phrase.</p>
        <Toggle label={`Panic shortcut: ${mac ? '⌘' : 'Ctrl'}+Shift+X`} checked={s.panicShortcut} onChange={(v) => run(() => call('setSettings', { panicShortcut: v }))}
          hint="Works from anywhere in Sigil. No confirmation, on purpose." />
        <button className="btn danger" onClick={() => setPanicModal(true)}><Icon name="flame" size={15} />Wipe this device now</button>
      </section>

      <section className="card-section">
        <h3>Encryption</h3>
        <ul className="facts">
          <li>Your account is a key made from your recovery phrase. There's no password for Sigil to leak or reset.</li>
          <li>When someone's safety number changes, the chat shows a warning. In Lockdown Mode, sending is blocked until you verify.</li>
          <li>Messages are padded to fixed sizes before they're encrypted, so the relay can't guess what you sent from its length.</li>
        </ul>
      </section>

      {pinModal && (
        <Modal title={s.appLock ? 'Change PIN' : 'Set a PIN'} onClose={() => { setPinModal(false); setPin({ a: '', b: '' }); }}>
          <div className="row two">
            <label className="field"><span>PIN (4–12 digits)</span><input inputMode="numeric" type="password" autoFocus value={pin.a} onChange={(e) => setPin({ ...pin, a: e.target.value.replace(/\D/g, '') })} maxLength={12} /></label>
            <label className="field"><span>Again</span><input inputMode="numeric" type="password" value={pin.b} onChange={(e) => setPin({ ...pin, b: e.target.value.replace(/\D/g, '') })} maxLength={12} /></label>
          </div>
          {pin.b && pin.a !== pin.b && <small className="status-line unavailable">The PINs don't match.</small>}
          <p className="fine">Forgot it later? Your recovery phrase unlocks the app too.</p>
          <div className="row end">
            <button className="btn primary" disabled={busy || pin.a.length < 4 || pin.a !== pin.b}
              onClick={() => run(() => call('setAppLock', { pin: pin.a, timeoutMin: s.appLock?.timeoutMin ?? 5 }), 'App lock on').then(() => { setPinModal(false); setPin({ a: '', b: '' }); })}>Save PIN</button>
          </div>
        </Modal>
      )}
      {panicModal && (
        <Modal title="Wipe this device?" onClose={() => setPanicModal(false)}>
          <p className="muted">This signs you out here and deletes this device's keys and chats right now. It doesn't delete your account. You'll need your recovery phrase to sign back in.</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setPanicModal(false)}>Cancel</button>
            <button className="btn danger" onClick={() => call('panic')}>Wipe now</button>
          </div>
        </Modal>
      )}
    </>
  );
}
