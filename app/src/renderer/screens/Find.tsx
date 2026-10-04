import { useEffect, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Modal, Empty, Icon, countdown, useNow } from '../components/ui';
import { ProfileCard, Handle } from '../components/ProfileCard';
import type { PublicProfile } from '../../core/types';

export function Find({ state, initial, onMessage }: { state: AppState; initial?: string | null; onMessage: (peerId: string) => void }) {
  const [q, setQ] = useState(initial ?? '');
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState('');
  const [report, setReport] = useState(false);
  const { busy, run } = useAction();

  const search = async (name: string) => {
    const n = name.trim().replace(/^@/, '');
    if (!n) return;
    setErr('');
    try { setP(await call<PublicProfile>('lookup', n)); }
    catch (e: any) { setP(null); setErr(e.message); }
  };
  useEffect(() => { if (initial) { setQ(initial); search(initial); } }, [initial]);

  const isMe = p?.id === state.me?.id;
  const blocked = p && state.blocked.some((b) => b.id === p.id);

  return (
    <div className="page find">
      <header className="page-head">
        <h1>Find someone</h1>
        <p>Look up an exact username. There's no directory or suggestions, so nobody gets found unless someone knows their name.</p>
      </header>
      <form className="search" onSubmit={(e) => { e.preventDefault(); search(q); }}>
        <b>@</b>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} placeholder="username" spellCheck={false} aria-label="Username" />
        <button className="btn primary" type="submit">Look up</button>
      </form>
      <div className="find-result">
        {err && <Empty title="No profile found">{err === 'No profile with that username.' ? 'Either nobody has that name, or they chose not to be discoverable.' : err}</Empty>}
        {p && (
          <ProfileCard p={p} actions={isMe ? null : (
            <>
              <button className="pc-btn" disabled={busy || p.messagePolicy === 'nobody' || !!blocked}
                onClick={async () => { const r = await run(() => call('openConversation', p.username)); if (r) onMessage(p.id); }}>
                {p.messagePolicy === 'nobody' ? 'Not accepting messages' : blocked ? 'Blocked' : 'Message'}
              </button>
              <button className="pc-btn ghost" title="Report profile" aria-label="Report profile" onClick={() => setReport(true)}><Icon name="flag" /></button>
              {!blocked && <button className="pc-btn ghost" title="Block" aria-label="Block" onClick={() => run(() => call('block', p.id), `Blocked @${p.username}`)}><Icon name="ban" /></button>}
            </>
          )} />
        )}
        {p && p.messagePolicy === 'friends' && !isMe && <p className="fine center">@{p.username} only reads messages from people they've accepted. Yours may not reach them.</p>}
      </div>
      {report && p && <ReportModal targetId={p.id} username={p.username} onClose={() => setReport(false)} />}
    </div>
  );
}

const REASONS = [
  { value: 'username', label: 'Offensive username' }, { value: 'avatar', label: 'Avatar' }, { value: 'banner', label: 'Banner' },
  { value: 'bio', label: 'Bio or status' }, { value: 'impersonation', label: 'Impersonation' }, { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' }, { value: 'other', label: 'Something else' },
];

export function ReportModal({ targetId, username, onClose }: { targetId: string; username: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal title={`Report @${username}`} onClose={onClose}>
      <p className="muted">Reports cover the public profile. Staff can't see your messages, so describe anything that happened in chat below.</p>
      <div className="choice-list grid">
        {REASONS.map((r) => <button key={r.value} className={reason === r.value ? 'on' : ''} onClick={() => setReason(r.value)}>{r.label}</button>)}
      </div>
      <label className="field"><span>Details (optional)</span><textarea rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!reason || busy} onClick={async () => { if (await run(() => call('report', targetId, reason, details), 'Report sent')) onClose(); }}>Send report</button>
      </div>
    </Modal>
  );
}

interface RareItem { name: string; tier: string; status: string; by: string; createdAt: number; availableAt: number | null }

export function Rare({ onOpen }: { onOpen: (name: string) => void }) {
  const [items, setItems] = useState<RareItem[] | null>(null);
  const { run } = useAction();
  useNow(1000);
  useEffect(() => {
    const load = () => run(() => call<RareItem[]>('rareFeed')).then((r) => r && setItems(r));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [run]);

  return (
    <div className="page rare">
      <header className="page-head">
        <h1>Rare claims</h1>
        <p>Every 1–4 character name is claimed in the open. Three- and four-letter names sit on a public 24-hour hold before they change hands; one- and two-letter names are granted by staff.</p>
      </header>
      {items && items.length === 0 && <Empty title="No rare claims yet">The first short names will show up here.</Empty>}
      <ul className="rare-list">
        {items?.map((it, i) => (
          <li key={i} className={`rare-item ${it.status}`}>
            <span className="rare-name" data-len={it.name.length}>{it.name}</span>
            <span className="rare-info">
              {it.status === 'holding' && <><b>On hold</b><span>Claimed by <Handle name={it.by} />. Settles in {countdown(it.availableAt!)}.</span></>}
              {it.status === 'pending_staff' && <><b>Awaiting staff</b><span>Requested by <Handle name={it.by} /></span></>}
              {it.status === 'finalized' && <><b>Claimed</b><span><button className="link" onClick={() => onOpen(it.name)}>View profile</button></span></>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
