// Release notes that ship with the app. Staff can post more from the Staff
// screen; those show up on the Updates page above these.

export interface Release { version: string; name: string; date?: string; highlights: string[]; sections: { title: string; items: string[] }[] }

export const RELEASES: Release[] = [
  {
    version: '0.6', name: 'Lockdown', date: '2026-10-03',
    highlights: ['Lockdown Mode', 'Replies, reactions and edits', '31 new cosmetics'],
    sections: [
      { title: 'Privacy and safety', items: [
        'Lockdown Mode for people who may be targeted: strangers can\'t reach you, nobody can add you to servers, your public page goes dark, other devices are signed out, and turning it off takes your recovery phrase.',
        'Safety-number change alerts. If someone\'s key changes you see it in the chat, and in Lockdown Mode you can\'t send until you verify.',
        'Messages are padded to fixed sizes before encryption, so the relay can\'t guess what you sent from its length.',
        'App lock with a PIN, privacy blur when you switch away, hidden message previews, and a panic shortcut that wipes this device.',
        'Tracking parameters (utm_, fbclid, gclid and friends) are stripped from links you send.',
        'Choose whether to show your join date, badges and links, whether your public page exists, and whether people can add you to groups.',
        'Devices: see where you\'re signed in and sign out the rest.',
        'Download your data: everything the server holds about you, in one file.',
      ] },
      { title: 'Chat', items: [
        'Reply to messages, react with emoji, edit, and unsend for everyone, in DMs and server channels.',
        'Markdown in messages: bold, italic, strikethrough, code, code blocks, quotes and spoilers.',
        'Quick switcher: Ctrl+K (Cmd+K on Mac) jumps to any chat, server or setting.',
        'Desktop notifications, with a choice of how much they show.',
      ] },
      { title: 'Customization', items: [
        'Two new shop categories: name effects (Rainbow, Neon, Inferno, Glitch, Chrome, Frost, 24 Karat) and accessories (Crown, Cat Ears, Headphones, Halo, Horns, Party Hat, Flower Clip, Pixel Shades, Bunny Ears).',
        'Six new frames and six new animated profile themes.',
        'Settings rebuilt around categories, with chat density, text size, 12/24-hour time, Enter-to-send, high contrast and more.',
      ] },
      { title: 'Staff', items: [
        'Platform controls: open, invite-only or paused signups, pause the shop or marketplace, raid mode, and a site-wide banner.',
        'Post updates to this page and send a notice to every account.',
        'Dashboard with signups, activity and economy numbers. Marketplace bans and cosmetic resets per account.',
      ] },
    ],
  },
  {
    version: '0.5', name: 'Marketplace',
    highlights: ['Credits', 'Username marketplace', 'Animated frames and themes'],
    sections: [
      { title: 'New', items: [
        'Credits: 1,000 to start and 50 a day for being active.',
        'Sell your username at a fixed price or at auction, with bids held in escrow and a 2-minute anti-snipe extension.',
        'A shop of animated avatar frames and animated profile themes.',
        'Staff perks: gift credits, give titles and cosmetics, remove listings.',
      ] },
    ],
  },
  {
    version: '0.4', name: 'Servers',
    highlights: ['Servers and groups', 'Roles and channels', 'Pitch black and liquid glass'],
    sections: [
      { title: 'New', items: [
        'Servers with channels, categories, private channels, roles, permissions, invites and bans. Group chats for up to 10.',
        'Every channel message is end-to-end encrypted for each member who can read it.',
        'Pitch black theme, liquid glass, reduce motion, and more profile options: second color, avatar shapes, username styles, pronouns and links.',
      ] },
    ],
  },
  {
    version: '0.3', name: 'Staff tools',
    highlights: ['Equip badges', 'Moderation toolkit'],
    sections: [
      { title: 'New', items: [
        'Badges you can equip and unequip, plus houses, supporter and booster tiers.',
        'Warn, mute, suspend, freeze profiles, rename, reserve names, notes and an audit log.',
      ] },
    ],
  },
  {
    version: '0.1', name: 'First light',
    highlights: ['Rare usernames', 'Encrypted chat', 'Public profiles'],
    sections: [
      { title: 'New', items: [
        'Claim usernames as short as one character, with holds and staff approval for the rarest.',
        'End-to-end encrypted direct messages that the server never stores.',
        'Themeable public profiles with GIF avatars and banners.',
      ] },
    ],
  },
];

export const LATEST_VERSION = RELEASES[0].version;
