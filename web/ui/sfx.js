// ui/sfx.js
// Lightweight WebAudio SFX manager with simple synthesized sounds

export class SFX {
  constructor() {
    this.ctx = null;
    this.cool = new Map();
    this.master = null;
    this.muted = false;
    this.volume = 0.1;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) { this.muted = !!m; if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master && !this.muted) this.master.gain.value = this.volume; }

  can(name, ms=60) {
    const now = performance.now();
    const until = this.cool.get(name) || 0;
    if (now < until) return false;
    this.cool.set(name, now + ms);
    return true;
  }

  playOsc({ type='sine', freq=300, to=300, dur=0.08, gain=0.4 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (to !== freq) o.frequency.linearRampToValueAtTime(to, t0 + dur);
    g.gain.value = gain; g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur);
  }

  playNoise({ dur=0.08, gain=0.3, type='bandpass', freq=1000, q=1.0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
    const src = this.ctx.createBufferSource(); src.buffer = buffer;
    let node = src;
    if (type) {
      const biquad = this.ctx.createBiquadFilter();
      biquad.type = type; biquad.frequency.value = freq; biquad.Q.value = q;
      node.connect(biquad); node = biquad;
    }
    const g = this.ctx.createGain(); g.gain.value = gain;
    node.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur);
  }

  // Sound palette
  moveFree() { if (this.can('moveFree')) this.playOsc({ type:'triangle', freq:380, to:300, dur:0.08, gain:0.25 }); }
  moveInboxThump() { if (this.can('moveInboxThump')) this.playOsc({ type:'sine', freq:110, to:90, dur:0.08, gain:0.35 }); }
  enterBoxDeep() { if (this.can('enterBox', 120)) this.playOsc({ type:'sawtooth', freq:220, to:120, dur:0.10, gain:0.35 }); }
  exitBoxBright() { if (this.can('exitBox', 120)) this.playOsc({ type:'triangle', freq:600, to:800, dur:0.08, gain:0.22 }); }
  launchWhoosh() { if (this.can('whoosh', 120)) this.playNoise({ dur:0.10, gain:0.20, type:'highpass', freq:1200, q:0.5 }); }
  fallThud() { if (this.can('fall', 120)) this.playOsc({ type:'sine', freq:160, to:60, dur:0.10, gain:0.4 }); }
  winJingle() {
    if (!this.can('win', 200)) return;
    this.playOsc({ type:'triangle', freq:440, to:660, dur:0.06, gain:0.25 });
    setTimeout(()=> this.playOsc({ type:'triangle', freq:550, to:770, dur:0.06, gain:0.25 }), 60);
  }
  cracklePop() { if (this.can('crackle', 40)) this.playNoise({ dur:0.04, gain:0.18, type:'bandpass', freq:1800, q:7 }); }
  loseTone() { if (this.can('lose', 200)) this.playOsc({ type:'sine', freq:360, to:180, dur:0.10, gain:0.3 }); }
  bump() { if (this.can('bump', 80)) this.playNoise({ dur:0.05, gain:0.15, type:'bandpass', freq:800, q:6 }); }

  playEffects(effects = [], state) {
    if (!effects.length) return;
    this.ensure();
    // Derive whether last player move was inbox or free from current state
    const mode = (state && state.entities && state.entities.find(e=>e.type==='player')?.state?.mode) || 'free';
    let playedLaunch = false;
    for (const ef of effects) {
      if (ef.type === 'playerEnteredBox') this.enterBoxDeep();
      else if (ef.type === 'playerExitedBox') this.exitBoxBright();
      else if (ef.type === 'playerLaunched') { this.launchWhoosh(); playedLaunch = true; }
      else if (ef.type === 'boxFell') this.fallThud();
      else if (ef.type === 'entityMoved' && ef.entityType === 'player') {
        // suppress step if launch already played; otherwise choose by mode
        if (!playedLaunch) {
          if (mode === 'inbox') this.moveInboxThump(); else this.moveFree();
        }
      }
    }
  }
}

