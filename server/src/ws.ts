// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close,
// fragmentation). Dependency-free so the relay stays small and auditable.

import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024;

export class WsConn extends EventEmitter {
  private buf = Buffer.alloc(0);
  private frags: Buffer[] = [];
  private fragOp = 0;
  open = true;
  alive = true;

  constructor(private socket: Duplex) {
    super();
    socket.on('data', (d: Buffer) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  send(text: string) {
    if (!this.open) return;
    this.write(0x1, Buffer.from(text, 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.write(0x8, p);
    this.socket.end();
    this.finish();
  }

  ping() { this.write(0x9, Buffer.alloc(0)); }

  private finish() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  private write(op: number, payload: Buffer) {
    const len = payload.length;
    let head: Buffer;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.finish(); }
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > MAX_MESSAGE + 14) return this.close(1009, 'too big');
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009, 'too big');
        len = Number(big); off = 10;
      }
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.alive = true;

      if (op === 0x8) return this.close();
      if (op === 0x9) { this.write(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2) { this.frags = [payload]; this.fragOp = op; }
      else if (op === 0x0) this.frags.push(payload);
      else return this.close(1002, 'bad opcode');

      const total = this.frags.reduce((n, f) => n + f.length, 0);
      if (total > MAX_MESSAGE) return this.close(1009, 'too big');
      if (fin) {
        const msg = Buffer.concat(this.frags);
        this.frags = [];
        if (this.fragOp === 0x1) this.emit('message', msg.toString('utf8'));
      }
    }
  }
}

/** Complete the HTTP upgrade handshake and return a connection. */
export function acceptUpgrade(req: IncomingMessage, socket: Duplex): WsConn | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WsConn(socket);
}
