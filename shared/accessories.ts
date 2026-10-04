// Accessory art: small SVG pieces drawn over the avatar.
// The overlay box is 140% of the avatar; in its 140×140 viewBox the avatar is
// the circle centred at (70,70) with radius 50. `currentColor` is the profile accent.

const ART: Record<string, string> = {
  acc_crown: `<g transform="rotate(-12 70 22)"><path d="M44 30 L48 8 L59 20 L70 4 L81 20 L92 8 L96 30 Z" fill="#ffd25e" stroke="#b8860b" stroke-width="2" stroke-linejoin="round"/><rect x="44" y="28" width="52" height="7" rx="2" fill="#f0b429" stroke="#b8860b" stroke-width="2"/><circle cx="70" cy="18" r="3.4" fill="#ff4d6d"/><circle cx="55" cy="23" r="2.4" fill="#5ee7ff"/><circle cx="85" cy="23" r="2.4" fill="#5ee7ff"/></g>`,
  acc_cat_ears: `<path d="M30 46 L30 10 L58 30 Z" fill="#2a2a2e" stroke="#111" stroke-width="2" stroke-linejoin="round"/><path d="M36 38 L36 20 L50 30 Z" fill="#ff9ec7"/><path d="M110 46 L110 10 L82 30 Z" fill="#2a2a2e" stroke="#111" stroke-width="2" stroke-linejoin="round"/><path d="M104 38 L104 20 L90 30 Z" fill="#ff9ec7"/>`,
  acc_headphones: `<path d="M24 74 Q24 14 70 14 Q116 14 116 74" fill="none" stroke="#1d1d22" stroke-width="9" stroke-linecap="round"/><path d="M24 74 Q24 14 70 14 Q116 14 116 74" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".8"/><rect x="12" y="62" width="20" height="32" rx="9" fill="currentColor" stroke="#1d1d22" stroke-width="3"/><rect x="108" y="62" width="20" height="32" rx="9" fill="currentColor" stroke="#1d1d22" stroke-width="3"/>`,
  acc_halo: `<ellipse cx="70" cy="9" rx="30" ry="7" fill="none" stroke="#fff3c4" stroke-width="5"/><ellipse cx="70" cy="9" rx="30" ry="7" fill="none" stroke="#ffe08a" stroke-width="2" opacity=".9"/>`,
  acc_horns: `<path d="M38 34 Q26 18 34 2 Q40 20 52 26 Z" fill="#c81d3a" stroke="#6b0f1e" stroke-width="2" stroke-linejoin="round"/><path d="M102 34 Q114 18 106 2 Q100 20 88 26 Z" fill="#c81d3a" stroke="#6b0f1e" stroke-width="2" stroke-linejoin="round"/>`,
  acc_party: `<g transform="rotate(18 92 22)"><path d="M78 34 L92 -6 L106 34 Z" fill="#7a5cff" stroke="#3b2a99" stroke-width="2" stroke-linejoin="round"/><path d="M83 22 L101 22 M86 12 L98 12" stroke="#ffd25e" stroke-width="4"/><circle cx="92" cy="-6" r="5" fill="#ff5fa2"/><ellipse cx="92" cy="34" rx="16" ry="4" fill="#5a3fe0"/></g>`,
  acc_flower: `<g transform="translate(104 34)"><g fill="#ffb3d1" stroke="#e05a96" stroke-width="1.5"><circle cx="0" cy="-10" r="8"/><circle cx="9.5" cy="-3" r="8"/><circle cx="6" cy="8" r="8"/><circle cx="-6" cy="8" r="8"/><circle cx="-9.5" cy="-3" r="8"/></g><circle r="5.5" fill="#ffd25e" stroke="#d9a400" stroke-width="1.5"/></g>`,
  acc_shades: `<g fill="#0b0b0e"><rect x="30" y="56" width="80" height="6"/><rect x="34" y="62" width="30" height="8"/><rect x="38" y="70" width="22" height="6"/><rect x="76" y="62" width="30" height="8"/><rect x="80" y="70" width="22" height="6"/></g><g fill="#fff"><rect x="38" y="62" width="6" height="4"/><rect x="80" y="62" width="6" height="4"/></g>`,
  acc_bunny: `<path d="M50 30 Q38 -10 50 -14 Q62 -10 60 28 Z" fill="#f4f1ec" stroke="#cfc9c0" stroke-width="2"/><path d="M52 24 Q46 -2 51 -6 Q56 -2 56 22 Z" fill="#ffc6da"/><path d="M82 28 Q84 0 98 -4 Q110 4 92 30 Z" fill="#f4f1ec" stroke="#cfc9c0" stroke-width="2"/><path d="M86 24 Q88 6 97 2 Q102 8 90 26 Z" fill="#ffc6da"/>`,
  acc_staff: `<g transform="translate(28 112)"><circle r="15" fill="#8b7cff" stroke="#fff" stroke-width="3"/><path d="M0 -8 L2.4 -2.4 L8 -2.2 L3.6 1.6 L5 7.6 L0 4.2 L-5 7.6 L-3.6 1.6 L-8 -2.2 L-2.4 -2.4 Z" fill="#fff"/></g>`,
};

/** Static SVG markup for an accessory, or '' for an unknown id. */
export function accessorySvg(id: string | null | undefined): string {
  const art = id ? ART[id] : undefined;
  if (!art) return '';
  return `<svg viewBox="0 0 140 140" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${art}</svg>`;
}
export const ACCESSORY_IDS = Object.keys(ART);
