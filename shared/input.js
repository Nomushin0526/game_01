// 全ゲーム共通: キーボード + タッチ/マウス入力
// 画面の左半分を押している = 左、右半分 = 右 として axisX() に反映する
(function () {
  'use strict';
  const NS = (window.GameShared = window.GameShared || {});
  const BLOCK = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

  class Input {
    constructor(touchTarget) {
      this.keys = new Set();
      this.pressed = new Set();
      this.pointers = new Map(); // pointerId -> 0..1 の横位置

      window.addEventListener('keydown', (e) => {
        if (BLOCK.includes(e.code)) e.preventDefault();
        if (!this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => {
        this.keys.clear();
        this.pointers.clear();
      });

      if (touchTarget) {
        const t = touchTarget;
        const pos = (e) => {
          const r = t.getBoundingClientRect();
          return (e.clientX - r.left) / Math.max(1, r.width);
        };
        t.addEventListener('pointerdown', (e) => {
          this.pointers.set(e.pointerId, pos(e));
          try {
            t.setPointerCapture(e.pointerId);
          } catch (err) {
            /* ignore */
          }
        });
        t.addEventListener('pointermove', (e) => {
          if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, pos(e));
        });
        const end = (e) => this.pointers.delete(e.pointerId);
        t.addEventListener('pointerup', end);
        t.addEventListener('pointercancel', end);
        t.addEventListener('lostpointercapture', end);
      }
    }

    down(...codes) {
      return codes.some((c) => this.keys.has(c));
    }

    // このフレームで押された瞬間か（endFrame でリセット）
    wasPressed(...codes) {
      return codes.some((c) => this.pressed.has(c));
    }

    // -1（左）〜 1（右）
    axisX() {
      let a = 0;
      if (this.down('ArrowLeft', 'KeyA')) a -= 1;
      if (this.down('ArrowRight', 'KeyD')) a += 1;
      for (const v of this.pointers.values()) a += v < 0.5 ? -1 : 1;
      return Math.max(-1, Math.min(1, a));
    }

    endFrame() {
      this.pressed.clear();
    }
  }

  NS.Input = Input;
  NS.isTouchDevice = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
})();
