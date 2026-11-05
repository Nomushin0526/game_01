// 全ゲーム共通: 入力（スマホのタッチ操作が基本。PCでの確認用にキーボードも受け付ける）
//
// - ドラッグ: 指を置いて動かした横方向の移動量を consumeDragX() で受け取る（指でなぞる操作）
// - 左右タッチ: touchAxis() で「画面の左右どちらを押しているか」を -1 / 0 / 1 で受け取る
// - キーボード: axisX() で ←→ / A D を -1 / 0 / 1 で受け取る
// - スワイプ: 指をすばやく上下に払うと consumeSwipes() に 'up' / 'down' が入る（指を置いたままの途中でもOK）
(function () {
  'use strict';
  const NS = (window.GameShared = window.GameShared || {});
  const BLOCK = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

  class Input {
    constructor(touchTarget) {
      this.keys = new Set();
      this.pressed = new Set();
      this.pointers = new Map(); // pointerId -> { x0..1, lastX(px) }
      this.dragId = null;
      this.dragDX = 0;
      this.swipes = [];

      window.addEventListener('keydown', (e) => {
        if (BLOCK.includes(e.code)) e.preventDefault();
        if (!this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.reset());

      if (!touchTarget) return;
      const t = touchTarget;
      const rel = (e) => {
        const r = t.getBoundingClientRect();
        return (e.clientX - r.left) / Math.max(1, r.width);
      };
      t.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pointers.set(e.pointerId, { x: rel(e), lastX: e.clientX, hist: [{ t: performance.now(), x: e.clientX, y: e.clientY }], cool: 0 });
        if (this.dragId === null) this.dragId = e.pointerId;
        try {
          t.setPointerCapture(e.pointerId);
        } catch (err) {
          /* ignore */
        }
      });
      t.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        if (e.pointerId === this.dragId) this.dragDX += e.clientX - p.lastX;
        p.lastX = e.clientX;
        p.x = rel(e);
        // 直近 0.13 秒の動きで上下のフリックを判定
        const now = performance.now();
        p.hist.push({ t: now, x: e.clientX, y: e.clientY });
        while (p.hist.length > 2 && now - p.hist[0].t > 130) p.hist.shift();
        if (now > p.cool) {
          const a = p.hist[0];
          const dy = e.clientY - a.y;
          const dx = e.clientX - a.x;
          if (Math.abs(dy) > 34 && Math.abs(dy) > Math.abs(dx) * 1.2) {
            this.swipes.push(dy < 0 ? 'up' : 'down');
            p.cool = now + 260;
            p.hist = [{ t: now, x: e.clientX, y: e.clientY }];
          }
        }
      });
      const end = (e) => {
        this.pointers.delete(e.pointerId);
        if (e.pointerId === this.dragId) {
          // 別の指が残っていればそちらに引き継ぐ
          const next = this.pointers.keys().next();
          this.dragId = next.done ? null : next.value;
        }
      };
      t.addEventListener('pointerup', end);
      t.addEventListener('pointercancel', end);
      t.addEventListener('lostpointercapture', end);
      // 長押しメニューや選択を出さない
      t.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    consumeSwipes() {
      const s = this.swipes;
      this.swipes = [];
      return s;
    }

    reset() {
      this.swipes = [];
      this.keys.clear();
      this.pointers.clear();
      this.dragId = null;
      this.dragDX = 0;
    }

    down(...codes) {
      return codes.some((c) => this.keys.has(c));
    }

    // このフレームで押された瞬間か（endFrame でリセット）
    wasPressed(...codes) {
      return codes.some((c) => this.pressed.has(c));
    }

    // キーボードの左右 (-1〜1)
    axisX() {
      let a = 0;
      if (this.down('ArrowLeft', 'KeyA')) a -= 1;
      if (this.down('ArrowRight', 'KeyD')) a += 1;
      return a;
    }

    // 画面の左右どちらを押しているか (-1〜1)
    touchAxis() {
      let a = 0;
      for (const p of this.pointers.values()) a += p.x < 0.5 ? -1 : 1;
      return Math.max(-1, Math.min(1, a));
    }

    // 前回呼んでからの指の横移動量（px）
    consumeDragX() {
      const d = this.dragDX;
      this.dragDX = 0;
      return d;
    }

    get touching() {
      return this.pointers.size > 0;
    }

    endFrame() {
      this.pressed.clear();
    }
  }

  NS.Input = Input;
  NS.isTouchDevice = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
})();
