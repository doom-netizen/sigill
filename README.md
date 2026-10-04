# Sigil

Claim a rare username (even `@b` or `@3`), wear it on a Discord-style public profile, and chat with end-to-end encrypted messages that are never stored on the server.

- **Public layer:** username, display name, GIF avatar and banner, status, bio, theme, server-granted badges, a public page at `/{username}`.
- **Private layer:** 1:1 chats encrypted on your device (X3DH + Double Ratchet). The server relays ciphertext to online recipients and keeps nothing.

```
sigil/
  shared/   username rules + blocklists, theme schema, bio markdown, badges, recovery phrase  (used by both sides)
  server/   Node relay + identity server: accounts, claims, profiles, media, public pages, WebSocket relay
  app/      the client: platform-neutral core (WebCrypto), React UI, web entry (/app), Electron shell, demo build
```

![Profile editor with a legendary @z name](docs/screens/13-profile-legendary.png)

## Run it

Needs Node 22.13+ and a current browser (Chrome/Edge 137+, Firefox 130+, Safari 17+; Ed25519/X25519 in WebCrypto).

**Web app (main way to use it)**

```bash
cd app && npm install && npm run build     # builds the web app into app/dist/web
cd ../server && npm install && npm start   # prints 5 bootstrap invite codes on first run
```

Open **http://localhost:8787/app/**. The server serves the web app at `/app/`, public profiles at `/{username}`, and the API + WebSocket relay. Each browser profile is its own device: keys live in WebCrypto, and the local vault is AES-GCM encrypted in IndexedDB with a non-extractable key.

**Desktop app (same UI, same crypto, Electron)**: `cd app && npm start`, pointed at `http://localhost:8787`.

**Demo (no server)**: `npm run build` also writes `app/dist/demo/sigil-demo.html`, one self-contained file with a simulated server and bot accounts inside. Open it in any browser. It saves its world (your account, profile, images, cosmetics, servers, settings) in that browser's storage, so it picks up where you left off; "Reset demo" in the Demo panel starts over.

The first account created on a fresh server becomes the founder (Staff + Developer + Founder). Every account gets 3 invite codes. Set `INVITE_ONLY=0` to let anyone sign up while testing.

Package desktop installers with `npm run dist:mac`, `dist:win` or `dist:linux` (electron-builder).

### Tests

```bash
cd server && npm test     # shared rules + end-to-end with real client cores, incl. test/privacy.test.ts (Lockdown, devices, export, platform)
cd app && npm test        # crypto: phrase, X3DH, ratchet ordering, replay/tamper rejection, safety numbers
cd app && npx tsx harness/webtest.ts  # real web app: server at /app, two browser profiles sign up and chat
cd app && npx tsx harness/demotest.ts # the demo file at desktop and phone widths
cd app && npx tsx harness/uitest.ts   # the desktop UI with the core behind a simulated preload
cd app && npx tsx harness/features.ts # servers, marketplace, shop, staff perks, appearance (demo, desktop + phone)
cd app && npx tsx harness/v06.ts      # replies/reactions/edits, What's new, credits, shop, staff platform, app lock, Lockdown Mode
```

## Usernames

Charset `a–z 0–9 _`, length 1–24, case-insensitive, unique, one per account.

**Check order** (`shared/usernames.ts`), identical on client (instant feedback) and server (authoritative):

1. Normalize: trim, strip `@`, lowercase, NFKC. Anything outside ASCII `a-z0-9_` is rejected, which also kills Unicode confusables.
2. Length / charset.
3. System reserved → *This username is unavailable.* Exact match after leet-reading and stripping leading/trailing digits (`adm1n`, `admin2`, `_root_`), plus impersonation roots blocked anywhere (`realadmin`, `xx_official`).
4. Slurs → *This username is unavailable.*
5. Brands → *This username is unavailable.* (staff can grant one after verification)
6. Short-name rules (below).
7. Free? Not taken, not locked, not mid-claim by someone else.

Reserved, slur, brand and taken all show the same message, so the list can't be probed.

**Slur matching** (`shared/blocklist.ts`) covers racial and ethnic slurs, homophobic, transphobic and ableist slurs (including `retard`/`tard` variants), and hate codes (`1488`, `kkk`, `hitler`…). Swears are allowed. Evasions are caught by:
- leet expansion with multiple readings (`1` → i *and* l, `0` → o, `4` → a, `3` → e, `5` → s, `7` → t…)
- underscores removed (`n_i_g_g_a`)
- repeated letters tolerated (`niiiggga`, `reeetard`) while doubled letters stay required (`niger` and `nigeria` are fine)
- short stems as exact or segment matches only (`homo`, `spic`…) so `homemade` and `spicy` pass
- an allowlist of innocent words scrubbed before matching (`bastard`, `standard`, `raccoon`, `pakistan`, `spicy`, `injunction`…) using a separator, so `spicspicy` is still blocked

The tests pin both directions: nearly 90 blocked variants, and 60+ names that must stay allowed.

**Scarcity tiers**

| Length | Tier | Requirement |
|---|---|---|
| 5+ | Standard | Claim instantly |
| 4 | Short | Account 7+ days old, activity score 4+, then a **public 24h hold** |
| 3 | Rare | Account 14+ days old, activity score 6+, then a **public 24h hold** |
| 1–2 | Legendary | Same as 3, then **staff approval** |

Activity score = display name (1) + avatar (1) + bio (1) + distinct active days (up to 7). Holds and pending requests are listed publicly on the **Rare claims** page, so rare names are slow and visible.

**Anti-hoarding:** invite-only launch; one username per account and one open claim at a time; a 60-day change cooldown, with the old name locked for 60 days; signup limits per IP (3/day) and per device (2/week); short-claim velocity locks per account (1/24h), per network (2/week) and site-wide (20/hour). Accounts created from datacenter/VPN ranges (`NETWORK_FLAG_FILE`, a CIDR list) can use Sigil but can't claim names of 4 characters or fewer. IPs and device ids are only stored as keyed hashes.

## Profiles

- Avatar (8 MB, 120 frames, 256×256), banner (12 MB, 90 frames, 960×320), page background (static). Every upload is decoded and re-encoded (GIF → animated WebP) with sharp. That strips EXIF/GPS/comments, enforces size and frame caps, and rejects anything that isn't really PNG/JPEG/GIF/WebP.
- Display name, bio (190 chars; `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `||spoiler||`, https links; HTML is always escaped first), status (Online / Idle / DND / Invisible) + custom status.
- Theme is JSON validated against a fixed schema (`shared/theme.ts`) and turned into CSS variables. No free-form CSS, and badges are never part of a theme.
- Privacy: discoverable by username, who can message (everyone / people I've accepted / nobody), show status, appear offline.
- Public page at `GET /{username}`: server-rendered, no JavaScript, strict CSP, mobile-first, `noai` robots meta.

**Badges** are server-granted only: Founder, Staff, Developer (granted; Staff/Developer/Founder also follow roles), Early Supporter (automatic before `EARLY_SUPPORTER_UNTIL`), Bug Hunter, Supporter, and automatic 1-Letter / 2-Letter chips. Grant from the Staff screen or `npm run admin -- grant <user> bug_hunter`.

## Chat and privacy

**What happens to a message:**
1. Your identity is an Ed25519 + X25519 keypair derived from a 9-word recovery phrase (128-bit entropy + checksum, proquint-encoded). No password and no email.
2. Each device publishes a signed prekey. The first message runs X3DH against it, then every message advances a Double Ratchet (AES-256-GCM, header bound into the AEAD). Identity keys in a handshake must match the sender's published keys.
3. Encryption runs on WebCrypto. In the desktop app it runs in the Electron main process, so the sandboxed UI never sees keys (its CSP is `connect-src 'none'`). In the web app it runs in the page, with a CSP that only allows talking to the Sigil server's own origin.
4. The relay forwards the envelope to the recipient's open connections. **If they're offline, the message is dropped** and you see "Not delivered". There's no queue, no history, no previews. The e2e test greps the server database to confirm no message text is ever written.
5. Chats live in memory and vanish when you quit. "Keep chat history on this device" stores them locally, encrypted with the OS keychain (`safeStorage`). Disappearing timers (30s to 1 week) apply on both devices.

**Message requests:** a first message from someone new lands in Requests. Accept, Decline (they aren't told) or Block. Contacts and blocks live only on your device, so the server never holds a social graph. "Nobody" is enforced by the server; "People I've accepted" is enforced by your device, which drops other messages without opening them.

**Safety numbers:** 60 digits, identical on both screens. Compare them in person and tap "The numbers match" to mark a chat verified.

**Direct connections (optional, off by default):** WebRTC data channels when both people are online. They carry the same already-encrypted envelopes, with the relay as fallback. Off by default because it reveals your IP to the other person. Add STUN/TURN servers with the `ICE_SERVERS` env var.

**What we promise, honestly:** Sigil can't read your messages and doesn't keep them. It does see, while relaying, that two accounts are exchanging messages and when, and it sees your IP address. It doesn't log either. It does not make you anonymous; use a VPN or Tor for that.

**The server stores:** usernames, profiles, theme JSON, images, public keys, claims, invites, sessions (token hashes), reports about public profiles, hashed IP/device fingerprints for signup limits. **It never stores:** message bodies, attachments, typing data, last-message previews, chat history, contact or block lists.

## Privacy and Lockdown Mode

**Lockdown Mode** (Settings, Lockdown Mode) is for people who might be personally targeted: staff, journalists, activists, anyone being harassed. Like Apple's version, it trades convenience for a much smaller attack surface:

| | Where it's enforced |
|---|---|
| Messages from anyone you haven't accepted are dropped unopened (optionally allow text-only requests, e.g. for sources) | your device |
| Nobody can add you to groups or servers; you join only by invite link | server |
| You look offline; status, custom status, join date and links are hidden | server |
| Your public web page returns 404 | server |
| Every other device is signed out when you turn it on | server |
| No direct (WebRTC) connections, no chat history, new chats disappear after 1 day | your device |
| Images from people you haven't accepted aren't loaded | your device |
| Links in messages aren't clickable | your device |
| A changed safety number blocks sending until you verify it | your device |
| Turning it off (or allowing requests) needs your recovery phrase, checked on the device and proven to the server with a fresh signature | both |

Staff only ever see a count of accounts in Lockdown Mode, never who.

**Other privacy features**
- Messages are padded to 256-byte blocks before encryption, so the relay can't infer what you sent from its length.
- Trust-on-first-use key pinning: if a contact's identity key changes, the chat says so.
- Tracking parameters (utm_*, fbclid, gclid, …) are stripped from links you send.
- Privacy toggles for join date, badges, links, the public web page and being added to groups.
- App lock (PIN, PBKDF2-hashed, device-only) with idle timeout; privacy blur when the window loses focus; hidden message previews; a "leaving Sigil" link warning.
- Panic: wipe this device's keys and chats instantly (button, or an optional Ctrl/⌘+Shift+X).
- Devices: see where you're signed in (coarse labels like "Firefox on Linux", no IPs) and sign out the rest.
- Download your data: everything the server keeps about you, as JSON.

## Chat features

Replies, emoji reactions, edits and unsend-for-everyone in DMs and channels (all end-to-end encrypted as control messages), "remove from this device", markdown (bold, italic, strike, code, code blocks, quotes, spoilers, @mentions), mention highlights, a Ctrl/⌘+K quick switcher, and desktop notifications with a choice of how much they reveal.

## Settings

Settings is split into pages: My account, Devices, Privacy & safety, Lockdown Mode, App lock & panic, Notifications, Appearance (dark / pitch black, liquid glass, density, 24-hour time), Accessibility (text size, high contrast, underlined links, status shapes, reduce motion), Chats & messages (Enter to send, formatting, default disappearing timer, history, direct connections), Keyboard shortcuts, Data & storage, What's new and Credits.

**What's new** shows the release notes in `shared/changelog.ts` plus anything staff post. **Credits** lives in `shared/credits.ts`; edit `TEAM` to put your people on it.

## Servers and groups

- **Servers** (up to 100 members) start with `#welcome` (announcements), `#general`, a private `#mods` and a Moderator role. Owners and admins manage channels, categories, private channels, roles with permissions and colors, nicknames, kicks, bans, invites and ownership transfer.
- **Groups** (up to 10) are small private chats with a `#chat` channel.
- Channel messages are end-to-end encrypted once per member who can read the channel. The server checks permissions, passes the ciphertext to members who are online, and stores nothing. The rules live in `shared/spaces.ts`, so the server and the demo enforce exactly the same thing.

## Marketplace and credits

- **Credits** are an in-app currency with no real-money value: 1,000 to start, +50 a day for being active, more from staff gifts or selling a name.
- **Shop:** four categories, all animated: avatar frames (Pulse, Orbit, Halo, Aurora, Neon Sign, Ember, Prism, Glitch, Sakura, Circuit, Vinyl, Storm, Galaxy), profile themes (Starfield, Snowfall, Aurora Sky, Tide, Embers, Holo Foil, Event Horizon, Night Rain, Code Rain, Petals, Bubbles, Lava Lamp, Constellations), name effects (Rainbow, Neon, Inferno, Glitch, Chrome, Frost, 24 Karat) and accessories worn on your avatar (Crown, Cat Ears, Headphones, Angel Halo, Horns, Party Hat, Flower Clip, Pixel Shades, Bunny Ears). Staff own everything, plus staff-only items.
- **Usernames:** list your name at a fixed price or as an auction (1 hour to 7 days, optional buy-now) with a description. You choose a replacement name (5+ characters) that's reserved for you while it's listed. Bids are held from the bidder's balance and refunded when outbid; late bids extend the auction by 2 minutes. On a sale the names swap, the buyer's old name is locked for 60 days, and there's a 5% fee. The rules live in `shared/economy.ts`.
- **Wallet:** every credit in and out.

## Appearance

Settings → Appearance: Dark or Pitch black, **Liquid glass** (frosted, light-bending panels; best in Chrome/Edge), and Reduce motion (also stops animated frames and themes). Profiles get a second color, avatar shapes, gradient/outline/shimmer usernames, glow, pronouns, up to 3 links, titles, and the frame/theme you own.

## Staff

The Staff screen (staff role only) covers:
- approving or denying 1–2 character requests, and granting holds early
- profile reports: dismiss, or mark handled
- accounts: search and filter, then warn, mute, suspend (timed or permanent), freeze profile, hide from discovery, rename, reset or remove profile parts, clear cooldowns, force sign-out, notes, badges and roles (founders only)
- **perks:** gift or take credits, give titles (VIP, Moderator, Helper, OG, Legend… or custom with a color), grant any cosmetic, remove a market listing
- **dashboard:** sign-ups over 14 days, activity, economy and moderation counts
- **platform:** open / invite-only / paused sign-ups, raid mode (new accounts can read but not send), pause the shop or marketplace, a site-wide banner, posting updates to What's new, and announcements to every account
- marketplace bans and cosmetic resets per account
- an audit log of every staff action, and invite codes

CLI: `npm run admin -- invites 10 | grant <user> <badge> | revoke … | role <user> staff,developer | ban <user>`.

## Share it with friends

Your friends need a link to **your** server. Two things matter: it has to be reachable from the internet, and it has to be **HTTPS**. Browsers only allow the encryption APIs Sigil uses on `https://` pages (or `localhost`), so a plain `http://192.168…` LAN address won't work for anyone but you.

**Just to show it off:** send `app/dist/demo/sigil-demo.html` (or the demo link). Everything runs in their browser, but each person is in their own world, so they can't message each other.

**Quick test from your computer (free tunnel):**

```bash
cd app && npm install && npm run build
cd ../server && npm install && INVITE_ONLY=0 npm start
# in another terminal, either one:
npx cloudflared tunnel --url http://127.0.0.1:8787    # prints https://something.trycloudflare.com
tailscale funnel 8787                                   # if you use Tailscale
```

Restart the server with `PUBLIC_ORIGIN=https://<that address>` so links and images point at the right place, then send friends `https://<that address>/app/`. It works while your computer is on.

**Render (no server of your own):** put this folder in a GitHub repository, then on render.com choose New → Blueprint and pick the repo. `render.yaml` builds the Dockerfile and sets everything up. The free plan sleeps after 15 minutes without visitors and wipes its storage when it does, so accounts reset; switch `plan` to a paid one and uncomment the `disk` block to keep data.

**Always on (a small VPS, about $5/month):** point a domain at the server, then

```bash
SIGIL_DOMAIN=sigil.example.com FINGERPRINT_SECRET=$(openssl rand -hex 32) docker compose up -d
```

`docker-compose.yml` runs Sigil behind Caddy, which gets the HTTPS certificate automatically. Data lives in the `sigil-data` volume. The `Dockerfile` also works on any host that runs containers (Fly.io, Railway, Render); give it a persistent disk at `/data` and set `PUBLIC_ORIGIN`, `FINGERPRINT_SECRET` and `TRUST_PROXY=true`.

**Invites:** the server prints 5 invite codes on first run, and every account gets 3 more (Settings → Your invites). Hand those out, or set `INVITE_ONLY=0` to let anyone with the link sign up. The first account to sign up becomes the founder, so make yours first.

## Configuration (server env)

| Var | Default | |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | |
| `PUBLIC_ORIGIN` | `http://localhost:8787` | Used in media URLs and links |
| `DATA_DIR` | `server/data` | SQLite DB + media |
| `INVITE_ONLY` | `true` | |
| `INVITES_PER_ACCOUNT` | `3` | |
| `EARLY_SUPPORTER_UNTIL` | `2027-03-01` | |
| `FINGERPRINT_SECRET` | dev value | **Set this in production** |
| `TRUST_PROXY` | `false` | Read `X-Forwarded-For` (only behind your own proxy) |
| `NETWORK_FLAG_FILE` | none | CIDR list of datacenter/VPN ranges |
| `ICE_SERVERS` | `[]` | JSON array of STUN/TURN servers for direct connections |
| `FAST_CLOCK` | `false` | Testing only: 1 day = 1 s, 1 hour = 100 ms |

## Not done yet (by design or for later)

- **Passkeys:** Electron's WebAuthn support is uneven across platforms, so v1 uses the recovery phrase plus an OS-keychain-encrypted key on the device. Passkeys fit naturally once there's a web client.
- **Multiple devices at once:** the phrase works on any device, but the most recent sign-in owns the prekey, so run one device at a time. Proper multi-device needs per-device keys (Sesame-style), which is next.
- **One-time prekeys:** X3DH here uses the signed prekey only, rotated on every sign-in. Adding one-time prekeys strengthens forward secrecy for first messages.
- **Production pieces:** SQLite → Postgres (the schema maps 1:1), in-memory rate limits → Redis, media → object storage + CDN, run behind TLS.
- From the spec's Phase 3: friends without a public graph, a paid supporter badge, mobile apps.
- **Voice/video** in servers, and channel history for people who were offline (channels are live-only, like DMs).
- The web app uses system fonts on purpose (no third-party font requests), so the TextPressure title is less dramatic there than in the demo, which loads Roboto Flex. Drop a variable font into the server and pass `fontUrl` to change that.
