// Credits, shop and username marketplace for the real server. Rules live in
// shared/economy.ts; this file is the SQLite-backed store plus API helpers.

import { one, all, run, tx, type Row } from './db';
import { DAY, dayMs } from './config';
import { ApiError, newId, parse, rolesOf, liftExpired } from './accounts';
import { notifyPresence } from './relay';
import {
  createListing, placeBid, buyNow, cancelListing, settleDue, buyCosmetic, listingView, owns,
  COSMETICS, COSMETIC_BY_ID, COSMETIC_SLOTS, ECONOMY, type CosmeticSlot, EconomyError, OLD_NAME_LOCK_DAYS, type EconomyStore, type Listing, type ListingInput,
} from '../../shared/economy';

const account = (id: string) => one('SELECT * FROM accounts WHERE id = ?', id);

export const store: EconomyStore = {
  account(id) {
    const a = account(id);
    if (!a) return null;
    return {
      id: a.id, username: a.username, credits: a.credits, createdAt: a.created_at, lastUsernameChange: a.last_username_change,
      flagged: !!a.flagged_network, banned: !!liftExpired(a).banned, staff: rolesOf(a).includes('staff'), owned: parse(a.owned_cosmetics_json, []),
    };
  },
  credit(id, delta, reason) {
    const a = account(id);
    if (!a) throw new ApiError(404, 'Account not found.');
    if (a.credits + delta < 0) throw new ApiError(402, 'Not enough credits.');
    run('UPDATE accounts SET credits = credits + ? WHERE id = ?', delta, id);
    run('INSERT INTO credit_ledger (id, account_id, delta, reason, at) VALUES (?,?,?,?,?)', newId(), id, delta, reason.slice(0, 200), Date.now());
  },
  setOwned(id, owned) { run('UPDATE accounts SET owned_cosmetics_json = ? WHERE id = ?', JSON.stringify(owned), id); },
  nameFree(name, self) {
    if (one('SELECT 1 FROM accounts WHERE username = ? AND id != ?', name, self)) return false;
    const lock = one('SELECT owner_id FROM username_locks WHERE name = ? AND until > ?', name, Date.now());
    if (lock && lock.owner_id !== self) return false;
    return !one("SELECT 1 FROM claim_requests WHERE name = ? AND status IN ('holding','pending_staff') AND account_id != ?", name, self);
  },
  lockName(name, owner, until) { run('INSERT OR REPLACE INTO username_locks (name, owner_id, until) VALUES (?,?,?)', name, owner, until); },
  unlockName(name, owner) { run('DELETE FROM username_locks WHERE name = ? AND owner_id = ?', name, owner); },
  transferName({ sellerId, buyerId, name, fallback, now }) {
    const buyer = account(buyerId)!;
    // seller takes the replacement first so the unique username stays valid
    run('DELETE FROM username_locks WHERE name = ?', fallback);
    run('UPDATE accounts SET username = ?, last_username_change = ?, username_changes = username_changes + 1, previous_username = COALESCE(previous_username, ?) WHERE id = ?', fallback, now, name, sellerId);
    run('INSERT OR REPLACE INTO username_locks (name, owner_id, until) VALUES (?,?,?)', buyer.username, buyerId, now + OLD_NAME_LOCK_DAYS * DAY);
    run('UPDATE accounts SET username = ?, last_username_change = ?, username_changes = username_changes + 1, previous_username = COALESCE(previous_username, ?) WHERE id = ?', name, now, buyer.username, buyerId);
    run("UPDATE claim_requests SET status = 'cancelled' WHERE account_id IN (?, ?) AND status IN ('holding','pending_staff')", sellerId, buyerId);
    notifyPresence(sellerId); notifyPresence(buyerId);
  },
  getListing(id) { const r = one('SELECT data_json FROM listings WHERE id = ?', id); return r ? JSON.parse(r.data_json) : null; },
  saveListing(l) { run('INSERT OR REPLACE INTO listings (id, data_json, status, seller_id, ends_at) VALUES (?,?,?,?,?)', l.id, JSON.stringify(l), l.status, l.sellerId, l.endsAt); },
  activeListings() { return all("SELECT data_json FROM listings WHERE status = 'active'").map((r) => JSON.parse(r.data_json) as Listing); },
  newId: () => newId(),
  get dayMs() { return dayMs(); },
};

const nameOf = (id: string) => (account(id)?.username as string) ?? null;
function wrap<T>(fn: () => T): T {
  try { return tx(fn); } catch (e) {
    if (e instanceof EconomyError) throw new ApiError(e.status, e.message);
    throw e;
  }
}

export const settle = () => wrap(() => settleDue(store));
setInterval(() => { try { settle(); } catch (e) { console.error(e); } }, 15e3).unref();

export function market(viewer: string, q: { kind?: string; sort?: string; search?: string }) {
  settle();
  let list = store.activeListings();
  if (q.kind === 'auction' || q.kind === 'fixed') list = list.filter((l) => l.kind === q.kind);
  if (q.search) list = list.filter((l) => l.name.includes(q.search!.toLowerCase().replace(/^@/, '')));
  const price = (l: Listing) => (l.kind === 'fixed' ? l.price : Math.max(l.price, ...l.bids.map((b) => b.amount)));
  const sorters: Record<string, (a: Listing, b: Listing) => number> = {
    ending: (a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity),
    price_low: (a, b) => price(a) - price(b),
    price_high: (a, b) => price(b) - price(a),
    shortest: (a, b) => a.name.length - b.name.length || price(b) - price(a),
    newest: (a, b) => b.createdAt - a.createdAt,
  };
  list.sort(sorters[q.sort ?? 'newest'] ?? sorters.newest);
  const recent = all("SELECT data_json FROM listings WHERE status = 'sold' ORDER BY ends_at DESC LIMIT 10").map((r) => JSON.parse(r.data_json) as Listing);
  const mine = all("SELECT data_json FROM listings WHERE seller_id = ? ORDER BY rowid DESC LIMIT 10", viewer).map((r) => JSON.parse(r.data_json) as Listing);
  return {
    listings: list.slice(0, 100).map((l) => listingView(l, viewer, nameOf)),
    recentSales: recent.map((l) => listingView(l, viewer, nameOf)),
    mine: mine.map((l) => listingView(l, viewer, nameOf)),
  };
}

export function getListing(viewer: string, id: string) {
  settle();
  const l = store.getListing(id);
  if (!l) throw new ApiError(404, 'Listing not found.');
  return listingView(l, viewer, nameOf);
}
export const create = (viewer: string, input: ListingInput) => wrap(() => listingView(createListing(store, viewer, input), viewer, nameOf));
export const bid = (viewer: string, id: string, amount: number) => wrap(() => { settleDue(store); return listingView(placeBid(store, id, viewer, amount), viewer, nameOf); });
export const buy = (viewer: string, id: string) => wrap(() => { settleDue(store); return listingView(buyNow(store, id, viewer), viewer, nameOf); });
export const cancel = (viewer: string, id: string, byStaff = false) => wrap(() => listingView(cancelListing(store, id, viewer, byStaff), viewer, nameOf));

export function shop(a: Row) {
  const acct = store.account(a.id)!;
  return { items: COSMETICS.map((c) => ({ ...c, owned: owns(acct, c.id) })), credits: acct.credits, frame: a.frame ?? null, effect: a.effect ?? null, nameFx: a.name_fx ?? null, accessory: a.accessory ?? null };
}
export const buyItem = (a: Row, item: string) => wrap(() => { buyCosmetic(store, a.id, item); });

export function ledger(id: string) {
  return all('SELECT delta, reason, at FROM credit_ledger WHERE account_id = ? ORDER BY at DESC LIMIT 50', id);
}

/** Equip/unequip a frame or effect (must own it, staff own all). */
export function equip(a: Row, slot: CosmeticSlot, item: string | null) {
  const col = COSMETIC_SLOTS[slot];
  if (item === null || item === '') { run(`UPDATE accounts SET ${col} = NULL WHERE id = ?`, a.id); return; }
  const c = COSMETIC_BY_ID[item];
  if (!c || c.kind !== slot) throw new ApiError(400, 'Unknown item.');
  if (!owns(store.account(a.id)!, item)) throw new ApiError(403, 'Buy it in the shop first.');
  run(`UPDATE accounts SET ${col} = ? WHERE id = ?`, item, a.id);
}

/** Daily login bonus, once per calendar day. */
export function dailyBonus(a: Row, day: string) {
  if (a.last_bonus_day === day) return;
  run('UPDATE accounts SET last_bonus_day = ? WHERE id = ?', day, a.id);
  if (a.last_bonus_day) store.credit(a.id, ECONOMY.dailyBonus, 'Daily login bonus');
}
