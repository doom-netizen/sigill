// Recovery phrase encoding using proquints (pronounceable 16-bit words),
// e.g. "lusab-babad-gutih-tugad-...". 128 bits of entropy + 16-bit checksum
// = 9 words. No wordlist needed, easy to read aloud and type.

const CONS = 'bdfghjklmnprstvz';
const VOWS = 'aiou';

export function wordFromU16(n: number): string {
  return (
    CONS[(n >> 12) & 15] + VOWS[(n >> 10) & 3] + CONS[(n >> 6) & 15] + VOWS[(n >> 4) & 3] + CONS[n & 15]
  );
}

export function u16FromWord(w: string): number {
  if (!/^[bdfghjklmnprstvz][aiou][bdfghjklmnprstvz][aiou][bdfghjklmnprstvz]$/.test(w)) throw new Error(`bad word: ${w}`);
  return (
    (CONS.indexOf(w[0]) << 12) | (VOWS.indexOf(w[1]) << 10) | (CONS.indexOf(w[2]) << 6) |
    (VOWS.indexOf(w[3]) << 4) | CONS.indexOf(w[4])
  );
}

/** Fletcher-16 over the entropy bytes; catches typos and swapped words. */
function checksum(bytes: Uint8Array): number {
  let a = 0, b = 0;
  for (const x of bytes) { a = (a + x) % 255; b = (b + a) % 255; }
  return (b << 8) | a;
}

export function encodePhrase(entropy: Uint8Array): string {
  if (entropy.length !== 16) throw new Error('entropy must be 16 bytes');
  const words: string[] = [];
  for (let i = 0; i < 16; i += 2) words.push(wordFromU16((entropy[i] << 8) | entropy[i + 1]));
  words.push(wordFromU16(checksum(entropy)));
  return words.join('-');
}

export function decodePhrase(phrase: string): Uint8Array {
  const words = phrase.toLowerCase().trim().split(/[\s,\-]+/).filter(Boolean);
  if (words.length !== 9) throw new Error('A recovery phrase has 9 words.');
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = u16FromWord(words[i]);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 255;
  }
  if (u16FromWord(words[8]) !== checksum(out)) throw new Error('That recovery phrase has a typo.');
  return out;
}
