// Public media: avatars, banners, profile backgrounds.
// Every upload is decoded and re-encoded (GIF -> animated WebP), which
// strips all metadata (EXIF/GPS/comments). Hard caps on bytes, pixels,
// frames and output size. Media is public and moderatable by staff.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { ApiError } from './accounts';

type Slot = 'avatar' | 'banner' | 'background';

function sniff(buf: Buffer): 'gif' | 'png' | 'jpeg' | 'webp' | null {
  if (buf.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'gif';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

let sharpMod: any = null;
async function sharp() {
  if (!sharpMod) {
    try { sharpMod = (await import('sharp')).default; } catch {
      throw new ApiError(500, 'Image processing is not installed on this server (npm install sharp).');
    }
  }
  return sharpMod;
}

export async function processUpload(slot: Slot, input: Buffer): Promise<string> {
  const caps = config[slot];
  if (input.length > caps.maxBytes) throw new ApiError(413, `File too large (max ${Math.round(caps.maxBytes / 1048576)} MB).`);
  const kind = sniff(input);
  if (!kind) throw new ApiError(415, 'Use a PNG, JPEG, GIF or WebP image.');

  const s = await sharp();
  const animated = kind === 'gif' || kind === 'webp';
  const meta = await s(input, { animated, limitInputPixels: 40_000_000 }).metadata();
  const frames = meta.pages ?? 1;
  if (frames > caps.maxFrames && slot !== 'background') {
    throw new ApiError(422, `Animation has too many frames (${frames}; max ${caps.maxFrames}).`);
  }

  const keepAnimation = animated && frames > 1 && slot !== 'background';
  let img = s(input, { animated: keepAnimation, pages: keepAnimation ? Math.min(frames, caps.maxFrames) : 1, limitInputPixels: 40_000_000 });
  if (slot === 'avatar') img = img.resize(config.avatar.size, config.avatar.size, { fit: 'cover' });
  else if (slot === 'banner') img = img.resize(config.banner.width, config.banner.height, { fit: 'cover' });
  else img = img.resize(config.background.width, config.background.height, { fit: 'cover', withoutEnlargement: true });

  // .webp() without withMetadata() drops EXIF/ICC/XMP.
  const out: Buffer = await img.webp({ quality: 82, effort: 4, loop: 0 }).toBuffer();
  if (out.length > 6 * 1024 * 1024) throw new ApiError(422, 'Animation is too heavy after processing. Try a shorter or smaller GIF.');

  const name = `${slot}_${crypto.randomBytes(12).toString('base64url')}.webp`;
  fs.mkdirSync(config.mediaDir, { recursive: true });
  fs.writeFileSync(path.join(config.mediaDir, name), out);
  return name;
}

export function deleteMedia(name: string | null | undefined) {
  if (!name || !/^[a-z]+_[A-Za-z0-9_-]+\.webp$/.test(name)) return;
  fs.rm(path.join(config.mediaDir, name), { force: true }, () => {});
}

export function mediaPath(name: string): string | null {
  if (!/^[a-z]+_[A-Za-z0-9_-]+\.webp$/.test(name)) return null;
  const p = path.join(config.mediaDir, name);
  return fs.existsSync(p) ? p : null;
}
