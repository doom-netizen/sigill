// Shared message pieces for DMs and channels: markdown, replies, reactions,
// the hover toolbar, and a composer that handles replying and editing.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '../api';
import { Icon, useAction, useToast } from './ui';
import { usePrefs } from './Prefs';
import { renderMessage } from '../../../../shared/markdown';
import type { ChatMessage, Where } from '../../core/types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const MORE_REACTIONS = ['🎉', '👀', '💯', '🙏', '😭', '🤝', '✅', '❌', '💀', '🫡', '✨', '🤔'];

export function MessageText({ m }: { m: ChatMessage }) {
  const { settings, lockdown, meName, linkClicks } = usePrefs();
  if (m.deleted) return <div className="msg-text deleted"><Icon name="x" size={12} />Message unsent</div>;
  const onClick = (e: React.MouseEvent) => {
    const sp = (e.target as HTMLElement).closest?.('.spoiler');
    if (sp) { sp.classList.add('shown'); return; }
    linkClicks(e);
  };
  if (!settings.renderMarkdown) return <div className="msg-text plain">{m.text}{m.edited && <small className="edited"> (edited)</small>}</div>;
  return (
    <div className="msg-text" onClick={onClick}>
      <span dangerouslySetInnerHTML={{ __html: renderMessage(m.text, { links: !lockdown, me: meName ?? undefined }) /* escaped, then a small safe subset */ }} />
      {m.edited && <small className="edited"> (edited)</small>}
    </div>
  );
}

export function ReplyQuote({ r, nameOf, onJump }: { r: NonNullable<ChatMessage['replyTo']>; nameOf: (id: string) => string; onJump?: () => void }) {
  return (
    <button type="button" className="reply-quote" onClick={onJump} title="Jump to message">
      <Icon name="reply" size={12} /><b>{nameOf(r.author)}</b><span>{r.text}</span>
    </button>
  );
}

export function Reactions({ m, where, nameOf }: { m: ChatMessage; where: Where; nameOf: (id: string) => string }) {
  const { meId } = usePrefs();
  const { run } = useAction();
  const entries = Object.entries(m.reactions ?? {}).filter(([, ids]) => ids.length);
  if (!entries.length || m.deleted) return null;
  return (
    <div className="reactions">
      {entries.map(([e, ids]) => (
        <button key={e} type="button" className={`reaction ${meId && ids.includes(meId) ? 'mine' : ''}`} title={ids.map(nameOf).join(', ')}
          aria-label={`${e} ${ids.length}, reacted by ${ids.map(nameOf).join(', ')}`} onClick={() => run(() => call('react', where, m.id, e))}>
          <span>{e}</span><b>{ids.length}</b>
        </button>
      ))}
    </div>
  );
}

/** Hover / tap toolbar on a message. */
export function MsgActions({ m, where, mine, onReply, onEdit }: { m: ChatMessage; where: Where; mine: boolean; onReply: () => void; onEdit: () => void }) {
  const { run } = useAction();
  const toast = useToast();
  const [more, setMore] = useState(false);
  if (m.from === 'system' || m.deleted) return null;
  const react = (e: string) => { setMore(false); run(() => call('react', where, m.id, e)); };
  return (
    <div className="msg-actions" role="toolbar" aria-label="Message actions">
      {QUICK_REACTIONS.slice(0, 3).map((e) => <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}>{e}</button>)}
      <div className="menu-wrap">
        <button type="button" onClick={() => setMore(!more)} aria-label="More reactions" aria-expanded={more}><Icon name="smile" size={16} /></button>
        {more && (
          <div className="emoji-pop" onMouseLeave={() => setMore(false)}>
            {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((e) => <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}>{e}</button>)}
          </div>
        )}
      </div>
      <button type="button" onClick={onReply} aria-label="Reply" title="Reply"><Icon name="reply" size={16} /></button>
      {mine && <button type="button" onClick={onEdit} aria-label="Edit" title="Edit"><Icon name="edit" size={16} /></button>}
      <button type="button" onClick={() => navigator.clipboard?.writeText(m.text).then(() => toast('Copied'), () => {})} aria-label="Copy text" title="Copy text"><Icon name="copy" size={16} /></button>
      {mine
        ? <button type="button" className="danger" onClick={() => run(() => call('unsendMessage', where, m.id), 'Unsent for everyone')} aria-label="Unsend for everyone" title="Unsend for everyone"><Icon name="trash" size={16} /></button>
        : <button type="button" onClick={() => run(() => call('deleteLocal', where, m.id), 'Removed from this device')} aria-label="Remove from this device" title="Remove from this device"><Icon name="trash" size={16} /></button>}
    </div>
  );
}

export interface ComposerHandle { reply: (m: ChatMessage) => void; edit: (m: ChatMessage) => void }

export function Composer({ placeholder, disabled, nameOf, onSend, onEdit, replyTo, setReplyTo, editing, setEditing, extra }: {
  placeholder: string; disabled?: boolean; nameOf: (id: string) => string;
  onSend: (text: string, replyTo: string | null) => Promise<unknown>; onEdit: (id: string, text: string) => Promise<unknown>;
  replyTo: ChatMessage | null; setReplyTo: (m: ChatMessage | null) => void;
  editing: ChatMessage | null; setEditing: (m: ChatMessage | null) => void; extra?: ReactNode;
}) {
  const { settings } = usePrefs();
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = useRef('');

  useEffect(() => {
    if (editing) { draft.current = text; setText(editing.text); }
    else if (draft.current) { setText(draft.current); draft.current = ''; }
    if (editing || replyTo) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, replyTo?.id]);

  // grow with content
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const submit = async () => {
    const t = text;
    if (!t.trim()) return;
    if (editing) {
      const id = editing.id;
      setEditing(null); setText('');
      await onEdit(id, t);
      return;
    }
    const r = replyTo?.id ?? null;
    setText(''); setReplyTo(null);
    await onSend(t, r);
  };

  return (
    <form className={`composer ${editing ? 'editing' : ''}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {(replyTo || editing) && (
        <div className="composer-ctx">
          <Icon name={editing ? 'edit' : 'reply'} size={14} />
          {editing ? <span>Editing message</span> : <span>Replying to <b>{nameOf(replyTo!.author ?? '')}</b>: {replyTo!.text.slice(0, 80)}</span>}
          <button type="button" className="icon-btn sm" aria-label="Cancel" onClick={() => (editing ? (setEditing(null), setText('')) : setReplyTo(null))}><Icon name="x" size={14} /></button>
        </div>
      )}
      <div className="composer-row">
        {extra}
        <textarea ref={input} rows={1} value={text} maxLength={4000} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          aria-label={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (editing || replyTo)) { e.preventDefault(); if (editing) { setEditing(null); setText(''); } else setReplyTo(null); return; }
            const sendKey = settings.enterToSend ? e.key === 'Enter' && !e.shiftKey : e.key === 'Enter' && (e.ctrlKey || e.metaKey);
            if (sendKey) { e.preventDefault(); submit(); }
          }} />
        <button className="send" type="submit" aria-label={editing ? 'Save edit' : 'Send'} disabled={!text.trim() || disabled}><Icon name={editing ? 'check' : 'send'} /></button>
      </div>
    </form>
  );
}
