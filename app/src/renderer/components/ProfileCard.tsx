import type { CSSProperties, ReactNode } from 'react';
import { themeToCssVars, sanitizeTheme } from '../../../../shared/theme';
import { BADGES, badgeSvg } from '../../../../shared/badges';
import { renderBio } from '../../../../shared/markdown';
import { accessorySvg } from '../../../../shared/accessories';
import type { PublicProfile } from '../../core/types';
import { usePrefs } from './Prefs';

const PRESENCE_LABEL: Record<string, string> = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };
const TIER_LABEL: Record<string, string> = { legendary: 'Legendary', rare: 'Rare', short: 'Short', standard: 'Standard' };

export function themeStyle(p: Pick<PublicProfile, 'theme' | 'background'>): CSSProperties {
  return themeToCssVars(p.theme, p.background) as CSSProperties;
}

/** Same markup + CSS as the public /{username} page (shared/profileCard.css). */
export function ProfileCard({ p, actions, presence, compact }: { p: PublicProfile; actions?: ReactNode; presence?: PublicProfile['presence']; compact?: boolean }) {
  const { mediaOk, linkClicks, openLink, lockdown } = usePrefs();
  const pr = presence !== undefined ? presence : p.presence;
  const t = sanitizeTheme(p.theme);
  const media = mediaOk(p.id);
  const acc = accessorySvg(p.accessory);
  return (
    <article className={`pc ${compact ? 'compact' : ''}`} style={{ ...themeStyle(media ? p : { ...p, background: null }), ['--p-acc-color' as any]: t.accent }} data-shape={t.avatarShape} data-name={t.nameStyle}
      data-effect={p.effect ?? undefined} data-namefx={p.nameFx ?? undefined}>
      {p.effect && <div className="pc-fx" aria-hidden="true" />}
      <div className="pc-banner">{p.banner && media && <img src={p.banner} alt="" />}</div>
      <div className="pc-body">
        <div className="pc-avatar-wrap" data-frame={p.frame ?? undefined}>
          {p.avatar && media ? <img className="pc-avatar" src={p.avatar} alt="" /> : <div className="pc-avatar">{p.username.slice(0, 1).toUpperCase()}</div>}
          {p.frame && <span className="pc-frame" aria-hidden="true" />}
          {acc && <span className="pc-acc" data-acc={p.accessory!} aria-hidden="true" dangerouslySetInnerHTML={{ __html: acc /* static art from shared/accessories */ }} />}
          {pr && <span className="pc-dot" data-p={pr} />}
        </div>
        <div className="pc-head">
          <div className="pc-display-row">
            <span className="pc-display">{p.displayName}</span>
            {p.pronouns && <span className="pc-pronouns">{p.pronouns}</span>}
          </div>
          <h1 className="pc-username" data-len={p.username.length} data-text={`@${p.username}`}><span className="at">@</span>{p.username}</h1>
        </div>
        {!compact && p.titles?.length > 0 && (
          <div className="pc-titles">{p.titles.map((x) => <span key={x.name} className="pc-title" style={{ ['--tc' as any]: x.color }}>{x.name}</span>)}</div>
        )}
        {!compact && pr && (
          <div className="pc-status" data-p={pr}><i /><span>{p.customStatus || PRESENCE_LABEL[pr]}</span></div>
        )}
        {!compact && p.badges.length > 0 && (
          <div className="pc-badges">
            {p.badges.map((id) => {
              const b = BADGES[id];
              if (!b) return null;
              const tip = id === 'legacy_username' && p.legacyUsername ? `Originally known as @${p.legacyUsername}` : b.label;
              return <span key={id} className="badge" role="img" tabIndex={0} aria-label={tip} data-tip={tip} style={{ ['--b-tone' as any]: b.tone }}
                dangerouslySetInnerHTML={{ __html: badgeSvg(id) /* static icon markup from the catalog */ }} />;
            })}
          </div>
        )}
        {!compact && p.bio && <div className="pc-bio" onClick={linkClicks} dangerouslySetInnerHTML={{ __html: renderBio(p.bio) /* escaped first, then a tiny markdown subset; never trusts server HTML */ }} />}
        {!compact && !lockdown && p.links?.length > 0 && (
          <ul className="pc-links">{p.links.map((l) => <li key={l.url}><a href={l.url} onClick={(e) => { e.preventDefault(); openLink(l.url); }}>{l.label}</a></li>)}</ul>
        )}
        {!compact && (
          <div className="pc-meta">
            <span className="tier-chip" data-tier={p.tier}>{TIER_LABEL[p.tier]} name</span>
            {p.createdAt && <span>Joined {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
          </div>
        )}
        {actions && <div className="pc-actions">{actions}</div>}
      </div>
    </article>
  );
}

export function Avatar({ p, size = 36, presence }: { p: Pick<PublicProfile, 'avatar' | 'username' | 'theme'> & { id?: string }; size?: number; presence?: string | null }) {
  const { mediaOk } = usePrefs();
  const show = p.avatar && mediaOk(p.id);
  return (
    <span className="av" style={{ width: size, height: size, ['--p-accent' as any]: p.theme?.accent }}>
      {show ? <img src={p.avatar!} alt="" /> : <span className="av-fallback" style={{ fontSize: size * 0.42 }}>{p.username.slice(0, 1).toUpperCase()}</span>}
      {presence && <i className="av-dot" data-p={presence} />}
    </span>
  );
}

/** @username in mono; scaled when the name is rare. */
export function Handle({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`handle ${className}`} data-len={name.length}><span className="at">@</span>{name}</span>;
}
