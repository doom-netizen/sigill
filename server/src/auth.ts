// Auth: the account IS a keypair derived from the recovery phrase.
// Login = sign a server challenge with the Ed25519 identity key.
// No passwords. Email is not collected.

import crypto from 'node:crypto';
import { one, run, all, tx, type Row } from './db';
import { config, dayKey } from './config';
import { ApiError, newId, checkForAccount, liftExpired, suspendedMessage } from './accounts';
import { fingerprint, isFlaggedNetwork, hit, LIMITS } from './abuse';
import { DEFAULT_THEME } from '../../shared/theme';
import { DEFAULT_PRIVACY } from '../../shared/types';
import { cleanText } from '../../shared/markdown';
import { platform } from './platform';

const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const TOKEN_TTL = 30 * 24 * 3600e3;
const challenges = new Map<string, number>();

export function edPublicKey(b64: string) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new ApiError(400, 'Bad public key.');
  return crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, raw]), format: 'der', type: 'spki' });
}

export function verifySig(edB64: string, message: Buffer | string, sigB64: string): boolean {
  try {
    return crypto.verify(null, Buffer.isBuffer(message) ? message : Buffer.from(message), edPublicKey(edB64), Buffer.from(sigB64, 'base64'));
  } catch { return false; }
}

export function newChallenge(): string {
  const n = crypto.randomBytes(24).toString('base64url');
  challenges.set(n, Date.now() + 120e3);
  if (challenges.size > 50_000) for (const [k, t] of challenges) if (t < Date.now()) challenges.delete(k);
  return n;
}

export function consumeChallenge(nonce: string, edB64: string, sig: string, purpose = 'auth') {
  const exp = challenges.get(nonce);
  challenges.delete(nonce);
  if (!exp || exp < Date.now()) throw new ApiError(401, 'Challenge expired. Try again.');
  if (!verifySig(edB64, `sigil-${purpose}:${nonce}`, sig)) throw new ApiError(401, 'Signature check failed.');
}

/** "Firefox on Linux"-style label, chosen by the client. Never an IP or a precise fingerprint. */
const cleanLabel = (s: unknown) => cleanText(String(s ?? ''), 40).replace(/[^\w .,()+-]/g, '').trim() || 'Unknown device';

function issueToken(accountId: string, label?: unknown): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  run('INSERT INTO sessions (token_hash, account_id, created_at, expires_at, sid, label, last_seen) VALUES (?,?,?,?,?,?,?)',
    hash, accountId, now, now + TOKEN_TTL, crypto.randomBytes(9).toString('base64url'), cleanLabel(label), now);
  return token;
}

/** The account for a token, with `_sid` (this session's public id). */
export function accountForToken(token: string): Row | undefined {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const r = one('SELECT a.*, s.sid AS _sid, s.last_seen AS _seen FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?', hash, Date.now());
  if (r && (!r._seen || Date.now() - r._seen > 60e3)) run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', Date.now(), hash);
  return r;
}

export function listSessions(accountId: string, currentSid: string | null) {
  return all('SELECT sid, label, created_at, last_seen FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY last_seen DESC', accountId, Date.now())
    .map((r) => ({ id: r.sid as string, label: r.label as string, createdAt: r.created_at as number, lastSeen: (r.last_seen ?? r.created_at) as number, current: r.sid === currentSid }));
}
export function revokeSession(accountId: string, sid: string) { run('DELETE FROM sessions WHERE account_id = ? AND sid = ?', accountId, sid); }
export function revokeOtherSessions(accountId: string, keepSid: string | null): string[] {
  const gone = all('SELECT sid FROM sessions WHERE account_id = ? AND sid IS NOT ?', accountId, keepSid).map((r) => r.sid as string);
  run('DELETE FROM sessions WHERE account_id = ? AND sid IS NOT ?', accountId, keepSid);
  return gone;
}

export function revokeToken(token: string) {
  run('DELETE FROM sessions WHERE token_hash = ?', crypto.createHash('sha256').update(token).digest('hex'));
}

function recentSignups(kind: string, hash: string, windowMs: number): number {
  return (one('SELECT count(*) AS n FROM signup_fingerprints WHERE kind = ? AND hash = ? AND created_at > ?', kind, hash, Date.now() - windowMs)?.n as number) ?? 0;
}

export function makeInviteCodes(createdBy: string | null, n: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const code = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toUpperCase().slice(0, 8);
    run('INSERT INTO invites (code, created_by, created_at) VALUES (?,?,?)', code, createdBy, Date.now());
    codes.push(code);
  }
  return codes;
}

export interface RegisterInput {
  username: string; invite?: string; ed: string; x: string; nonce: string; sig: string; deviceId?: string; deviceLabel?: string;
}

export function register(input: RegisterInput, ip: string) {
  const signups = platform().signups;
  if (signups === 'paused') throw new ApiError(403, 'Sign-ups are paused right now. Try again later.', 'signups_paused');
  const needInvite = signups === 'invite';
  consumeChallenge(input.nonce, input.ed, input.sig);
  const xRaw = Buffer.from(input.x ?? '', 'base64');
  if (xRaw.length !== 32) throw new ApiError(400, 'Bad public key.');
  if (one('SELECT 1 FROM accounts WHERE ed_pub = ?', input.ed)) throw new ApiError(409, 'This recovery phrase already has an account. Sign in instead.');

  const ipHash = fingerprint('ip', ip);
  const devHash = input.deviceId ? fingerprint('device', input.deviceId) : null;
  if (recentSignups('ip', ipHash, LIMITS.signupPerIp.window) >= LIMITS.signupPerIp.limit) {
    throw new ApiError(429, 'Too many new accounts from this network today.', 'rate_limited');
  }
  if (devHash && recentSignups('device', devHash, LIMITS.signupPerDevice.window) >= LIMITS.signupPerDevice.limit) {
    throw new ApiError(429, 'Too many new accounts from this device this week.', 'rate_limited');
  }

  const chk = checkForAccount(input.username, null, ipHash);
  if (chk.status !== 'available') throw new ApiError(chk.status === 'invalid' ? 400 : 409, chk.message, chk.status);

  return tx(() => {
    let invitedBy: string | null = null;
    if (needInvite) {
      const inv = one('SELECT * FROM invites WHERE code = ?', String(input.invite ?? '').trim().toUpperCase());
      if (!inv || inv.used_by) throw new ApiError(403, 'That invite code is invalid or already used.', 'invite');
      invitedBy = inv.created_by;
    }
    const id = newId();
    const isFirst = !one('SELECT 1 FROM accounts LIMIT 1');
    run(`INSERT INTO accounts (id, username, original_username, created_at, ed_pub, x_pub, theme_json, privacy_json, roles_json, flagged_network, invited_by, last_active_day)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, chk.name, chk.name, Date.now(), input.ed, input.x, JSON.stringify(DEFAULT_THEME), JSON.stringify(DEFAULT_PRIVACY),
      // the very first account on a fresh server is the founder/staff account
      JSON.stringify(isFirst ? ['staff', 'founder', 'developer'] : []),
      isFlaggedNetwork(ip) ? 1 : 0, invitedBy, dayKey());
    if (needInvite) run('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?', id, Date.now(), String(input.invite).trim().toUpperCase());
    run('INSERT INTO signup_fingerprints (kind, hash, created_at) VALUES (?,?,?)', 'ip', ipHash, Date.now());
    if (devHash) run('INSERT INTO signup_fingerprints (kind, hash, created_at) VALUES (?,?,?)', 'device', devHash, Date.now());
    makeInviteCodes(id, config.invitesPerAccount);
    return { token: issueToken(id, input.deviceLabel), accountId: id };
  });
}

export function login(input: { ed: string; nonce: string; sig: string; deviceLabel?: string }, ip: string) {
  if (!hit('login', fingerprint('ip', ip), 30, 3600e3)) throw new ApiError(429, 'Too many sign-in attempts.');
  consumeChallenge(input.nonce, input.ed, input.sig);
  const row = one('SELECT * FROM accounts WHERE ed_pub = ?', input.ed);
  if (!row) throw new ApiError(404, 'No account for this recovery phrase.', 'no_account');
  const a = liftExpired(row);
  if (a.banned) throw new ApiError(403, suspendedMessage(a), 'banned');
  return { token: issueToken(a.id, input.deviceLabel), accountId: a.id };
}

export function setSignedPrekey(a: Row, spk: string, spkId: number, spkSig: string) {
  if (Buffer.from(spk, 'base64').length !== 32 || !Number.isInteger(spkId)) throw new ApiError(400, 'Bad prekey.');
  const msg = Buffer.concat([Buffer.from(`sigil-spk:${spkId}:`), Buffer.from(spk, 'base64')]);
  if (!verifySig(a.ed_pub, msg, spkSig)) throw new ApiError(400, 'Prekey signature invalid.');
  run('UPDATE accounts SET spk_pub = ?, spk_id = ?, spk_sig = ? WHERE id = ?', spk, spkId, spkSig, a.id);
}

export function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return all('SELECT 1');
}
