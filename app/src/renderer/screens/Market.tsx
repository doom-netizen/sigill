import { useCallback, useEffect, useState } from 'react';
import { call, type AppState } from '../api';
import { useAction, Modal, Empty, Segmented, Icon, countdown, timeAgo, useNow } from '../components/ui';
import { Handle } from '../components/ProfileCard';
import { FramePreview } from '../components/Cosmetics';
import { renderBio } from '../../../../shared/markdown';
import { checkUsername } from '../../../../shared/usernames';
import { ECONOMY, RARITY_TONE, KIND_LABEL, type Cosmetic, type CosmeticKind, type ListingView } from '../../../../shared/economy';

const cr = (n: number) => n.toLocaleString();
export function Credits({ n, big }: { n: number; big?: boolean }) {
  return <span className={`credits ${big ? 'big' : ''}`}><i aria-hidden="true">◈</i>{cr(n)}<span className="sr"> credits</span></span>;
}

export function Market({ state }: { state: AppState }) {
  const [tab, setTab] = useState<'shop' | 'names' | 'wallet'>('shop');
  const me = state.me!;
  return (
    <div className="page market wide">
      <header className="page-head market-head">
        <div>
          <h1>Marketplace</h1>
          <p>Spend credits on animated frames and profile themes, or buy and sell usernames.</p>
        </div>
        <div className="wallet-chip" title="Your balance"><Credits n={me.credits} big /></div>
      </header>
      <div className="tabs" role="tablist">
        {([['shop', 'Shop'], ['names', 'Usernames'], ['wallet', 'Wallet']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'shop' && <Shop state={state} />}
      {tab === 'names' && <Names state={state} />}
      {tab === 'wallet' && <Wallet state={state} />}
    </div>
  );
}

// -------------------------------------------------------------------- shop
function Shop({ state }: { state: AppState }) {
  const me = state.me!;
  const [items, setItems] = useState<(Cosmetic & { owned: boolean })[] | null>(null);
  const [kind, setKind] = useState<CosmeticKind>('frame');
  const [confirm, setConfirm] = useState<Cosmetic | null>(null);
  const { busy, run } = useAction();
  const load = useCallback(() => run(() => call('shop')).then((r: any) => r && setItems(r.items)), [run]);
  useEffect(() => { load(); }, [load, me.credits]);
  if (!items) return <Empty title="Loading the shop" />;
  const list = items.filter((i) => i.kind === kind && (!i.staffOnly || i.owned));
  const equipped = me[kind];
  const kinds = Object.keys(KIND_LABEL) as CosmeticKind[];
  const fresh = (k: CosmeticKind) => items.some((i) => i.kind === k && i.isNew && !i.owned);
  const equip = (id: string | null) => run(() => call('updateProfile', { [kind]: id }), id ? 'Equipped' : 'Unequipped');

  return (
    <>
      <div className="shop-bar">
        <div className="chip-tabs" role="tablist" aria-label="Category">
          {kinds.map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}{fresh(k) && <i className="new-dot" aria-label="New items" />}
            </button>
          ))}
        </div>
        {equipped && <button className="btn ghost sm" onClick={() => equip(null)}>Take off</button>}
      </div>
      {state.platform.shopPaused && !me.roles.includes('staff') && <p className="perk-note warn"><Icon name="info" size={14} />The shop is paused by staff for a moment. You can still equip what you own.</p>}
      {me.marketBanned && <p className="perk-note warn"><Icon name="ban" size={14} />Staff removed your shop and marketplace access. You can still wear what you own.</p>}
      {me.roles.includes('staff') && <p className="perk-note"><Icon name="shield" size={14} />Staff perk: you own every item, including staff-only ones.</p>}
      <div className="shop-grid">
        {list.map((it) => (
          <article key={it.id} className={`shop-item ${it.owned ? 'owned' : ''} ${equipped === it.id ? 'equipped' : ''}`} style={{ ['--rt' as any]: RARITY_TONE[it.rarity] }}>
            <FramePreview me={me} kind={it.kind} id={it.id} />
            <div className="shop-info">
              <span className="rarity">{it.rarity === 'staff' ? 'Staff only' : it.rarity[0].toUpperCase() + it.rarity.slice(1)}{it.isNew && !it.owned && <span className="new-chip">New</span>}</span>
              <h3>{it.name}</h3>
              <p>{it.description}</p>
            </div>
            <div className="shop-actions">
              {it.owned ? (
                equipped === it.id
                  ? <span className="equipped-tag"><Icon name="check" size={14} />Equipped</span>
                  : <button className="btn sm" disabled={busy} onClick={() => equip(it.id)}>Equip</button>
              ) : (
                <button className="btn primary sm" disabled={busy || me.credits < it.price || me.marketBanned || (state.platform.shopPaused && !me.roles.includes('staff'))} onClick={() => setConfirm(it)}>
                  <Credits n={it.price} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {confirm && (
        <Modal title={`Buy ${confirm.name}?`} onClose={() => setConfirm(null)}>
          <div className="buy-preview"><FramePreview me={me} kind={confirm.kind} id={confirm.id} large /></div>
          <p className="muted">{confirm.description} You'll have <b><Credits n={me.credits - confirm.price} /></b> left.</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={async () => {
              if (await run(() => call('shopBuy', confirm.id), `${confirm.name} is yours`)) {
                await run(() => call('updateProfile', { [confirm.kind]: confirm.id }));
                setConfirm(null); load();
              }
            }}>Buy and equip</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// --------------------------------------------------------------- usernames
function Names({ state }: { state: AppState }) {
  const me = state.me!;
  const [data, setData] = useState<{ listings: ListingView[]; recentSales: ListingView[]; mine: ListingView[] } | null>(null);
  const [kind, setKind] = useState<'' | 'auction' | 'fixed'>('');
  const [sort, setSort] = useState('newest');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const { run } = useAction();
  useNow(1000);
  const load = useCallback(() => run(() => call('market', { kind, sort, q })).then((r: any) => r && setData(r)), [run, kind, sort, q]);
  useEffect(() => { const t = setTimeout(load, 150); const i = setInterval(load, 10_000); return () => { clearTimeout(t); clearInterval(i); }; }, [load]);
  const active = data?.mine.find((l) => l.status === 'active');

  return (
    <>
      {state.platform.marketPaused && !me.roles.includes('staff') && <p className="perk-note warn"><Icon name="info" size={14} />The marketplace is paused for maintenance. Your listings and bids are safe; buying and bidding are off for now.</p>}
      <div className="names-bar">
        <div className="at-input inline"><b>@</b><input value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} placeholder="search names" aria-label="Search listings" /></div>
        <select value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Listing type"><option value="">All listings</option><option value="auction">Auctions</option><option value="fixed">Buy now</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="newest">Newest</option><option value="ending">Ending soon</option><option value="shortest">Shortest names</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option></select>
        {active ? <button className="btn" onClick={() => setOpen(active.id)}>Your listing: @{active.name}</button>
          : <button className="btn primary" onClick={() => setSelling(true)}>Sell @{me.username}</button>}
      </div>
      {!data ? <Empty title="Loading listings" /> : data.listings.length === 0 ? (
        <Empty title="Nothing for sale yet">{q ? 'No listings match that search.' : 'Be the first: list your username and set a price or start an auction.'}</Empty>
      ) : (
        <div className="listing-grid">
          {data.listings.map((l) => <ListingCard key={l.id} l={l} onOpen={() => setOpen(l.id)} />)}
        </div>
      )}
      {data && data.recentSales.length > 0 && (
        <section className="card-section recent-sales">
          <h3>Recent sales</h3>
          <ul>{data.recentSales.map((l) => <li key={l.id}><span className="rs-name" data-len={l.name.length}>@{l.name}</span><span>sold to @{l.buyer} for <Credits n={l.soldPrice ?? 0} /></span><time>{timeAgo(l.closedAt ?? l.createdAt)}</time></li>)}</ul>
        </section>
      )}
      {open && <ListingModal id={open} me={me} onClose={() => { setOpen(null); load(); }} />}
      {selling && <SellModal me={me} onClose={() => { setSelling(false); load(); }} />}
    </>
  );
}

function priceOf(l: ListingView) { return l.kind === 'fixed' ? l.price : l.highest ?? l.price; }

function ListingCard({ l, onOpen }: { l: ListingView; onOpen: () => void }) {
  return (
    <button className={`listing ${l.kind}`} onClick={onOpen}>
      <span className="listing-name" data-len={Math.min(l.name.length, 9)}><span className="at">@</span>{l.name}</span>
      <span className="listing-meta">
        <span className="kind-chip">{l.kind === 'auction' ? 'Auction' : 'Buy now'}</span>
        {l.mine && <span className="kind-chip mine">Yours</span>}
        {l.leading && <span className="kind-chip lead">You're winning</span>}
      </span>
      <span className="listing-price">
        <small>{l.kind === 'auction' ? (l.highest ? `Top bid, ${l.bidCount} bid${l.bidCount === 1 ? '' : 's'}` : 'Starting bid') : 'Price'}</small>
        <Credits n={priceOf(l)} />
      </span>
      {l.endsAt && <span className="listing-ends"><Icon name="timer" size={13} />{countdown(l.endsAt)}</span>}
      <span className="listing-seller">by @{l.seller?.username}</span>
    </button>
  );
}

function ListingModal({ id, me, onClose }: { id: string; me: AppState['me'] & {}; onClose: () => void }) {
  const [l, setL] = useState<ListingView | null>(null);
  const [amount, setAmount] = useState('');
  const { busy, run } = useAction();
  useNow(1000);
  const load = useCallback(() => run(() => call<ListingView>('marketGet', id)).then((r) => { if (r) { setL(r); setAmount(String(r.minBid)); } }), [id, run]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  if (!l) return <Modal title="Listing" onClose={onClose}><Empty title="Loading" /></Modal>;
  const closed = l.status !== 'active';
  const buyPrice = l.kind === 'fixed' ? l.price : l.buyNow;
  return (
    <Modal title={l.kind === 'auction' ? 'Auction' : 'For sale'} onClose={onClose} wide>
      <div className="listing-detail">
        <div className="ld-hero">
          <span className="listing-name" data-len={Math.min(l.name.length, 9)}><span className="at">@</span>{l.name}</span>
          <span className="muted small">Listed by <Handle name={l.seller?.username ?? '?'} /> {timeAgo(l.createdAt)}{l.name.length <= 2 ? ', comes with the ' + (l.name.length === 1 ? '1-Letter' : '2-Letter') + ' badge' : ''}</span>
        </div>
        {l.description && <div className="ld-desc pc-bio" dangerouslySetInnerHTML={{ __html: renderBio(l.description) }} />}
        <div className="ld-stats">
          <div><small>{l.kind === 'auction' ? (l.highest ? 'Top bid' : 'Starting bid') : 'Price'}</small><Credits n={priceOf(l)} big /></div>
          {l.buyNow && l.kind === 'auction' && <div><small>Buy now</small><Credits n={l.buyNow} big /></div>}
          {l.endsAt && <div><small>{closed ? 'Ended' : 'Ends in'}</small><b>{closed ? timeAgo(l.closedAt ?? l.endsAt) : countdown(l.endsAt)}</b></div>}
          <div><small>Your balance</small><Credits n={me.credits} big /></div>
        </div>
        {closed ? (
          <p className="ld-closed">{l.status === 'sold' ? <>Sold to @{l.buyer} for <Credits n={l.soldPrice ?? 0} />.</> : l.status === 'expired' ? 'Ended with no bids.' : 'This listing was taken down.'}</p>
        ) : l.mine ? (
          <div className="row">
            <p className="muted small grow">If it sells you'll become @{l.fallback} and get the price minus a {ECONOMY.marketFeePct}% fee.</p>
            {l.bidCount === 0 && <button className="btn danger ghost" disabled={busy} onClick={async () => { if (await run(() => call('marketCancel', l.id), 'Listing cancelled')) onClose(); }}>Cancel listing</button>}
          </div>
        ) : (
          <div className="ld-actions">
            {l.kind === 'auction' && (
              <form className="bid-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => call('marketBid', l.id, Number(amount)), 'Bid placed')) load(); }}>
                <label className="field"><span>Your bid (at least {cr(l.minBid)})</span>
                  <input type="number" min={l.minBid} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <button className="btn primary" type="submit" disabled={busy || Number(amount) < l.minBid}>{l.leading ? 'Raise bid' : 'Place bid'}</button>
              </form>
            )}
            {buyPrice && (
              <button className="btn" disabled={busy} onClick={async () => { if (await run(() => call('marketBuy', l.id), `@${l.name} is yours`)) onClose(); }}>
                Buy now for <Credits n={buyPrice} />
              </button>
            )}
            <p className="fine">Buying changes your username to @{l.name}. Your current name stays locked for 60 days, and the 60-day change cooldown starts. Bids are held from your balance and returned if you're outbid.</p>
          </div>
        )}
        {l.bids.length > 0 && (
          <div className="bid-list">
            <h4>Bids</h4>
            <ul>{l.bids.map((b, i) => <li key={i}><Handle name={b.bidder} /><Credits n={b.amount} /><time>{timeAgo(b.at)}</time></li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SellModal({ me, onClose }: { me: AppState['me'] & {}; onClose: () => void }) {
  const [f, setF] = useState({ kind: 'auction' as 'auction' | 'fixed', price: 500, buyNow: '', hours: 24, description: '', fallback: `${me.username}_` });
  const { busy, run } = useAction();
  const fb = checkUsername(f.fallback);
  const fbErr = !fb.ok ? fb.message : fb.name.length < 5 ? 'Needs 5 or more characters.' : fb.name === me.username ? 'Pick a different name.' : '';
  return (
    <Modal title={`Sell @${me.username}`} onClose={onClose} wide>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => call('marketCreate', { ...f, buyNow: f.buyNow ? Number(f.buyNow) : null }), 'Listed')) onClose();
      }}>
        <Segmented label="Listing type" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'auction', label: 'Auction' }, { value: 'fixed', label: 'Fixed price' }]} />
        <div className="row two">
          <label className="field"><span>{f.kind === 'auction' ? 'Starting bid' : 'Price'}</span><input type="number" min={ECONOMY.minPrice} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></label>
          {f.kind === 'auction' ? (
            <label className="field"><span>Runs for</span>
              <select value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })}>
                {ECONOMY.auctionHours.map((h) => <option key={h} value={h}>{h < 24 ? `${h} hour${h > 1 ? 's' : ''}` : `${h / 24} day${h > 24 ? 's' : ''}`}</option>)}
              </select>
            </label>
          ) : <span />}
        </div>
        {f.kind === 'auction' && <label className="field"><span>Buy-now price (optional)</span><input type="number" value={f.buyNow} onChange={(e) => setF({ ...f, buyNow: e.target.value })} placeholder="Leave empty for no buy-now" /></label>}
        <label className="field"><span>Description <em>{f.description.length}/500</em></span>
          <textarea rows={4} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Why this name is special. Supports **bold**, *italic* and links." />
        </label>
        <label className="field"><span>Your new username if it sells</span>
          <div className="at-input inline"><b>@</b><input value={f.fallback} onChange={(e) => setF({ ...f, fallback: e.target.value.toLowerCase().replace(/^@/, '') })} maxLength={24} /></div>
          <small className={fbErr ? 'bad' : ''}>{fbErr || 'Reserved for you while the listing is up.'}</small>
        </label>
        <p className="fine">You hold one username, so selling it means switching to the name above. The buyer pays in credits; Sigil keeps a {ECONOMY.marketFeePct}% fee. Auctions with bids can't be cancelled. A bid in the last 2 minutes adds 2 minutes.</p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !!fbErr || f.price < ECONOMY.minPrice}>List @{me.username}</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ wallet
function Wallet({ state }: { state: AppState }) {
  const [rows, setRows] = useState<{ delta: number; reason: string; at: number }[] | null>(null);
  const { run } = useAction();
  useEffect(() => { run(() => call('ledger')).then((r: any) => r && setRows(r)); }, [run, state.me?.credits]);
  return (
    <section className="card-section">
      <div className="section-head"><h3>Wallet</h3><Credits n={state.me!.credits} big /></div>
      <p className="muted small">You get {ECONOMY.dailyBonus} credits each day you open Sigil. Staff can also send credits for events and contests. Credits have no cash value.</p>
      {!rows ? null : rows.length === 0 ? <p className="muted small">No activity yet.</p> : (
        <ul className="ledger">{rows.map((r, i) => <li key={i}><span>{r.reason}</span><b className={r.delta < 0 ? 'neg' : 'pos'}>{r.delta > 0 ? '+' : ''}{cr(r.delta)}</b><time>{timeAgo(r.at)}</time></li>)}</ul>
      )}
    </section>
  );
}
