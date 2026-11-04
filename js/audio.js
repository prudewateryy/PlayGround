/* ============================================================
   Procedural forest ambience — wind, leaves, birds, footsteps
   ============================================================ */

export class ForestAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.volume = 0.4;
    this.started = false;
    this.paused = false;
    this.birdTimer = null;
  }

  async start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {});
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      this.ctx = new AudioCtx();
      await this.ctx.resume().catch(() => {});
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoiseBuffer(4);

      this.wind = this.makeWind();
      this.leaves = this.makeLeaves();
      this.started = true;
      this.setVolume(this.volume);
      this.scheduleBird();
    } catch {
      this.started = false;
    }
  }

  makeNoiseBuffer(seconds, brown = true) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.1;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  makeWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0.5;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.075;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);

    const body = ctx.createGain();
    body.gain.value = 0.34;

    src.connect(filter).connect(gain).connect(body).connect(this.master);
    src.start();
    lfo.start();
    return { src, gain, body };
  }

  makeLeaves() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1.3;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;

    const gain = ctx.createGain();
    gain.gain.value = 0.012;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(gain.gain);

    src.connect(hp).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    return { src, gain };
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (!this.master || !this.ctx) return;
    const target = this.paused ? this.volume * 0.24 : this.volume;
    this.master.gain.setTargetAtTime(target * 0.75, this.ctx.currentTime, 0.25);
  }

  setPaused(paused) {
    this.paused = paused;
    this.setVolume(this.volume);
  }

  scheduleBird() {
    if (!this.started) return;
    clearTimeout(this.birdTimer);
    const delay = 3500 + Math.random() * 8000;
    this.birdTimer = setTimeout(() => {
      if (!this.paused && this.ctx?.state === 'running') this.chirp();
      this.scheduleBird();
    }, delay);
  }

  chirp() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = 1 + Math.floor(Math.random() * 3);
    const base = 1750 + Math.random() * 1000;
    for (let n = 0; n < notes; n++) {
      const t = now + n * (0.09 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.type = Math.random() > 0.55 ? 'sine' : 'triangle';
      const startFreq = base * (0.86 + Math.random() * 0.3);
      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(startFreq * (1.22 + Math.random() * 0.35), t + 0.045);
      osc.frequency.exponentialRampToValueAtTime(startFreq * 0.92, t + 0.13);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.022 + Math.random() * 0.016, t + 0.016);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      if (pan) {
        pan.pan.value = Math.random() * 1.4 - 0.7;
        osc.connect(gain).connect(pan).connect(this.master);
      } else {
        osc.connect(gain).connect(this.master);
      }
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  footstep(surface = 'duff') {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = surface === 'trail' ? 520 : 820;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055 + Math.random() * 0.02, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.random() * 2.5, 0.16);
  }

  jump() {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.02, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  land() {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.45;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, 0.2, 0.24);
  }
}
