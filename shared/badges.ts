// Badge catalog. One-for-one with the categories on Discord's badge list,
// but with Sigil's own names and original icons (no Discord branding).
//
// Badges come from four places and are always computed by the server:
//   role       Staff / Developer / Founder follow account roles
//   granted    staff grant them (Partner, Bug Hunter, Verified Bot…)
//   automatic  computed (Early Supporter, account age, 1-/2-letter, New Member…)
//   tiered     computed from a date staff set (Supporter, Booster months)
//   self       chosen by the user (House)
// Users can equip/unequip any badge they've earned. They can never add one,
// and nothing in a theme can draw one.

export type BadgeSource = 'role' | 'granted' | 'automatic' | 'tiered' | 'self';
export type BadgeCategory = 'Staff & trust' | 'Early & legacy' | 'Houses' | 'Supporter' | 'Booster' | 'Activity' | 'Developer & bot' | 'Account' | 'Events';

export interface BadgeDef {
  id: string;
  label: string;
  description: string;
  category: BadgeCategory;
  source: BadgeSource;
  icon: keyof typeof ICONS;
  tone: string;
  /** how to earn it, shown in the catalog */
  howTo: string;
}

// ---------------------------------------------------------------- icons
// 24×24, filled with currentColor. Original shapes.
export const ICONS = {
  shieldStar: '<path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z" opacity=".35"/><path d="m12 7 1.5 3.1 3.4.5-2.5 2.4.6 3.4L12 14.8 9 16.4l.6-3.4-2.5-2.4 3.4-.5z"/>',
  shieldCheck: '<path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z" opacity=".35"/><path d="m10.6 15.6-3.3-3.3 1.4-1.4 1.9 1.9 4.7-4.7 1.4 1.4z"/>',
  diamond: '<path d="M7 3h10l4 6-9 12L3 9z" opacity=".4"/><path d="M3 9h18L12 21z"/>',
  code: '<path d="M8.6 17.4 3.2 12l5.4-5.4L10 8l-4 4 4 4zm6.8 0L14 16l4-4-4-4 1.4-1.4 5.4 5.4z"/>',
  rings: '<path d="M9 6a6 6 0 1 0 0 12A6 6 0 0 0 9 6zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M15 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" opacity=".55"/>',
  bug: '<ellipse cx="12" cy="14" rx="5" ry="6"/><circle cx="12" cy="6.5" r="2.5"/><path d="M3 10h4v1.6H3zm14 0h4v1.6h-4zM3 15h4v1.6H3zm14 0h4v1.6h-4zM4 20l3.2-2.2.9 1.3L4.9 21.3zm16 0-3.2-2.2-.9 1.3 3.2 2.2z"/>',
  sparkle: '<path d="M12 2c.6 4.6 2.4 7.4 8 8.1v1.8c-5.6.7-7.4 3.5-8 8.1h-.1c-.6-4.6-2.4-7.4-8-8.1v-1.8c5.6-.7 7.4-3.5 8-8.1z"/><circle cx="19" cy="4.5" r="1.6" opacity=".6"/>',
  robotCheck: '<rect x="4" y="7" width="16" height="12" rx="3" opacity=".4"/><path d="M11 2h2v5h-2z"/><path d="m10.8 16.4-3-3 1.4-1.4 1.6 1.6 4-4 1.4 1.4z"/>',
  flag: '<path d="M5 2h2v20H5z"/><path d="M8 3h11l-2.5 4.5L19 12H8z" opacity=".6"/>',
  hash: '<path d="M9.6 3h2l-.8 5h4l.8-5h2l-.8 5H20v2h-3.5l-.6 4H19v2h-3.4l-.8 5h-2l.8-5h-4l-.8 5h-2l.8-5H4v-2h3.4l.6-4H5V8h3.3zm.9 7-.6 4h4l.6-4z"/>',
  flame: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-4.6 3-6 .3 2 1 3 2 3.5C11 9 10.5 5.5 12 2z"/>',
  drop: '<path d="M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2z"/><path d="M8.5 14.5a3.5 3.5 0 0 0 3.5 3.5v1.8a5.3 5.3 0 0 1-5.3-5.3z" opacity=".4" fill="#000"/>',
  swirl: '<path d="M3 8h11a3 3 0 1 0-3-3h-2a5 5 0 1 1 5 5H3zm0 4h15a3.5 3.5 0 1 1-3.5 3.5h2A1.5 1.5 0 1 0 18 14H3zm0 4h8v2H3z"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9z" opacity=".45"/><path d="M8 3h8l2.5 6H5.5z"/><path d="M5.5 9h13L12 22z" opacity=".8"/>',
  rocket: '<path d="M12 2c3.5 2.5 5 6 5 10l-2 4H9l-2-4c0-4 1.5-7.5 5-10z"/><circle cx="12" cy="10" r="2" fill="#000" opacity=".35"/><path d="M9 17h6l-3 5z" opacity=".55"/><path d="M7 12l-3 3v3l4-2zm10 0 3 3v3l-4-2z" opacity=".6"/>',
  compass: '<circle cx="12" cy="12" r="10" opacity=".35"/><path d="m16.5 7.5-2.8 6.2-6.2 2.8 2.8-6.2z"/>',
  orb: '<circle cx="12" cy="12" r="6.5"/><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 1.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8z" opacity=".45"/><circle cx="10" cy="10" r="1.8" fill="#fff" opacity=".7"/>',
  gift: '<path d="M3 8h18v4H3z"/><path d="M4.5 12h15v9h-15z" opacity=".55"/><path d="M11 8h2v13h-2zM12 8C9 8 7 7 7 5.2 7 3.8 8.8 3.3 10 4.5L12 7l2-2.5c1.2-1.2 3-.7 3 .7C17 7 15 8 12 8z"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="3" opacity=".35"/><path d="m6.4 9.4 1.4-1.4 4 4-4 4-1.4-1.4 2.6-2.6zM12 15h6v2h-6z"/>',
  checkSquare: '<rect x="3" y="3" width="18" height="18" rx="5" opacity=".4"/><path d="m10.5 16-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z"/>',
  slash: '<rect x="3" y="3" width="18" height="18" rx="5" opacity=".4"/><path d="M14.3 5.5h2.1L9.7 18.5H7.6z"/>',
  play: '<circle cx="12" cy="12" r="10" opacity=".35"/><path d="M9.5 7.5v9l7-4.5z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3" opacity=".4"/><path d="M3 9h18v2H3zM7 2h2v5H7zm8 0h2v5h-2z"/><circle cx="12" cy="16" r="2.4"/>',
  sprout: '<path d="M11 22V13h2v9z"/><path d="M12 13C12 8 9 5 3 5c0 5 3.5 8 9 8z" opacity=".6"/><path d="M12 12c0-4.5 3-7.5 9-7.5 0 4.7-3.5 7.5-9 7.5z"/>',
  crown: '<path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/><path d="M5 20h14v2H5z" opacity=".6"/>',
  seal: '<path d="m12 1.5 2.4 1.8 3-.1.9 2.8 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.8-3-.1L12 22.5l-2.4-1.8-3 .1-.9-2.8-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.8 3 .1z" opacity=".45"/><path d="m10.6 15.6-3.3-3.3 1.4-1.4 1.9 1.9 4.7-4.7 1.4 1.4z"/>',
  jester: '<circle cx="12" cy="13" r="8" opacity=".4"/><circle cx="9" cy="11.5" r="1.4"/><circle cx="15" cy="11.5" r="1.4"/><path d="M7.5 14.5h9a4.5 4.5 0 0 1-9 0z"/><path d="M12 2 9 5h6z"/>',
  leaf: '<path d="M20 3C9 3 4 8 4 15c0 2 .5 3.6 1.3 5L4 21.5 5.3 23l1.4-1.4C8 22.4 9.6 23 11.5 23 18 23 21 16 20 3z" opacity=".55"/><path d="M6.7 21.6C9 15 12 11 17 7.5l.8 1C13 12 10.2 15.8 8.3 22z"/>',
  one: '<circle cx="12" cy="12" r="10" opacity=".35"/><path d="M12.6 6.5h1.8v11h-2.2V9.2l-2.3.9-.6-1.9z"/>',
  two: '<circle cx="12" cy="12" r="10" opacity=".35"/><path d="M8.6 17.5v-1.6l4-4c1-1 1.3-1.7 1.3-2.4 0-1-.7-1.6-1.8-1.6-1 0-1.8.5-2.4 1.3L8.2 8C9 6.8 10.4 6 12.2 6c2.3 0 3.9 1.3 3.9 3.4 0 1.3-.6 2.3-1.9 3.6l-2.6 2.5h4.6v2z"/>',
} as const;

const D = (id: string, label: string, category: BadgeCategory, source: BadgeSource, icon: keyof typeof ICONS, tone: string, description: string, howTo: string): BadgeDef =>
  ({ id, label, category, source, icon, tone, description, howTo });

export const SUPPORTER_TIERS = [
  { months: 1, id: 'supporter_1', label: 'Supporter', tone: '#c8a2ff' },
  { months: 3, id: 'supporter_3', label: 'Supporter: Bronze', tone: '#d08a52' },
  { months: 6, id: 'supporter_6', label: 'Supporter: Silver', tone: '#cfd6e0' },
  { months: 12, id: 'supporter_12', label: 'Supporter: Gold', tone: '#ffd25e' },
  { months: 24, id: 'supporter_24', label: 'Supporter: Platinum', tone: '#9fe6ff' },
  { months: 36, id: 'supporter_36', label: 'Supporter: Diamond', tone: '#7dd3fc' },
  { months: 60, id: 'supporter_60', label: 'Supporter: Emerald', tone: '#4ade80' },
  { months: 72, id: 'supporter_72', label: 'Supporter: Ruby', tone: '#ff5f7a' },
  { months: 84, id: 'supporter_84', label: 'Supporter: Opal', tone: '#ffb8f0' },
] as const;

export const BOOSTER_TIERS = [1, 2, 3, 6, 9, 12, 15, 18, 24].map((months, i) => ({
  months, id: `booster_${months}`, label: `Booster: ${months} month${months === 1 ? '' : 's'}`,
  tone: ['#f47fff', '#e879f9', '#d76bff', '#c084fc', '#a78bfa', '#8b9cff', '#7cb7ff', '#67d4ff', '#5ef0e0'][i],
}));

export const MEMBER_YEARS = [1, 2, 3, 5] as const;

export const CATALOG: BadgeDef[] = [
  // Staff & trust
  D('founder', 'Founder', 'Staff & trust', 'role', 'diamond', '#ffd25e', 'Built Sigil.', 'Founder role'),
  D('staff', 'Sigil Staff', 'Staff & trust', 'role', 'shieldStar', '#8b7cff', 'Works on Sigil.', 'Staff role'),
  D('developer', 'Developer', 'Staff & trust', 'role', 'code', '#5ee7ff', 'Engineer on Sigil.', 'Developer role'),
  D('partner', 'Partner', 'Staff & trust', 'granted', 'rings', '#7aa2ff', 'Runs a community Sigil partners with.', 'Granted by staff'),
  D('mod_alumni', 'Moderator Alumni', 'Staff & trust', 'granted', 'shieldCheck', '#8fd3ff', 'Helped keep Sigil safe as a volunteer moderator.', 'Granted by staff'),
  D('bug_hunter', 'Bug Hunter', 'Staff & trust', 'granted', 'bug', '#9dff6a', 'Reported a real bug.', 'Granted by staff for a confirmed bug report'),
  D('bug_hunter_gold', 'Bug Hunter: Gold', 'Staff & trust', 'granted', 'bug', '#ffd25e', 'Reported many real bugs, or a serious one.', 'Granted by staff'),
  D('verified', 'Verified', 'Staff & trust', 'granted', 'seal', '#5ee7ff', 'Identity confirmed by Sigil staff.', 'Granted by staff after verification'),
  // Early & legacy
  D('early_supporter', 'Early Supporter', 'Early & legacy', 'automatic', 'sparkle', '#ff8ad8', 'Joined in the first wave.', 'Join before the early-supporter cutoff'),
  D('early_bot_dev', 'Early Verified Bot Developer', 'Early & legacy', 'granted', 'robotCheck', '#7c9cff', 'Built one of the first verified bots.', 'Granted by staff'),
  D('events_team', 'Events Team', 'Early & legacy', 'granted', 'flag', '#ffb347', 'Helped run Sigil events.', 'Granted by staff'),
  D('legacy_username', 'Originally known as', 'Early & legacy', 'granted', 'hash', '#b9b6c8', 'Shows the username this account was created with. Later names never replace it.', 'Change your username at least once, or get it from staff'),
  // Houses
  D('house_ember', 'House Ember', 'Houses', 'self', 'flame', '#ff7a45', 'Member of House Ember.', 'Join from your profile'),
  D('house_tide', 'House Tide', 'Houses', 'self', 'drop', '#3dc8ff', 'Member of House Tide.', 'Join from your profile'),
  D('house_gale', 'House Gale', 'Houses', 'self', 'swirl', '#6ef0b0', 'Member of House Gale.', 'Join from your profile'),
  // Supporter (evolving with months supported)
  ...SUPPORTER_TIERS.map((t) => D(t.id, t.label, 'Supporter', 'tiered', 'gem', t.tone, `Supporting Sigil for ${t.months}+ month${t.months === 1 ? '' : 's'}.`, 'Support Sigil; the badge evolves the longer you do')),
  // Booster (months)
  ...BOOSTER_TIERS.map((t) => D(t.id, t.label, 'Booster', 'tiered', 'rocket', t.tone, `Boosting Sigil for ${t.months}+ month${t.months === 1 ? '' : 's'}.`, 'Boost Sigil; the badge levels up over time')),
  // Activity
  D('quest', 'Quest Completer', 'Activity', 'granted', 'compass', '#ffcf5c', 'Finished a Sigil quest.', 'Granted for completing a quest'),
  D('orbs', 'Orb Apprentice', 'Activity', 'granted', 'orb', '#b98bff', 'Collected their first orbs.', 'Granted by staff'),
  D('gifter_1', 'Gifter', 'Activity', 'granted', 'gift', '#ff9ec7', 'Gifted support to someone.', 'Granted for gifting'),
  D('gifter_2', 'Gifter: Generous', 'Activity', 'granted', 'gift', '#ff6fae', 'Gifted support many times.', 'Granted for gifting'),
  D('gifter_3', 'Gifter: Legendary', 'Activity', 'granted', 'gift', '#ff3d8b', 'Gifted support more than almost anyone.', 'Granted for gifting'),
  // Developer & bot
  D('active_developer', 'Active Developer', 'Developer & bot', 'granted', 'terminal', '#4ade80', 'Maintains an active Sigil bot or integration.', 'Granted by staff'),
  D('verified_bot', 'Verified Bot', 'Developer & bot', 'granted', 'checkSquare', '#7c9cff', 'This account is a verified bot.', 'Granted by staff to bot accounts'),
  D('supports_commands', 'Supports Commands', 'Developer & bot', 'granted', 'slash', '#a5b4fc', 'This bot responds to slash commands.', 'Granted by staff to bot accounts'),
  // Account
  D('one_letter', '1-Letter', 'Account', 'automatic', 'one', '#f5f5f5', 'Holds a single-character username.', 'Hold a 1-character username'),
  D('two_letter', '2-Letter', 'Account', 'automatic', 'two', '#d9d9d9', 'Holds a two-character username.', 'Hold a 2-character username'),
  ...MEMBER_YEARS.map((y) => D(`member_${y}y`, `Member: ${y} year${y === 1 ? '' : 's'}`, 'Account', 'automatic', 'calendar', ['#9db4ff', '#b49dff', '#ff9dd8', '#ffd59d'][MEMBER_YEARS.indexOf(y)], `On Sigil for ${y}+ year${y === 1 ? '' : 's'}.`, `Keep your account for ${y} year${y === 1 ? '' : 's'}`)),
  D('new_member', 'New Member', 'Account', 'automatic', 'sprout', '#86efac', 'Joined in the last 14 days.', 'Shown for your first 14 days'),
  D('streamer', 'Streamer', 'Account', 'granted', 'play', '#a970ff', 'Streams regularly.', 'Granted by staff'),
  D('community_owner', 'Community Owner', 'Account', 'granted', 'crown', '#ffd25e', 'Runs a community on Sigil.', 'Granted by staff'),
  // Events
  D('april_fools', 'April Fools', 'Events', 'granted', 'jester', '#ffb347', 'Took part in the April Fools event.', 'Granted for the event'),
  D('seasonal_event', 'Seasonal Event', 'Events', 'granted', 'leaf', '#f59e0b', 'Took part in a seasonal event.', 'Granted for the event'),
];

export const BADGES: Record<string, BadgeDef> = Object.fromEntries(CATALOG.map((b) => [b.id, b]));
export type BadgeId = string;
export const BADGE_ORDER = CATALOG.map((b) => b.id);
export const GRANTABLE = CATALOG.filter((b) => b.source === 'granted').map((b) => b.id);
export const HOUSES = ['ember', 'tide', 'gale'] as const;
export type House = (typeof HOUSES)[number];
export const CATEGORIES: BadgeCategory[] = ['Staff & trust', 'Early & legacy', 'Houses', 'Supporter', 'Booster', 'Activity', 'Developer & bot', 'Account', 'Events'];

export function sortBadges(ids: string[]): BadgeId[] {
  const known = ids.filter((i) => i in BADGES);
  return [...new Set(known)].sort((a, b) => BADGE_ORDER.indexOf(a) - BADGE_ORDER.indexOf(b));
}

export interface BadgeInputs {
  roles: string[];
  granted: string[];
  createdAt: number;
  username: string;
  /** the username the account was created with (never changes) */
  originalUsername: string | null;
  /** has the account ever changed its username? */
  renamed: boolean;
  house: string | null;
  supporterSince: number | null;
  boosterSince: number | null;
  earlyCutoff: number;
  now?: number;
}

const MONTH = 30.44 * 86_400_000;

/** Everything an account has earned (before the user's equip choices). */
export function earnedBadges(i: BadgeInputs): BadgeId[] {
  const now = i.now ?? Date.now();
  const ids: string[] = i.granted.filter((g) => GRANTABLE.includes(g));
  for (const r of i.roles) if (r === 'staff' || r === 'developer' || r === 'founder') ids.push(r);
  if (i.username.length === 1) ids.push('one_letter');
  if (i.username.length === 2) ids.push('two_letter');
  if (i.createdAt < i.earlyCutoff) ids.push('early_supporter');
  if (i.originalUsername && i.renamed) ids.push('legacy_username');
  if (i.house && (HOUSES as readonly string[]).includes(i.house)) ids.push(`house_${i.house}`);
  const ageDays = (now - i.createdAt) / 86_400_000;
  if (ageDays < 14) ids.push('new_member');
  const years = [...MEMBER_YEARS].reverse().find((y) => ageDays >= y * 365);
  if (years) ids.push(`member_${years}y`);
  if (i.supporterSince) {
    const m = (now - i.supporterSince) / MONTH;
    const t = [...SUPPORTER_TIERS].reverse().find((x) => m >= x.months) ?? SUPPORTER_TIERS[0];
    ids.push(t.id);
  }
  if (i.boosterSince) {
    const m = (now - i.boosterSince) / MONTH;
    const t = [...BOOSTER_TIERS].reverse().find((x) => m >= x.months) ?? BOOSTER_TIERS[0];
    ids.push(t.id);
  }
  return sortBadges(ids);
}

/** Badges shown publicly: earned minus the ones the user unequipped. */
export function visibleBadges(earned: BadgeId[], hidden: string[]): BadgeId[] {
  const h = new Set(hidden);
  return earned.filter((b) => !h.has(b));
}

/** Inline SVG for a badge icon (static, trusted markup). */
export function badgeSvg(id: string, size = 18): string {
  const b = BADGES[id];
  if (!b) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[b.icon]}</svg>`;
}
