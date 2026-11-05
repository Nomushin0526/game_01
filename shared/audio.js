// 全ゲーム共通: Web Audio で鳴らす簡易サウンド（音源ファイル不要）
(function () {
  'use strict';
  const NS = (window.GameShared = window.GameShared || {});
  const storage = NS.storage;

  let ctx = null;
  let master = null;
  let muted = storage ? storage.get('shared.muted', false) : false;
  const VOLUME = 0.45;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 単音。type: square / triangle / sine / sawtooth
  function tone(freq, dur, opts) {
    const o = opts || {};
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(o.vol == null ? 0.18 : o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // ノイズ（衝突音など）
  function noise(dur, opts) {
    const o = opts || {};
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + (o.delay || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.cutoff || 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol == null ? 0.3 : o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
  }

  NS.audio = {
    unlock: ensure,
    tone,
    noise,
    get muted() {
      return muted;
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : VOLUME;
      if (storage) storage.set('shared.muted', muted);
    },
  };
})();
