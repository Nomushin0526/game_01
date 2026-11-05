// 全ゲーム共通: スマホの振動（Android の Chrome 等。iPhone の Safari は未対応のため何も起きない）
(function () {
  'use strict';
  const NS = (window.GameShared = window.GameShared || {});
  const storage = NS.storage;
  let enabled = storage ? storage.get('shared.vibrate', true) : true;

  NS.haptics = {
    get supported() {
      return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    },
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = !!v;
      if (storage) storage.set('shared.vibrate', enabled);
    },
    // ms か [振動, 休み, 振動...] のパターン
    vibrate(pattern) {
      if (!enabled || !this.supported) return;
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        /* ignore */
      }
    },
  };
})();
