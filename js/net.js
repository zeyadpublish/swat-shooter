// Peer-to-peer transport (WebRTC data channels via PeerJS). Signalling uses the free public PeerJS broker
// (0.peerjs.com) unless ?peerhost=&peerport=&peerpath=&peersecure= point at another PeerServer.
// The host registers the peer id PREFIX + room code; clients connect to it. Messages are small JSON objects.
const PREFIX = 'swat-us-';
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
export const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

// ICE / TURN configuration (for players behind strict NATs). Sources, later ones win:
//  1. defaults: Google public STUN
//  2. netconfig.json next to index.html (optional): { "iceServers": [...], "iceTransportPolicy": "all"|"relay",
//     "credentialsUrl": "https://.../turn-credentials" (must return { iceServers: [...] } or [...]), "peer": { host, port, path, secure, key } }
//     Works with Metered (its credentials API URL) or a small Cloudflare Worker that mints Cloudflare TURN credentials.
//  3. localStorage 'swat-netconfig' (same JSON; handy for testing on a phone)
//  4. URL: ?turn=turn:host:3478&turnuser=U&turnpass=P (repeatable turn=), ?ice=<URL-encoded JSON array>, ?icerelay=1,
//     ?peerhost=&peerport=&peerpath=&peersecure=1&peerkey=
export const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let netCfgP = null;
export function loadNetConfig() {
  if (netCfgP) return netCfgP;
  return (netCfgP = (async () => {
    const cfg = { iceServers: DEFAULT_ICE.slice(), iceTransportPolicy: 'all', peer: null, source: ['default'] };
    const merge = (c, src) => {
      if (!c || typeof c !== 'object') return;
      if (Array.isArray(c.iceServers) && c.iceServers.length) cfg.iceServers = c.extendDefaults ? DEFAULT_ICE.concat(c.iceServers) : c.iceServers;
      if (c.iceTransportPolicy === 'relay' || c.iceTransportPolicy === 'all') cfg.iceTransportPolicy = c.iceTransportPolicy;
      if (c.peer && c.peer.host) cfg.peer = c.peer;
      if (c.credentialsUrl) cfg.credentialsUrl = c.credentialsUrl;
      cfg.source.push(src);
    };
    try { const r = await fetch('netconfig.json', { cache: 'no-store' }); if (r.ok) merge(await r.json(), 'netconfig.json'); } catch (e) {}
    try { merge(JSON.parse(localStorage.getItem('swat-netconfig') || 'null'), 'localStorage'); } catch (e) {}
    const q = new URLSearchParams(location.search);
    try { if (q.get('ice')) merge({ iceServers: JSON.parse(q.get('ice')) }, 'url'); } catch (e) { console.warn('bad ?ice= JSON'); }
    const turns = q.getAll('turn').filter(u => /^turns?:/.test(u));
    if (turns.length) merge({ iceServers: turns.map(u => ({ urls: u, username: q.get('turnuser') || undefined, credential: q.get('turnpass') || undefined })), extendDefaults: true }, 'url');
    if (q.get('icerelay') === '1') cfg.iceTransportPolicy = 'relay';
    if (q.get('peerhost')) cfg.peer = { host: q.get('peerhost'), port: +(q.get('peerport') || 9000), path: q.get('peerpath') || '/', secure: q.get('peersecure') === '1', key: q.get('peerkey') || 'peerjs' };
    if (cfg.credentialsUrl) { // short-lived TURN credentials from a provider endpoint
      try { const r = await timeout(fetch(cfg.credentialsUrl, { cache: 'no-store' }), 6000, 'timeout'); const j = await r.json(); const list = Array.isArray(j) ? j : j.iceServers; if (Array.isArray(list) && list.length) { cfg.iceServers = DEFAULT_ICE.concat(list); cfg.source.push('credentialsUrl'); } } catch (e) { console.warn('TURN credentials fetch failed', e); }
    }
    window.__netcfg = cfg; return cfg;
  })());
}
async function peerOptions() {
  const c = await loadNetConfig();
  const o = { debug: 0, config: { iceServers: c.iceServers, iceTransportPolicy: c.iceTransportPolicy } };
  if (c.peer) Object.assign(o, { host: c.peer.host, port: +(c.peer.port || 443), path: c.peer.path || '/', secure: c.peer.secure !== false && c.peer.secure !== '0', key: c.peer.key || 'peerjs' });
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
        const peer = new Peer(PREFIX + code, await peerOptions());
        await timeout(new Promise((res, rej) => { peer.once('open', res); peer.once('error', rej); }), 12000, 'The matchmaking server did not answer.');
        this.peer = peer; this.code = code; this.wire(); return code;
      } catch (e) { if (!(e && e.type === 'unavailable-id')) throw e; }
    }
    throw new Error('Could not reserve a room code. Try again.');
  }
  async join(code) {
    const Peer = await loadPeer(); this.isHost = false; this.code = code;
    const peer = this.peer = new Peer(await peerOptions());
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

// Offline room (bot matches without a network): same interface as Net, nothing is sent anywhere.
export class LocalNet {
  constructor() { this.peer = null; this.conns = new Map(); this.isHost = true; this.local = true; this.code = 'LOCAL'; }
  async host() { return 'LOCAL'; }
  broadcast() {} send() {} kick() {} checkTimeouts() {} close() {}
}
