import type { Me, PublicProfile, Presence, UsernameCheckResult } from '../../../shared/types';
import type { SpaceView } from '../../../shared/spaces';
export type { Me, PublicProfile, Presence, UsernameCheckResult, SpaceView };

export interface AppLock { hash: string; salt: string; timeoutMin: number }

/** Device-only settings. None of these are sent to the server. */
export interface Settings {
  /** Keep message history on this device (encrypted at rest). Off by default: chats vanish. */
  keepHistory: boolean;
  /** Try WebRTC direct connections (reveals your IP to the other person). Off by default. */
  directConnections: boolean;
  // appearance
  appearance: 'dark' | 'black';
  liquidGlass: boolean;
  reduceMotion: boolean;
  // privacy on this device
  hidePreviews: boolean;
  blurOnLeave: boolean;
  stripTracking: boolean;
  linkWarning: boolean;
  panicShortcut: boolean;
  /** disappearing timer for new chats, seconds */
  defaultTtl: number | null;
  appLock: AppLock | null;
  // notifications
  notifications: boolean;
  notifyContent: 'full' | 'name' | 'none';
  notifyRequests: boolean;
  notifySound: boolean;
  // chat
  enterToSend: boolean;
  time24: boolean;
  density: 'cozy' | 'compact';
  fontScale: number;
  renderMarkdown: boolean;
  // accessibility
  highContrast: boolean;
  underlineLinks: boolean;
  presenceShapes: boolean;
  // updates page
  lastSeenUpdate: string;
}
export const DEFAULT_SETTINGS: Settings = {
  keepHistory: false, directConnections: false, appearance: 'dark', liquidGlass: false, reduceMotion: false,
  hidePreviews: false, blurOnLeave: false, stripTracking: true, linkWarning: true, panicShortcut: false, defaultTtl: null, appLock: null,
  notifications: false, notifyContent: 'name', notifyRequests: true, notifySound: false,
  enterToSend: true, time24: false, density: 'cozy', fontScale: 100, renderMarkdown: true,
  highContrast: false, underlineLinks: false, presenceShapes: false, lastSeenUpdate: '',
};

export interface PlatformInfo {
  signups: 'open' | 'invite' | 'paused';
  banner: { text: string; tone: 'info' | 'warn' | 'good' } | null;
  marketPaused: boolean;
  shopPaused: boolean;
  raidMode: boolean;
  version: string;
}

export interface ChatMessage {
  id: string;
  from: 'me' | 'peer' | 'system';
  text: string;
  ts: number;
  expiresAt: number | null;
  status: 'sending' | 'sent' | 'failed' | 'received';
  note?: string;
  via?: 'relay' | 'direct';
  /** account id of who wrote it (channels, and DMs from 0.6) */
  author?: string;
  replyTo?: { id: string; author: string; text: string } | null;
  /** emoji -> account ids who reacted */
  reactions?: Record<string, string[]>;
  edited?: number;
  deleted?: boolean;
}

export type Where = { peerId: string } | { spaceId: string; channelId: string };

export interface ConversationView {
  peerId: string;
  peer: PublicProfile;
  status: 'active' | 'request';
  messages: ChatMessage[];
  ttl: number | null;          // disappearing timer in seconds
  unread: number;
  verified: boolean;
  presence: Presence | null;
  customStatus: string;
  direct: boolean;             // WebRTC channel open
  /** their encryption key changed since you first talked; cleared by verifying or acknowledging */
  keyChanged: boolean;
}

export interface AppState {
  phase: 'loading' | 'welcome' | 'ready';
  serverUrl: string;
  connection: 'connecting' | 'online' | 'offline';
  me: Me | null;
  settings: Settings;
  blocked: { id: string; username: string }[];
  conversations: ConversationView[];
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  inviteOnly: boolean;
  spaces: SpaceView[];
  channels: Record<string, { messages: ChatMessage[]; unread: number }>;
  platform: PlatformInfo;
  /** people you've accepted (used to decide whose images load in Lockdown Mode) */
  contacts: string[];
  /** Lockdown Mode is on (from your account) */
  lockdown: boolean;
}

export interface VaultData {
  entropy: string;               // hex recovery entropy (encrypted at rest by the OS keychain)
  token: string | null;
  accountId: string | null;
  spks: { id: number; priv: string; pub: string }[];
  /** ed = their identity key when you first talked (to detect changes) */
  contacts: Record<string, { username: string; addedAt: number; verified?: boolean; ed?: string; keyChanged?: boolean }>;
  blocked: Record<string, { username: string }>;
  settings: Settings;
  ttl: Record<string, number | null>;
  history?: Record<string, { peer: PublicProfile; messages: ChatMessage[] }>;
}

export interface Vault {
  load(): Promise<VaultData | null>;
  save(d: VaultData): Promise<void>;
  clear(): Promise<void>;
}

/** Every method the UI may call. Exposed over IPC by main.ts (or the dev harness). */
export type CoreMethod =
  | 'getState' | 'newPhrase' | 'checkUsername' | 'register' | 'restore' | 'logout' | 'deleteAccount'
  | 'refreshMe' | 'updateProfile' | 'uploadMedia' | 'removeMedia' | 'claimUsername' | 'cancelClaim'
  | 'lookup' | 'rareFeed' | 'report' | 'block' | 'unblock' | 'openConversation' | 'sendText'
  | 'acceptRequest' | 'declineRequest' | 'setDisappearing' | 'clearConversation' | 'markRead'
  | 'safetyNumber' | 'setVerified' | 'setSettings' | 'revealPhrase' | 'setServer'
  | 'staffOverview' | 'staffDecide' | 'staffLookup' | 'staffUpdate' | 'staffInvites' | 'staffReport'
  | 'staffAccounts' | 'staffAccount' | 'staffAction' | 'staffAudit' | 'ackNotice'
  | 'spaceCreate' | 'spaceJoin' | 'spaceOp' | 'spaceRefresh' | 'sendChannel' | 'markChannelRead'
  | 'shop' | 'shopBuy' | 'ledger' | 'market' | 'marketGet' | 'marketCreate' | 'marketBid' | 'marketBuy' | 'marketCancel'
  | 'sendSignal' | 'receiveDirect' | 'setDirect'
  | 'react' | 'editMessage' | 'unsendMessage' | 'deleteLocal' | 'ackKeyChange'
  | 'setLockdown' | 'verifyPhrase' | 'setAppLock' | 'checkPin' | 'panic'
  | 'listSessions' | 'revokeSession' | 'revokeOtherSessions' | 'exportData' | 'updates'
  | 'staffPlatform' | 'staffSetPlatform' | 'staffPostUpdate' | 'staffDeleteUpdate' | 'staffBroadcast' | 'staffStats';

/** The same list as a runtime value, for the IPC / page bridges' allow-lists. */
export const CORE_METHODS: readonly CoreMethod[] = [
  'getState', 'newPhrase', 'checkUsername', 'register', 'restore', 'logout', 'deleteAccount',
  'refreshMe', 'updateProfile', 'uploadMedia', 'removeMedia', 'claimUsername', 'cancelClaim',
  'lookup', 'rareFeed', 'report', 'block', 'unblock', 'openConversation', 'sendText',
  'acceptRequest', 'declineRequest', 'setDisappearing', 'clearConversation', 'markRead',
  'safetyNumber', 'setVerified', 'setSettings', 'revealPhrase', 'setServer',
  'staffOverview', 'staffDecide', 'staffLookup', 'staffUpdate', 'staffInvites', 'staffReport',
  'staffAccounts', 'staffAccount', 'staffAction', 'staffAudit', 'ackNotice',
  'spaceCreate', 'spaceJoin', 'spaceOp', 'spaceRefresh', 'sendChannel', 'markChannelRead',
  'shop', 'shopBuy', 'ledger', 'market', 'marketGet', 'marketCreate', 'marketBid', 'marketBuy', 'marketCancel',
  'sendSignal', 'receiveDirect', 'setDirect',
  'react', 'editMessage', 'unsendMessage', 'deleteLocal', 'ackKeyChange',
  'setLockdown', 'verifyPhrase', 'setAppLock', 'checkPin', 'panic',
  'listSessions', 'revokeSession', 'revokeOtherSessions', 'exportData', 'updates',
  'staffPlatform', 'staffSetPlatform', 'staffPostUpdate', 'staffDeleteUpdate', 'staffBroadcast', 'staffStats',
];
