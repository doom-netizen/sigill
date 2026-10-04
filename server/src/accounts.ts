import crypto from 'node:crypto';
import { one, all, run, tx, type Row } from './db';
import { config, DAY, dayMs, holdHourMs, dayKey } from './config';
import { hit, peek, LIMITS } from './abuse';
import {
  checkUsername, canonicalize, tierFor, TIER_RULES, UNAVAILABLE_MESSAGE,
  USERNAME_CHANGE_COOLDOWN_DAYS, OLD_NAME_LOCK_DAYS, type Tier,
} from '../../shared/usernames';
import { sanitizeTheme } from '../../shared/theme';
import { renderBio } from '../../shared/markdown';
import { earnedBadges, visibleBadges, type BadgeId } from '../../shared/badges';
import { COSMETICS } from '../../shared/economy';
import {
  DEFAULT_PRIVACY, type Privacy, type PublicProfile, type Me, type ClaimRequest,
  type UsernameCheckResult, type Presence, type StatusChoice, type Lockdown,
} from '../../shared/types';
import { LOCKDOWN_OFF, publicView } from '../../shared/lockdown';

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}

// ------------------------------------------------------------- presence hook
// relay.ts registers a function telling us who is connected.
let isOnline: (id: string) => boolean = () => false;
export function setPresenceSource(fn: (id: string) => boolean) { isOnline = fn; }

// ----------------------------------------------------------------- helpers

export const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const privacyOf = (a: Row): Privacy => ({ ...DEFAULT_PRIVACY, ...parse(a.privacy_json, {}) });
export const lockdownOf = (a: Row): Lockdown => ({ ...LOCKDOWN_OFF, ...parse(a.lockdown_json, {}) });
export const rolesOf = (a: Row): string[] => parse(a.roles_json, []);
export const isStaff = (a: Row) => rolesOf(a).includes('staff');
const mediaUrl = (f: string | null) => (f ? `${config.publicOrigin}/media/${f}` : null);

export function earnedOf(a: Row): BadgeId[] {
  return earnedBadges({
    roles: rolesOf(a), granted: parse(a.badges_json, []), createdAt: a.created_at, username: a.username,
    originalUsername: a.original_username ?? a.previous_username ?? a.username, renamed: (a.username_changes ?? 0) > 0 || !!a.previous_username, house: a.house ?? null,
    supporterSince: a.supporter_since ?? null, boosterSince: a.booster_since ?? null, earlyCutoff: config.earlySupporterUntil,
  });
}
export const hiddenOf = (a: Row): BadgeId[] => parse(a.hidden_badges_json, []);
/** Equipped (publicly shown) badges. */
export function badgesOf(a: Row): BadgeId[] { return visibleBadges(earnedOf(a), hiddenOf(a)); }

// ------------------------------------------------------------ restrictions
const active = (until: number | null | undefined) => !!until && until > Date.now();
export const isMuted = (a: Row) => active(a.muted_until);
export const isFrozen = (a: Row) => active(a.frozen_until);
const fmtUntil = (t: number) => (t >= Number.MAX_SAFE_INTEGER - 1 ? 'until further notice' : `until ${new Date(t).toUTCString().replace(/:\d\d GMT/, ' UTC')}`);

/** Lift a timed suspension that has run out. Returns the fresh row. */
export function liftExpired(a: Row): Row {
  if (a.banned && a.banned_until && a.banned_until <= Date.now()) {
    run('UPDATE accounts SET banned = 0, banned_until = NULL, ban_reason = NULL WHERE id = ?', a.id);
    return one('SELECT * FROM accounts WHERE id = ?', a.id)!;
  }
  return a;
}
export function suspendedMessage(a: Row): string {
  const until = a.banned_until ? fmtUntil(a.banned_until) : 'until further notice';
  return `This account is suspended ${until}.${a.ban_reason ? ` Reason: ${a.ban_reason}` : ''}`;
}
export function assertNotFrozen(a: Row) {
  if (isFrozen(a)) throw new ApiError(403, `Staff locked profile editing on this account ${fmtUntil(a.frozen_until)}.${a.freeze_reason ? ` Reason: ${a.freeze_reason}` : ''}`, 'frozen');
}

export function presenceOf(a: Row): Presence | null {
  const p = privacyOf(a);
  if (!p.showStatus || lockdownOf(a).enabled) return null;
  if (!isOnline(a.id) || a.status === 'invisible') return 'offline';
  return a.status as Presence;
}

export function activityOf(a: Row) {
  const breakdown = [
    { label: 'Display name set', points: a.display_name ? 1 : 0 },
    { label: 'Avatar set', points: a.avatar ? 1 : 0 },
    { label: 'Bio written', points: a.bio ? 1 : 0 },
    { label: `Active days (${a.active_days}, max 7)`, points: Math.min(7, a.active_days) },
  ];
  return { total: breakdown.reduce((n, b) => n + b.points, 0), breakdown };
}

export const accountAgeDays = (a: Row) => Math.floor((Date.now() - a.created_at) / dayMs());

/** Custom status as other people see it. */
export const statusTextOf = (a: Row) => (privacyOf(a).showStatus && !lockdownOf(a).enabled ? a.custom_status : '');

/** What other people see: the owner's privacy choices and Lockdown Mode applied. */
export function toPublicProfile(a: Row, withKeys = true): PublicProfile {
  return publicView(rawProfile(a, withKeys), privacyOf(a), lockdownOf(a));
}

function rawProfile(a: Row, withKeys = true): PublicProfile {
  return {
    id: a.id,
    username: a.username,
    displayName: a.display_name || a.username,
    bio: a.bio,
    bioHtml: renderBio(a.bio),
    presence: presenceOf(a),
    customStatus: privacyOf(a).showStatus ? a.custom_status : '',
    theme: sanitizeTheme(parse(a.theme_json, {})),
    avatar: mediaUrl(a.avatar),
    banner: mediaUrl(a.banner),
    background: mediaUrl(a.background),
    badges: badgesOf(a),
    legacyUsername: badgesOf(a).includes('legacy_username') ? (a.original_username ?? a.previous_username ?? a.username) : null,
    pronouns: a.pronouns ?? '',
    links: parse(a.links_json, []),
    titles: parse(a.titles_json, []),
    frame: a.frame ?? null,
    effect: a.effect ?? null,
    nameFx: a.name_fx ?? null,
    accessory: a.accessory ?? null,
    messagePolicy: privacyOf(a).whoCanMessage,
    createdAt: a.created_at,
    tier: tierFor(a.username),
    keys: withKeys && a.spk_pub
      ? { ed: a.ed_pub, x: a.x_pub, spk: a.spk_pub, spkId: a.spk_id, spkSig: a.spk_sig }
      : null,
  };
}

function claimOf(r: Row | undefined): ClaimRequest | null {
  if (!r) return null;
  return { id: r.id, name: r.name, tier: r.tier, status: r.status, createdAt: r.created_at, availableAt: r.available_at };
}

export function nextChangeAt(a: Row): number | null {
  if (!a.last_username_change) return null; // first change after signup is free
  const t = a.last_username_change + USERNAME_CHANGE_COOLDOWN_DAYS * dayMs();
  return t > Date.now() ? t : null;
}

export function toMe(a: Row): Me {
  const act = activityOf(a);
  const pending = one("SELECT * FROM claim_requests WHERE account_id = ? AND status IN ('holding','pending_staff')", a.id);
  return {
    ...rawProfile(a),
    status: a.status as StatusChoice,
    privacy: privacyOf(a),
    roles: rolesOf(a),
    accountAgeDays: accountAgeDays(a),
    activity: act.total,
    activityBreakdown: act.breakdown,
    lastUsernameChange: a.last_username_change,
    usernameChanges: a.username_changes,
    nextUsernameChangeAt: nextChangeAt(a),
    pendingClaim: claimOf(pending),
    flaggedNetwork: !!a.flagged_network,
    invites: all('SELECT code, used_by FROM invites WHERE created_by = ? ORDER BY created_at', a.id)
      .map((r) => ({ code: r.code, usedBy: r.used_by ? (one('SELECT username FROM accounts WHERE id = ?', r.used_by)?.username ?? 'deleted') : null })),
    earnedBadges: earnedOf(a),
    credits: a.credits ?? 0,
    ownedCosmetics: rolesOf(a).includes('staff') ? COSMETICS.map((c) => c.id) : parse(a.owned_cosmetics_json, []),
    hiddenBadges: hiddenOf(a),
    lockdown: lockdownOf(a),
    marketBanned: !!a.market_banned,
    house: a.house ?? null,
    notices: parse<{ id: string; message: string; at: number; ack?: boolean; kind?: 'warning' | 'broadcast' }[]>(a.notices_json, []).filter((n) => !n.ack).map(({ id, message, at, kind }) => ({ id, message, at, kind: kind ?? 'warning' })),
    restrictions: {
      mutedUntil: isMuted(a) ? a.muted_until : null, muteReason: isMuted(a) ? a.mute_reason : null,
      frozenUntil: isFrozen(a) ? a.frozen_until : null, freezeReason: isFrozen(a) ? a.freeze_reason : null,
      discoveryLocked: !!a.discovery_locked,
    },
  };
}

let dailyBonusHook: (a: Row, day: string) => void = () => {};
export function setDailyBonusHook(fn: typeof dailyBonusHook) { dailyBonusHook = fn; }

export function touchActivity(a: Row) {
  const day = dayKey();
  if (a.last_active_day !== day) {
    run('UPDATE accounts SET active_days = active_days + 1, last_active_day = ? WHERE id = ?', day, a.id);
  }
  dailyBonusHook(a, day);
}

// --------------------------------------------------- username availability

/** Is `name` held by someone (active, locked, or mid-claim)? Ignores `selfId`. */
function nameHeld(name: string, selfId: string | null): boolean {
  const acct = one('SELECT id FROM accounts WHERE username = ?', name);
  if (acct && acct.id !== selfId) return true;
  const lock = one('SELECT owner_id, until FROM username_locks WHERE name = ? AND until > ?', name, Date.now());
  if (lock && lock.owner_id !== selfId) return true;
  const claim = one("SELECT account_id FROM claim_requests WHERE name = ? AND status IN ('holding','pending_staff')", name);
  if (claim && claim.account_id !== selfId) return true;
  return false;
}

/**
 * Full check order: 1–5 static (shared), 6 short-name rules, 7 free?
 * `acct` is null during signup. `ipHash` is used for velocity peeks.
 */
export function checkForAccount(raw: string, acct: Row | null, ipHash: string): UsernameCheckResult {
  const s = checkUsername(raw);
  if (!s.ok) {
    const status = s.reason === 'empty' || s.reason === 'too_long' || s.reason === 'charset' ? 'invalid' : 'unavailable';
    return { name: s.name, status, message: s.message, tier: null };
  }
  const name = s.name;
  const tier = s.tier as Tier;
  if (acct && acct.username === name) return { name, status: 'yours', message: "That's your username.", tier };
  if (nameHeld(name, acct?.id ?? null)) return { name, status: 'unavailable', message: UNAVAILABLE_MESSAGE, tier };

  const rule = TIER_RULES[tier];
  if (tier === 'standard' && !acct) return { name, status: 'available', message: 'Available.', tier };

  if (!acct) {
    return {
      name, status: 'locked', tier,
      message: `${rule.label} names unlock after your account is ${rule.minAccountAgeDays} days old. Pick a 5+ character name to start.`,
      requirements: [{ label: `Account at least ${rule.minAccountAgeDays} days old`, met: false }],
    };
  }

  const reqs: { label: string; met: boolean }[] = [];
  const next = nextChangeAt(acct);
  reqs.push({ label: `Username change cooldown (${USERNAME_CHANGE_COOLDOWN_DAYS} days)`, met: next === null });
  const pending = one("SELECT id FROM claim_requests WHERE account_id = ? AND status IN ('holding','pending_staff')", acct.id);
  reqs.push({ label: 'No other claim in progress', met: !pending });

  if (tier !== 'standard') {
    const age = accountAgeDays(acct);
    const act = activityOf(acct).total;
    reqs.push({ label: `Account at least ${rule.minAccountAgeDays} days old (you: ${age})`, met: age >= rule.minAccountAgeDays });
    reqs.push({ label: `Activity score ${rule.minActivity}+ (you: ${act})`, met: act >= rule.minActivity });
    if (rule.blockFlaggedNetworks) reqs.push({ label: 'Not signed up from a datacenter / VPN network', met: !acct.flagged_network });
    reqs.push({ label: 'One short-name claim per 24h', met: peek('shortClaimAcct', acct.id, LIMITS.shortClaimPerAccount.window) < LIMITS.shortClaimPerAccount.limit });
    reqs.push({ label: 'Network short-claim limit', met: peek('shortClaimIp', ipHash, LIMITS.shortClaimPerIp.window) < LIMITS.shortClaimPerIp.limit });
    reqs.push({ label: 'Site-wide rare claim rate', met: peek('shortClaimGlobal', 'all', LIMITS.shortClaimGlobal.window) < LIMITS.shortClaimGlobal.limit });
  }

  if (reqs.some((r) => !r.met)) {
    return { name, status: 'locked', tier, message: 'Not yet — requirements below.', requirements: reqs };
  }
  if (rule.staffApproval) {
    return { name, status: 'staff', tier, requirements: reqs, message: '1–2 character names are granted by staff. You can submit a request.' };
  }
  if (rule.holdHours > 0) {
    return { name, status: 'hold', tier, requirements: reqs, message: `Rare name: goes on a public ${rule.holdHours}h hold before it's yours.` };
  }
  return { name, status: 'available', tier, requirements: reqs, message: 'Available.' };
}

/** Swap an account's username: old name locked for OLD_NAME_LOCK_DAYS. */
export function applyRename(acctId: string, newName: string) {
  const a = one('SELECT * FROM accounts WHERE id = ?', acctId)!;
  const now = Date.now();
  run('INSERT OR REPLACE INTO username_locks (name, owner_id, until) VALUES (?, ?, ?)', a.username, a.id, now + OLD_NAME_LOCK_DAYS * DAY);
  run('DELETE FROM username_locks WHERE name = ?', newName);
  run('UPDATE accounts SET username = ?, username_changes = username_changes + 1, last_username_change = ?, previous_username = COALESCE(previous_username, ?) WHERE id = ?', newName, now, a.username, a.id);
}

export function claimUsername(acct: Row, raw: string, ipHash: string): { result: 'renamed' | 'hold' | 'staff'; claim?: ClaimRequest } {
  return tx(() => {
    const chk = checkForAccount(raw, acct, ipHash);
    if (chk.status === 'available') {
      applyRename(acct.id, chk.name);
      return { result: 'renamed' as const };
    }
    if (chk.status === 'hold' || chk.status === 'staff') {
      // velocity locks are consumed on submission
      if (!hit('shortClaimAcct', acct.id, LIMITS.shortClaimPerAccount.limit, LIMITS.shortClaimPerAccount.window) ||
          !hit('shortClaimIp', ipHash, LIMITS.shortClaimPerIp.limit, LIMITS.shortClaimPerIp.window) ||
          !hit('shortClaimGlobal', 'all', LIMITS.shortClaimGlobal.limit, LIMITS.shortClaimGlobal.window)) {
        throw new ApiError(429, 'Short-name claims are rate limited. Try again later.', 'velocity');
      }
      const id = newId();
      const now = Date.now();
      const isHold = chk.status === 'hold';
      const availableAt = isHold ? now + TIER_RULES[chk.tier!].holdHours * holdHourMs() : null;
      run('INSERT INTO claim_requests (id, account_id, name, tier, status, created_at, available_at, ip_hash) VALUES (?,?,?,?,?,?,?,?)',
        id, acct.id, chk.name, chk.tier, isHold ? 'holding' : 'pending_staff', now, availableAt, ipHash);
      return { result: isHold ? 'hold' as const : 'staff' as const, claim: claimOf(one('SELECT * FROM claim_requests WHERE id = ?', id))! };
    }
    if (chk.status === 'yours') throw new ApiError(400, "That's already your username.");
    throw new ApiError(chk.status === 'invalid' ? 400 : 409, chk.message, chk.status);
  });
}

export function cancelClaim(acct: Row) {
  run("UPDATE claim_requests SET status = 'cancelled' WHERE account_id = ? AND status IN ('holding','pending_staff')", acct.id);
}

/** Finalize expired holds. Called on an interval and before reads. */
export function finalizeHolds() {
  const due = all("SELECT * FROM claim_requests WHERE status = 'holding' AND available_at <= ?", Date.now());
  for (const c of due) {
    tx(() => {
      const a = one('SELECT * FROM accounts WHERE id = ?', c.account_id);
      const stillOk = a && !a.banned && checkUsername(c.name).ok && !one('SELECT 1 FROM accounts WHERE username = ? AND id != ?', c.name, c.account_id);
      if (stillOk) {
        applyRename(c.account_id, c.name);
        run("UPDATE claim_requests SET status = 'finalized' WHERE id = ?", c.id);
      } else {
        run("UPDATE claim_requests SET status = 'cancelled' WHERE id = ?", c.id);
      }
    });
  }
}

export function decideClaim(staff: Row, claimId: string, approve: boolean) {
  tx(() => {
    const c = one("SELECT * FROM claim_requests WHERE id = ? AND status IN ('holding','pending_staff')", claimId);
    if (!c) throw new ApiError(404, 'No open claim with that id.');
    if (approve) {
      if (one('SELECT 1 FROM accounts WHERE username = ? AND id != ?', c.name, c.account_id)) throw new ApiError(409, 'Name already taken.');
      applyRename(c.account_id, c.name);
      run("UPDATE claim_requests SET status = 'finalized', decided_by = ? WHERE id = ?", staff.id, c.id);
    } else {
      run("UPDATE claim_requests SET status = 'denied', decided_by = ? WHERE id = ?", staff.id, c.id);
    }
  });
}

/** Public, visible feed of rare claims (holds + recent finalized ≤4 chars). */
export function rareFeed() {
  finalizeHolds();
  const rows = all(`
    SELECT c.*, a.username AS current FROM claim_requests c JOIN accounts a ON a.id = c.account_id
    WHERE c.status IN ('holding','pending_staff','finalized') AND length(c.name) <= 4
    ORDER BY c.created_at DESC LIMIT 50`);
  return rows.map((r) => ({
    name: r.name, tier: r.tier, status: r.status, by: r.current, createdAt: r.created_at, availableAt: r.available_at,
  }));
}

export { canonicalize };
