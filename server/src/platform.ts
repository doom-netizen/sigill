// Runtime platform switches (signups, pauses, raid mode, banner) and updates.
import { one, all, run } from './db';
import { config } from './config';
import { newId, ApiError } from './accounts';
import { PLATFORM_DEFAULTS, mergePlatform, cleanUpdate, type PlatformSettings, type UpdatePost } from '../../shared/platform';

let cache: PlatformSettings | null = null;

export function platform(): PlatformSettings {
  if (cache) return cache;
  const r = one('SELECT value FROM platform WHERE key = ?', 'settings');
  let v = PLATFORM_DEFAULTS(config.inviteOnly);
  try { if (r) v = mergePlatform(v, JSON.parse(r.value)); } catch { /* defaults */ }
  return (cache = v);
}

export function setPlatform(patch: unknown): PlatformSettings {
  const next = mergePlatform(platform(), patch);
  run('INSERT OR REPLACE INTO platform (key, value) VALUES (?, ?)', 'settings', JSON.stringify(next));
  cache = next;
  return next;
}

export function listUpdates(): UpdatePost[] {
  return all(`SELECT u.*, a.username AS by_name FROM updates u LEFT JOIN accounts a ON a.id = u.by_id ORDER BY u.at DESC LIMIT 50`)
    .map((r) => ({ id: r.id, title: r.title, body: r.body, tag: r.tag, at: r.at, by: r.by_name ?? 'staff' }));
}

export function postUpdate(byId: string, body: unknown): UpdatePost {
  let u;
  try { u = cleanUpdate(body); } catch (e: any) { throw new ApiError(400, e.message); }
  const id = newId();
  run('INSERT INTO updates (id, title, body, tag, at, by_id) VALUES (?,?,?,?,?,?)', id, u.title, u.body, u.tag, Date.now(), byId);
  return listUpdates().find((x) => x.id === id)!;
}

export function deleteUpdate(id: string) { run('DELETE FROM updates WHERE id = ?', id); }
