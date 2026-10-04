// Server-rendered public profile at /{username}. No JS, no trackers,
// no feed, no comments. Theme -> CSS variables only.

import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml } from '../../shared/markdown';
import { themeToCssVars, cssVarsToString, sanitizeTheme } from '../../shared/theme';
import { BADGES, badgeSvg } from '../../shared/badges';
import { accessorySvg } from '../../shared/accessories';
import type { PublicProfile } from '../../shared/types';

const cardCss = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'profileCard.css'), 'utf8');

const PRESENCE_LABEL: Record<string, string> = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };
const TIER_LABEL: Record<string, string> = { legendary: 'Legendary', rare: 'Rare', short: 'Short', standard: 'Standard' };

const pageCss = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:#060608;color:#f3f2f7;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.stage{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 16px;background:var(--p-bg);background-attachment:fixed}
.brand{position:fixed;top:16px;left:18px;font:800 14px/1 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:-.02em;color:#fff;opacity:.75;text-decoration:none}
.brand span{color:var(--p-accent)}
.foot{margin-top:18px;font-size:12px;color:#8d8b99;text-align:center;max-width:440px;line-height:1.5}
.empty{font:600 15px/1.5 system-ui;color:#a5a3b3;text-align:center}
.empty b{display:block;font:800 64px/1 "JetBrains Mono",ui-monospace,monospace;color:#fff;margin-bottom:12px;letter-spacing:-.04em}
`;

function shell(title: string, vars: string, body: string, description = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta name="robots" content="noai,noimageai">
<style>${cardCss}${pageCss}</style></head>
<body><div class="stage" style="${escapeHtml(vars)}">${body}</div></body></html>`;
}

export function renderProfileCardHtml(p: PublicProfile, opts: { messageHref?: string | null } = {}) {
  const initial = escapeHtml(p.username.slice(0, 1).toUpperCase());
  const presence = p.presence;
  const status = presence
    ? `<div class="pc-status" data-p="${presence}"><i></i><span>${escapeHtml(p.customStatus || PRESENCE_LABEL[presence])}</span></div>`
    : '';
  const badges = p.badges.map((id) => {
    const b = BADGES[id];
    if (!b) return '';
    const tip = id === 'legacy_username' && p.legacyUsername ? `Originally known as @${p.legacyUsername}` : `${b.label}: ${b.description}`;
    return `<span class="badge" style="--b-tone:${b.tone}" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}" role="img" tabindex="0">${badgeSvg(id)}</span>`;
  }).join('');
  const joined = p.createdAt ? `<span>Joined ${new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` : '';
  const acc = accessorySvg(p.accessory);
  const t = sanitizeTheme(p.theme);
  const attr = (v: string | null | undefined) => (v ? escapeHtml(v) : '');
  const titles = (p.titles ?? []).map((x) => `<span class="pc-title" style="--tc:${escapeHtml(x.color)}">${escapeHtml(x.name)}</span>`).join('');
  const links = (p.links ?? []).filter((l) => /^https:\/\//.test(l.url)).map((l) => `<li><a href="${escapeHtml(l.url)}" rel="noopener noreferrer nofollow ugc" target="_blank">${escapeHtml(l.label)}</a></li>`).join('');
  const msg = p.messagePolicy === 'nobody'
    ? `<button class="pc-btn" disabled>Not accepting messages</button>`
    : opts.messageHref
      ? `<a class="pc-btn" href="${escapeHtml(opts.messageHref)}">Message</a>`
      : '';
  return `<article class="pc" data-shape="${t.avatarShape}" data-name="${t.nameStyle}"${p.effect ? ` data-effect="${attr(p.effect)}"` : ''}${p.nameFx ? ` data-namefx="${attr(p.nameFx)}"` : ''}>
  ${p.effect ? '<div class="pc-fx" aria-hidden="true"></div>' : ''}
  <div class="pc-banner">${p.banner ? `<img src="${escapeHtml(p.banner)}" alt="">` : ''}</div>
  <div class="pc-body">
    <div class="pc-avatar-wrap"${p.frame ? ` data-frame="${attr(p.frame)}"` : ''}>
      ${p.avatar ? `<img class="pc-avatar" src="${escapeHtml(p.avatar)}" alt="">` : `<div class="pc-avatar">${initial}</div>`}
      ${p.frame ? '<span class="pc-frame" aria-hidden="true"></span>' : ''}
      ${acc ? `<span class="pc-acc" data-acc="${attr(p.accessory)}">${acc}</span>` : ''}
      ${presence ? `<span class="pc-dot" data-p="${presence}"></span>` : ''}
    </div>
    <div class="pc-head">
      <div class="pc-display-row"><span class="pc-display">${escapeHtml(p.displayName)}</span>${p.pronouns ? `<span class="pc-pronouns">${escapeHtml(p.pronouns)}</span>` : ''}</div>
      <h1 class="pc-username" data-len="${p.username.length}" data-text="@${escapeHtml(p.username)}"><span class="at">@</span>${escapeHtml(p.username)}</h1>
    </div>
    ${titles ? `<div class="pc-titles">${titles}</div>` : ''}
    ${status}
    ${badges ? `<div class="pc-badges">${badges}</div>` : ''}
    ${p.bioHtml ? `<div class="pc-bio">${p.bioHtml}</div>` : ''}
    ${links ? `<ul class="pc-links">${links}</ul>` : ''}
    <div class="pc-meta"><span class="tier-chip" data-tier="${p.tier}">${TIER_LABEL[p.tier]} name</span>${joined}</div>
    ${msg ? `<div class="pc-actions">${msg}</div>` : ''}
  </div>
</article>`;
}

export function profilePage(p: PublicProfile) {
  const vars = cssVarsToString(themeToCssVars(p.theme, p.background));
  const body = `<a class="brand" href="/">sigil<span>.</span></a>
${renderProfileCardHtml(p, { messageHref: `/app/#u=${p.username}` })}
<p class="foot">Messages on Sigil are end-to-end encrypted and not stored on our servers.</p>`;
  return shell(`@${p.username} on Sigil`, vars, body, p.bio.slice(0, 160) || `@${p.username} on Sigil`);
}

export function notFoundPage() {
  const vars = cssVarsToString(themeToCssVars({} as any));
  return shell('Not found · Sigil', vars, `<a class="brand" href="/">sigil<span>.</span></a><div class="empty"><b>@?</b>No public profile here.</div>`);
}

export function landingPage(stats: { accounts: number }) {
  const vars = cssVarsToString(themeToCssVars({} as any));
  return shell('Sigil', vars, `<a class="brand" href="/">sigil<span>.</span></a>
<div class="empty"><b>sigil.</b>Claim a rare name. Wear it. Talk privately.<br><span style="font-size:13px;color:#77758a">${stats.accounts} names claimed, invite only</span><br><a href="/app/" style="display:inline-block;margin-top:22px;padding:12px 22px;border-radius:12px;background:#8b7cff;color:#0c0c10;font-weight:700;text-decoration:none">Open Sigil</a></div>`);
}
