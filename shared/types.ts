import type { Theme } from './theme';
import type { BadgeId } from './badges';
import type { Tier } from './usernames';

export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type StatusChoice = 'online' | 'idle' | 'dnd' | 'invisible';
export type MessagePolicy = 'everyone' | 'friends' | 'nobody';

export interface Privacy {
  discoverable: boolean;       // findable by username in the app
  whoCanMessage: MessagePolicy;
  showStatus: boolean;
  /** the public web page at /{username} */
  publicPage: boolean;
  showJoinDate: boolean;
  showBadges: boolean;
  showLinks: boolean;
  /** others can add you straight into groups and servers (otherwise you join with an invite) */
  allowSpaceAdds: boolean;
}

export const DEFAULT_PRIVACY: Privacy = {
  discoverable: true, whoCanMessage: 'everyone', showStatus: true,
  publicPage: true, showJoinDate: true, showBadges: true, showLinks: true, allowSpaceAdds: true,
};
export const PRIVACY_BOOLS = ['discoverable', 'showStatus', 'publicPage', 'showJoinDate', 'showBadges', 'showLinks', 'allowSpaceAdds'] as const;

/** Sanitize a privacy patch on top of the current settings. */
export function mergePrivacy(cur: Privacy, patch: unknown): Privacy {
  const b = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const out: Privacy = { ...DEFAULT_PRIVACY, ...cur };
  for (const k of PRIVACY_BOOLS) if (typeof b[k] === 'boolean') (out as any)[k] = b[k];
  if (['everyone', 'friends', 'nobody'].includes(b.whoCanMessage as string)) out.whoCanMessage = b.whoCanMessage as MessagePolicy;
  return out;
}

export interface Lockdown {
  enabled: boolean;
  since: number | null;
  /** let people you haven't accepted send a first (text-only) message request */
  allowRequests: boolean;
}

export interface PublicKeys {
  ed: string;      // Ed25519 identity (signing), base64
  x: string;       // X25519 identity (DH), base64
  spk: string;     // X25519 signed prekey, base64
  spkId: number;
  spkSig: string;  // Ed25519 signature over spkId||spk, base64
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  bioHtml: string;
  presence: Presence | null;      // null when the user hides status
  customStatus: string;
  theme: Theme;
  avatar: string | null;
  banner: string | null;
  background: string | null;
  badges: BadgeId[];
  /** first username this account held; only set when the user equips that badge */
  legacyUsername: string | null;
  pronouns: string;
  links: { label: string; url: string }[];
  /** platform roles staff gave this account */
  titles: { name: string; color: string }[];
  /** equipped animated avatar frame / profile effect (bought in the shop) */
  frame: string | null;
  effect: string | null;
  nameFx: string | null;
  accessory: string | null;
  messagePolicy: MessagePolicy;
  /** null when the person hides their join date */
  createdAt: number | null;
  tier: Tier;
  keys: PublicKeys | null;
}

export interface ClaimRequest {
  id: string;
  name: string;
  tier: Tier;
  status: 'holding' | 'pending_staff' | 'approved' | 'denied' | 'cancelled' | 'finalized';
  createdAt: number;
  availableAt: number | null;
}

export interface Me extends PublicProfile {
  status: StatusChoice;
  privacy: Privacy;
  roles: string[];
  accountAgeDays: number;
  activity: number;
  activityBreakdown: { label: string; points: number }[];
  lastUsernameChange: number | null;
  usernameChanges: number;
  nextUsernameChangeAt: number | null;
  pendingClaim: ClaimRequest | null;
  flaggedNetwork: boolean;
  invites: { code: string; usedBy: string | null }[];
  /** every badge earned; `badges` is the equipped subset */
  earnedBadges: BadgeId[];
  hiddenBadges: BadgeId[];
  house: string | null;
  notices: { id: string; message: string; at: number; kind?: 'warning' | 'broadcast' }[];
  credits: number;
  ownedCosmetics: string[];
  lockdown: Lockdown;
  marketBanned: boolean;
  restrictions: {
    mutedUntil: number | null; muteReason: string | null;
    frozenUntil: number | null; freezeReason: string | null;
    discoveryLocked: boolean;
  };
}

export interface UsernameCheckResult {
  name: string;
  /** available: claim now; hold: 24h public hold; staff: request approval; locked: requirements unmet; unavailable */
  status: 'available' | 'hold' | 'staff' | 'locked' | 'unavailable' | 'invalid' | 'yours';
  message: string;
  tier: Tier | null;
  requirements?: { label: string; met: boolean }[];
}
