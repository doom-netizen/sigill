// Optional WebRTC data channels. Opt-in (reveals IPs between the two
// people). Only carries envelopes that are already end-to-end encrypted by
// the main process; falls back to the relay whenever the channel isn't open.

import { call, sigil, type AppState } from './api';

interface Link { pc: RTCPeerConnection; dc: RTCDataChannel | null; started: number; open: boolean }

export class DirectManager {
  private links = new Map<string, Link>();
  private cooldown = new Map<string, number>();
  private state: AppState | null = null;
  private offs: (() => void)[] = [];

  constructor() {
    this.offs.push(sigil.on('signal', (s: { from: string; data: any }) => this.onSignal(s.from, s.data)));
    this.offs.push(sigil.on('direct-send', (s: { to: string; env: string }) => {
      const l = this.links.get(s.to);
      if (l?.dc?.readyState === 'open') l.dc.send(s.env);
    }));
    setInterval(() => this.reap(), 5000);
  }

  private eligible(peerId: string): boolean {
    if (typeof RTCPeerConnection === 'undefined') return false;
    const s = this.state;
    if (!s || !s.me || !s.settings.directConnections || s.connection !== 'online') return false;
    const c = s.conversations.find((x) => x.peerId === peerId);
    return !!c && c.status === 'active' && c.presence !== 'offline' && c.presence !== null;
  }

  sync(state: AppState) {
    this.state = state;
    for (const id of [...this.links.keys()]) if (!this.eligible(id)) this.close(id);
    if (!state.settings.directConnections || !state.me) return;
    for (const c of state.conversations) {
      if (!this.eligible(c.peerId) || this.links.has(c.peerId)) continue;
      if ((this.cooldown.get(c.peerId) ?? 0) > Date.now()) continue;
      // deterministic offerer: lower account id
      if (state.me.id < c.peerId) this.start(c.peerId).catch(() => this.close(c.peerId));
    }
  }

  private make(peerId: string): Link {
    const pc = new RTCPeerConnection({ iceServers: this.state?.iceServers ?? [] });
    const link: Link = { pc, dc: null, started: Date.now(), open: false };
    pc.onicecandidate = (e) => { if (e.candidate) call('sendSignal', peerId, { k: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.close(peerId); };
    pc.ondatachannel = (e) => this.wire(peerId, link, e.channel);
    this.links.set(peerId, link);
    return link;
  }

  private wire(peerId: string, link: Link, dc: RTCDataChannel) {
    link.dc = dc;
    dc.onopen = () => { link.open = true; call('setDirect', peerId, true); };
    dc.onclose = () => this.close(peerId);
    dc.onmessage = (e) => { if (typeof e.data === 'string' && e.data.length < 96 * 1024) call('receiveDirect', peerId, e.data); };
  }

  private async start(peerId: string) {
    const link = this.make(peerId);
    this.wire(peerId, link, link.pc.createDataChannel('sigil', { ordered: true }));
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    call('sendSignal', peerId, { k: 'offer', sdp: offer.sdp });
  }

  private async onSignal(from: string, data: any) {
    if (!data || typeof data !== 'object' || !this.eligible(from)) return;
    try {
      if (data.k === 'offer' && typeof data.sdp === 'string') {
        this.close(from, false);
        const link = this.make(from);
        await link.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        call('sendSignal', from, { k: 'answer', sdp: answer.sdp });
      } else if (data.k === 'answer' && typeof data.sdp === 'string') {
        await this.links.get(from)?.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } else if (data.k === 'ice' && data.c) {
        await this.links.get(from)?.pc.addIceCandidate(data.c);
      }
    } catch {
      this.close(from);
    }
  }

  private reap() {
    for (const [id, l] of this.links) if (!l.open && Date.now() - l.started > 15_000) this.close(id);
  }

  private close(peerId: string, backoff = true) {
    const l = this.links.get(peerId);
    if (!l) return;
    this.links.delete(peerId);
    try { l.dc?.close(); l.pc.close(); } catch { /* already closed */ }
    if (backoff) this.cooldown.set(peerId, Date.now() + 60_000);
    call('setDirect', peerId, false);
  }
}
