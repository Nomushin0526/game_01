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

  // ---------- BGM（音源ファイルなしの簡易シーケンサー） ----------
  // song: { bpm, root(MIDI), prog: [和音の根音のずれ ×4小節], minor }
  const music = { timer: null, song: null, step: 0, next: 0, hype: false, gain: null };
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  function mvoice(type, freq, t, dur, vol, slideTo) {
    const c = ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(music.gain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  let noiseBuf = null;
  function mnoise(t, dur, vol, hp) {
    const c = ctx;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = hp ? 'highpass' : 'bandpass';
    f.frequency.value = hp ? 7000 : 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(music.gain);
    src.start(t, 0, dur + 0.02);
  }
  const ARP = [0, 2, 1, 2, 0, 2, 1, 3];
  function scheduleStep(t) {
    const s = music.song;
    const st = music.step % 16;
    const bar = Math.floor(music.step / 16) % s.prog.length;
    const root = s.root + s.prog[bar];
    const third = s.minor && (bar === 0 || bar === 2) ? 3 : 4;
    const chord = [root, root + third, root + 7, root + 12];
    const sixteenth = 60 / s.bpm / 4;
    const hype = music.hype;
    // ドラム
    if (st % 4 === 0 || (hype && st === 14)) mvoice('sine', 150, t, 0.16, 0.5, 45);
    if (st === 4 || st === 12) mnoise(t, 0.12, 0.25, false);
    if (st % 2 === 1 || hype) mnoise(t, 0.035, hype ? 0.09 : 0.06, true);
    // ベース
    if ([0, 3, 6, 8, 10, 11, 14].includes(st)) mvoice('square', midi(root - 24 + (st === 14 ? 12 : 0)), t, sixteenth * 1.6, 0.07);
    // メロディ（分散和音）。タイムセール中は1オクターブ上でにぎやかに
    if (st % 2 === 0 || hype) {
      const n = chord[ARP[(st >> (hype ? 0 : 1)) % ARP.length]] + (hype ? 12 : 0);
      mvoice(hype ? 'square' : 'triangle', midi(n), t, sixteenth * 1.4, hype ? 0.05 : 0.08);
    }
    music.step++;
    return sixteenth;
  }
  function playMusic(song) {
    const c = ensure();
    if (!c) return;
    stopMusic();
    if (!music.gain) {
      music.gain = c.createGain();
      music.gain.gain.value = 0.55;
      music.gain.connect(master);
    }
    music.song = song;
    music.step = 0;
    music.next = c.currentTime + 0.05;
    music.timer = setInterval(() => {
      // ミュート中や画面が裏に回っていた後に、溜まった音をまとめて鳴らさない
      if (muted || music.next < ctx.currentTime - 0.1) music.next = ctx.currentTime + 0.05;
      if (muted) return;
      while (music.next < ctx.currentTime + 0.15) music.next += scheduleStep(music.next);
    }, 25);
  }
  function stopMusic() {
    if (music.timer) clearInterval(music.timer);
    music.timer = null;
  }

  NS.audio = {
    playMusic,
    stopMusic,
    setHype(v) {
      music.hype = !!v;
    },
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
