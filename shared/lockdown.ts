// Lockdown Mode: an optional, extreme protection for people who may be
// personally targeted (staff, journalists, activists, anyone being harassed).
// Like Apple's Lockdown Mode it trades features for a smaller attack surface.
// Each rule says where it is enforced, so the UI can be honest about it.

import type { Privacy, PublicProfile, Lockdown } from './types';

export interface LockdownRule { id: string; title: string; detail: string; where: 'server' | 'device' | 'both' }

export const LOCKDOWN_RULES: LockdownRule[] = [
  { id: 'strangers', where: 'device', title: 'Strangers can\'t reach you',
    detail: 'Messages from anyone you haven\'t accepted are dropped before they\'re opened. You can allow text-only message requests if you need sources to reach you.' },
  { id: 'adds', where: 'server', title: 'Nobody can add you to groups or servers',
    detail: 'You join only with an invite link you choose to open.' },
  { id: 'presence', where: 'server', title: 'You look offline to everyone',
    detail: 'Online status, custom status and your join date are hidden.' },
  { id: 'page', where: 'server', title: 'Your public web page goes dark',
    detail: 'sigil.app/yourname shows nothing and your profile links are hidden. You can still be found in the app unless you turn that off too.' },
  { id: 'devices', where: 'server', title: 'Every other device is signed out',
    detail: 'Turning it on ends all other sessions, so a device you lost or left signed in loses access.' },
  { id: 'direct', where: 'device', title: 'No direct connections',
    detail: 'Messages always go through the relay, so nobody you chat with learns your IP address.' },
  { id: 'history', where: 'device', title: 'Nothing is kept on this device',
    detail: 'Chat history is off and new chats start with 1-day disappearing messages.' },
  { id: 'media', where: 'device', title: 'Images from strangers aren\'t loaded',
    detail: 'Avatars, banners and GIFs only load for people you\'ve accepted, so a crafted image can\'t reach you or confirm you\'re online.' },
  { id: 'links', where: 'device', title: 'Links in messages are not clickable',
    detail: 'Links show as plain text. Copying one is a deliberate choice, not a misclick.' },
  { id: 'keys', where: 'device', title: 'Safety-number changes block sending',
    detail: 'If someone\'s encryption key changes, you can\'t send to them until you verify the new safety number.' },
  { id: 'off', where: 'device', title: 'Turning it off takes your recovery phrase',
    detail: 'Someone with your unlocked device can\'t quietly switch it off.' },
];

export const LOCKDOWN_OFF: Lockdown = { enabled: false, since: null, allowRequests: false };

/**
 * What other people see of a profile, after the owner's privacy choices and
 * Lockdown Mode. Used by the server and the demo so both behave the same.
 */
export function publicView(p: PublicProfile, privacy: Privacy, lockdown: Lockdown): PublicProfile {
  const out = { ...p };
  if (!privacy.showJoinDate || lockdown.enabled) out.createdAt = null;
  if (!privacy.showBadges) { out.badges = []; out.legacyUsername = null; }
  if (!privacy.showLinks || lockdown.enabled) out.links = [];
  if (lockdown.enabled) { out.presence = null; out.customStatus = ''; }
  return out;
}

/** Can someone else add this account to a group or server directly? */
export const acceptsSpaceAdds = (privacy: Privacy, lockdown: Lockdown) => privacy.allowSpaceAdds && !lockdown.enabled;
/** Does /{username} render? */
export const hasPublicPage = (privacy: Privacy, lockdown: Lockdown) => privacy.discoverable && privacy.publicPage && !lockdown.enabled;
