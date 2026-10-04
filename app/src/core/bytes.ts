// Platform-neutral byte helpers (browser, Electron, Node 22+). No Buffer.

export type Bytes = Uint8Array;

const te = new TextEncoder();
const td = new TextDecoder();
export const utf8 = (s: string): Bytes => te.encode(s);
export const fromUtf8 = (b: Bytes): string => td.decode(b);

export function b64(b: Bytes): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Bytes {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64url = (b: Bytes) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const hex = (b: Bytes) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function unhex(s: string): Bytes {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function equal(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export const randomBytes = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));
export const randomId = (n = 9) => b64url(randomBytes(n));
