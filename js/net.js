// Peer-to-peer transport (WebRTC data channels via PeerJS). Signalling uses the free public PeerJS broker
// (0.peerjs.com) unless ?peerhost=&peerport=&peerpath=&peersecure= point at another PeerServer.
// The host registers the peer id PREFIX + room code; clients connect to it. Messages are small JSON objects.
const PREFIX = 'swat-us-';
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
export const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function peerOptions() {
  const q = new URLSearchParams(location.search), o = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } };
  if (q.get('peerhost')) { o.host = q.get('peerhost'); o.port = +(q.get('peerport') || 9000); o.path = q.get('peerpath') || '/'; o.secure = q.get('peersecure') === '1'; o.key = q.get('peerkey') || 'peerjs'; }
  return o;
}
async function loadPeer() {
  const relay = new URLSearchParams(location.search).get('relay');
  if (relay && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(relay)) return relayPeerClass(relay); // test-only, local relay only
  if (window.Peer) return window.Peer;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'libs/peerjs/peerjs.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the networking library')); document.head.appendChild(s); });
  return window.Peer;
}
const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
const ERR = {
  'peer-unavailable': 'Room not found. Check the code, or the host may have closed the room.',
  'network': 'Cannot reach the matchmaking server. Check your internet connection.',
  'server-error': 'The matchmaking server is not responding. Try again in a moment.',
  'browser-incompatible': 'This browser does not support WebRTC multiplayer.',
  'socket-error': 'Lost the connection to the matchmaking server.', 'socket-closed': 'Lost the connection to the matchmaking server.',
  'unavailable-id': 'That room code is taken.', 'webrtc': 'A WebRTC error occurred (network blocked?).',
};
export const errText = (e) => (e && (ERR[e.type] || e.message)) || 'Connection failed';

export class Net {
  constructor() { this.peer = null; this.conns = new Map(); this.isHost = false; this.onData = null; this.onOpen = null; this.onClose = null; this.onError = null; }
  // host: register PREFIX+code with the broker, accept incoming connections
  async host() {
    const Peer = await loadPeer(); this.isHost = true;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        const peer = new Peer(PREFIX + code, peerOptions());
        await timeout(new Promise((res, rej) => { peer.once('open', res); peer.once('error', rej); }), 12000, 'The matchmaking server did not answer.');
        this.peer = peer; this.code = code; this.wire(); return code;
      } catch (e) { if (!(e && e.type === 'unavailable-id')) throw e; }
    }
    throw new Error('Could not reserve a room code. Try again.');
  }
  async join(code) {
    const Peer = await loadPeer(); this.isHost = false; this.code = code;
    const peer = this.peer = new Peer(peerOptions());
    await timeout(new Promise((res, rej) => { peer.once('open', res); peer.once('error', rej); }), 12000, 'The matchmaking server did not answer.');
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    await timeout(new Promise((res, rej) => { conn.once('open', res); peer.once('error', rej); conn.once('error', rej); }), 15000, 'Could not connect to the host (room closed or network blocked).');
    this.addConn(conn); this.wire(); return conn;
  }
  wire() {
    const p = this.peer;
    p.on('connection', (conn) => { if (!this.isHost) { conn.close(); return; } conn.on('open', () => this.addConn(conn)); });
    p.on('error', (e) => this.onError && this.onError(e));
    p.on('disconnected', () => { // lost the broker: existing peer links keep working; reconnect so new players can still join
      if (!this.closed) setTimeout(() => { try { if (!this.closed && p.disconnected && !p.destroyed) p.reconnect(); } catch (e) {} }, 1500);
    });
  }
  addConn(conn) {
    if (this.conns.has(conn.peer)) return;
    this.conns.set(conn.peer, conn); conn.lastRx = performance.now();
    conn.on('data', (d) => { conn.lastRx = performance.now(); if (d && typeof d === 'object' && this.onData) this.onData(conn.peer, d); });
    const gone = () => { if (this.closed || !this.conns.has(conn.peer)) return; this.conns.delete(conn.peer); this.onClose && this.onClose(conn.peer); };
    conn.on('close', gone); conn.on('error', gone); conn.gone = gone;
    this.onOpen && this.onOpen(conn.peer);
  }
  send(pid, msg) { const c = this.conns.get(pid); if (c && c.open) { try { c.send(msg); } catch (e) {} } }
  broadcast(msg, except) { for (const [pid, c] of this.conns) if (pid !== except && c.open) { try { c.send(msg); } catch (e) {} } }
  // drop links that have been silent too long (tab closed without a clean goodbye, network loss)
  checkTimeouts(ms = 8000) { const now = performance.now(); for (const c of [...this.conns.values()]) if (now - c.lastRx > ms) { try { c.close(); } catch (e) {} c.gone(); } }
  kick(pid) { const c = this.conns.get(pid); if (c) { try { c.close(); } catch (e) {} c.gone(); } }
  close() { this.closed = true; this.onClose = this.onData = null; for (const c of this.conns.values()) { try { c.close(); } catch (e) {} } this.conns.clear(); try { this.peer && this.peer.destroy(); } catch (e) {} this.peer = null; }
}

// ---- TEST-ONLY transport: a PeerJS-compatible shim over a local WebSocket relay (tools/relay.mjs).
// Only enabled by ?relay=ws://127.0.0.1:PORT; lets the multiplayer code run end-to-end in sandboxes where browsers
// cannot open WebRTC data channels. Never used by default.
class Emitter {
  constructor() { this._h = {}; }
  on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; }
  once(e, f) { const w = (...a) => { this.off(e, w); f(...a); }; return this.on(e, w); }
  off(e, f) { this._h[e] = (this._h[e] || []).filter(x => x !== f); return this; }
  emit(e, ...a) { for (const f of [...(this._h[e] || [])]) f(...a); }
}
function relayPeerClass(url) {
  class RelayConn extends Emitter {
    constructor(peer, remote, cid) { super(); this.p = peer; this.peer = remote; this.cid = cid; this.open = false; }
    send(d) { if (this.open) this.p.ws.send(JSON.stringify({ t: 'd', to: this.peer, cid: this.cid, d })); }
    close() { if (!this.open) return; this.open = false; try { this.p.ws.send(JSON.stringify({ t: 'cl', to: this.peer, cid: this.cid })); } catch (e) {} this.p.conns.delete(this.cid); this.emit('close'); }
    _closed() { if (!this.open) return; this.open = false; this.p.conns.delete(this.cid); this.emit('close'); }
  }
  return class RelayPeer extends Emitter {
    constructor(id, opts) {
      super(); if (typeof id === 'object') id = null; this.conns = new Map(); this.disconnected = false; this.destroyed = false;
      const ws = this.ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'reg', id }));
      ws.onerror = () => this.emit('error', { type: 'network', message: 'relay unreachable' });
      ws.onclose = () => { for (const c of [...this.conns.values()]) c._closed(); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'open') { this.id = m.id; this.emit('open', m.id); }
        else if (m.t === 'err') { const c = m.cid && this.conns.get(m.cid); if (c) { this.conns.delete(m.cid); } this.emit('error', { type: m.type, message: m.type }); }
        else if (m.t === 'conn') { const c = new RelayConn(this, m.from, m.cid); this.conns.set(m.cid, c); this.emit('connection', c); setTimeout(() => { c.open = true; ws.send(JSON.stringify({ t: 'acc', to: m.from, cid: m.cid })); c.emit('open'); }, 0); }
        else if (m.t === 'acc') { const c = this.conns.get(m.cid); if (c) { c.open = true; c.emit('open'); } }
        else if (m.t === 'd') { const c = this.conns.get(m.cid); if (c && c.open) c.emit('data', m.d); }
        else if (m.t === 'cl') { const c = this.conns.get(m.cid); if (c) c._closed(); }
        else if (m.t === 'gone') { for (const c of [...this.conns.values()]) if (c.peer === m.id) c._closed(); }
      };
    }
    connect(remote) { const cid = Math.random().toString(36).slice(2); const c = new RelayConn(this, remote, cid); this.conns.set(cid, c); this.ws.send(JSON.stringify({ t: 'conn', to: remote, cid })); return c; }
    reconnect() {}
    destroy() { this.destroyed = true; for (const c of [...this.conns.values()]) c.close(); try { this.ws.close(); } catch (e) {} }
  };
}
