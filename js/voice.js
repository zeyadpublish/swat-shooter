// v1.6 voice chat over PeerJS media calls (WebRTC audio). Star topology like the data channels:
// every client calls the host with its microphone; the host answers each call with a mix of its own mic and
// all the other clients, so everyone hears everyone. Mic chain: getUserMedia -> MIC VOLUME -> gate -> call.
// Gate: PUSH-TO-TALK (hold B / the TALK button), OPEN MIC (opens above the MIC INPUT THRESHOLD), MUTED; MUTE ON DEATH.
// Incoming voice plays through the VOICE bus (VOICE CHAT VOLUME). Not available on the local test relay transport.
const $ = (id) => document.getElementById(id);
export class Voice {
  constructor(g) {
    this.g = g; this.calls = new Map(); this.srcs = new Map(); this.dests = new Map(); this.state = 'idle'; this.err = ''; this.ptt = false; this.level = 0;
    addEventListener('keydown', (e) => { if (e.code === 'KeyB' && !e.repeat && !(g.mp && g.mp.chatOpen)) this.ptt = true; });
    addEventListener('keyup', (e) => { if (e.code === 'KeyB') this.ptt = false; });
    const t = $('tTalk'); if (t) { const on = (v) => (e) => { e.preventDefault(); e.stopPropagation(); this.ptt = v; t.classList.toggle('on', v); };
      t.addEventListener('touchstart', on(true), { passive: false }); t.addEventListener('touchend', on(false), { passive: false }); t.addEventListener('touchcancel', on(false), { passive: false }); }
    setInterval(() => this.tick(), 500); this.raf();
  }
  get s() { return this.g.settings; }
  get net() { return this.g.mp && this.g.mp.active && this.g.mp.net; }
  statusText() {
    const s = this.s; if (!s.voip) return 'Voice chat off';
    if (this.state === 'live') return `Voice live · ${this.calls.size} connected · ${s.micMode === 'ptt' ? (this.g.mobile ? 'hold TALK' : 'hold B') + ' to talk' : s.micMode === 'open' ? 'open mic' : 'mic muted'}`;
    if (this.state === 'unsupported') return 'Voice chat needs the online (PeerJS) transport';
    if (this.state === 'denied') return 'Microphone blocked: ' + this.err;
    return 'Voice chat starts in multiplayer matches';
  }
  configure() { if (!this.s.voip) this.stop(); this.apply(); }
  tick() {
    const n = this.net, want = this.s.voip && n && n.peer && !this.g.testMode;
    if (!want) { if (this.state === 'live' || this.state === 'starting') this.stop(); if (n && n.peer && typeof n.peer.call !== 'function') this.state = 'unsupported'; return; }
    if (typeof n.peer.call !== 'function') { this.state = 'unsupported'; return; }
    if (this.state === 'idle' || (this.state === 'unsupported')) this.start(n);
    else if (this.state === 'live' && !n.isHost && !this.calls.size && n.conns.size) this.callHost(n);
    document.body.classList.toggle('voiceptt', this.state === 'live' && this.s.micMode === 'ptt');
  }
  async start(n) {
    this.state = 'starting'; const sfx = this.g.sfx; sfx.init(); const ctx = sfx.ctx; if (!ctx) { this.state = 'idle'; return; }
    try { this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { this.state = 'denied'; this.err = e.name || String(e); return; }
    if (this.net !== n) { this.mic.getTracks().forEach(t => t.stop()); this.state = 'idle'; return; }
    this.peer = n.peer; this.isHost = n.isHost;
    const src = ctx.createMediaStreamSource(this.mic); this.micGain = ctx.createGain(); this.gate = ctx.createGain(); this.gate.gain.value = 0;
    this.an = ctx.createAnalyser(); this.an.fftSize = 512; this.buf = new Float32Array(512);
    src.connect(this.micGain); this.micGain.connect(this.an); this.micGain.connect(this.gate);
    this.myDest = ctx.createMediaStreamDestination(); this.gate.connect(this.myDest); // client: my gated mic -> the call
    this.onCall = (call) => this.answer(call); this.peer.on('call', this.onCall);
    this.state = 'live'; this.apply(); if (!this.isHost) this.callHost(n);
  }
  callHost(n) { const hostId = [...n.conns.keys()][0]; if (!hostId || this.calls.has(hostId)) return; try { const c = this.peer.call(hostId, this.myDest.stream); this.wire(c); } catch (e) {} }
  answer(call) {
    const ctx = this.g.sfx.ctx;
    if (!this.isHost) { call.answer(this.myDest.stream); this.wire(call); return; }
    // host: each caller gets its own mix (host mic + every other caller)
    const d = ctx.createMediaStreamDestination(); this.gate.connect(d); this.dests.set(call.peer, d);
    for (const [pid, s] of this.srcs) if (pid !== call.peer) s.connect(d);
    call.answer(d.stream); this.wire(call);
  }
  wire(call) {
    this.calls.set(call.peer, call);
    call.on('stream', (st) => {
      const ctx = this.g.sfx.ctx; if (this.srcs.has(call.peer)) return;
      const el = new Audio(); el.muted = true; el.srcObject = st; el.play().catch(() => {}); // Chrome only flows remote WebRTC audio into WebAudio when a media element holds it
      const s = ctx.createMediaStreamSource(st); s.connect(this.g.sfx.voiceBus); this.srcs.set(call.peer, s); call._el = el;
      if (this.isHost) for (const [pid, d] of this.dests) if (pid !== call.peer) s.connect(d);
    });
    const end = () => { this.calls.delete(call.peer); const s = this.srcs.get(call.peer); if (s) { try { s.disconnect(); } catch (e) {} } this.srcs.delete(call.peer); const d = this.dests.get(call.peer); if (d) { try { this.gate.disconnect(d); } catch (e) {} } this.dests.delete(call.peer); };
    call.on('close', end); call.on('error', end);
  }
  stop() {
    for (const c of this.calls.values()) { try { c.close(); } catch (e) {} } this.calls.clear(); this.srcs.clear(); this.dests.clear();
    if (this.peer && this.onCall) { try { this.peer.off('call', this.onCall); } catch (e) {} }
    if (this.mic) this.mic.getTracks().forEach(t => t.stop()); this.mic = null; this.peer = null; this.state = 'idle'; document.body.classList.remove('voiceptt');
  }
  apply() { if (this.micGain) this.micGain.gain.value = (this.s.micVol ?? 0.75) * 1.6; }
  // gate + level meter
  raf() {
    requestAnimationFrame(() => this.raf()); if (!this.an || this.state !== 'live') return;
    this.an.getFloatTimeDomainData(this.buf); let r = 0; for (const v of this.buf) r += v * v; r = Math.sqrt(r / this.buf.length);
    this.level += (Math.min(1, r * 6) - this.level) * 0.3; const s = this.s, p = this.g.player;
    let open = s.micMode === 'ptt' ? this.ptt : s.micMode === 'open' ? this.level > (s.micThr ?? 0.35) * 0.6 : false;
    if (s.muteDeath && p && p.dead) open = false;
    this.gate.gain.setTargetAtTime(open ? 1 : 0, this.g.sfx.ctx.currentTime, 0.02);
    const m = $('micLvl'); if (m) m.style.width = (this.level * 100).toFixed(0) + '%';
    const vi = $('voiceInd'); if (vi) vi.textContent = open ? '● TRANSMITTING' : '';
  }
}
