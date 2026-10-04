// Every staff action on an account, defined once. The server and the demo
// server both implement these; the Staff UI renders its controls from this
// list. Every action is written to the audit log with who did it and why.

export type Duration = '1h' | '1d' | '7d' | '30d' | 'permanent';
export const DURATIONS: { value: Duration; label: string; ms: number | null }[] = [
  { value: '1h', label: '1 hour', ms: 3600e3 },
  { value: '1d', label: '1 day', ms: 86400e3 },
  { value: '7d', label: '7 days', ms: 7 * 86400e3 },
  { value: '30d', label: '30 days', ms: 30 * 86400e3 },
  { value: 'permanent', label: 'Permanent', ms: null },
];
export const durationUntil = (d: Duration, now = Date.now()) => {
  const x = DURATIONS.find((v) => v.value === d);
  return x?.ms == null ? Number.MAX_SAFE_INTEGER : now + x.ms;
};

export type StaffParam =
  | { key: 'reason'; label: string; kind: 'text'; required?: boolean }
  | { key: 'message'; label: string; kind: 'textarea'; required: true }
  | { key: 'note'; label: string; kind: 'textarea'; required: true }
  | { key: 'duration'; label: string; kind: 'duration' }
  | { key: 'username'; label: string; kind: 'username'; required: true }
  | { key: 'days'; label: string; kind: 'number' }
  | { key: 'date'; label: string; kind: 'date' };

export interface StaffActionDef {
  id: string;
  label: string;
  group: 'Enforcement' | 'Messaging' | 'Profile' | 'Username' | 'Access' | 'Records';
  description: string;
  params: StaffParam[];
  danger?: boolean;
  founderOnly?: boolean;
}

const reason = (required = false): StaffParam => ({ key: 'reason', label: 'Reason (the user sees this)', kind: 'text', required });

export const STAFF_ACTIONS: StaffActionDef[] = [
  // Enforcement
  { id: 'warn', label: 'Send warning', group: 'Enforcement', description: 'Shows a notice the user must acknowledge next time they open Sigil.', params: [{ key: 'message', label: 'Warning', kind: 'textarea', required: true }] },
  { id: 'suspend', label: 'Suspend', group: 'Enforcement', description: 'Signs them out everywhere and blocks sign-in until it ends. Their public page goes offline.', params: [{ key: 'duration', label: 'For', kind: 'duration' }, reason(true)], danger: true },
  { id: 'unsuspend', label: 'Lift suspension', group: 'Enforcement', description: 'Restores access immediately.', params: [] },
  { id: 'delete_account', label: 'Delete account', group: 'Enforcement', description: 'Deletes the account and its images. The username stays locked for 60 days.', params: [reason(true)], danger: true },

  // Messaging
  { id: 'mute', label: 'Restrict messaging', group: 'Messaging', description: "They can't send messages or message requests. They can still read.", params: [{ key: 'duration', label: 'For', kind: 'duration' }, reason()] },
  { id: 'unmute', label: 'Lift messaging restriction', group: 'Messaging', description: '', params: [] },

  // Profile
  { id: 'freeze_profile', label: 'Lock profile editing', group: 'Profile', description: "They can't change their profile, images, theme or username.", params: [{ key: 'duration', label: 'For', kind: 'duration' }, reason()] },
  { id: 'unfreeze_profile', label: 'Unlock profile editing', group: 'Profile', description: '', params: [] },
  { id: 'reset_display_name', label: 'Reset display name', group: 'Profile', description: '', params: [] },
  { id: 'reset_bio', label: 'Clear bio', group: 'Profile', description: '', params: [] },
  { id: 'reset_status', label: 'Clear custom status', group: 'Profile', description: '', params: [] },
  { id: 'reset_theme', label: 'Reset theme', group: 'Profile', description: 'Back to the default theme.', params: [] },
  { id: 'remove_avatar', label: 'Remove avatar', group: 'Profile', description: '', params: [] },
  { id: 'remove_banner', label: 'Remove banner', group: 'Profile', description: '', params: [] },
  { id: 'remove_background', label: 'Remove page background', group: 'Profile', description: '', params: [] },
  { id: 'hide_from_discovery', label: 'Hide from discovery', group: 'Profile', description: "Turns off their public page and lookups, and they can't turn it back on.", params: [reason()] },
  { id: 'allow_discovery', label: 'Allow discovery again', group: 'Profile', description: '', params: [] },
  { id: 'reset_cosmetics', label: 'Unequip cosmetics', group: 'Profile', description: 'Takes off their frame, profile theme, name effect and accessory. They keep what they bought.', params: [reason()] },
  { id: 'market_ban', label: 'Ban from marketplace', group: 'Access', description: "They can't list, bid on or buy usernames, or buy from the shop. Their active listing is removed and bids refunded.", params: [reason()] },
  { id: 'market_unban', label: 'Lift marketplace ban', group: 'Access', description: '', params: [] },

  // Username
  { id: 'rename', label: 'Force rename', group: 'Username', description: 'Changes their username now (bypasses tiers, not the slur list). The old name is locked.', params: [{ key: 'username', label: 'New username', kind: 'username', required: true }, reason(true)] },
  { id: 'reserve_name', label: 'Reserve a username', group: 'Username', description: 'Locks any free name so nobody can claim it.', params: [{ key: 'username', label: 'Name to reserve', kind: 'username', required: true }, { key: 'days', label: 'Days (0 = forever)', kind: 'number' }] },
  { id: 'clear_cooldown', label: 'Clear username cooldown', group: 'Username', description: 'Lets them change their username now.', params: [] },
  { id: 'cancel_claim', label: 'Cancel pending claim', group: 'Username', description: 'Cancels a short-name hold or request.', params: [reason()] },

  // Access
  { id: 'force_logout', label: 'Sign out everywhere', group: 'Access', description: 'Ends every session. They can sign back in with their recovery phrase.', params: [] },
  { id: 'flag_network', label: 'Flag as datacenter / VPN', group: 'Access', description: "They can't claim names of 4 characters or fewer.", params: [] },
  { id: 'unflag_network', label: 'Clear network flag', group: 'Access', description: '', params: [] },

  // Records
  { id: 'add_note', label: 'Add staff note', group: 'Records', description: 'Private to staff. Shows in the audit log.', params: [{ key: 'note', label: 'Note', kind: 'textarea', required: true }] },
];

export const STAFF_ACTION_IDS = new Set(STAFF_ACTIONS.map((a) => a.id));

/** Badge-related staff actions (handled in the Badges tab, also audited). */
export type BadgeAction =
  | { action: 'grant_badge'; badge: string }
  | { action: 'revoke_badge'; badge: string }
  | { action: 'set_supporter'; date: string | null }
  | { action: 'set_booster'; date: string | null }
  | { action: 'set_house'; house: string | null }
  | { action: 'set_roles'; roles: string[] };

export interface AuditEntry { id: string; at: number; staff: string; target: string | null; action: string; detail: string }
