// The Credits page. Edit TEAM to put your people on it.

export const TEAM: { name: string; role: string }[] = [
  { name: '@hack', role: 'Creator' },
];

export const CREDITS: { group: string; items: { name: string; by: string; note?: string; license?: string }[] }[] = [
  { group: 'Encryption', items: [
    { name: 'X3DH and the Double Ratchet', by: 'Trevor Perrin and Moxie Marlinspike', note: 'Sigil\'s message encryption follows these published Signal specifications, implemented on WebCrypto.' },
    { name: 'Proquints', by: 'Daniel S. Wilkerson', note: 'The pronounceable words in your recovery phrase.' },
    { name: 'WebCrypto (Ed25519, X25519, AES-GCM, HKDF)', by: 'W3C and browser engineers' },
  ] },
  { group: 'Built with', items: [
    { name: 'React', by: 'Meta and contributors', license: 'MIT' },
    { name: 'TypeScript', by: 'Microsoft', license: 'Apache-2.0' },
    { name: 'esbuild', by: 'Evan Wallace', license: 'MIT' },
    { name: 'Node.js', by: 'OpenJS Foundation', license: 'MIT' },
    { name: 'SQLite', by: 'D. Richard Hipp and team', license: 'Public domain' },
    { name: 'sharp and libvips', by: 'Lovell Fuller, John Cupitt and contributors', note: 'Re-encodes every upload, which also strips location and camera metadata.', license: 'Apache-2.0 / LGPL' },
    { name: 'Electron', by: 'OpenJS Foundation', license: 'MIT' },
    { name: 'Playwright', by: 'Microsoft', note: 'Used to test every screen.', license: 'Apache-2.0' },
  ] },
  { group: 'Type', items: [
    { name: 'Geist', by: 'Vercel', license: 'OFL' },
    { name: 'JetBrains Mono', by: 'JetBrains', license: 'OFL' },
    { name: 'Roboto Flex', by: 'Font Bureau for Google', license: 'OFL' },
  ] },
  { group: 'Inspiration', items: [
    { name: 'Text pressure effect', by: 'Juan Fuentes (CodePen), popularised by React Bits (David Haz)', note: 'Rewritten for Sigil. The original look uses Compressa VF by Preusstype.' },
    { name: 'Lockdown Mode', by: 'Apple', note: 'The idea of trading features for safety when you might be targeted.' },
    { name: 'Profiles, servers and badges', by: 'Discord', note: 'Sigil\'s badges, icons and art are original; nothing is copied from Discord.' },
  ] },
];
