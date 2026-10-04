import path from 'node:path';

const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v == null ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '127.0.0.1',
  /** Public origin used in links and the app's media URLs. */
  publicOrigin: env.PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT ?? 8787}`, // Render sets RENDER_EXTERNAL_URL
  dataDir: path.resolve(env.DATA_DIR ?? path.join(__dirname, '..', 'data')),
  get dbPath() { return env.DB_PATH ?? path.join(this.dataDir, 'sigil.db'); },
  get mediaDir() { return path.join(this.dataDir, 'media'); },
  /** Built web app (app/dist/web), served at /app. */
  webDir: path.resolve(env.WEB_DIR ?? path.join(__dirname, '..', '..', 'app', 'dist', 'web')),

  /** Launch mode: signups need an invite code. */
  inviteOnly: bool(env.INVITE_ONLY, true),
  invitesPerAccount: Number(env.INVITES_PER_ACCOUNT ?? 3),
  /** Accounts created before this date get the Early Supporter badge. */
  earlySupporterUntil: Date.parse(env.EARLY_SUPPORTER_UNTIL ?? '2027-03-01T00:00:00Z'),

  /** Secret used to hash IPs / device ids for rate limiting (never stored raw). */
  fingerprintSecret: env.FINGERPRINT_SECRET ?? 'dev-only-change-me',
  /** Trust X-Forwarded-For (only behind your own proxy). */
  trustProxy: bool(env.TRUST_PROXY, false),
  /** CIDR file listing datacenter / VPN / hosting ranges (one per line). */
  networkFlagFile: env.NETWORK_FLAG_FILE ?? '',

  /** Dev shortcut: shrink short-name waiting periods (hours -> seconds). Never in prod. */
  fastClock: bool(env.FAST_CLOCK, false),

  /** ICE servers for optional WebRTC direct connections (JSON array). TURN goes here. */
  iceServers: JSON.parse(env.ICE_SERVERS ?? '[]') as { urls: string | string[]; username?: string; credential?: string }[],

  // Media caps
  avatar: { maxBytes: 8 * 1024 * 1024, size: 256, maxFrames: 120 },
  banner: { maxBytes: 12 * 1024 * 1024, width: 960, height: 320, maxFrames: 90 },
  background: { maxBytes: 12 * 1024 * 1024, width: 1600, height: 1000, maxFrames: 1 },
};

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
/** Real ms for an hour, or 1s when FAST_CLOCK is on (local testing only). */
export const holdHourMs = () => (config.fastClock ? 100 : HOUR);
export const dayMs = () => (config.fastClock ? 1000 : DAY);
/** Calendar-day key used for activity tracking. */
export const dayKey = () => (config.fastClock ? String(Math.floor(Date.now() / 1000)) : new Date().toISOString().slice(0, 10));
