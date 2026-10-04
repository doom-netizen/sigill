import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createListing, placeBid, buyNow, cancelListing, settleDue, buyCosmetic, owns, type EconomyStore, type EconAccount, type Listing } from './economy';

const DAY = 86_400_000;
function world() {
  const accts = new Map<string, EconAccount & { names: string[] }>();
  const add = (id: string, username: string, credits: number, ageDays = 30) =>
    accts.set(id, { id, username, credits, createdAt: Date.now() - ageDays * DAY, lastUsernameChange: null, flagged: false, banned: false, staff: false, owned: [], names: [username] });
  const listings = new Map<string, Listing>();
  const locks = new Map<string, string>();
  const ledger: string[] = [];
  let n = 0;
  const store: EconomyStore = {
    account: (id) => accts.get(id) ?? null,
    credit: (id, d, why) => { const a = accts.get(id)!; if (a.credits + d < 0) throw new Error('negative'); a.credits += d; ledger.push(`${id}:${d}:${why}`); },
    setOwned: (id, o) => { accts.get(id)!.owned = o; },
    nameFree: (name, self) => ![...accts.values()].some((a) => a.username === name && a.id !== self) && (!locks.has(name) || locks.get(name) === self),
    lockName: (name, owner) => locks.set(name, owner),
    unlockName: (name, owner) => { if (locks.get(name) === owner) locks.delete(name); },
    transferName: ({ sellerId, buyerId, name, fallback, now }) => {
      const s = accts.get(sellerId)!, b = accts.get(buyerId)!;
      locks.set(b.username, buyerId);
      b.username = name; b.lastUsernameChange = now;
      s.username = fallback; s.lastUsernameChange = now;
      locks.delete(fallback);
    },
    getListing: (id) => listings.get(id) ?? null,
    saveListing: (l) => listings.set(l.id, l),
    activeListings: () => [...listings.values()].filter((l) => l.status === 'active'),
    newId: () => `L${++n}`,
  };
  return { store, accts, add, ledger, locks };
}

test('fixed price sale swaps names, pays seller minus fee, locks names', () => {
  const { store, accts, add } = world();
  add('s', 'zed', 0); add('b', 'buyer_one', 5000);
  const l = createListing(store, 's', { kind: 'fixed', price: 1000, description: 'clean 3-letter **name**', fallback: 'zed_was_here' });
  assert.equal(l.name, 'zed');
  assert.throws(() => createListing(store, 's', { kind: 'fixed', price: 5, fallback: 'zed_again' }), /already have/);
  buyNow(store, l.id, 'b');
  assert.equal(accts.get('b')!.username, 'zed');
  assert.equal(accts.get('s')!.username, 'zed_was_here');
  assert.equal(accts.get('b')!.credits, 4000);
  assert.equal(accts.get('s')!.credits, 950, '5% fee');
  // both are in cooldown now
  add('c', 'charlie_c', 9999);
  const l2 = (() => { try { return createListing(store, 'b', { kind: 'fixed', price: 10, fallback: 'nope_name' }); } catch (e: any) { return e.message; } })();
  assert.match(String(l2), /cooldown/);
});

test('auction: escrow, outbid refunds, raising own bid, anti-snipe, settlement', () => {
  const { store, accts, add } = world();
  add('s', 'abc', 0); add('x', 'bidder_x', 2000); add('y', 'bidder_y', 2000);
  const now = Date.now();
  const l = createListing(store, 's', { kind: 'auction', price: 100, hours: 24, fallback: 'abc_sold' }, now);
  assert.throws(() => placeBid(store, l.id, 'x', 50, now), /at least 100/);
  placeBid(store, l.id, 'x', 100, now);
  assert.equal(accts.get('x')!.credits, 1900, 'bid held');
  assert.throws(() => placeBid(store, l.id, 'y', 101, now), /at least 105/);
  placeBid(store, l.id, 'y', 200, now);
  assert.equal(accts.get('x')!.credits, 2000, 'outbid refunded');
  assert.equal(accts.get('y')!.credits, 1800);
  placeBid(store, l.id, 'y', 300, now);
  assert.equal(accts.get('y')!.credits, 1700, 'raising own bid charges the difference');
  assert.throws(() => placeBid(store, l.id, 's', 1000, now), /own name/);
  // snipe in last minute extends
  const late = l.endsAt! - 30e3;
  placeBid(store, l.id, 'x', 400, late);
  assert.ok(store.getListing(l.id)!.endsAt! >= late + 120e3 - 1);
  assert.equal(accts.get('y')!.credits, 2000);
  settleDue(store, store.getListing(l.id)!.endsAt! + 1);
  assert.equal(accts.get('x')!.username, 'abc');
  assert.equal(accts.get('s')!.username, 'abc_sold');
  assert.equal(accts.get('s')!.credits, 380);
  assert.equal(store.getListing(l.id)!.status, 'sold');
});

test('eligibility: new accounts cannot buy short names; insufficient credits; buy-now on auctions', () => {
  const { store, accts, add } = world();
  add('s', 'q', 0); add('new', 'newbie_acct', 99999, 1); add('poor', 'poor_acct', 10); add('rich', 'rich_acct', 99999);
  const l = createListing(store, 's', { kind: 'auction', price: 500, buyNow: 5000, hours: 24, fallback: 'q_retired' });
  assert.throws(() => placeBid(store, l.id, 'new', 600), /7 days old/);
  assert.throws(() => placeBid(store, l.id, 'poor', 500), /You need 500/);
  placeBid(store, l.id, 'rich', 600);
  buyNow(store, l.id, 'rich');
  assert.equal(accts.get('rich')!.username, 'q');
  assert.equal(accts.get('rich')!.credits, 99999 - 5000, 'bid refunded, buy-now charged');
});

test('cancel rules, expiry, replacement-name checks', () => {
  const { store, accts, add, locks } = world();
  add('s', 'seller_one', 0); add('t', 'taken_name', 0); add('b', 'buyer_b', 5000);
  assert.throws(() => createListing(store, 's', { kind: 'fixed', price: 100, fallback: 'taken_name' }), /taken/);
  assert.throws(() => createListing(store, 's', { kind: 'fixed', price: 100, fallback: 'abc' }), /5 or more/);
  assert.throws(() => createListing(store, 's', { kind: 'fixed', price: 100, fallback: 'admin_two' }), /unavailable/);
  const l = createListing(store, 's', { kind: 'auction', price: 100, hours: 1, fallback: 'seller_next' });
  assert.equal(locks.get('seller_next'), 's', 'replacement name reserved');
  placeBid(store, l.id, 'b', 100);
  assert.throws(() => cancelListing(store, l.id, 's'), /with bids/);
  cancelListing(store, l.id, 'staff', true);
  assert.equal(accts.get('b')!.credits, 5000, 'staff removal refunds');
  assert.ok(!locks.has('seller_next'), 'reservation released');
  const l2 = createListing(store, 's', { kind: 'auction', price: 100, hours: 1, fallback: 'seller_next' });
  settleDue(store, l2.endsAt! + 1);
  assert.equal(store.getListing(l2.id)!.status, 'expired');
  assert.equal(accts.get('s')!.username, 'seller_one');
});

test('shop: buy, already owned, staff own everything, staff-only items', () => {
  const { store, accts, add } = world();
  add('u', 'user_u', 500);
  buyCosmetic(store, 'u', 'frame_pulse');
  assert.equal(accts.get('u')!.credits, 250);
  assert.throws(() => buyCosmetic(store, 'u', 'frame_pulse'), /already own/);
  assert.throws(() => buyCosmetic(store, 'u', 'fx_void'), /You need 3,000/);
  assert.throws(() => buyCosmetic(store, 'u', 'frame_staff'), /staff/);
  assert.ok(owns({ owned: [], staff: true }, 'frame_staff'));
});
