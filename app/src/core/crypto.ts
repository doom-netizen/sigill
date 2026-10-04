// End-to-end encryption, Signal-style, on WebCrypto (browser, Electron, Node 22+):
//   - Identity: Ed25519 (signing) + X25519 (DH), both derived from the
//     128-bit recovery entropy via HKDF. The phrase IS the account.
//   - Signed prekey (X25519) published on the server, signed by Ed25519.
//   - X3DH handshake (no one-time prekeys in this MVP).
//   - Double Ratchet with AES-256-GCM, header bound into the AEAD.
// Private keys are non-extractable CryptoKeys except where they must be
// persisted (identity is re-derived from the phrase; prekeys are exported
// once into the encrypted local vault).

import { concat, equal, utf8, b64, unb64, type Bytes } from './bytes';

export { b64, unb64 };

const subtle = globalThis.crypto.subtle;
const ED_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const X_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const MAX_SKIP = 500;
const ZERO32 = new Uint8Array(32);

// WebCrypto's TS types want ArrayBuffer-backed views; our Uint8Arrays always are.
const buf = (b: Bytes) => b as unknown as BufferSource;

export async function hkdf(ikm: Bytes, salt: Bytes, info: string, len: number): Promise<Bytes> {
  const key = await subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(utf8(info)) }, key, len * 8));
}
async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await subtle.importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, buf(data)));
}

// ------------------------------------------------------------------- keys

export interface XPair { priv: CryptoKey; pub: Bytes; raw?: Bytes }

const jwkPub = async (k: CryptoKey) => unb64((await subtle.exportKey('jwk', k)).x!);

export async function xFromRaw(raw: Bytes): Promise<XPair> {
  const ext = await subtle.importKey('pkcs8', buf(concat(X_PKCS8, raw)), { name: 'X25519' }, true, ['deriveBits']);
  const pub = await jwkPub(ext);
  const priv = await subtle.importKey('pkcs8', buf(concat(X_PKCS8, raw)), { name: 'X25519' }, false, ['deriveBits']);
  return { priv, pub };
}
/** Fresh X25519 pair. `exportable` keeps raw bytes so it can be persisted (signed prekeys). */
export async function xGenerate(exportable = false): Promise<XPair> {
  const kp = (await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  if (!exportable) return { priv: kp.privateKey, pub };
  const raw = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey)).subarray(16);
  return { priv: kp.privateKey, pub, raw };
}
export async function dh(priv: CryptoKey, pubRaw: Bytes): Promise<Bytes> {
  if (pubRaw.length !== 32) throw new Error('bad dh public key');
  const pub = await subtle.importKey('raw', buf(pubRaw), { name: 'X25519' }, false, []);
  return new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub } as any, priv, 256));
}

export interface Identity { edPriv: CryptoKey; ed: Bytes; x: XPair }

export async function identityFromEntropy(entropy: Bytes): Promise<Identity> {
  const salt = utf8('sigil-identity-v1');
  const edSeed = await hkdf(entropy, salt, 'ed25519', 32);
  const xSeed = await hkdf(entropy, salt, 'x25519', 32);
  const edExt = await subtle.importKey('pkcs8', buf(concat(ED_PKCS8, edSeed)), { name: 'Ed25519' }, true, ['sign']);
  const ed = await jwkPub(edExt);
  const edPriv = await subtle.importKey('pkcs8', buf(concat(ED_PKCS8, edSeed)), { name: 'Ed25519' }, false, ['sign']);
  return { edPriv, ed, x: await xFromRaw(xSeed) };
}

export async function sign(id: Identity, msg: Bytes | string): Promise<Bytes> {
  return new Uint8Array(await subtle.sign('Ed25519', id.edPriv, buf(typeof msg === 'string' ? utf8(msg) : msg)));
}
export async function verify(edRaw: Bytes, msg: Bytes, sig: Bytes): Promise<boolean> {
  try {
    const key = await subtle.importKey('raw', buf(edRaw), { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify('Ed25519', key, buf(sig), buf(msg));
  } catch { return false; }
}

export const spkMessage = (id: number, pub: Bytes) => concat(utf8(`sigil-spk:${id}:`), pub);

// ----------------------------------------------------------- safety number

async function fingerprintDigits(ed: Bytes, x: Bytes): Promise<string> {
  let h: Bytes = concat(utf8('sigil-fp-v1'), ed, x);
  for (let i = 0; i < 1024; i++) h = new Uint8Array(await subtle.digest('SHA-512', buf(concat(h, ed))));
  let out = '';
  for (let i = 0; i < 6; i++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + h[i * 5 + j];
    out += String(n % 100000).padStart(5, '0');
  }
  return out;
}

/** 60-digit safety number, identical on both sides. */
export async function safetyNumber(a: { id: string; ed: Bytes; x: Bytes }, b: { id: string; ed: Bytes; x: Bytes }): Promise<string> {
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  const digits = (await fingerprintDigits(first.ed, first.x)) + (await fingerprintDigits(second.ed, second.x));
  return digits.match(/.{5}/g)!.join(' ');
}

// ------------------------------------------------------------------ AEAD

async function msgKey(mk: Bytes) {
  const k = await hkdf(mk, ZERO32, 'sigil-msg', 44);
  const key = await subtle.importKey('raw', buf(k.subarray(0, 32)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, iv: k.slice(32, 44) };
}
async function seal(mk: Bytes, plaintext: Bytes, ad: Bytes): Promise<Bytes> {
  const { key, iv } = await msgKey(mk);
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(ad) }, key, buf(plaintext)));
}
async function open(mk: Bytes, ct: Bytes, ad: Bytes): Promise<Bytes> {
  if (ct.length < 16) throw new Error('short ciphertext');
  const { key, iv } = await msgKey(mk);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(ad) }, key, buf(ct)));
}

const kdfRk = async (rk: Bytes, dhOut: Bytes) => { const o = await hkdf(dhOut, rk, 'sigil-ratchet', 64); return { rk: o.slice(0, 32), ck: o.slice(32) }; };
const kdfCk = async (ck: Bytes) => ({ mk: await hmac(ck, Uint8Array.of(1)), ck: await hmac(ck, Uint8Array.of(2)) });

// -------------------------------------------------------------- ratchet

export interface Header { dh: string; pn: number; n: number }
export interface InitHeader { ik: string; ed: string; ek: string; spkId: number }
export interface Envelope { v: 1; init?: InitHeader; h: Header; ct: string }

export interface Session {
  ad: Bytes;
  rk: Bytes;
  dhs: XPair;
  dhr: Bytes | null;
  cks: Bytes | null;
  ckr: Bytes | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Map<string, Bytes>;
  /** initiator: X3DH header repeated until the peer replies */
  pendingInit: InitHeader | null;
  /** responder: the initiator's ephemeral key that created this session */
  fromEk: string | null;
}

const clone = (s: Session): Session => ({ ...s, skipped: new Map(s.skipped) });
const headerBytes = (h: Header) => utf8(`${h.dh}|${h.pn}|${h.n}`);

export interface Bundle { ed: Bytes; x: Bytes; spk: Bytes; spkId: number; spkSig: Bytes }

/** Initiator side of X3DH. Throws if the prekey signature is bad. */
export async function initiateSession(me: Identity, peer: Bundle): Promise<Session> {
  if (!(await verify(peer.ed, spkMessage(peer.spkId, peer.spk), peer.spkSig))) throw new Error('Prekey signature check failed.');
  const ek = await xGenerate();
  const dh1 = await dh(me.x.priv, peer.spk);
  const dh2 = await dh(ek.priv, peer.x);
  const dh3 = await dh(ek.priv, peer.spk);
  const sk = await hkdf(concat(new Uint8Array(32).fill(0xff), dh1, dh2, dh3), ZERO32, 'sigil-x3dh', 32);
  const ad = concat(me.ed, me.x.pub, peer.ed, peer.x);
  const dhs = await xGenerate();
  const { rk, ck } = await kdfRk(sk, await dh(dhs.priv, peer.spk));
  return {
    ad, rk, dhs, dhr: peer.spk, cks: ck, ckr: null, ns: 0, nr: 0, pn: 0, skipped: new Map(),
    pendingInit: { ik: b64(me.x.pub), ed: b64(me.ed), ek: b64(ek.pub), spkId: peer.spkId },
    fromEk: null,
  };
}

/** Responder side of X3DH. `peer` keys must come from the server profile, not the envelope. */
export async function acceptSession(me: Identity, spk: XPair, peer: { ed: Bytes; x: Bytes }, init: InitHeader): Promise<Session> {
  if (!equal(unb64(init.ik), peer.x) || !equal(unb64(init.ed), peer.ed)) throw new Error('Identity key mismatch.');
  const ek = unb64(init.ek);
  const dh1 = await dh(spk.priv, peer.x);
  const dh2 = await dh(me.x.priv, ek);
  const dh3 = await dh(spk.priv, ek);
  const sk = await hkdf(concat(new Uint8Array(32).fill(0xff), dh1, dh2, dh3), ZERO32, 'sigil-x3dh', 32);
  const ad = concat(peer.ed, peer.x, me.ed, me.x.pub);
  return { ad, rk: sk, dhs: spk, dhr: null, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, skipped: new Map(), pendingInit: null, fromEk: init.ek };
}

/** Encrypt; mutates the session (sending chain advances). */
export async function encrypt(s: Session, plaintext: Bytes): Promise<Envelope> {
  if (!s.cks) throw new Error('No sending chain yet.');
  const { mk, ck } = await kdfCk(s.cks);
  s.cks = ck;
  const h: Header = { dh: b64(s.dhs.pub), pn: s.pn, n: s.ns };
  s.ns++;
  const ct = await seal(mk, plaintext, concat(s.ad, headerBytes(h)));
  return { v: 1, ...(s.pendingInit ? { init: s.pendingInit } : {}), h, ct: b64(ct) };
}

async function skip(s: Session, until: number) {
  if (s.nr + MAX_SKIP < until) throw new Error('Too many skipped messages.');
  if (!s.ckr) return;
  while (s.nr < until) {
    const { mk, ck } = await kdfCk(s.ckr);
    s.ckr = ck;
    s.skipped.set(`${b64(s.dhr!)}:${s.nr}`, mk);
    s.nr++;
  }
  while (s.skipped.size > MAX_SKIP) s.skipped.delete(s.skipped.keys().next().value!);
}

/**
 * Decrypt; returns plaintext and the updated session. The input session is
 * never mutated, so a forged or corrupted envelope can't desync state.
 */
export async function decrypt(session: Session, env: Envelope): Promise<{ plaintext: Bytes; session: Session }> {
  const s = clone(session);
  const h = env.h;
  if (!h || typeof h.dh !== 'string' || !Number.isInteger(h.n) || !Number.isInteger(h.pn) || h.n < 0 || h.pn < 0) throw new Error('bad header');
  const ad = concat(s.ad, headerBytes(h));
  const ct = unb64(env.ct);
  const key = `${h.dh}:${h.n}`;
  const skippedMk = s.skipped.get(key);
  if (skippedMk) {
    const pt = await open(skippedMk, ct, ad);
    s.skipped.delete(key);
    return { plaintext: pt, session: s };
  }
  const dhr = unb64(h.dh);
  if (!s.dhr || !equal(dhr, s.dhr)) {
    await skip(s, h.pn);
    s.pn = s.ns; s.ns = 0; s.nr = 0;
    s.dhr = dhr;
    let r = await kdfRk(s.rk, await dh(s.dhs.priv, s.dhr));
    s.rk = r.rk; s.ckr = r.ck;
    s.dhs = await xGenerate();
    r = await kdfRk(s.rk, await dh(s.dhs.priv, s.dhr));
    s.rk = r.rk; s.cks = r.ck;
  }
  await skip(s, h.n);
  const { mk, ck } = await kdfCk(s.ckr!);
  s.ckr = ck;
  s.nr++;
  const pt = await open(mk, ct, ad);
  // Any successful decrypt means the peer has our session: stop sending the X3DH header.
  s.pendingInit = null;
  return { plaintext: pt, session: s };
}
