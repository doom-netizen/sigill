import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Modal, Empty, Icon, timeAgo, useNow } from '../components/ui';
import { Avatar, Handle, ProfileCard } from '../components/ProfileCard';
import type { ChatMessage, ConversationView } from '../../core/types';
import { ReportModal } from './Find';
import { usePrefs } from '../components/Prefs';
import { MessageText, Reactions, MsgActions, ReplyQuote, Composer } from '../components/Messages';

const TTL_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' }, { value: 30, label: '30 seconds' }, { value: 300, label: '5 minutes' },
  { value: 3600, label: '1 hour' }, { value: 86400, label: '1 day' }, { value: 604800, label: '1 week' },
];
const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.ceil(s / 60)}m` : s < 86400 ? `${Math.ceil(s / 3600)}h` : `${Math.ceil(s / 86400)}d`;
};
const ttlShort = (t: number | null) => (t == null ? '' : t < 60 ? `${t}s` : t < 3600 ? `${t / 60}m` : t < 86400 ? `${t / 3600}h` : `${t / 86400}d`);

export function Chats({ state, mode, openPeer, setOpenPeer, goFind }: {
  state: AppState; mode: 'chats' | 'requests'; openPeer: string | null; setOpenPeer: (id: string | null) => void; goFind: () => void;
}) {
  const list = state.conversations.filter((c) => (mode === 'requests' ? c.status === 'request' : c.status === 'active'));
  const current = state.conversations.find((c) => c.peerId === openPeer && (mode === 'requests' ? c.status === 'request' : c.status === 'active')) ?? null;
  const { settings } = usePrefs();
  useNow(30_000);

  useEffect(() => { if (current?.unread) call('markRead', current.peerId); }, [current?.peerId, current?.unread]);

  return (
    <div className={`split ${current ? 'has-open' : ''}`}>
      <aside className="list-col">
        <header className="col-head">
          <h2>{mode === 'requests' ? 'Message requests' : 'Chats'}</h2>
          {mode === 'chats' && <button className="icon-btn" aria-label="New chat" title="New chat" onClick={goFind}><Icon name="search" /></button>}
        </header>
        {mode === 'requests' && <p className="col-note">People you haven't talked to yet. They can't see whether you've read their messages.</p>}
        <div className="conv-list">
          {list.length === 0 && (
            <div className="list-empty">{mode === 'requests' ? 'No requests.' : 'No chats yet.'}</div>
          )}
          {list.map((c) => {
            const last = [...c.messages].reverse().find((m) => m.from !== 'system');
            return (
              <button key={c.peerId} className={`conv-item ${c.peerId === openPeer ? 'on' : ''}`} onClick={() => setOpenPeer(c.peerId)}>
                <Avatar p={c.peer} presence={c.presence} />
                <span className="conv-main">
                  <span className="conv-top"><Handle name={c.peer.username} />{last && <time>{timeAgo(last.ts)}</time>}</span>
                  <span className="conv-preview">{!last ? 'No messages' : settings.hidePreviews ? (c.unread ? 'New message' : 'Message') : last.deleted ? 'Message unsent' : `${last.from === 'me' ? 'You: ' : ''}${last.text}`}</span>
                </span>
                {c.unread > 0 && <span className="pill">{c.unread}</span>}
              </button>
            );
          })}
        </div>
      </aside>
      <section className="thread-col">
        {current ? <Thread key={current.peerId} c={current} state={state} onClosed={() => setOpenPeer(null)} />
          : mode === 'requests'
            ? <Empty title="Nothing waiting">When someone new messages you, it shows up here first.</Empty>
            : <Empty title="Start a private chat" action={<button className="btn primary" onClick={goFind}>Find someone</button>}>
                Messages are end-to-end encrypted and only exist on your devices.
              </Empty>}
      </section>
    </div>
  );
}

function Thread({ c, state, onClosed }: { c: ConversationView; state: AppState; onClosed: () => void }) {
  const [modal, setModal] = useState<null | 'safety' | 'profile' | 'report' | 'timer'>(null);
  const [menu, setMenu] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const { run } = useAction();
  const { time, lockdown } = usePrefs();
  const scroller = useRef<HTMLDivElement>(null);
  useNow(1000);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.messages.length]);

  const me = state.me!;
  const nameOf = (id: string) => (id === me.id ? 'You' : id === c.peerId ? `@${c.peer.username}` : 'someone');
  const where = { peerId: c.peerId };
  const jump = (id: string) => document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const isRequest = c.status === 'request';
  const offline = state.connection !== 'online';

  return (
    <div className="thread">
      <header className="thread-head">
        <button className="icon-btn back-btn" aria-label="Back to chats" onClick={onClosed}><Icon name="back" /></button>
        <button className="thread-who" onClick={() => setModal('profile')}>
          <Avatar p={c.peer} presence={c.presence} size={34} />
          <span>
            <Handle name={c.peer.username} />
            <small>{c.presence === 'offline' ? 'Offline' : c.customStatus || (c.presence ? { online: 'Online', idle: 'Idle', dnd: 'Do not disturb' }[c.presence] : '')}</small>
          </span>
        </button>
        <div className="thread-tools">
          {c.direct && <span className="chip" title="Connected directly (WebRTC). Messages skip the relay."><Icon name="bolt" size={14} />Direct</span>}
          <button className={`chip ${c.verified ? 'ok' : ''}`} onClick={() => setModal('safety')} title="Encryption details">
            <Icon name={c.verified ? 'shield' : 'lock'} size={14} />{c.verified ? 'Verified' : 'Encrypted'}
          </button>
          {!isRequest && (
            <button className={`chip ${c.ttl ? 'accent' : ''}`} onClick={() => setModal('timer')} title="Disappearing messages">
              <Icon name="timer" size={14} />{c.ttl ? ttlShort(c.ttl) : 'Keep'}
            </button>
          )}
          <div className="menu-wrap">
            <button className="icon-btn" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setMenu(false); setModal('profile'); }}>View profile</button>
                <button onClick={() => { setMenu(false); run(() => call('clearConversation', c.peerId), 'Cleared from this device'); }}>Clear chat on this device</button>
                <button onClick={() => { setMenu(false); setModal('report'); }}>Report profile</button>
                <button className="danger" onClick={() => { setMenu(false); run(() => call('block', c.peerId), `Blocked @${c.peer.username}`).then(onClosed); }}>Block @{c.peer.username}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="messages" ref={scroller}>
        <div className="e2ee-note"><Icon name="lock" size={14} />Messages with @{c.peer.username} are end-to-end encrypted. Sigil relays them but can't read them, and doesn't keep them.</div>
        {c.messages.map((m, i) => {
          if (m.from === 'system') return <div key={m.id} className="sys">{m.text}</div>;
          const prev = c.messages[i - 1];
          const grouped = prev && prev.from === m.from && m.ts - prev.ts < 120_000 && !m.replyTo;
          return (
            <div key={m.id} id={`m-${m.id}`} className={`msg ${m.from} ${grouped ? 'grouped' : ''} ${m.status} ${replyTo?.id === m.id || editing?.id === m.id ? 'targeted' : ''} ${tapped === m.id ? 'show-actions' : ''}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) setTapped(tapped === m.id ? null : m.id); }}>
              {!isRequest && <MsgActions m={m} where={where} mine={m.from === 'me'} onReply={() => { setEditing(null); setReplyTo(m); }} onEdit={() => { setReplyTo(null); setEditing(m); }} />}
              {m.replyTo && <ReplyQuote r={m.replyTo} nameOf={nameOf} onJump={() => jump(m.replyTo!.id)} />}
              <div className="bubble"><MessageText m={m} /></div>
              <Reactions m={m} where={where} nameOf={nameOf} />
              <div className="msg-meta">
                {m.expiresAt && <span title="Disappears"><Icon name="timer" size={11} />{fmtLeft(m.expiresAt - Date.now())}</span>}
                {m.from === 'me' && m.status === 'sending' && <span>Sending</span>}
                {m.via === 'direct' && <span>Direct</span>}
                {!grouped && <time>{time(m.ts)}</time>}
              </div>
              {m.status === 'failed' && <div className="msg-fail">{m.note ?? 'Not delivered.'}</div>}
            </div>
          );
        })}
      </div>

      {c.keyChanged && !isRequest && (
        <div className={`keychange-bar ${lockdown ? 'hard' : ''}`} role="alert">
          <Icon name="key" size={16} />
          <span><b>@{c.peer.username}'s safety number changed.</b> {lockdown ? 'Lockdown Mode won\'t send until you compare the new number with them.' : 'Compare it with them before sharing anything sensitive.'}</span>
          <div className="row">
            {!lockdown && <button className="btn ghost sm" onClick={() => run(() => call('ackKeyChange', c.peerId))}>Dismiss</button>}
            <button className="btn sm primary" onClick={() => setModal('safety')}>Verify</button>
          </div>
        </div>
      )}

      {isRequest ? (
        <div className="request-bar">
          <p><b>@{c.peer.username}</b> wants to message you. Accept to reply; they'll get a notice. Decline removes this chat without telling them.</p>
          <div className="row">
            <button className="btn danger ghost" onClick={() => run(() => call('block', c.peerId), 'Blocked').then(onClosed)}>Block</button>
            <button className="btn ghost" onClick={() => run(() => call('declineRequest', c.peerId)).then(onClosed)}>Decline</button>
            <button className="btn primary" onClick={() => run(() => call('acceptRequest', c.peerId), 'Request accepted')}>Accept</button>
          </div>
        </div>
      ) : (
        <Composer placeholder={offline ? 'Reconnecting…' : `Message @${c.peer.username}`} disabled={offline} nameOf={nameOf}
          replyTo={replyTo} setReplyTo={setReplyTo} editing={editing} setEditing={setEditing}
          onSend={(t, r) => run(() => call('sendText', c.peerId, t, r))}
          onEdit={(id, t) => run(() => call('editMessage', where, id, t))} />
      )}

      {modal === 'safety' && <SafetyModal c={c} onClose={() => setModal(null)} />}
      {modal === 'timer' && (
        <Modal title="Disappearing messages" onClose={() => setModal(null)}>
          <p className="muted">New messages vanish from both devices after this time. It applies to messages sent from now on.</p>
          <div className="choice-list">
            {TTL_OPTIONS.map((o) => (
              <button key={String(o.value)} className={c.ttl === o.value ? 'on' : ''} onClick={() => { run(() => call('setDisappearing', c.peerId, o.value)); setModal(null); }}>
                {o.label}{c.ttl === o.value && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal title={`@${c.peer.username}`} onClose={() => setModal(null)}>
          <div className="modal-card"><ProfileCard p={c.peer} presence={c.presence} /></div>
        </Modal>
      )}
      {modal === 'report' && <ReportModal targetId={c.peerId} username={c.peer.username} onClose={() => setModal(null)} />}
    </div>
  );
}

function SafetyModal({ c, onClose }: { c: ConversationView; onClose: () => void }) {
  const [sn, setSn] = useState<{ number: string; verified: boolean } | null>(null);
  const { run } = useAction();
  useEffect(() => { run(() => call('safetyNumber', c.peerId)).then((r) => r && setSn(r)); }, [c.peerId, run]);
  return (
    <Modal title="Encryption" onClose={onClose}>
      <p className="muted">
        Compare this safety number with @{c.peer.username} in person or over a call. If it matches on both screens, nobody, including Sigil,
        is sitting in the middle of your chat. It changes if either of you resets your keys.
      </p>
      <div className="safety">{sn ? sn.number.split(' ').map((g, i) => <span key={i}>{g}</span>) : 'Loading…'}</div>
      <ul className="facts">
        <li>Messages are encrypted on your device with a Signal-style ratchet before they leave it.</li>
        <li>Sigil's relay passes ciphertext to @{c.peer.username} only while they're online, and keeps no copy.</li>
        <li>Sigil can still see that two accounts are connected while it relays, and when. It doesn't log this.</li>
      </ul>
      <div className="row end">
        {c.verified
          ? <button className="btn ghost" onClick={() => run(() => call('setVerified', c.peerId, false)).then(onClose)}>Mark as not verified</button>
          : <button className="btn primary" onClick={() => run(() => call('setVerified', c.peerId, true), 'Marked as verified').then(onClose)}>The numbers match</button>}
      </div>
    </Modal>
  );
}
