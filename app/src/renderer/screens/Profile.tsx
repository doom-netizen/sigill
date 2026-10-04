import { useEffect, useMemo, useRef, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Segmented, Toggle, Icon, countdown, useNow } from '../components/ui';
import { ProfileCard, themeStyle } from '../components/ProfileCard';
import { BadgesSection } from '../components/Badges';
import { COSMETICS } from '../../../../shared/economy';
import { THEME_PRESETS, sanitizeTheme, type Theme } from '../../../../shared/theme';
import { BIO_MAX, DISPLAY_NAME_MAX, CUSTOM_STATUS_MAX } from '../../../../shared/markdown';
import { checkUsername as localCheck, USERNAME_CHANGE_COOLDOWN_DAYS } from '../../../../shared/usernames';
import type { Me, UsernameCheckResult, PublicProfile } from '../../core/types';

const SLOT_COPY = {
  avatar: { label: 'Avatar', hint: 'PNG, JPEG, WebP or GIF. Up to 8 MB, 120 frames. Cropped square.' },
  banner: { label: 'Banner', hint: 'Up to 12 MB, 90 frames. Shown at 960×320.' },
  background: { label: 'Page background', hint: 'Still image, up to 12 MB. Used when background is set to Image.' },
} as const;

export function Profile({ state }: { state: AppState }) {
  const me = state.me!;
  const [draft, setDraft] = useState({ displayName: me.displayName === me.username ? '' : me.displayName, bio: me.bio, customStatus: me.customStatus, theme: me.theme, pronouns: me.pronouns ?? '', links: me.links ?? [] });
  const { busy, run } = useAction();

  // Edits save themselves a moment after you stop typing (and when you leave the page).
  const ownSave = useRef(0);
  const [saveState, setSaveState] = useState<{ s: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ s: 'idle' });

  // Reset the draft if the server copy changes underneath (e.g. another device), but not for our own saves.
  const lastSaved = useRef(JSON.stringify({ d: me.displayName, b: me.bio, c: me.customStatus, t: me.theme, p: me.pronouns, l: me.links }));
  useEffect(() => {
    const now = JSON.stringify({ d: me.displayName, b: me.bio, c: me.customStatus, t: me.theme, p: me.pronouns, l: me.links });
    if (now !== lastSaved.current) {
      lastSaved.current = now;
      if (ownSave.current > 0) return;
      setDraft({ displayName: me.displayName === me.username ? '' : me.displayName, bio: me.bio, customStatus: me.customStatus, theme: me.theme, pronouns: me.pronouns ?? '', links: me.links ?? [] });
    }
  }, [me]);

  const dirty = (draft.displayName || me.username) !== me.displayName || draft.bio !== me.bio || draft.customStatus !== me.customStatus
    || JSON.stringify(sanitizeTheme(draft.theme)) !== JSON.stringify(me.theme) || draft.pronouns !== (me.pronouns ?? '')
    || JSON.stringify(draft.links) !== JSON.stringify(me.links ?? []);

  const preview: PublicProfile = useMemo(() => ({
    ...me, displayName: draft.displayName || me.username, bio: draft.bio, customStatus: draft.customStatus, theme: sanitizeTheme(draft.theme),
    pronouns: draft.pronouns, links: draft.links.filter((l) => /^https:\/\/./.test(l.url)),
  }), [me, draft]);

  const setTheme = (patch: Partial<Theme>) => setDraft((d) => ({ ...d, theme: sanitizeTheme({ ...d.theme, ...patch }) }));
  const setBg = (patch: Partial<Theme['background']>) => setDraft((d) => ({ ...d, theme: sanitizeTheme({ ...d.theme, background: { ...d.theme.background, ...patch } }) }));

  const payload = (d: typeof draft) => ({
    displayName: d.displayName, bio: d.bio, customStatus: d.customStatus, theme: d.theme, pronouns: d.pronouns,
    // only finished links (half-typed ones are saved once they look like an address)
    links: d.links.filter((l) => /^https:\/\/[^/\s]+\.[^\s]{2,}/.test(l.url.trim())),
  });
  const save = async (d = draft) => {
    ownSave.current++;
    setSaveState({ s: 'saving' });
    try {
      await call<Me>('updateProfile', payload(d));
      setSaveState({ s: 'saved' });
    } catch (e: any) {
      setSaveState({ s: 'error', msg: e?.message ?? "Couldn't save." });
    } finally {
      // let the state update from this save land before accepting outside changes again
      setTimeout(() => { ownSave.current--; }, 50);
    }
  };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save(draft), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => {
    if (saveState.s !== 'saved') return;
    const t = setTimeout(() => setSaveState({ s: 'idle' }), 1800);
    return () => clearTimeout(t);
  }, [saveState]);
  // Leaving the profile page with edits still waiting: save them now.
  useEffect(() => () => { if (dirtyRef.current) call('updateProfile', payload(draftRef.current)).catch(() => {}); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const owned = new Set(me.ownedCosmetics ?? []);

  return (
    <div className="profile-page">
      <div className="profile-edit">
        <header className="page-head">
          <h1>Your profile</h1>
          <p>This is your public face. Anyone with your username can see it{me.privacy.discoverable ? '' : ' (right now nobody can: you turned off discoverability)'}.</p>
        </header>

        <UsernameSection me={me} />

        <BadgesSection me={me} />

        <section className="card-section">
          <h3>About you</h3>
          <label className="field">
            <span>Display name</span>
            <input value={draft.displayName} maxLength={DISPLAY_NAME_MAX} placeholder={me.username} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
          </label>
          <label className="field">
            <span>Bio <em>{draft.bio.length}/{BIO_MAX}</em></span>
            <textarea rows={3} value={draft.bio} maxLength={BIO_MAX} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
            <small>Supports **bold**, *italic*, ~~strike~~, `code`, ||spoiler|| and https links.</small>
          </label>
          <div className="row two">
            <label className="field">
              <span>Status</span>
              <select value={me.status} onChange={(e) => run(() => call('updateProfile', { status: e.target.value }))}>
                <option value="online">Online</option>
                <option value="idle">Idle</option>
                <option value="dnd">Do not disturb</option>
                <option value="invisible">Invisible</option>
              </select>
            </label>
            <label className="field">
              <span>Custom status</span>
              <input value={draft.customStatus} maxLength={CUSTOM_STATUS_MAX} placeholder="What's up?" onChange={(e) => setDraft({ ...draft, customStatus: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>Pronouns</span>
            <input value={draft.pronouns} maxLength={24} placeholder="they/them" onChange={(e) => setDraft({ ...draft, pronouns: e.target.value })} />
          </label>
          <div className="field">
            <span>Links <em>{draft.links.length}/3</em></span>
            {draft.links.map((l, i) => (
              <div key={i} className="link-row">
                <input value={l.label} maxLength={24} placeholder="Label" aria-label={`Link ${i + 1} label`} onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <input value={l.url} maxLength={200} placeholder="https://" aria-label={`Link ${i + 1} address`} onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                <button type="button" className="icon-btn" aria-label="Remove link" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, j) => j !== i) })}><Icon name="x" size={16} /></button>
              </div>
            ))}
            {draft.links.length < 3 && <button type="button" className="btn ghost sm add-link" onClick={() => setDraft({ ...draft, links: [...draft.links, { label: '', url: 'https://' }] })}>Add link</button>}
            <small>https links only. They open in a new tab and show the site name.</small>
          </div>
        </section>

        <section className="card-section">
          <div className="section-head"><h3>Cosmetics</h3><span className="muted small">{owned.size} owned</span></div>
          <div className="row two cosmetic-pickers">
            {(['frame', 'effect', 'nameFx', 'accessory'] as const).map((slot) => (
              <label key={slot} className="field"><span>{({ frame: 'Avatar frame', effect: 'Animated theme', nameFx: 'Name effect', accessory: 'Accessory' })[slot]}</span>
                <select value={me[slot] ?? ''} onChange={(e) => run(() => call('updateProfile', { [slot]: e.target.value || null }))}>
                  <option value="">None</option>
                  {COSMETICS.filter((c) => c.kind === slot && owned.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="fine">Get more in the Marketplace shop with credits. Name effects replace your username style while they're on.</p>
        </section>

        <section className="card-section">
          <h3>Images</h3>
          {(['avatar', 'banner', 'background'] as const).map((slot) => <MediaRow key={slot} slot={slot} current={me[slot]} />)}
        </section>

        <section className="card-section">
          <h3>Theme</h3>
          <div className="presets">
            {THEME_PRESETS.map((p) => (
              <button key={p.name} className="preset" style={{ ['--sw' as any]: p.theme.accent, ['--sb' as any]: `linear-gradient(${p.theme.background.angle}deg, ${p.theme.background.from}, ${p.theme.background.to})` }}
                onClick={() => setDraft((d) => ({ ...d, theme: p.theme }))}>
                <i /><span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="row two">
            <div className="row two tight">
              <label className="field color">
                <span>Accent</span>
                <span className="color-input"><input type="color" value={draft.theme.accent} onChange={(e) => setTheme({ accent: e.target.value })} /><code>{draft.theme.accent}</code></span>
              </label>
              <label className="field color">
                <span>Second color</span>
                <span className="color-input"><input type="color" value={draft.theme.accent2} onChange={(e) => setTheme({ accent2: e.target.value })} /><code>{draft.theme.accent2}</code></span>
              </label>
            </div>
            <div className="field">
              <span>Font</span>
              <Segmented label="Font" value={draft.theme.font} onChange={(font) => setTheme({ font })}
                options={[{ value: 'mono', label: 'Mono' }, { value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'display', label: 'Display' }]} />
            </div>
          </div>
          <div className="field">
            <span>Background</span>
            <Segmented label="Background" value={draft.theme.background.type} onChange={(type) => setBg({ type })}
              options={[{ value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Solid' }, { value: 'image', label: 'Image' }]} />
          </div>
          {draft.theme.background.type === 'gradient' && (
            <div className="row three">
              <label className="field color"><span>From</span><span className="color-input"><input type="color" value={draft.theme.background.from} onChange={(e) => setBg({ from: e.target.value })} /></span></label>
              <label className="field color"><span>To</span><span className="color-input"><input type="color" value={draft.theme.background.to} onChange={(e) => setBg({ to: e.target.value })} /></span></label>
              <label className="field"><span>Angle <em>{draft.theme.background.angle}°</em></span><input type="range" min={0} max={360} value={draft.theme.background.angle} onChange={(e) => setBg({ angle: +e.target.value })} /></label>
            </div>
          )}
          {draft.theme.background.type === 'solid' && (
            <label className="field color"><span>Color</span><span className="color-input"><input type="color" value={draft.theme.background.color} onChange={(e) => setBg({ color: e.target.value })} /></span></label>
          )}
          {draft.theme.background.type === 'image' && !me.background && <p className="fine">Upload a page background above to use this.</p>}
          <div className="field">
            <span>Card</span>
            <Segmented label="Card style" value={draft.theme.cardStyle} onChange={(cardStyle) => setTheme({ cardStyle })}
              options={[{ value: 'glass', label: 'Glass' }, { value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }]} />
          </div>
          <div className="row two">
            <label className="field"><span>Corner radius <em>{draft.theme.radius}px</em></span><input type="range" min={0} max={28} value={draft.theme.radius} onChange={(e) => setTheme({ radius: +e.target.value })} /></label>
            <Toggle label="Film grain" checked={draft.theme.noise} onChange={(noise) => setTheme({ noise })} />
          </div>
          <div className="field">
            <span>Avatar shape</span>
            <Segmented label="Avatar shape" value={draft.theme.avatarShape} onChange={(avatarShape) => setTheme({ avatarShape })}
              options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }, { value: 'hex', label: 'Hexagon' }]} />
          </div>
          <div className="field">
            <span>Username style</span>
            <Segmented label="Username style" value={draft.theme.nameStyle} onChange={(nameStyle) => setTheme({ nameStyle })}
              options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'shimmer', label: 'Shimmer' }, { value: 'outline', label: 'Outline' }]} />
          </div>
          <Toggle label="Accent glow around the card" checked={draft.theme.glow} onChange={(glow) => setTheme({ glow })} />
        </section>

        <div className={`savebar ${saveState.s !== 'idle' ? 'show' : ''} ${saveState.s}`} role="status" aria-live="polite">
          {saveState.s === 'saving' && <span><Icon name="timer" size={14} />Saving…</span>}
          {saveState.s === 'saved' && <span className="ok"><Icon name="check" size={14} />Saved</span>}
          {saveState.s === 'error' && <>
            <span className="bad">{saveState.msg}</span>
            <button className="btn primary sm" onClick={() => save()}>Try again</button>
          </>}
        </div>
      </div>

      <aside className="profile-preview">
        <div className="stage" style={{ ...themeStyle(preview), background: 'var(--p-bg)' }}>
          <ProfileCard p={preview} actions={<button className="pc-btn" disabled={me.privacy.whoCanMessage === 'nobody'}>{me.privacy.whoCanMessage === 'nobody' ? 'Not accepting messages' : 'Message'}</button>} />
        </div>
        <p className="fine center">Preview. Public at {state.serverUrl.replace(/^https?:\/\//, '')}/{me.username}</p>
      </aside>
    </div>
  );
}


function MediaRow({ slot, current }: { slot: 'avatar' | 'banner' | 'background'; current: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  return (
    <div className="media-row">
      <div className={`media-thumb ${slot}`}>{current ? <img src={current} alt="" /> : <Icon name="upload" />}</div>
      <div className="media-text">
        <b>{SLOT_COPY[slot].label}</b>
        <small>{SLOT_COPY[slot].hint}</small>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const buf = new Uint8Array(await f.arrayBuffer());
        await run(() => call('uploadMedia', slot, buf), `${SLOT_COPY[slot].label} updated`);
      }} />
      <div className="row">
        {current && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => call('removeMedia', slot), 'Removed')}>Remove</button>}
        <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Processing…' : current ? 'Replace' : 'Upload'}</button>
      </div>
    </div>
  );
}

function UsernameSection({ me }: { me: Me }) {
  const [name, setName] = useState('');
  const [check, setCheck] = useState<UsernameCheckResult | null>(null);
  const { busy, run } = useAction();
  useNow(1000);

  useEffect(() => {
    if (!name) { setCheck(null); return; }
    const local = localCheck(name);
    if (!local.ok) { setCheck({ name: local.name, status: local.reason === 'charset' || local.reason === 'too_long' ? 'invalid' : 'unavailable', message: local.message, tier: null }); return; }
    const t = setTimeout(() => call<UsernameCheckResult>('checkUsername', name).then(setCheck).catch(() => {}), 220);
    return () => clearTimeout(t);
  }, [name, me.username, me.pendingClaim?.id]);

  const claim = async () => {
    const r = await run(() => call('claimUsername', name));
    if (!r) return;
    setName('');
  };

  const pc = me.pendingClaim;
  const label = check?.status === 'hold' ? `Start 24h hold on @${check.name}` : check?.status === 'staff' ? `Request @${check.name}` : `Change to @${check?.name ?? name}`;

  return (
    <section className="card-section">
      <h3>Username</h3>
      <p className="muted">
        You have one username. Changing it starts a {USERNAME_CHANGE_COOLDOWN_DAYS}-day cooldown, and your old name stays locked for {USERNAME_CHANGE_COOLDOWN_DAYS} days so nobody can grab it.
        {me.nextUsernameChangeAt && <> Next change available {new Date(me.nextUsernameChangeAt).toLocaleDateString()}.</>}
      </p>
      {pc && (
        <div className="claim-banner">
          <span className="claim-name" data-len={pc.name.length}>@{pc.name}</span>
          <span>
            {pc.status === 'holding' ? <>On public hold. It becomes yours in <b>{countdown(pc.availableAt!)}</b> unless staff step in.</> : <>Waiting for staff review.</>}
          </span>
          <button className="btn ghost sm" disabled={busy} onClick={() => run(() => call('cancelClaim'), 'Claim cancelled')}>Cancel</button>
        </div>
      )}
      {!pc && (
        <>
          <div className="at-input inline">
            <b>@</b>
            <input value={name} onChange={(e) => setName(e.target.value.replace(/^@/, '').toLowerCase())} placeholder="new username" spellCheck={false} maxLength={30} aria-label="New username" />
            <button className="btn primary sm" disabled={busy || !check || !['available', 'hold', 'staff'].includes(check.status)} onClick={claim}>{name ? label : 'Check'}</button>
          </div>
          {check && <p className={`status-line ${check.status}`}>{check.message}</p>}
          {check?.requirements && (
            <ul className="reqs">
              {check.requirements.map((r) => <li key={r.label} className={r.met ? 'met' : ''}><Icon name={r.met ? 'check' : 'x'} size={14} />{r.label}</li>)}
            </ul>
          )}
        </>
      )}
      <details className="activity">
        <summary>Activity score: {me.activity}</summary>
        <ul>{me.activityBreakdown.map((b) => <li key={b.label}><span>{b.label}</span><b>+{b.points}</b></li>)}</ul>
        <p className="fine">Short names need an older, active account. 4 characters: 7 days and score 4. 3 characters: 14 days and score 6. 1–2 characters: same as 3, plus staff approval.</p>
      </details>
    </section>
  );
}
