// Demo build: the full Sigil web app running against an in-tab MockServer,
// with a few seeded rare-name accounts. Some are bots that chat back through
// the same end-to-end encryption the real app uses.

import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { SigilCore } from '../../core/client';
import { installBridge, MemoryVault } from '../bridge';
import { loadKey, saveKey, clearAll, PersistentVault } from './persist';
import { App } from '../../renderer/App';
import { MockServer, DEMO_INVITE, type Acct } from './mockServer';
import { encodePhrase, decodePhrase } from '../../../../shared/proquint';
import { utf8 } from '../../core/bytes';
import { THEME_PRESETS, sanitizeTheme } from '../../../../shared/theme';
import { GRANTABLE } from '../../../../shared/badges';
import { COSMETICS, createListing, placeBid } from '../../../../shared/economy';
import type { AppState } from '../../core/types';
import '../../../../shared/profileCard.css';
import '../../renderer/styles.css';
import './demo.css';

const SERVER = 'https://sigil.demo';
const DAY = 86_400_000;
const server = new MockServer();
const WS = server.socketClass();
const fetchImpl = server.fetch as typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------- art
const svg = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
function avatarArt(kind: string, a: string, b: string): string {
  const shapes: Record<string, string> = {
    sun: `<circle cx="64" cy="64" r="30" fill="${a}"><animate attributeName="r" values="26;34;26" dur="2.4s" repeatCount="indefinite"/></circle><g stroke="${a}" stroke-width="6" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 64 64" to="360 64 64" dur="9s" repeatCount="indefinite"/><path d="M64 14v10M64 104v10M14 64h10M104 64h10M29 29l7 7M92 92l7 7M29 99l7-7M92 36l7-7"/></g>`,
    three: `<text x="64" y="92" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="84" fill="${a}">3</text>`,
    moon: `<circle cx="60" cy="64" r="34" fill="${a}"/><circle cx="78" cy="52" r="30" fill="${b}"/>`,
    diamond: `<rect x="40" y="40" width="48" height="48" rx="8" fill="${a}" transform="rotate(45 64 64)"/>`,
    wave: `<path d="M10 74 Q37 44 64 74 T118 74" stroke="${a}" stroke-width="12" fill="none" stroke-linecap="round"/>`,
    dots: `<g fill="${a}"><circle cx="44" cy="50" r="10"/><circle cx="84" cy="50" r="10"/><circle cx="64" cy="84" r="10"/></g>`,
    prompt: `<path d="M30 44 L54 64 L30 84" stroke="${a}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="62" y="78" width="36" height="9" rx="3" fill="${a}"><animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite"/></rect>`,
    coin: `<circle cx="64" cy="64" r="36" fill="${a}"/><text x="64" y="80" text-anchor="middle" font-family="Arial" font-weight="900" font-size="44" fill="${b}">$</text>`,
  };
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="${b}"/>${shapes[kind]}</svg>`);
}
function bannerArt(a: string, b: string, c: string): string {
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 320" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}" stop-opacity=".25"/></linearGradient></defs><rect width="960" height="320" fill="${c}"/><path d="M0 230 Q240 110 480 200 T960 140 V320 H0Z" fill="url(#g)"><animate attributeName="d" dur="8s" repeatCount="indefinite" values="M0 230 Q240 110 480 200 T960 140 V320 H0Z;M0 210 Q240 160 480 170 T960 180 V320 H0Z;M0 230 Q240 110 480 200 T960 140 V320 H0Z"/></path><path d="M0 280 Q300 200 560 260 T960 230 V320 H0Z" fill="${c}" opacity=".55"/></svg>`);
}

// ------------------------------------------------------------------- bots
interface Seed {
  username: string; displayName: string; bio: string; customStatus: string; status?: string;
  theme: any; avatar: [string, string, string]; banner?: [string, string, string]; ageDays: number;
  roles?: string[]; badges?: string[]; online: boolean; script?: string[]; channelLines?: string[];
  extra?: Partial<Acct>;
}
const ago = (days: number) => Date.now() - days * DAY;
const preset = (name: string) => structuredClone(THEME_PRESETS.find((p) => p.name === name)!.theme);

const SEEDS: Seed[] = [
  {
    username: 'b', displayName: 'bee', ageDays: 412, online: true, roles: ['founder', 'staff', 'developer'], badges: ['partner', 'verified'],
    extra: { house: 'ember', supporterSince: ago(400), hiddenBadges: ['early_supporter'], accessory: 'acc_halo', frame: 'frame_aurora' },
    bio: 'built this. **ask me anything** and i\'ll show you around.', customStatus: 'showing people around',
    theme: { accent: '#ffd25e', background: { type: 'gradient', from: '#2a2006', to: '#08070a', angle: 160 }, font: 'mono', cardStyle: 'glass', radius: 20, noise: true },
    avatar: ['sun', '#ffd25e', '#1d1606'], banner: ['#ffd25e', '#ff8a3d', '#120d04'],
    script: [
      "hey, welcome to sigil. this chat is end-to-end encrypted: the server in this demo only ever sees scrambled ciphertext. open the Demo panel and look at \"What the relay saw\".",
      'tap the Encrypted chip at the top of this chat. that 60-digit safety number is identical on my screen. if it matches, nobody is in the middle.',
      'try the Keep chip next to it to set disappearing messages. the timer applies to both of us.',
      "rare names are slow on purpose. 3–4 letters sit on a public hold, 1–2 letters need staff. you're staff in this demo, so check the Staff tab: @nova is asking for @n.",
      'your profile is the trophy shelf. click your avatar in the corner to theme it: accent, gradient, card style, GIF avatar.',
      'want a short name? open the Demo panel, skip ahead 14 days, then claim one from your profile.',
      "that's the tour. i'll keep answering, but i'm a bot reading from a list.",
    ],
    channelLines: [
      'welcome to the lounge! each message here is encrypted separately for every member who can see the channel. the server just passes them along.',
      'try Server settings (the gear by the server name): roles, channels, invites, bans. you have full access in the demo.',
      '#mods is private to the Moderator role. give yourself the role in Members and it shows up.',
      'say hi to @nova, she runs moderation here.',
    ],
  },
  {
    username: '3', displayName: 'three', ageDays: 233, online: true, badges: ['quest', 'gifter_2', 'april_fools'],
    extra: { house: 'gale', supporterSince: ago(200), boosterSince: ago(100), nameFx: 'name_glitch', owned: ['name_glitch'] },
    bio: 'collector of short things. ||it was always going to be a 3||', customStatus: 'guarding @3',
    theme: preset('Rose'), avatar: ['three', '#ff5fa2', '#22071a'], banner: ['#ff5fa2', '#7a5cff', '#12060f'],
    script: ['fair. so the server literally cannot read this?', "ok i'm sold. i'll be over here guarding @3 with my life", 'gn ✌'],
  },
  {
    username: 'nova', displayName: 'Nova', ageDays: 31, online: true, badges: ['streamer'],
    extra: { house: 'tide', boosterSince: ago(40), nameFx: 'name_neon', accessory: 'acc_headphones', owned: ['name_neon', 'acc_headphones'] },
    bio: 'making small things for the internet. waiting on @n 🤞', customStatus: 'refreshing the rare page',
    theme: preset('Ice'), avatar: ['moon', '#5ee7ff', '#0b2a35'], banner: ['#5ee7ff', '#7a5cff', '#05121a'],
    script: ['hey! hoping staff approves my @n request', "(you're staff in this demo... just saying)", 'thank you either way :)'],
  },
  {
    username: 'kyo', displayName: 'Kyo', ageDays: 97, online: false, status: 'idle', badges: ['mod_alumni'],
    extra: { previousUsername: 'kyoto_kid', originalUsername: 'kyoto_kid', usernameChanges: 1 },
    bio: 'offline most of the time. that\'s the point.', customStatus: '',
    theme: preset('Mono'), avatar: ['wave', '#f2f2f2', '#141414'],
  },
  {
    username: 'ash_ln', displayName: 'Ash', ageDays: 19, online: true, status: 'dnd',
    bio: 'claimed @ash. it settles any second now.', customStatus: 'do not disturb',
    theme: preset('Ember'), avatar: ['diamond', '#ff6a3d', '#2a0f07'],
    script: ["i'm on do not disturb but i'll allow it", 'did you see @ash on the rare page?'],
  },
  {
    username: 'mika_dev', displayName: 'mika', ageDays: 64, online: true, badges: ['bug_hunter', 'bug_hunter_gold', 'active_developer', 'early_bot_dev'], status: 'idle',
    extra: { house: 'tide' },
    bio: 'found the first bug. got a badge. `printf("hi")`', customStatus: 'in a code review',
    theme: preset('Acid'), avatar: ['dots', '#c6ff3d', '#151d07'],
    script: ['hi! bug hunter badge is server-granted, so nobody can fake it with a theme', 'brb, code review'],
  },
  {
    username: 'vex', displayName: 'vex', ageDays: 160, online: true, badges: ['early_bot_dev'],
    extra: { house: 'ember', credits: 2200, frame: 'frame_storm', nameFx: 'name_fire', owned: ['frame_storm', 'name_fire'] },
    bio: 'name trader. selling @vex to the right person.', customStatus: 'taking offers',
    theme: { ...preset('Ember'), nameStyle: 'gradient', accent2: '#ffd25e' }, avatar: ['diamond', '#ff3d6a', '#24070f'], banner: ['#ff3d6a', '#ffd25e', '#120407'],
    script: ['the listing is in the Marketplace tab. fixed price, no haggling', 'ok a little haggling. bid on the auction ones though'],
  },
  {
    username: 'luna', displayName: 'Luna', ageDays: 120, online: true,
    extra: { house: 'tide', credits: 1800, effect: 'fx_sakura', accessory: 'acc_cat_ears', owned: ['fx_sakura', 'acc_cat_ears'] },
    bio: 'moving to a longer name. auctioning @luna, highest bid wins.', customStatus: 'auction ends soon',
    theme: preset('Ice'), avatar: ['moon', '#c9b6ff', '#150f2a'], banner: ['#c9b6ff', '#5ee7ff', '#09061a'],
  },
  {
    username: 'free_coins_4u', displayName: 'FREE COINS', ageDays: 1, online: false,
    bio: 'click here for free coins!!!', customStatus: '',
    theme: { accent: '#ffe600' }, avatar: ['coin', '#ffe600', '#332e00'],
  },
];

/** Server-side lookup: is this account a person playing the demo? */
const isHuman = (id: string) => server.humanIds.has(id);

/** Each bot's key comes from its name, so a saved world can sign the same bots back in. */
async function botEntropy(username: string): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', utf8(`sigil-demo-bot:${username}`) as BufferSource);
  return new Uint8Array(h).slice(0, 16);
}

class Bot {
  core: SigilCore;
  answered = new Set<string>();
  turns = new Map<string, number>();
  constructor(public seed: Seed) {
    this.core = new SigilCore({ serverUrl: SERVER, vault: new MemoryVault(), deviceId: `bot-${seed.username}`, fetchImpl, WebSocketImpl: WS });
  }
  async boot(restoring = false) {
    await this.core.init();
    const entropy = await botEntropy(this.seed.username);
    if (restoring) {
      await this.core.restore({ phrase: encodePhrase(entropy) });
    } else {
      (this.core as any).pendingEntropy = entropy; // demo seeding only
      await this.core.register({ username: `seed_${this.seed.username}_x`, invite: 'SEEDSEED', phraseConfirmed: true });
    }
    this.core.on('state', (s: AppState) => this.react(s));
  }
  acct(): Acct { return server.accounts.get(this.core.getState().me!.id)!; }
  private busy = false;
  private chanTurns = 0;
  private async react(s: AppState) {
    if (this.busy) return;
    if (this.seed.channelLines) await this.reactChannels(s);
    if (this.busy || !this.seed.script) return;
    for (const c of s.conversations) {
      const last = c.messages.filter((m) => m.from === 'peer').at(-1);
      if (!last || this.answered.has(last.id)) continue;
      this.answered.add(last.id);
      this.busy = true;
      try {
        if (c.status === 'request') await this.core.acceptRequest(c.peerId);
        await sleep(700 + Math.random() * 900);
        const n = this.turns.get(c.peerId) ?? 0;
        this.turns.set(c.peerId, n + 1);
        const script = this.seed.script;
        const line = n < script.length ? script[n] : ['🙂', 'still here.', 'say less.', 'you can reset the demo from the Demo panel any time.'][n % 4];
        await this.core.sendText(c.peerId, line);
      } finally { this.busy = false; }
    }
  }
  private async reactChannels(s: AppState) {
    const lines = this.seed.channelLines!;
    for (const sp of s.spaces) {
      for (const ch of sp.channels) {
        const last = s.channels[ch.id]?.messages.at(-1);
        if (!last || last.from === 'me' || !last.author || !isHuman(last.author) || this.answered.has(last.id)) continue;
        this.answered.add(last.id);
        if (!sp.canSend[ch.id]) continue;
        this.busy = true;
        try {
          await sleep(900 + Math.random() * 1200);
          const line = lines[this.chanTurns++ % lines.length];
          await this.core.sendChannel(sp.id, ch.id, line);
        } finally { this.busy = false; }
        return;
      }
    }
  }
}

let loungeId = '';
async function seedWorld(): Promise<Map<string, Bot>> {
  const bots = new Map<string, Bot>();
  for (const seed of SEEDS) {
    const bot = new Bot(seed);
    await bot.boot();
    const a = bot.acct();
    a.username = seed.username;
    a.originalUsername = seed.username;
    a.displayName = seed.displayName;
    a.bio = seed.bio;
    a.customStatus = seed.customStatus;
    a.status = seed.status ?? 'online';
    a.theme = sanitizeTheme(seed.theme);
    a.avatar = avatarArt(...seed.avatar);
    a.banner = seed.banner ? bannerArt(...seed.banner) : null;
    a.createdAt = Date.now() - seed.ageDays * DAY;
    a.activeDays = Math.min(seed.ageDays, 30);
    a.roles = seed.roles ?? [];
    a.badges = seed.badges ?? [];
    Object.assign(a, seed.extra ?? {});
    if (!seed.online) bot.core.close();
    bots.set(seed.username, bot);
    server.notifyPresence(a.id);
  }
  // A visible rare-name economy: @nova asks staff for @n, @ash_ln is mid-hold on @ash, @kyo got @kyo a while ago.
  const now = Date.now();
  const id = (u: string) => bots.get(u)!.acct().id;
  server.claims.push(
    { id: 'c-kyo', accountId: id('kyo'), name: 'kyo', tier: 'rare', status: 'finalized', createdAt: now - 40 * DAY, availableAt: now - 39 * DAY },
    { id: 'c-3', accountId: id('3'), name: '3', tier: 'legendary', status: 'finalized', createdAt: now - 200 * DAY, availableAt: null },
    { id: 'c-n', accountId: id('nova'), name: 'n', tier: 'legendary', status: 'pending_staff', createdAt: now - 2 * 3600e3, availableAt: null },
    { id: 'c-ash', accountId: id('ash_ln'), name: 'ash', tier: 'rare', status: 'holding', createdAt: now - 23.9 * 3600e3, availableAt: now + 75_000 },
  );
  // A little moderation history so the Staff console has something in it.
  const bee = bots.get('b')!.acct();
  server.staffAction(bee, id('free_coins_4u'), { action: 'warn', message: 'Sending everyone the same link is spam. Next time is a restriction.' });
  server.staffAction(bee, id('free_coins_4u'), { action: 'mute', duration: '7d', reason: 'spam links' });
  server.staffAction(bee, id('free_coins_4u'), { action: 'add_note', note: 'Brand-new account, same link sent to 40 people.' });
  server.staffAction(bee, id('mika_dev'), { action: 'grant_badge', badge: 'bug_hunter_gold' });
  server.reports.push({ id: 'r1', reporter: id('mika_dev'), target: id('free_coins_4u'), reason: 'spam', details: 'sends everyone the same link', createdAt: now - 3600e3, status: 'open' });

  // A marketplace with something in it: a fixed-price name, a live auction with bids, one past sale.
  createListing(server.econ, id('vex'), { kind: 'fixed', price: 4500, fallback: 'vex_trades', description: 'Three letters, no numbers. Short, sharp, easy to say. Comes with nothing but the name.' });
  const auction = createListing(server.econ, id('luna'), { kind: 'auction', price: 600, buyNow: 6000, hours: 24, fallback: 'luna_moves', description: 'Four letters, means moon. Starting low; highest bid when the timer runs out takes it.' });
  placeBid(server.econ, auction.id, id('nova'), 650);
  placeBid(server.econ, auction.id, id('3'), 900);
  auction.endsAt = now + 3.2 * 3600e3;
  server.listings.set('sold-1', {
    id: 'sold-1', name: 'echo', sellerId: id('kyo'), kind: 'auction', price: 300, buyNow: null, endsAt: now - 2 * DAY, description: '', fallback: 'kyo',
    status: 'sold', createdAt: now - 3 * DAY, bids: [], buyerId: id('ash_ln'), soldPrice: 1450, closedAt: now - 2 * DAY,
  });

  // A server to explore: owned by @b, with the bots as members and two moderators.
  const lounge = server.createSpaceFor(id('b'), { kind: 'server', name: 'Sigil Lounge', emoji: '✦', color: '#ffd25e' });
  lounge.description = 'The official hangout. Every message here is end-to-end encrypted, one copy per member.';
  const modRole = lounge.roles.find((r) => r.name === 'Moderator')!;
  for (const u of ['3', 'nova', 'kyo', 'ash_ln', 'mika_dev', 'vex', 'luna']) {
    lounge.members[id(u)] = { joinedAt: now - 5 * DAY, roles: u === 'mika_dev' || u === 'nova' ? [modRole.id] : [], nickname: '' };
  }
  lounge.roles.push({ id: 'role-collectors', name: 'Collectors', color: '#ff5fa2', perms: ['send_messages', 'create_invites'], position: 2, hoist: true });
  lounge.roles.push({ id: 'role-admin', name: 'Admin', color: '#c6ff3d', perms: ['admin'], position: 3, hoist: true });
  lounge.members[id('3')].roles.push('role-collectors');
  lounge.members[id('vex')].roles.push('role-collectors');
  loungeId = lounge.id;
  server.updates.unshift({
    id: 'u-1', tag: 'security', at: now - 3 * 3600e3, by: 'b', title: 'Lockdown Mode is here',
    body: 'If you might be targeted (staff, journalists, anyone being harassed), turn on **Lockdown Mode** in Settings. It cuts off strangers, hides you, signs out your other devices, and needs your recovery phrase to turn off.\n\nAlso new: replies, reactions, edits and unsend, and 31 new cosmetics in the shop.',
  });
  for (const bot of bots.values()) bot.core.spaceRefresh(lounge.id).catch(() => {});
  return bots;
}

// ------------------------------------------------------ password accounts
// Real Sigil has no passwords: an account is a key made from a 9-word phrase.
// For the demo, a username + password is stretched (PBKDF2, 200k rounds) into
// that phrase, so signing in with a password is just a friendlier way to type it.
async function phraseFromPassword(username: string, password: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: utf8(`sigil-demo-login:${username.toLowerCase().replace(/^@/, '')}`) as BufferSource, iterations: 200_000 },
    key, 128,
  );
  return encodePhrase(new Uint8Array(bits));
}

const PASSWORD_ACCOUNTS = [{
  username: 'hack', password: 'sky123', displayName: 'hack', ageDays: 5 * 365 + 40,
  bio: 'my account. **4 letters**, every badge on the shelf, and nobody else holds the key.', customStatus: 'building sigil',
  theme: { ...preset('Acid'), accent2: '#2ad38b', nameStyle: 'shimmer', glow: true, avatarShape: 'rounded' },
  avatar: ['prompt', '#c6ff3d', '#0e1405'] as [string, string, string], banner: ['#c6ff3d', '#2ad38b', '#070a04'] as [string, string, string],
}];

async function seedPasswordAccounts() {
  for (const p of PASSWORD_ACCOUNTS) {
    const seeder = new SigilCore({ serverUrl: SERVER, vault: new MemoryVault(), deviceId: `seed-${p.username}`, fetchImpl, WebSocketImpl: WS });
    await seeder.init();
    (seeder as any).pendingEntropy = decodePhrase(await phraseFromPassword(p.username, p.password)); // demo seeding only
    await seeder.register({ username: `seed_${p.username}_x`, invite: 'SEEDSEED', phraseConfirmed: true });
    const a = server.accounts.get(seeder.getState().me!.id)!;
    seeder.close();
    // Every badge that can coexist: all staff-granted ones, every role badge, the top supporter and
    // booster tiers, 5-year member, early supporter, legacy name and a house. (Tiers replace each
    // other, and you can only be in one house, so those show the highest one.)
    Object.assign(a, {
      username: p.username, displayName: p.displayName, bio: p.bio, customStatus: p.customStatus,
      theme: sanitizeTheme(p.theme), avatar: avatarArt(...p.avatar), banner: bannerArt(...p.banner),
      createdAt: Date.now() - p.ageDays * DAY, activeDays: 30, roles: ['staff', 'founder', 'developer'],
      badges: [...GRANTABLE], house: 'gale', originalUsername: 'hack', previousUsername: null,
      supporterSince: Date.now() - 86 * 30.44 * DAY, boosterSince: Date.now() - 25 * 30.44 * DAY,
      credits: 25_000, owned: COSMETICS.map((c) => c.id), frame: 'frame_prism', effect: 'fx_holo', nameFx: 'name_gold', accessory: 'acc_crown',
      titles: [{ name: 'OG', color: '#f5f5f5' }, { name: 'Legend', color: '#ff6a3d' }, { name: 'VIP', color: '#ffd25e' }],
      pronouns: 'they/them', links: [{ label: 'sigil', url: 'https://sigil.demo/hack' }],
    });
    server.humanIds.add(a.id);
  }
}

// ------------------------------------------------------------ demo panel
function PasswordSignIn({ core }: { core: SigilCore }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="demo-login" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError('');
      try {
        await core.restore({ phrase: await phraseFromPassword(username, password) });
      } catch {
        setError('No demo account with that username and password.');
      } finally { setBusy(false); }
    }}>
      <h4>Sign in with a password</h4>
      <label htmlFor="demo-user">Username</label>
      <input id="demo-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
      <label htmlFor="demo-pass">Password</label>
      <input id="demo-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {error && <small className="demo-error">{error}</small>}
      <button type="submit" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function DemoPanel({ core }: { core: SigilCore }) {
  const [state, setState] = useState<AppState>(core.getState());
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 720px)').matches);
  const [relay, setRelay] = useState(server.lastRelayed);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const h = (s: AppState) => setState(s);
    core.on('state', h);
    const t = setInterval(() => setRelay(server.lastRelayed), 400);
    return () => { core.off('state', h); clearInterval(t); };
  }, [core]);
  useEffect(() => { if (state.phase === 'ready') setOpen(false); }, [state.phase]);

  const name = (id: string) => server.accounts.get(id)?.username ?? '?';
  const skip = async () => {
    const me = state.me && server.accounts.get(state.me.id);
    if (!me) return;
    me.createdAt -= 14 * DAY;
    me.activeDays += 7;
    await core.refreshMe();
  };

  return (
    <aside className={`demo ${open ? 'open' : ''} ${state.phase !== 'ready' ? 'onboarding' : ''}`} aria-label="Demo controls">
      <button className="demo-tab" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i />{state.phase !== 'ready' && !open ? 'Demo: sign in or get an invite' : 'Demo'}
      </button>
      {open && (
        <div className="demo-body">
          <p>Everything runs in this tab: a simulated Sigil server and a few bot accounts. Nothing leaves your device. Your account, profile and settings are saved in this browser, so they're here next time.</p>
          {state.phase !== 'ready' && <PasswordSignIn core={core} />}
          {state.phase !== 'ready' && (
            <div className="demo-invite">
              <span>Invite code</span>
              <code>{DEMO_INVITE}</code>
              <button onClick={() => { navigator.clipboard?.writeText(DEMO_INVITE).then(() => setCopied(true), () => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
          )}
          {state.phase === 'ready' && (
            <>
              <div className="demo-relay">
                <h4>What the relay saw</h4>
                {relay ? (
                  <>
                    <small>@{name(relay.from)} → @{name(relay.to)}, {new Date(relay.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</small>
                    <code>{relay.env.slice(0, 220)}…</code>
                    <small>That's the whole message as the server gets it. No key, no plaintext, and it's not stored.</small>
                  </>
                ) : <small>Send a message to @b to see it.</small>}
              </div>
              <div className="demo-actions">
                <button onClick={skip}>Skip ahead 14 days</button>
                <button onClick={() => { if (confirm('Erase your demo account and start over?')) clearAll().then(() => location.reload()); }}>Reset demo</button>
              </div>
              <small className="demo-fine">Short names unlock with account age. Skipping ahead lets you claim one from your profile; holds settle in 25 seconds here instead of 24 hours.</small>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

// ----------------------------------------------------------------- boot
// ------------------------------------------------------------- saving
const WORLD_KEY = 'world-v1';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveWorld() {
  return saveKey(WORLD_KEY, { snap: structuredClone(server.snapshot()), loungeId, savedAt: Date.now() });
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveWorld(); }, 400);
}

/** Sign the saved bots back in (their keys are derived from their names). */
async function restoreBots(): Promise<Map<string, Bot>> {
  const bots = new Map<string, Bot>();
  for (const seed of SEEDS) {
    const bot = new Bot(seed);
    try { await bot.boot(true); } catch { continue; }
    if (!seed.online) bot.core.close();
    bots.set(seed.username, bot);
  }
  return bots;
}

async function main() {
  const core = new SigilCore({ serverUrl: SERVER, vault: new PersistentVault(), deviceId: 'demo-you', fetchImpl, WebSocketImpl: WS });
  installBridge(core, 'web');
  createRoot(document.getElementById('root')!).render(<App />);
  const panelRoot = document.createElement('div');
  document.body.appendChild(panelRoot);
  createRoot(panelRoot).render(<DemoPanel core={core} />);

  // Pick up where you left off, or build a fresh world.
  const saved = await loadKey<{ snap: ReturnType<MockServer['snapshot']>; loungeId: string }>(WORLD_KEY);
  let bots: Map<string, Bot>;
  if (saved?.snap?.v === 1) {
    server.restore(saved.snap);
    loungeId = saved.loungeId;
    bots = await restoreBots();
  } else {
    await new PersistentVault().clear(); // a vault without its world can't sign in
    bots = await seedWorld();
    await seedPasswordAccounts();
  }
  server.onChange = scheduleSave;
  setInterval(() => saveWorld(), 15_000);
  addEventListener('pagehide', () => { saveWorld(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveWorld(); });
  await saveWorld();
  await core.init();

  // @3 slides into your requests a few seconds after you sign up.
  server.onHumanSignup = async (a) => {
    // Everyone who plays lands in the demo server too.
    const lounge = server.spaces.get(loungeId);
    if (lounge && !lounge.members[a.id]) {
      lounge.members[a.id] = { joinedAt: Date.now(), roles: ['role-admin'], nickname: '' }; // so you can try every setting
      server.notifySpace(Object.keys(lounge.members), { t: 'space', id: lounge.id });
    }
    await sleep(6000);
    const three = bots.get('3')!.core;
    try {
      await three.openConversation(a.username);
      await three.sendText(a.id, 'yo, nice name. is this actually encrypted or is that marketing');
    } catch { /* they may have changed name; fine */ }
  };
}
main();
