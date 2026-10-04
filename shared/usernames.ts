// Username rules shared by server (authoritative) and client (live preview).
//
// Check order (spec):
//   1. Normalize
//   2. Length / charset
//   3. System reserved      -> unavailable
//   4. Slur list            -> unavailable
//   5. Brand list           -> unavailable (staff may grant after review)
//   6. Short-name rules     -> tiered requirements
//   7. Else allow if free   (uniqueness + locks are checked by the server)

import { RESERVED, IMPERSONATION_CONTAINS, BRANDS, SLURS, SLUR_ALLOWLIST } from './blocklist';

export const USERNAME_MIN = 1;
export const USERNAME_MAX = 24;
export const USERNAME_RE = /^[a-z0-9_]+$/;
export const UNAVAILABLE_MESSAGE = 'This username is unavailable.';

// ---------------------------------------------------------------- 1. normalize

/** Canonical stored form: trimmed, leading @ removed, lowercased. NOT leet-mapped. */
export function canonicalize(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/^@+/, '').toLowerCase();
}

const LEET: Record<string, string[]> = {
  '0': ['o'], '1': ['i', 'l'], '2': ['z'], '3': ['e'], '4': ['a'], '5': ['s'],
  '6': ['g'], '7': ['t'], '8': ['b'], '9': ['g'],
};
const MAX_VARIANTS = 64;

/** All leet readings of a string (1 -> i and l, etc.), capped. */
export function leetVariants(s: string): string[] {
  let out = [''];
  for (const ch of s) {
    const opts = LEET[ch] ?? [ch];
    const next: string[] = [];
    for (const prefix of out) for (const o of opts) next.push(prefix + o);
    out = next.length > MAX_VARIANTS ? next.slice(0, MAX_VARIANTS) : next;
  }
  return out;
}

/**
 * Forms a name is matched against. Includes the raw digits form (so "1488"
 * matches as digits) and all leet readings, each with underscores removed.
 */
export function matchForms(name: string): string[] {
  const stripped = name.replace(/_/g, '');
  return unique([stripped, ...leetVariants(stripped)]);
}

/**
 * "Core" forms for exact matching: the stripped name, the name with
 * leading/trailing digits removed ("admin2", "0admin0"), and each underscore
 * segment, all with leet readings.
 */
export function coreForms(name: string, withSegments = true): string[] {
  const stripped = name.replace(/_/g, '');
  const trimmedDigits = name.replace(/^[0-9_]+|[0-9_]+$/g, '').replace(/_/g, '');
  const segments = withSegments ? name.split('_').filter(Boolean) : [];
  const bases = unique([stripped, trimmedDigits, ...segments]).filter(Boolean);
  const out: string[] = [];
  for (const b of bases) out.push(b, ...leetVariants(b));
  return unique(out);
}

function unique<T>(xs: T[]): T[] { return [...new Set(xs)]; }

// ----------------------------------------------------------------- matchers

/** Stem -> regex where each run of a letter needs at least as many repeats. */
function stemRegex(stem: string): RegExp {
  let src = '';
  for (let i = 0; i < stem.length;) {
    let j = i;
    while (j < stem.length && stem[j] === stem[i]) j++;
    const ch = stem[i].replace(/[^a-z0-9]/g, '\\$&');
    const n = j - i;
    src += n === 1 ? `${ch}+` : `${ch}{${n},}`;
    i = j;
  }
  return new RegExp(src);
}

const CONTAINS_SLURS = SLURS.filter((s) => s.mode === 'contains').map((s) => ({ ...s, re: stemRegex(s.stem) }));
const EXACT_SLURS = SLURS.filter((s) => s.mode === 'exact').map((s) => ({ ...s, re: new RegExp(`^${stemRegex(s.stem).source}$`) }));
const RESERVED_SET = new Set(RESERVED);
const BRAND_SET = new Set(BRANDS);
// Longest first so "allspice" is scrubbed before "spice".
const ALLOW = [...SLUR_ALLOWLIST].sort((a, b) => b.length - a.length);

function scrubAllowlist(form: string): string {
  let out = form;
  for (const w of ALLOW) if (out.includes(w)) out = out.split(w).join('|');
  return out;
}

/** Collapse runs of any letter to one ("aaadmin" -> "admin") for reserved checks. */
function collapse(s: string): string { return s.replace(/(.)\1+/g, '$1'); }

const IMPERSONATION_ALLOW = ['badminton'];

export function isReserved(name: string): boolean {
  // Exact: whole name, or name with leading/trailing digits removed ("admin2"),
  // leet-read. Underscore segments are NOT checked ("help_me" is fine).
  for (const f of coreForms(name, false)) if (RESERVED_SET.has(f)) return true;
  for (const raw of matchForms(name)) {
    let f = raw;
    for (const w of IMPERSONATION_ALLOW) f = f.split(w).join('|');
    const cf = collapse(f);
    for (const root of IMPERSONATION_CONTAINS) {
      if (f.includes(root) || cf.includes(collapse(root))) return true;
    }
  }
  return false;
}

export function isSlur(name: string): boolean {
  for (const f of matchForms(name)) {
    const scrubbed = scrubAllowlist(f);
    for (const s of CONTAINS_SLURS) if (s.re.test(scrubbed)) return true;
  }
  for (const f of coreForms(name)) {
    for (const s of EXACT_SLURS) if (s.re.test(f)) return true;
  }
  return false;
}

export function isBrand(name: string): boolean {
  for (const f of coreForms(name, false)) if (BRAND_SET.has(f)) return true;
  return false;
}

// ---------------------------------------------------------- short-name tiers

export type Tier = 'standard' | 'short' | 'rare' | 'legendary';

/** 5+ standard, 4 short, 3 rare, 1–2 legendary. */
export function tierFor(name: string): Tier {
  const n = name.length;
  if (n >= 5) return 'standard';
  if (n === 4) return 'short';
  if (n === 3) return 'rare';
  return 'legendary';
}

export interface TierRule {
  tier: Tier;
  label: string;
  minAccountAgeDays: number;
  minActivity: number;
  /** claims go through a public hold before they become active */
  holdHours: number;
  /** needs staff approval (1–2 chars) */
  staffApproval: boolean;
  /** blocked for accounts flagged as datacenter/VPN */
  blockFlaggedNetworks: boolean;
}

export const TIER_RULES: Record<Tier, TierRule> = {
  standard: { tier: 'standard', label: '5+ characters', minAccountAgeDays: 0, minActivity: 0, holdHours: 0, staffApproval: false, blockFlaggedNetworks: false },
  short: { tier: 'short', label: '4 characters', minAccountAgeDays: 7, minActivity: 4, holdHours: 24, staffApproval: false, blockFlaggedNetworks: true },
  rare: { tier: 'rare', label: '3 characters', minAccountAgeDays: 14, minActivity: 6, holdHours: 24, staffApproval: false, blockFlaggedNetworks: true },
  legendary: { tier: 'legendary', label: '1–2 characters', minAccountAgeDays: 14, minActivity: 6, holdHours: 0, staffApproval: true, blockFlaggedNetworks: true },
};

export const USERNAME_CHANGE_COOLDOWN_DAYS = 60;
export const OLD_NAME_LOCK_DAYS = 60;

// --------------------------------------------------------------- the check

export type CheckReason = 'ok' | 'empty' | 'too_long' | 'charset' | 'reserved' | 'slur' | 'brand';

export interface StaticCheck {
  name: string;
  ok: boolean;
  reason: CheckReason;
  /** what the user is shown */
  message: string;
  tier: Tier | null;
}

/**
 * Steps 1–5 (+ tier for step 6). Pure and deterministic; the server adds
 * step 6 eligibility (account age, activity, velocity) and step 7 (free?).
 * Reserved / slur / brand all show the same message on purpose.
 */
export function checkUsername(raw: string): StaticCheck {
  const name = canonicalize(raw);
  const base = { name, tier: null as Tier | null };
  if (name.length < USERNAME_MIN) return { ...base, ok: false, reason: 'empty', message: 'Pick a username.' };
  if (name.length > USERNAME_MAX) return { ...base, ok: false, reason: 'too_long', message: `Usernames can be at most ${USERNAME_MAX} characters.` };
  if (!USERNAME_RE.test(name)) return { ...base, ok: false, reason: 'charset', message: 'Use only a–z, 0–9 and _.' };
  if (isReserved(name)) return { ...base, ok: false, reason: 'reserved', message: UNAVAILABLE_MESSAGE };
  if (isSlur(name)) return { ...base, ok: false, reason: 'slur', message: UNAVAILABLE_MESSAGE };
  if (isBrand(name)) return { ...base, ok: false, reason: 'brand', message: UNAVAILABLE_MESSAGE };
  return { ...base, ok: true, reason: 'ok', message: 'Looks good.', tier: tierFor(name) };
}
