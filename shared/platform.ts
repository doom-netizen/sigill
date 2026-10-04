// Site-wide switches staff can flip at runtime, plus staff-written updates.

import { cleanText } from './markdown';

export interface PlatformSettings {
  /** open: anyone; invite: invite code needed; paused: no new accounts */
  signups: 'open' | 'invite' | 'paused';
  marketPaused: boolean;
  shopPaused: boolean;
  /** raid mode: accounts younger than 24h can't start DMs or create servers */
  raidMode: boolean;
  /** banner shown to everyone at the top of the app */
  banner: { text: string; tone: 'info' | 'warn' | 'good' } | null;
}

export const PLATFORM_DEFAULTS = (inviteOnly: boolean): PlatformSettings => ({
  signups: inviteOnly ? 'invite' : 'open', marketPaused: false, shopPaused: false, raidMode: false, banner: null,
});

export function mergePlatform(cur: PlatformSettings, patch: unknown): PlatformSettings {
  const b = (patch && typeof patch === 'object' ? patch : {}) as Record<string, any>;
  const out = { ...cur };
  if (['open', 'invite', 'paused'].includes(b.signups)) out.signups = b.signups;
  for (const k of ['marketPaused', 'shopPaused', 'raidMode'] as const) if (typeof b[k] === 'boolean') out[k] = b[k];
  if (b.banner === null) out.banner = null;
  else if (b.banner && typeof b.banner === 'object') {
    const text = cleanText(String(b.banner.text ?? ''), 200).replace(/\n/g, ' ').trim();
    out.banner = text ? { text, tone: ['info', 'warn', 'good'].includes(b.banner.tone) ? b.banner.tone : 'info' } : null;
  }
  return out;
}

export const RAID_MIN_AGE_MS = 24 * 3600e3;

// -------------------------------------------------------------- updates
export type UpdateTag = 'feature' | 'fix' | 'security' | 'event' | 'notice';
export interface UpdatePost { id: string; title: string; body: string; tag: UpdateTag; at: number; by: string; version?: string; items?: string[] }

export function cleanUpdate(b: any): { title: string; body: string; tag: UpdateTag } {
  const title = cleanText(String(b?.title ?? ''), 80).replace(/\n/g, ' ').trim();
  const body = cleanText(String(b?.body ?? ''), 2000).trim();
  if (!title) throw new Error('Give the update a title.');
  if (!body) throw new Error('Write something in the update.');
  const tag: UpdateTag = ['feature', 'fix', 'security', 'event', 'notice'].includes(b?.tag) ? b.tag : 'notice';
  return { title, body, tag };
}
