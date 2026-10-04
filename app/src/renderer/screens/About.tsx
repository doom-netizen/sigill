// What's new (release notes + staff posts) and Credits.
import { useEffect, useState } from 'react';
import { call } from '../api';
import { Icon, timeAgo } from '../components/ui';
import { usePrefs } from '../components/Prefs';
import { RELEASES, LATEST_VERSION } from '../../../../shared/changelog';
import { TEAM, CREDITS } from '../../../../shared/credits';
import { renderMessage } from '../../../../shared/markdown';
import type { UpdatePost } from '../../../../shared/platform';

const TAG_LABEL: Record<string, string> = { feature: 'New', fix: 'Fix', security: 'Security', event: 'Event', notice: 'Notice' };

export function Updates() {
  const [posts, setPosts] = useState<UpdatePost[] | null>(null);
  const [open, setOpen] = useState<string>(RELEASES[0].version);
  const { settings, lockdown, linkClicks } = usePrefs();
  useEffect(() => {
    call<UpdatePost[]>('updates').then(setPosts, () => setPosts([]));
    if (settings.lastSeenUpdate !== LATEST_VERSION) call('setSettings', { lastSeenUpdate: LATEST_VERSION });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="updates">
      {posts && posts.length > 0 && (
        <section className="update-posts" aria-label="From the Sigil team">
          {posts.map((p) => (
            <article key={p.id} className="update-post" data-tag={p.tag}>
              <header><span className="tag-chip" data-tag={p.tag}>{TAG_LABEL[p.tag]}</span><h3>{p.title}</h3><time>{timeAgo(p.at)}</time></header>
              <div className="update-body" onClick={linkClicks} dangerouslySetInnerHTML={{ __html: renderMessage(p.body, { links: !lockdown }) /* escaped first */ }} />
              <small className="muted">Posted by @{p.by}</small>
            </article>
          ))}
        </section>
      )}
      <ol className="releases">
        {RELEASES.map((r, i) => {
          const isOpen = open === r.version;
          return (
            <li key={r.version} className={`release ${isOpen ? 'open' : ''} ${i === 0 ? 'latest' : ''}`}>
              <button className="release-head" onClick={() => setOpen(isOpen ? '' : r.version)} aria-expanded={isOpen}>
                <span className="rel-ver">v{r.version}</span>
                <span className="rel-name">{r.name}{i === 0 && <span className="new-chip">Latest</span>}</span>
                <span className="rel-hl">{r.highlights.join(' · ')}</span>
                {r.date && <time>{new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>}
                <Icon name="back" size={16} />
              </button>
              {isOpen && (
                <div className="release-body">
                  {r.sections.map((s) => (
                    <div key={s.title}>
                      <h4>{s.title}</h4>
                      <ul>{s.items.map((x) => <li key={x}>{x}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Credits() {
  return (
    <div className="credits">
      <section className="credits-hero">
        <div className="credits-mark">sigil<span>.</span></div>
        <p>Rare names, private messages, and profiles worth keeping.</p>
        <p className="muted small">Version {LATEST_VERSION}</p>
      </section>
      <section>
        <h3>Made by</h3>
        <ul className="team">{TEAM.map((t) => <li key={t.name}><b>{t.name}</b><span>{t.role}</span></li>)}</ul>
      </section>
      {CREDITS.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <ul className="credit-list">
            {g.items.map((c) => (
              <li key={c.name}>
                <div><b>{c.name}</b>{c.license && <span className="license">{c.license}</span>}</div>
                <span className="by">{c.by}</span>
                {c.note && <small>{c.note}</small>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="fine">Badges, icons, frames, themes and accessories are original artwork made for Sigil. "Discord" and "Lockdown Mode" belong to their owners; they're named here only as inspiration, and Sigil isn't affiliated with either.</p>
    </div>
  );
}
