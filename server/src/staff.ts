// Staff actions on accounts. Every action is validated against the shared
// definitions and written to the audit log.

import { one, all, run, tx, type Row } from './db';
import { DAY } from './config';
import {
  ApiError, newId, parse, rolesOf, applyRename, toPublicProfile, earnedOf, hiddenOf, isMuted, isFrozen, privacyOf,
} from './accounts';
import { deleteMedia } from './media';
import { disconnectAccount, notifyPresence } from './relay';
import { canonicalize, checkUsername, USERNAME_RE, OLD_NAME_LOCK_DAYS } from '../../shared/usernames';
import { DEFAULT_THEME } from '../../shared/theme';
import { cleanText } from '../../shared/markdown';
import { GRANTABLE, HOUSES, BADGES } from '../../shared/badges';
import { STAFF_ACTIONS, durationUntil, type Duration, type AuditEntry } from '../../shared/staffActions';
import { COSMETIC_BY_ID, cleanTitle, MAX_TITLES, EconomyError } from '../../shared/economy';
import { store as econStore, cancel as cancelListingFn } from './economy';

export function audit(staffId: string, targetId: string | null, action: string, detail = '') {
  run('INSERT INTO staff_audit (id, at, staff_id, target_id, action, detail) VALUES (?,?,?,?,?,?)', newId(), Date.now(), staffId, targetId, action, detail.slice(0, 500));
}

function auditRows(where: string, ...params: unknown[]): AuditEntry[] {
  return all(`SELECT s.*, st.username AS staff_name, t.username AS target_name FROM staff_audit s
              LEFT JOIN accounts st ON st.id = s.staff_id LEFT JOIN accounts t ON t.id = s.target_id
              ${where} ORDER BY s.at DESC LIMIT 100`, ...params)
    .map((r) => ({ id: r.id, at: r.at, staff: r.staff_name ?? 'deleted', target: r.target_name ?? null, action: r.action, detail: r.detail }));
}
export const recentAudit = () => auditRows('');

const text = (v: unknown, max = 300) => cleanText(String(v ?? ''), max).replace(/\n{2,}/g, '\n').trim();
const durationOf = (v: unknown): Duration => (['1h', '1d', '7d', '30d', 'permanent'].includes(v as string) ? (v as Duration) : '1d');
const dateOrNull = (v: unknown): number | null => {
  if (v === null || v === '' || v === undefined) return null;
  const t = Date.parse(String(v));
  if (!Number.isFinite(t) || t > Date.now()) throw new ApiError(400, 'Pick a date in the past.');
  return t;
};

export function applyStaffAction(staff: Row, targetId: string, body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  const t = one('SELECT * FROM accounts WHERE id = ?', targetId);
  if (!t) throw new ApiError(404, 'Account not found.');
  const isSelf = t.id === staff.id;
  const founder = rolesOf(staff).includes('founder');
  // Only founders can act on other staff with destructive actions.
  const targetIsStaff = rolesOf(t).includes('staff');
  const def = STAFF_ACTIONS.find((a) => a.id === action);
  if (def) {
    for (const p of def.params) if ('required' in p && p.required && !text(body[p.key])) throw new ApiError(400, `${p.label} is required.`);
    if (def.danger && isSelf) throw new ApiError(400, "You can't do that to your own account.");
    if (def.danger && targetIsStaff && !founder) throw new ApiError(403, 'Only founders can do that to staff accounts.');
  }
  const reason = text(body.reason, 200);
  let detail = reason;

  tx(() => {
    switch (action) {
      // ----------------------------------------------------- enforcement
      case 'warn': {
        const message = text(body.message, 500);
        const notices = parse<any[]>(t.notices_json, []);
        notices.push({ id: newId(6), message, at: Date.now() });
        run('UPDATE accounts SET notices_json = ? WHERE id = ?', JSON.stringify(notices.slice(-20)), t.id);
        detail = message;
        break;
      }
      case 'suspend': {
        const d = durationOf(body.duration);
        run('UPDATE accounts SET banned = 1, banned_until = ?, ban_reason = ? WHERE id = ?', d === 'permanent' ? null : durationUntil(d), reason, t.id);
        run('DELETE FROM sessions WHERE account_id = ?', t.id);
        disconnectAccount(t.id);
        detail = `${d}: ${reason}`;
        break;
      }
      case 'unsuspend':
        run('UPDATE accounts SET banned = 0, banned_until = NULL, ban_reason = NULL WHERE id = ?', t.id);
        break;
      case 'delete_account':
        for (const s of ['avatar', 'banner', 'background']) deleteMedia(t[s]);
        run('INSERT OR REPLACE INTO username_locks (name, owner_id, until) VALUES (?, ?, ?)', t.username, 'deleted', Date.now() + OLD_NAME_LOCK_DAYS * DAY);
        disconnectAccount(t.id);
        run('DELETE FROM accounts WHERE id = ?', t.id);
        detail = `@${t.username}: ${reason}`;
        break;

      // ------------------------------------------------------- messaging
      case 'mute': {
        const d = durationOf(body.duration);
        run('UPDATE accounts SET muted_until = ?, mute_reason = ? WHERE id = ?', durationUntil(d), reason || null, t.id);
        detail = `${d}${reason ? `: ${reason}` : ''}`;
        break;
      }
      case 'unmute':
        run('UPDATE accounts SET muted_until = NULL, mute_reason = NULL WHERE id = ?', t.id);
        break;

      // --------------------------------------------------------- profile
      case 'freeze_profile': {
        const d = durationOf(body.duration);
        run('UPDATE accounts SET frozen_until = ?, freeze_reason = ? WHERE id = ?', durationUntil(d), reason || null, t.id);
        detail = `${d}${reason ? `: ${reason}` : ''}`;
        break;
      }
      case 'unfreeze_profile':
        run('UPDATE accounts SET frozen_until = NULL, freeze_reason = NULL WHERE id = ?', t.id);
        break;
      case 'reset_display_name': run("UPDATE accounts SET display_name = '' WHERE id = ?", t.id); detail = t.display_name; break;
      case 'reset_bio': run("UPDATE accounts SET bio = '' WHERE id = ?", t.id); detail = t.bio; break;
      case 'reset_status': run("UPDATE accounts SET custom_status = '' WHERE id = ?", t.id); detail = t.custom_status; break;
      case 'reset_theme': run('UPDATE accounts SET theme_json = ? WHERE id = ?', JSON.stringify(DEFAULT_THEME), t.id); break;
      case 'remove_avatar': case 'remove_banner': case 'remove_background': {
        const slot = action.slice(7);
        deleteMedia(t[slot]);
        run(`UPDATE accounts SET ${slot} = NULL WHERE id = ?`, t.id);
        break;
      }
      case 'hide_from_discovery':
        run('UPDATE accounts SET privacy_json = ?, discovery_locked = 1 WHERE id = ?', JSON.stringify({ ...privacyOf(t), discoverable: false }), t.id);
        break;
      case 'allow_discovery':
        run('UPDATE accounts SET discovery_locked = 0 WHERE id = ?', t.id);
        break;

      // -------------------------------------------------------- username
      case 'rename': {
        const n = canonicalize(String(body.username));
        if (!USERNAME_RE.test(n) || n.length > 24) throw new ApiError(400, 'Use 1–24 characters: a–z, 0–9, _.');
        const chk = checkUsername(n);
        if (chk.reason === 'slur') throw new ApiError(400, 'That name is on the slur list.');
        if (one('SELECT 1 FROM accounts WHERE username = ? AND id != ?', n, t.id)) throw new ApiError(409, 'Someone already has that username.');
        applyRename(t.id, n);
        detail = `@${t.username} → @${n}: ${reason}`;
        break;
      }
      case 'reserve_name': {
        const n = canonicalize(String(body.username));
        if (!USERNAME_RE.test(n) || n.length > 24) throw new ApiError(400, 'Use 1–24 characters: a–z, 0–9, _.');
        if (one('SELECT 1 FROM accounts WHERE username = ?', n)) throw new ApiError(409, 'Someone already has that username.');
        const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
        run('INSERT OR REPLACE INTO username_locks (name, owner_id, until) VALUES (?, ?, ?)', n, 'staff', days ? Date.now() + days * DAY : Number.MAX_SAFE_INTEGER);
        detail = `@${n} for ${days ? `${days} days` : 'ever'}`;
        break;
      }
      case 'clear_cooldown':
        run('UPDATE accounts SET last_username_change = NULL WHERE id = ?', t.id);
        break;
      case 'cancel_claim':
        run("UPDATE claim_requests SET status = 'cancelled', decided_by = ? WHERE account_id = ? AND status IN ('holding','pending_staff')", staff.id, t.id);
        break;

      // ---------------------------------------------------------- access
      case 'force_logout':
        run('DELETE FROM sessions WHERE account_id = ?', t.id);
        disconnectAccount(t.id);
        break;
      case 'flag_network': run('UPDATE accounts SET flagged_network = 1 WHERE id = ?', t.id); break;
      case 'unflag_network': run('UPDATE accounts SET flagged_network = 0 WHERE id = ?', t.id); break;

      // --------------------------------------------------------- records
      case 'add_note': detail = text(body.note, 500); break;

      // ---------------------------------------------------------- badges
      case 'grant_badge': case 'revoke_badge': {
        const b = String(body.badge);
        if (!GRANTABLE.includes(b)) throw new ApiError(400, "That badge can't be granted by hand.");
        const set = new Set<string>(parse(t.badges_json, []));
        action === 'grant_badge' ? set.add(b) : set.delete(b);
        run('UPDATE accounts SET badges_json = ? WHERE id = ?', JSON.stringify([...set]), t.id);
        detail = BADGES[b].label;
        break;
      }
      case 'set_supporter': case 'set_booster': {
        const d = dateOrNull(body.date);
        run(`UPDATE accounts SET ${action === 'set_supporter' ? 'supporter_since' : 'booster_since'} = ? WHERE id = ?`, d, t.id);
        detail = d ? new Date(d).toISOString().slice(0, 10) : 'removed';
        break;
      }
      case 'set_house': {
        const h = body.house == null || body.house === '' ? null : String(body.house);
        if (h && !(HOUSES as readonly string[]).includes(h)) throw new ApiError(400, 'Unknown house.');
        run('UPDATE accounts SET house = ? WHERE id = ?', h, t.id);
        detail = h ?? 'none';
        break;
      }
      case 'set_roles': {
        if (!founder) throw new ApiError(403, 'Only founders can change roles.');
        const roles = (Array.isArray(body.roles) ? body.roles : []).filter((r: unknown) => ['staff', 'developer', 'founder'].includes(r as string)) as string[];
        if (isSelf && !roles.includes('founder')) throw new ApiError(400, "You can't remove your own founder role.");
        run('UPDATE accounts SET roles_json = ? WHERE id = ?', JSON.stringify(roles), t.id);
        detail = roles.join(', ') || 'none';
        break;
      }
      // ----------------------------------------------------------- perks
      case 'grant_credits': {
        const amt = Math.trunc(Number(body.amount));
        if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1_000_000) throw new ApiError(400, 'Amount must be between -1,000,000 and 1,000,000.');
        if (amt < 0 && t.credits + amt < 0) throw new ApiError(400, `They only have ${t.credits} credits.`);
        econStore.credit(t.id, amt, `${amt > 0 ? 'Gift' : 'Adjustment'} from staff${reason ? `: ${reason}` : ''}`);
        detail = `${amt > 0 ? '+' : ''}${amt}${reason ? `: ${reason}` : ''}`;
        break;
      }
      case 'set_titles': {
        let titles;
        try { titles = (Array.isArray(body.titles) ? body.titles : []).slice(0, MAX_TITLES).map(cleanTitle); }
        catch (e) { if (e instanceof EconomyError) throw new ApiError(e.status, e.message); throw e; }
        run('UPDATE accounts SET titles_json = ? WHERE id = ?', JSON.stringify(titles), t.id);
        detail = titles.map((x) => x.name).join(', ') || 'none';
        break;
      }
      case 'grant_cosmetic': case 'revoke_cosmetic': {
        const item = COSMETIC_BY_ID[String(body.item)];
        if (!item || item.staffOnly) throw new ApiError(400, 'Unknown item.');
        const owned = new Set<string>(parse(t.owned_cosmetics_json, []));
        action === 'grant_cosmetic' ? owned.add(item.id) : owned.delete(item.id);
        run('UPDATE accounts SET owned_cosmetics_json = ? WHERE id = ?', JSON.stringify([...owned]), t.id);
        if (action === 'revoke_cosmetic') run(`UPDATE accounts SET ${item.kind} = NULL WHERE id = ? AND ${item.kind} = ?`, t.id, item.id);
        detail = item.name;
        break;
      }
      case 'reset_cosmetics':
        run('UPDATE accounts SET frame = NULL, effect = NULL, name_fx = NULL, accessory = NULL WHERE id = ?', t.id);
        break;
      case 'market_ban': {
        run('UPDATE accounts SET market_banned = 1 WHERE id = ?', t.id);
        const l = one("SELECT id FROM listings WHERE seller_id = ? AND status = 'active'", t.id);
        if (l) cancelListingFn(staff.id, l.id, true);
        // refund any bids they're leading on
        for (const r of all("SELECT data_json FROM listings WHERE status = 'active'")) {
          const lst = JSON.parse(r.data_json);
          const top = lst.bids.reduce((m: any, b: any) => (!m || b.amount > m.amount ? b : m), null);
          if (top?.bidderId === t.id) {
            econStore.credit(t.id, top.amount, `Refund: marketplace access removed (@${lst.name})`);
            lst.bids = []; // earlier bidders were already refunded when outbid
            econStore.saveListing(lst);
          }
        }
        break;
      }
      case 'market_unban':
        run('UPDATE accounts SET market_banned = 0 WHERE id = ?', t.id);
        break;
      case 'remove_listing': {
        const l = one("SELECT id FROM listings WHERE seller_id = ? AND status = 'active'", t.id);
        if (!l) throw new ApiError(404, 'No active listing.');
        cancelListingFn(staff.id, l.id, true);
        break;
      }
      default:
        throw new ApiError(400, 'Unknown action.');
    }
    audit(staff.id, action === 'delete_account' ? null : t.id, action, detail);
  });
  if (action !== 'delete_account') notifyPresence(t.id);
}

/** Full staff view of one account. */
export function staffDetail(a: Row) {
  const reports = all("SELECT r.*, p.username AS reporter FROM reports r LEFT JOIN accounts p ON p.id = r.reporter_id WHERE r.target_id = ? ORDER BY r.created_at DESC LIMIT 20", a.id);
  const claim = one("SELECT * FROM claim_requests WHERE account_id = ? AND status IN ('holding','pending_staff')", a.id);
  return {
    ...toPublicProfile(a),
    createdAt: a.created_at,
    roles: rolesOf(a),
    marketBanned: !!a.market_banned,
    grantedBadges: parse(a.badges_json, []),
    earnedBadges: earnedOf(a),
    hiddenBadges: hiddenOf(a),
    house: a.house ?? null,
    supporterSince: a.supporter_since ?? null,
    boosterSince: a.booster_since ?? null,
    previousUsername: a.previous_username ?? null,
    originalUsername: a.original_username ?? null,
    banned: !!a.banned,
    bannedUntil: a.banned ? (a.banned_until ?? null) : null,
    banReason: a.banned ? a.ban_reason : null,
    mutedUntil: isMuted(a) ? a.muted_until : null,
    frozenUntil: isFrozen(a) ? a.frozen_until : null,
    discoveryLocked: !!a.discovery_locked,
    flaggedNetwork: !!a.flagged_network,
    activeDays: a.active_days,
    usernameChanges: a.username_changes,
    lastUsernameChange: a.last_username_change,
    pendingClaim: claim ? { name: claim.name, status: claim.status } : null,
    sessions: (one('SELECT count(*) n FROM sessions WHERE account_id = ? AND expires_at > ?', a.id, Date.now())?.n as number) ?? 0,
    unackedWarnings: parse<any[]>(a.notices_json, []).filter((n) => !n.ack).length,
    reports: reports.map((r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, reporter: r.reporter, createdAt: r.created_at })),
    audit: auditRows('WHERE s.target_id = ?', a.id),
    credits: a.credits ?? 0,
    ownedCosmetics: parse(a.owned_cosmetics_json, []),
    titles: parse(a.titles_json, []),
    activeListing: (() => { const l = one("SELECT data_json FROM listings WHERE seller_id = ? AND status = 'active'", a.id); return l ? JSON.parse(l.data_json) : null; })(),
    ledger: all('SELECT delta, reason, at FROM credit_ledger WHERE account_id = ? ORDER BY at DESC LIMIT 15', a.id),
  };
}

/** Account browser. */
export function listAccounts(q: string, filter: string) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) { where.push('(a.username LIKE ? OR a.display_name LIKE ?)'); params.push(`%${q.replace(/[%_]/g, (c) => '\\' + c)}%`, `%${q}%`); }
  const now = Date.now();
  if (filter === 'suspended') where.push('a.banned = 1');
  if (filter === 'muted') { where.push('a.muted_until > ?'); params.push(now); }
  if (filter === 'locked') { where.push('a.frozen_until > ?'); params.push(now); }
  if (filter === 'staff') where.push("a.roles_json LIKE '%staff%'");
  if (filter === 'flagged') where.push('a.flagged_network = 1');
  if (filter === 'reported') where.push("EXISTS (SELECT 1 FROM reports r WHERE r.target_id = a.id AND r.status = 'open')");
  if (filter === 'new') { where.push('a.created_at > ?'); params.push(now - 7 * DAY); }
  if (filter === 'short') where.push('length(a.username) <= 4');
  const rows = all(`SELECT a.*, (SELECT count(*) FROM reports r WHERE r.target_id = a.id AND r.status = 'open') AS open_reports
                    FROM accounts a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT 60`, ...params);
  return rows.map((a) => ({
    id: a.id, username: a.username, displayName: a.display_name, createdAt: a.created_at, roles: rolesOf(a),
    avatar: toPublicProfile(a, false).avatar, theme: toPublicProfile(a, false).theme,
    banned: !!a.banned, muted: isMuted(a), frozen: isFrozen(a), flagged: !!a.flagged_network, openReports: a.open_reports,
  }));
}
