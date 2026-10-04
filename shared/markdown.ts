// Bio markdown: a tiny, safe subset. No raw HTML ever.
//   **bold**  *italic*  ~~strike~~  `code`  ||spoiler||  https://links  line breaks
// Input is HTML-escaped first, then the subset is applied.

export const BIO_MAX = 190;
export const DISPLAY_NAME_MAX = 32;
export const CUSTOM_STATUS_MAX = 60;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Strip control chars and zero-width / bidi override characters. */
export function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, max);
}

export function renderBio(src: string): string {
  let s = escapeHtml(cleanText(src, BIO_MAX));
  // code spans first so their content isn't formatted
  const codes: string[] = [];
  s = s.replace(/`([^`\n]{1,80})`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>');
  s = s.replace(/\bhttps:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<]*)?/gi, (url) => {
    const shown = url.replace(/^https:\/\//, '').slice(0, 40);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc">${shown}</a>`;
  });
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s.replace(/\n/g, '<br>');
}

// ----------------------------------------------------------- chat messages
// Same safety rules as bios (escape first, tiny subset), plus code blocks,
// quotes and mentions. `links: false` renders URLs as plain text (Lockdown Mode).
export function renderMessage(src: string, opts: { links?: boolean; me?: string } = {}): string {
  let s = escapeHtml(src);
  const blocks: string[] = [];
  s = s.replace(/```(?:[a-z0-9]{1,12}\n)?([\s\S]{1,4000}?)```/gi, (_, c) => { blocks.push(c.replace(/^\n|\n$/g, '')); return `\u0001${blocks.length - 1}\u0001`; });
  const codes: string[] = [];
  s = s.replace(/`([^`\n]{1,200})`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" tabindex="0" role="button" aria-label="Spoiler, select to reveal">$1</span>');
  s = s.replace(/(^|[\s(])@([a-z0-9_]{1,24})\b/g, (_, pre, name) => `${pre}<span class="mention${opts.me === name ? ' me' : ''}">@${name}</span>`);
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]]/gi, (url) => {
    if (opts.links === false) return `<span class="link-off">${url}</span>`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc">${url.replace(/^https?:\/\//, '').slice(0, 60)}${url.length > 68 ? '…' : ''}</a>`;
  });
  // quotes: lines starting with "> "
  s = s.split('\n').map((line) => (line.startsWith('&gt; ') ? `<span class="quote">${line.slice(5)}</span>` : line)).join('\n');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<pre><code>${blocks[+i]}</code></pre>`);
  return s;
}

/** Remove common tracking parameters from links in a message. */
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|si|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|yclid|twclid|ttclid|s_cid|vero_id)$/i;
export function stripTracking(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s<]+/gi, (raw) => {
    let u: URL;
    try { u = new URL(raw); } catch { return raw; }
    const keys = [...u.searchParams.keys()];
    if (!keys.some((k) => TRACKING.test(k))) return raw;
    for (const k of keys) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, '');
  });
}
