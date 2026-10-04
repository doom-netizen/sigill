// Username blocklists. This file intentionally contains offensive terms:
// it is a moderation filter. Policy:
//   - swears are allowed (fuck, shit, ass, ...)
//   - slurs (racial, ethnic, homophobic, transphobic, ableist) and hate
//     codes are blocked permanently, including obfuscated variants
//   - system / reserved names are never claimable
//   - brand names are not self-claimable (staff can grant after review)
//
// Matching is done in usernames.ts against normalized forms (lowercase,
// underscores removed, leet expanded, repeated letters tolerated).

/** System reserved names. Exact match on the normalized "core" of a name. */
export const RESERVED: readonly string[] = [
  'admin', 'administrator', 'admins', 'mod', 'mods', 'moderator', 'moderators',
  'staff', 'team', 'official', 'support', 'help', 'helper', 'helpers',
  'security', 'safety', 'trust', 'safetyteam', 'abuse', 'report', 'reports',
  'legal', 'privacy', 'terms', 'tos', 'dmca', 'billing', 'payment', 'payments', 'pay',
  'invoice', 'refund', 'owner', 'owners', 'founder', 'founders', 'ceo', 'cto',
  'dev', 'devs', 'developer', 'developers', 'engineer', 'engineering',
  'system', 'systems', 'root', 'superuser', 'sudo', 'operator', 'operators',
  'bot', 'bots', 'robot', 'service', 'services', 'api', 'apis', 'status', 'uptime',
  'mail', 'email', 'postmaster', 'noreply', 'webmaster', 'hostmaster',
  'null', 'undefined', 'unknown', 'anonymous', 'deleted', 'removed', 'banned',
  'suspend', 'suspended', 'verified', 'verify', 'verification', 'authenticate',
  'authentication', 'login', 'logout', 'signin', 'signout', 'signup', 'register',
  'account', 'accounts', 'user', 'users', 'profile', 'profiles', 'settings', 'setting',
  'dashboard', 'home', 'about', 'contact', 'feedback', 'news', 'blog',
  'announcement', 'announcements', 'update', 'updates', 'release', 'releases',
  'beta', 'alpha', 'staging', 'test', 'testing', 'demo', 'example', 'sample', 'void',
  // product + routing names (the public page lives at /{username})
  'sigil', 'sigils', 'api', 'ws', 'media', 'static', 'assets', 'public', 'app',
  'www', 'web', 'download', 'downloads', 'invite', 'invites', 'rare', 'discover',
  'explore', 'search', 'chat', 'chats', 'messages', 'message', 'inbox', 'requests',
  'favicon', 'robots', 'sitemap', 'well_known', 'wellknown', 'nan', 'true', 'false',
  'everyone', 'here', 'me', 'you', 'self', 'system32',
];

/**
 * Impersonation roots: blocked anywhere inside a name
 * ("realadmin", "admin_42", "xx_official_xx").
 */
export const IMPERSONATION_CONTAINS: readonly string[] = [
  'admin', 'administrator', 'moderator', 'official', 'sigilstaff', 'sigilteam',
  'sigilsupport', 'sigilofficial', 'sigiladmin', 'trustandsafety', 'safetyteam',
  'staffteam', 'supportteam', 'customersupport', 'helpdesk', 'noreply', 'postmaster',
  'superuser', 'sysadmin', 'sysop',
];

/** Brand names: unavailable to self-claim, staff may grant after review. Exact core match. */
export const BRANDS: readonly string[] = [
  'discord', 'google', 'gmail', 'youtube', 'apple', 'icloud', 'iphone', 'microsoft',
  'windows', 'xbox', 'amazon', 'meta', 'facebook', 'instagram', 'whatsapp', 'threads',
  'twitter', 'tiktok', 'bytedance', 'twitch', 'kick', 'snapchat', 'reddit', 'telegram',
  'signal', 'spotify', 'netflix', 'hulu', 'disney', 'marvel', 'pixar', 'nintendo',
  'playstation', 'sony', 'samsung', 'steam', 'valve', 'epicgames', 'fortnite',
  'roblox', 'minecraft', 'mojang', 'riotgames', 'valorant', 'leagueoflegends',
  'blizzard', 'activision', 'callofduty', 'pokemon', 'openai', 'chatgpt', 'anthropic',
  'claude', 'gemini', 'copilot', 'tesla', 'spacex', 'nvidia', 'intel', 'amd',
  'paypal', 'venmo', 'cashapp', 'stripe', 'coinbase', 'binance', 'kraken', 'visa',
  'mastercard', 'amex', 'github', 'gitlab', 'linkedin', 'pinterest', 'tumblr',
  'nike', 'adidas', 'supreme', 'gucci', 'louisvuitton', 'chanel', 'prada', 'rolex',
  'cocacola', 'pepsi', 'mcdonalds', 'starbucks', 'redbull', 'monster', 'uber', 'lyft',
  'airbnb', 'netlify', 'vercel', 'cloudflare', 'mozilla', 'firefox', 'chrome',
  'opera', 'brave', 'protonmail', 'proton', 'ubisoft', 'rockstargames', 'gta',
];

export type SlurMode = 'contains' | 'exact';
export interface SlurEntry { stem: string; mode: SlurMode }

const c = (...stems: string[]): SlurEntry[] => stems.map((stem) => ({ stem, mode: 'contains' as const }));
const x = (...stems: string[]): SlurEntry[] => stems.map((stem) => ({ stem, mode: 'exact' as const }));

/**
 * Slurs and hate codes.
 *   contains: blocked anywhere in the normalized name (after allowlist scrub)
 *   exact:    blocked when the whole name, or an underscore segment, or the
 *             name with leading/trailing digits removed, equals the stem.
 *             Used for short stems that appear inside innocent words.
 * Doubled letters in a stem must stay doubled (so "nigg" does not match "niger"),
 * but any letter may be repeated further ("niiiggga").
 */
export const SLURS: readonly SlurEntry[] = [
  // anti-Black
  ...c('nigg', 'nigger', 'nigga', 'negro', 'reggin', 'kneegrow', 'neeger',
    'jigaboo', 'jiggaboo', 'porchmonkey', 'junglebunny', 'spearchucker', 'darkie', 'darky',
    'golliwog', 'coon', 'sheboon', 'groid', 'jungleape'),
  ...x('nig', 'niga', 'nigah', 'nigs', 'sambo'),
  // anti-Latino
  ...c('wetback', 'beaner', 'spic', 'spick', 'spik'),
  // anti-Asian
  ...c('chink', 'gook', 'zipperhead', 'slanteye', 'chingchong', 'chingchang', 'slopehead'),
  ...x('jap', 'japs', 'chinky'),
  // antisemitic
  ...c('kike', 'kyke', 'jewrat', 'ovendodger', 'holohoax', 'gasthejews', 'killalljews', 'jewkiller',
    'christkiller'),
  ...x('hymie', 'heeb', 'hebe', 'yid', 'yids', 'zog'),
  // anti-Arab / Muslim / South Asian
  ...c('raghead', 'towelhead', 'cameljockey', 'sandmonkey', 'muzzie', 'paki', 'dothead',
    'goatfucker', 'camelfucker', 'mudslime'),
  // anti-Indigenous
  ...c('redskin', 'injun', 'squaw', 'halfbreed', 'boong'),
  ...x('abo', 'abbo', 'abos'),
  // other ethnic
  ...c('polack', 'gyppo', 'pikey'),
  ...x('wop', 'wops', 'dago', 'dagos', 'gypo', 'gyp', 'coolie', 'honky', 'honkey', 'kraut', 'krauts'),
  // homophobic
  ...c('fag', 'phag', 'dyke', 'lesbo', 'sodomite', 'poofter', 'battyboy', 'battyman',
    'fudgepacker', 'pillowbiter', 'rugmuncher', 'carpetmuncher', 'nancyboy', 'queerbait'),
  ...x('fgt', 'fgts', 'homo', 'homos', 'poof', 'poofs', 'dike', 'dikes'),
  // transphobic
  ...c('trann', 'shemale', 'ladyboy', 'troon'),
  ...x('heshe', 'trany', 'tranie', 'trap', 'traps'),
  // ableist
  ...c('retard', 'tard', 'spaz', 'spastic', 'mongoloid', 'windowlicker', 'cripple', 'downie', 'retart'),
  ...x('mong', 'mongs', 'tards'),
  // hate codes / extremist
  ...c('hitler', 'siegheil', 'heilhitl', '1488', '14words', 'fourteenwords', 'kkk', 'kukluxklan',
    'whitepower', 'whitepride', 'whitegenocide', 'gaschamber', 'neonazi', 'ethniccleans', 'racewar',
    'deathtojews', 'killniggers', 'killfags', 'killtrann', 'zyklon'),
  ...x('nazi', 'nazis', 'ss88', 'hh88', 'wpww', 'rahowa'),
];

/**
 * Innocent words that contain a "contains" stem. They are scrubbed from the
 * normalized name before slur matching, so "spicy", "raccoon", "standard",
 * "pakistan" stay claimable while "spic", "coon", "tard", "paki" do not.
 * Scrubbing replaces the word with a separator so fragments can't re-join
 * ("spicspicy" is still blocked).
 */
export const SLUR_ALLOWLIST: readonly string[] = [
  // spic / spik
  'allspice', 'spice', 'spicy', 'spicey', 'conspic', 'auspic', 'perspic', 'despic', 'suspic', 'spicule',
  'aspic', 'spike', 'spiky', 'spiking',
  // coon
  'raccoon', 'racoon', 'cocoon', 'tycoon', 'puccoon',
  // tard
  'bastard', 'mustard', 'custard', 'leotard', 'standard', 'dastard', 'petard', 'costard',
  'stardust', 'stardom', 'stardew', 'tardis', 'tardy', 'tardigrade',
  // retard (flame retardant)
  'retardant',
  // paki
  'pakistan',
  // dyke
  'vandyke',
  // fag
  'fagin', 'leafage',
  // negro
  'montenegro', 'negroni',
  // chink
  'chinking',
  // injun
  'injunction',
];
