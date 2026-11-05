// 全ゲーム共通: localStorage の安全なラッパー（プライベートモード等で失敗しても落ちない）
(function () {
  'use strict';
  const NS = (window.GameShared = window.GameShared || {});

  NS.storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* 保存できない環境では何もしない */
      }
    },
  };
})();
