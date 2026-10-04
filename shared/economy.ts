// Credits, the cosmetics shop, staff titles, and the username marketplace.
// One rules engine for the real server and the demo; each plugs in storage
// through the EconomyStore interface.
//
// Credits are an in-app currency. There is no real money in this code: cash
// payments need a payment provider plus legal/tax setup.

import { cleanText } from './markdown';
import { checkUsername, canonicalize, isSlur, USERNAME_CHANGE_COOLDOWN_DAYS, OLD_NAME_LOCK_DAYS } from './usernames';

const DAY = 86_400_000;

// ============================================================ cosmetics
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'staff';
export type CosmeticKind = 'frame' | 'effect' | 'nameFx' | 'accessory';
export interface Cosmetic { id: string; kind: CosmeticKind; name: string; description: string; price: number; rarity: Rarity; staffOnly?: boolean; isNew?: boolean }
/** Equip slots: profile field -> database column. */
export const COSMETIC_SLOTS = { frame: 'frame', effect: 'effect', nameFx: 'name_fx', accessory: 'accessory' } as const;
export type CosmeticSlot = keyof typeof COSMETIC_SLOTS;
export const KIND_LABEL: Record<CosmeticKind, string> = { frame: 'Avatar frames', effect: 'Profile themes', nameFx: 'Name effects', accessory: 'Accessories' };

export const COSMETICS: Cosmetic[] = [
  // Animated avatar frames
  { id: 'frame_pulse', kind: 'frame', name: 'Pulse', description: 'A soft ring that breathes in your accent color.', price: 250, rarity: 'common' },
  { id: 'frame_orbit', kind: 'frame', name: 'Orbit', description: 'Two moons circling your avatar.', price: 400, rarity: 'common' },
  { id: 'frame_halo', kind: 'frame', name: 'Halo', description: 'A floating ring of light above your head.', price: 600, rarity: 'rare' },
  { id: 'frame_aurora', kind: 'frame', name: 'Aurora', description: 'A slow-spinning ring of northern-light colors.', price: 900, rarity: 'rare' },
  { id: 'frame_neon', kind: 'frame', name: 'Neon Sign', description: 'A flickering neon tube, slightly unreliable.', price: 1200, rarity: 'epic' },
  { id: 'frame_ember', kind: 'frame', name: 'Ember', description: 'Heat shimmering off a ring of fire.', price: 1500, rarity: 'epic' },
  { id: 'frame_prism', kind: 'frame', name: 'Prism', description: 'Light split into every color, always moving.', price: 2500, rarity: 'legendary' },
  { id: 'frame_staff', kind: 'frame', name: 'Sigil Staff', description: 'Staff only. A rotating seal in staff violet.', price: 0, rarity: 'staff', staffOnly: true },
  // Animated profile themes (card effects)
  { id: 'fx_starfield', kind: 'effect', name: 'Starfield', description: 'Stars twinkling behind your profile.', price: 300, rarity: 'common' },
  { id: 'fx_snow', kind: 'effect', name: 'Snowfall', description: 'Quiet snow drifting down your card.', price: 350, rarity: 'common' },
  { id: 'fx_aurora', kind: 'effect', name: 'Aurora Sky', description: 'Slow ribbons of green and violet light.', price: 700, rarity: 'rare' },
  { id: 'fx_waves', kind: 'effect', name: 'Tide', description: 'Layered waves rolling under your bio.', price: 700, rarity: 'rare' },
  { id: 'fx_embers', kind: 'effect', name: 'Embers', description: 'Sparks rising from the bottom of your card.', price: 1100, rarity: 'epic' },
  { id: 'fx_holo', kind: 'effect', name: 'Holo Foil', description: 'A holographic sheen that sweeps across, like a rare trading card.', price: 1800, rarity: 'epic' },
  { id: 'fx_void', kind: 'effect', name: 'Event Horizon', description: 'A slow black-hole swirl. Best on pitch black.', price: 3000, rarity: 'legendary' },
  { id: 'fx_staff', kind: 'effect', name: 'Staff Grid', description: 'Staff only. A drifting violet blueprint grid.', price: 0, rarity: 'staff', staffOnly: true },
  // Drop 2: more frames
  { id: 'frame_glitch', kind: 'frame', name: 'Glitch', description: 'A ring that skips and tears like a bad signal.', price: 800, rarity: 'rare', isNew: true },
  { id: 'frame_sakura', kind: 'frame', name: 'Sakura', description: 'Cherry blossom petals drifting around you.', price: 1000, rarity: 'epic', isNew: true },
  { id: 'frame_circuit', kind: 'frame', name: 'Circuit', description: 'Pulses running along a printed circuit trace.', price: 700, rarity: 'rare', isNew: true },
  { id: 'frame_vinyl', kind: 'frame', name: 'Vinyl', description: 'A spinning record with your avatar as the label.', price: 500, rarity: 'common', isNew: true },
  { id: 'frame_storm', kind: 'frame', name: 'Storm', description: 'Lightning crackling around the edge.', price: 1800, rarity: 'epic', isNew: true },
  { id: 'frame_galaxy', kind: 'frame', name: 'Galaxy', description: 'A spiral galaxy turning slowly behind your avatar.', price: 3200, rarity: 'legendary', isNew: true },
  // Drop 2: more profile themes
  { id: 'fx_rain', kind: 'effect', name: 'Night Rain', description: 'Rain streaking down a dark window.', price: 400, rarity: 'common', isNew: true },
  { id: 'fx_matrix', kind: 'effect', name: 'Code Rain', description: 'Falling green glyphs. You know the one.', price: 900, rarity: 'rare', isNew: true },
  { id: 'fx_sakura', kind: 'effect', name: 'Petals', description: 'Blossoms drifting across your card.', price: 900, rarity: 'rare', isNew: true },
  { id: 'fx_bubbles', kind: 'effect', name: 'Bubbles', description: 'Soft bubbles rising and popping.', price: 450, rarity: 'common', isNew: true },
  { id: 'fx_lava', kind: 'effect', name: 'Lava Lamp', description: 'Slow, warm blobs that merge and split.', price: 1400, rarity: 'epic', isNew: true },
  { id: 'fx_constellation', kind: 'effect', name: 'Constellations', description: 'Stars joined by faint lines that slowly redraw.', price: 2600, rarity: 'legendary', isNew: true },
  // Name effects (applied to your @username)
  { id: 'name_rainbow', kind: 'nameFx', name: 'Rainbow', description: 'Every color, flowing through your name.', price: 600, rarity: 'rare', isNew: true },
  { id: 'name_neon', kind: 'nameFx', name: 'Neon', description: 'Your name as a glowing neon sign.', price: 500, rarity: 'common', isNew: true },
  { id: 'name_fire', kind: 'nameFx', name: 'Inferno', description: 'Flames licking up through the letters.', price: 1200, rarity: 'epic', isNew: true },
  { id: 'name_glitch', kind: 'nameFx', name: 'Glitch', description: 'Red and cyan ghosts that tear every few seconds.', price: 900, rarity: 'rare', isNew: true },
  { id: 'name_chrome', kind: 'nameFx', name: 'Chrome', description: 'Polished metal with a light sweep.', price: 1500, rarity: 'epic', isNew: true },
  { id: 'name_frost', kind: 'nameFx', name: 'Frost', description: 'Icy blue with a cold shimmer.', price: 700, rarity: 'rare', isNew: true },
  { id: 'name_gold', kind: 'nameFx', name: '24 Karat', description: 'Solid gold lettering that catches the light.', price: 3000, rarity: 'legendary', isNew: true },
  { id: 'name_staff', kind: 'nameFx', name: 'Staff Signal', description: 'Staff only. A violet scanline over your name.', price: 0, rarity: 'staff', staffOnly: true },
  // Accessories (worn on your avatar)
  { id: 'acc_crown', kind: 'accessory', name: 'Crown', description: 'A small gold crown, slightly tilted.', price: 1500, rarity: 'epic', isNew: true },
  { id: 'acc_cat_ears', kind: 'accessory', name: 'Cat Ears', description: 'Two pointed ears. Purring not included.', price: 400, rarity: 'common', isNew: true },
  { id: 'acc_headphones', kind: 'accessory', name: 'Headphones', description: 'Over-ear headphones in your accent color.', price: 500, rarity: 'common', isNew: true },
  { id: 'acc_halo', kind: 'accessory', name: 'Angel Halo', description: 'A glowing ring floating over your head.', price: 800, rarity: 'rare', isNew: true },
  { id: 'acc_horns', kind: 'accessory', name: 'Horns', description: 'Little devil horns.', price: 800, rarity: 'rare', isNew: true },
  { id: 'acc_party', kind: 'accessory', name: 'Party Hat', description: 'For every day that is somebody\'s birthday.', price: 300, rarity: 'common', isNew: true },
  { id: 'acc_flower', kind: 'accessory', name: 'Flower Clip', description: 'A blossom tucked behind one ear.', price: 350, rarity: 'common', isNew: true },
  { id: 'acc_shades', kind: 'accessory', name: 'Pixel Shades', description: 'Deal with it.', price: 900, rarity: 'rare', isNew: true },
  { id: 'acc_bunny', kind: 'accessory', name: 'Bunny Ears', description: 'Tall, floppy, one bent over.', price: 450, rarity: 'common', isNew: true },
  { id: 'acc_staff', kind: 'accessory', name: 'Staff Pin', description: 'Staff only. The Sigil seal, pinned to your avatar.', price: 0, rarity: 'staff', staffOnly: true },
];
export const COSMETIC_BY_ID: Record<string, Cosmetic> = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));
export const RARITY_TONE: Record<Rarity, string> = { common: '#b9c2d0', rare: '#5ee7ff', epic: '#c084fc', legendary: '#ffd25e', staff: '#8b7cff' };

// ================================================================ titles
// Platform-wide roles staff can give people. Shown as chips on profiles.
export interface Title { name: string; color: string }
export const TITLE_PRESETS: Title[] = [
  { name: 'VIP', color: '#ffd25e' }, { name: 'Moderator', color: '#5ee7ff' }, { name: 'Helper', color: '#4ade80' },
  { name: 'Tester', color: '#f59e0b' }, { name: 'Artist', color: '#ff8ad8' }, { name: 'Creator', color: '#a970ff' },
  { name: 'OG', color: '#f5f5f5' }, { name: 'Legend', color: '#ff6a3d' },
];
export const MAX_TITLES = 3;
export function cleanTitle(t: unknown): Title {
  const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
  const name = cleanText(String(o.name ?? ''), 20).replace(/\s+/g, ' ').trim();
  if (!name) throw new EconomyError(400, 'Give the title a name.');
  if (isSlur(name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'x')) throw new EconomyError(400, "That title isn't allowed.");
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : '#b9b6c8';
  return { name, color };
}

// ============================================================== economy
export const ECONOMY = {
  startingCredits: 1000,
  dailyBonus: 50,
  marketFeePct: 5,
  minPrice: 10,
  maxPrice: 10_000_000,
  minIncrementPct: 5,
  auctionHours: [1, 6, 24, 72, 168],
  shortNameMinAgeDays: 7,
  maxActiveListingsPerAccount: 1, // you can only sell the name you hold
};

export class EconomyError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (s: number, m: string): never => { throw new EconomyError(s, m); };

export interface Bid { bidderId: string; amount: number; at: number }
export interface Listing {
  id: string;
  name: string;            // the username being sold
  sellerId: string;
  kind: 'fixed' | 'auction';
  price: number;           // fixed price, or starting bid
  buyNow: number | null;   // optional instant price on auctions
  endsAt: number | null;   // auctions
  description: string;
  fallback: string;        // the seller's new username when it sells
  status: 'active' | 'sold' | 'cancelled' | 'expired' | 'removed';
  createdAt: number;
  bids: Bid[];
  buyerId: string | null;
  soldPrice: number | null;
  closedAt: number | null;
}

export interface EconAccount {
  id: string; username: string; credits: number; createdAt: number; lastUsernameChange: number | null;
  flagged: boolean; banned: boolean; staff: boolean; owned: string[];
}

/** Storage the engine needs. Each host (server, demo) implements this. */
export interface EconomyStore {
  account(id: string): EconAccount | null;
  /** add (or subtract) credits and record why; must never go below zero */
  credit(id: string, delta: number, reason: string): void;
  setOwned(id: string, owned: string[]): void;
  /** is `name` free for `selfId` (not taken, not locked by someone else, no open claim) */
  nameFree(name: string, selfId: string): boolean;
  lockName(name: string, ownerId: string, until: number): void;
  unlockName(name: string, ownerId: string): void;
  /** atomic username swap for a completed sale */
  transferName(sale: { sellerId: string; buyerId: string; name: string; fallback: string; now: number }): void;
  getListing(id: string): Listing | null;
  saveListing(l: Listing): void;
  activeListings(): Listing[];
  newId(): string;
  /** length of a day in ms (tests run on a fast clock) */
  dayMs?: number;
}

export const highestBid = (l: Listing): Bid | null => (l.bids.length ? l.bids.reduce((a, b) => (b.amount > a.amount ? b : a)) : null);
export const minNextBid = (l: Listing) => {
  const h = highestBid(l);
  return h ? h.amount + Math.max(1, Math.ceil((h.amount * ECONOMY.minIncrementPct) / 100)) : l.price;
};
const dayOf = (s: EconomyStore) => s.dayMs ?? DAY;
const cooldownOver = (s: EconomyStore, a: EconAccount, now: number) => !a.lastUsernameChange || a.lastUsernameChange + USERNAME_CHANGE_COOLDOWN_DAYS * dayOf(s) <= now;

function assertBuyer(store: EconomyStore, l: Listing, buyerId: string, now: number) {
  const b = store.account(buyerId) ?? fail(404, 'Account not found.');
  if (b.banned) fail(403, 'Suspended accounts can\'t buy.');
  if (buyerId === l.sellerId) fail(400, "You can't buy your own name.");
  if (!cooldownOver(store, b, now)) fail(403, `You changed your username recently. Buying counts as a change, so wait out the ${USERNAME_CHANGE_COOLDOWN_DAYS}-day cooldown.`);
  if (l.name.length <= 4) {
    if ((now - b.createdAt) / dayOf(store) < ECONOMY.shortNameMinAgeDays) fail(403, `Accounts need to be ${ECONOMY.shortNameMinAgeDays} days old to buy names of 4 characters or fewer.`);
    if (b.flagged) fail(403, "Accounts from flagged networks can't buy short names.");
  }
  return b;
}

// ---------------------------------------------------------------- listings
export interface ListingInput { kind: 'fixed' | 'auction'; price: number; buyNow?: number | null; hours?: number; description?: string; fallback: string }

export function createListing(store: EconomyStore, sellerId: string, input: ListingInput, now = Date.now()): Listing {
  const s = store.account(sellerId) ?? fail(404, 'Account not found.');
  if (s.banned) fail(403, 'Suspended accounts can\'t sell.');
  if (store.activeListings().some((l) => l.sellerId === sellerId)) fail(400, 'You already have an active listing.');
  if (!cooldownOver(store, s, now)) fail(403, `You changed your username recently. Selling counts as a change, so wait out the ${USERNAME_CHANGE_COOLDOWN_DAYS}-day cooldown.`);
  const price = Math.floor(Number(input.price));
  if (!Number.isFinite(price) || price < ECONOMY.minPrice || price > ECONOMY.maxPrice) fail(400, `Price must be between ${ECONOMY.minPrice} and ${ECONOMY.maxPrice.toLocaleString()} credits.`);
  const kind = input.kind === 'auction' ? 'auction' : 'fixed';
  let buyNow: number | null = null;
  if (kind === 'auction' && input.buyNow) {
    buyNow = Math.floor(Number(input.buyNow));
    if (!Number.isFinite(buyNow) || buyNow <= price || buyNow > ECONOMY.maxPrice) fail(400, 'Buy-now price must be higher than the starting bid.');
  }
  const hours = kind === 'auction' ? (ECONOMY.auctionHours.includes(Number(input.hours)) ? Number(input.hours) : 24) : null;
  const fb = checkUsername(String(input.fallback ?? ''));
  if (!fb.ok) fail(400, `Replacement name: ${fb.message}`);
  if (fb.name.length < 5) fail(400, 'Your replacement name needs 5 or more characters.');
  if (fb.name === s.username) fail(400, 'Pick a different replacement name.');
  if (!store.nameFree(fb.name, sellerId)) fail(409, 'That replacement name is taken.');
  const l: Listing = {
    id: store.newId(), name: s.username, sellerId, kind, price, buyNow, endsAt: hours ? now + hours * 3600e3 : null,
    description: cleanText(String(input.description ?? ''), 500), fallback: fb.name, status: 'active', createdAt: now,
    bids: [], buyerId: null, soldPrice: null, closedAt: null,
  };
  store.lockName(fb.name, sellerId, (l.endsAt ?? now + 30 * DAY) + DAY);
  store.saveListing(l);
  return l;
}

function close(store: EconomyStore, l: Listing, status: Listing['status'], now: number) {
  l.status = status;
  l.closedAt = now;
  if (status !== 'sold') store.unlockName(l.fallback, l.sellerId);
  store.saveListing(l);
}

function refundHighest(store: EconomyStore, l: Listing, except?: string) {
  const h = highestBid(l);
  if (h && h.bidderId !== except) store.credit(h.bidderId, h.amount, `Refund: outbid or closed on @${l.name}`);
}

function settle(store: EconomyStore, l: Listing, buyerId: string, price: number, now: number) {
  const fee = Math.floor((price * ECONOMY.marketFeePct) / 100);
  store.transferName({ sellerId: l.sellerId, buyerId, name: l.name, fallback: l.fallback, now });
  store.credit(l.sellerId, price - fee, `Sold @${l.name} (${ECONOMY.marketFeePct}% fee: ${fee})`);
  l.buyerId = buyerId;
  l.soldPrice = price;
  close(store, l, 'sold', now);
}

export function placeBid(store: EconomyStore, listingId: string, bidderId: string, amount: number, now = Date.now()): Listing {
  const l = store.getListing(listingId) ?? fail(404, 'Listing not found.');
  if (l.status !== 'active' || l.kind !== 'auction' || (l.endsAt ?? 0) <= now) fail(400, 'This auction has ended.');
  const b = assertBuyer(store, l, bidderId, now);
  const amt = Math.floor(Number(amount));
  const min = minNextBid(l);
  if (!Number.isFinite(amt) || amt < min) fail(400, `Bid at least ${min.toLocaleString()} credits.`);
  const prev = highestBid(l);
  const held = prev?.bidderId === bidderId ? prev.amount : 0; // raising your own bid only charges the difference
  if (b.credits + held < amt) fail(402, `You need ${amt.toLocaleString()} credits; you have ${(b.credits + held).toLocaleString()}.`);
  if (held) store.credit(bidderId, held, `Bid raised on @${l.name}`);
  else refundHighest(store, l);
  store.credit(bidderId, -amt, `Bid held on @${l.name}`);
  l.bids.push({ bidderId, amount: amt, at: now });
  // anti-sniping: a bid in the last 2 minutes extends the auction by 2 minutes
  if (l.endsAt && l.endsAt - now < 120e3) l.endsAt = now + 120e3;
  if (l.buyNow && amt >= l.buyNow) { settle(store, l, bidderId, amt, now); return l; }
  store.saveListing(l);
  return l;
}

export function buyNow(store: EconomyStore, listingId: string, buyerId: string, now = Date.now()): Listing {
  const l = store.getListing(listingId) ?? fail(404, 'Listing not found.');
  if (l.status !== 'active' || (l.endsAt && l.endsAt <= now)) fail(400, 'This listing is closed.');
  const price = l.kind === 'fixed' ? l.price : l.buyNow ?? fail(400, 'This auction has no buy-now price.');
  const b = assertBuyer(store, l, buyerId, now);
  const prev = highestBid(l);
  const held = prev?.bidderId === buyerId ? prev.amount : 0;
  if (b.credits + held < price) fail(402, `You need ${price.toLocaleString()} credits; you have ${(b.credits + held).toLocaleString()}.`);
  refundHighest(store, l);
  store.credit(buyerId, -price, `Bought @${l.name}`);
  settle(store, l, buyerId, price, now);
  return l;
}

export function cancelListing(store: EconomyStore, listingId: string, actorId: string, byStaff = false, now = Date.now()): Listing {
  const l = store.getListing(listingId) ?? fail(404, 'Listing not found.');
  if (l.status !== 'active') fail(400, 'This listing is already closed.');
  if (!byStaff && l.sellerId !== actorId) fail(403, 'Only the seller can cancel this.');
  if (!byStaff && l.bids.length) fail(400, "Auctions with bids can't be cancelled.");
  refundHighest(store, l);
  close(store, l, byStaff ? 'removed' : 'cancelled', now);
  return l;
}

/** Close auctions whose time ran out. Call before reads and on a timer. */
export function settleDue(store: EconomyStore, now = Date.now()) {
  for (const l of store.activeListings()) {
    if (!l.endsAt || l.endsAt > now) continue;
    const seller = store.account(l.sellerId);
    const h = highestBid(l);
    if (!seller || seller.banned || seller.username !== l.name) { refundHighest(store, l); close(store, l, 'removed', now); continue; }
    if (h) settle(store, l, h.bidderId, h.amount, now);
    else close(store, l, 'expired', now);
  }
}

// -------------------------------------------------------------------- shop
export function buyCosmetic(store: EconomyStore, accountId: string, itemId: string) {
  const a = store.account(accountId) ?? fail(404, 'Account not found.');
  const item = COSMETIC_BY_ID[itemId] ?? fail(404, 'No such item.');
  if (item.staffOnly) fail(403, 'That one is for staff.');
  if (a.owned.includes(itemId) || a.staff) fail(400, 'You already own this.');
  if (a.credits < item.price) fail(402, `You need ${item.price.toLocaleString()} credits; you have ${a.credits.toLocaleString()}.`);
  store.credit(accountId, -item.price, `Bought ${item.name}`);
  store.setOwned(accountId, [...a.owned, itemId]);
}

/** Staff own every cosmetic, including staff-only ones. */
export const owns = (a: Pick<EconAccount, 'owned' | 'staff'>, itemId: string) => a.staff || a.owned.includes(itemId);

// ------------------------------------------------------------------- views
export interface ListingView extends Omit<Listing, 'bids' | 'sellerId' | 'buyerId'> {
  seller: { id: string; username: string } | null;
  buyer: string | null;
  bids: { bidder: string; amount: number; at: number }[];
  highest: number | null;
  minBid: number;
  bidCount: number;
  mine: boolean;
  leading: boolean;
}

export function listingView(l: Listing, viewer: string | null, nameOf: (id: string) => string | null): ListingView {
  const h = highestBid(l);
  const { bids, sellerId, buyerId, ...rest } = l;
  return {
    ...rest,
    seller: { id: sellerId, username: nameOf(sellerId) ?? 'deleted' },
    buyer: buyerId ? nameOf(buyerId) : null,
    bids: [...bids].sort((a, b) => b.amount - a.amount).slice(0, 20).map((b) => ({ bidder: nameOf(b.bidderId) ?? 'deleted', amount: b.amount, at: b.at })),
    highest: h?.amount ?? null,
    minBid: minNextBid(l),
    bidCount: bids.length,
    mine: viewer === sellerId,
    leading: !!viewer && h?.bidderId === viewer,
  };
}

export { canonicalize, OLD_NAME_LOCK_DAYS };
