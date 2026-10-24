/* ============================================================
   本地存储层：进度、错题本、背诵卡片 SM-2 调度、设置
   全部数据保存在浏览器 localStorage，不上传任何服务器。
   ============================================================ */
(function (global) {
  'use strict';

  const K = {
    progress: 'zsb.progress',      // 刷题记录 { qid: {right, wrong, last, wrongFlag} }
    cards: 'zsb.cards',            // 背诵卡片 SM-2 状态 { cid: {ef, interval, reps, due, lapses} }
    stats: 'zsb.stats',            // 每日学习量 { '2025-01-01': {quiz, card, read} }
    settings: 'zsb.settings',      // 设置
    readPos: 'zsb.readpos',        // 阅读进度 { bookId: {chapterId, scroll} }
    offline: 'zsb.offline',        // 离线资料包状态（仅本机）
    wrongOnly: 'zsb.wrongonly'
  };
  const SCHEMA_VERSION = 2;
  const DATA_KEYS = [K.progress, K.cards, K.stats, K.settings, K.readPos];
  const LOCAL_KEYS = DATA_KEYS.concat(K.offline);

  function load(key, def) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return def;
      const v = JSON.parse(raw);
      return v === null || v === undefined ? def : v;
    } catch (e) { return def; }
  }
  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error('存储失败', e);
      const err = new Error('浏览器存储失败，可能是空间不足或隐私模式限制');
      err.cause = e;
      throw err;
    }
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function assert(cond, message) {
    if (!cond) throw new Error('导入数据格式错误：' + message);
  }
  function isSafeKey(k) {
    return typeof k === 'string' && k.length > 0 && k.length <= 200 &&
      !['__proto__', 'prototype', 'constructor'].includes(k);
  }
  function assertMap(v, name, maxKeys, validateValue) {
    assert(isPlainObject(v), name + ' 必须是对象');
    const keys = Object.keys(v);
    assert(keys.length <= maxKeys, name + ' 记录数量异常');
    for (const key of keys) {
      assert(isSafeKey(key), name + ' 含非法键名');
      validateValue(v[key], name + '.' + key);
    }
  }
  function assertInteger(v, min, max, name) {
    assert(Number.isInteger(v) && v >= min && v <= max, name + ' 必须是 ' + min + '~' + max + ' 的整数');
  }
  function assertNumber(v, min, max, name) {
    assert(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max, name + ' 数值超出范围');
  }
  function assertBoolean(v, name) {
    assert(typeof v === 'boolean', name + ' 必须是布尔值');
  }

  function validateProgress(v) {
    assertMap(v, 'progress', 100000, (s, name) => {
      assert(isPlainObject(s), name + ' 必须是对象');
      assertInteger(s.right, 0, 10000000, name + '.right');
      assertInteger(s.wrong, 0, 10000000, name + '.wrong');
      assertNumber(s.last, 0, Number.MAX_SAFE_INTEGER, name + '.last');
      assertBoolean(s.wrongFlag, name + '.wrongFlag');
    });
  }
  function validateCards(v) {
    assertMap(v, 'cards', 200000, (s, name) => {
      assert(isPlainObject(s), name + ' 必须是对象');
      assertNumber(s.ef, 1.3, 2.8, name + '.ef');
      assertInteger(s.interval, 0, 180, name + '.interval');
      assertInteger(s.reps, 0, 1000000, name + '.reps');
      assertNumber(s.due, 0, Number.MAX_SAFE_INTEGER, name + '.due');
      assertInteger(s.lapses, 0, 1000000, name + '.lapses');
    });
  }
  function validateStats(v) {
    assertMap(v, 'stats', 5000, (s, name) => {
      const dateKey = name.slice('stats.'.length);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(dateKey), dateKey + ' 不是有效日期键');
      assert(isPlainObject(s), name + ' 必须是对象');
      ['quiz', 'card', 'read'].forEach(field => assertInteger(s[field] || 0, 0, 1000000, name + '.' + field));
    });
  }
  function validateSettings(v) {
    assert(isPlainObject(v), 'settings 必须是对象');
    const allowed = ['theme', 'fontSize', 'dailyQuiz', 'dailyCard', 'shuffleOptions', 'autoNext'];
    Object.keys(v).forEach(key => assert(allowed.includes(key), 'settings 含未知字段 ' + key));
    if ('theme' in v) assert(['auto', 'light', 'dark'].includes(v.theme), 'settings.theme 无效');
    if ('fontSize' in v) assertInteger(v.fontSize, 13, 24, 'settings.fontSize');
    if ('dailyQuiz' in v) assertInteger(v.dailyQuiz, 1, 500, 'settings.dailyQuiz');
    if ('dailyCard' in v) assertInteger(v.dailyCard, 1, 500, 'settings.dailyCard');
    if ('shuffleOptions' in v) assertBoolean(v.shuffleOptions, 'settings.shuffleOptions');
    if ('autoNext' in v) assertBoolean(v.autoNext, 'settings.autoNext');
  }
  function validateReadPos(v) {
    assertMap(v, 'readPos', 1000, (p, name) => {
      assert(isPlainObject(p), name + ' 必须是对象');
      assert(typeof p.chapterId === 'string' && p.chapterId.length <= 200, name + '.chapterId 无效');
      assertNumber(p.pct, 0, 100, name + '.pct');
      if ('chapterPct' in p) assertNumber(p.chapterPct, 0, 100, name + '.chapterPct');
      if ('scroll' in p) assertNumber(p.scroll, 0, 100000000, name + '.scroll');
      if ('at' in p) assertNumber(p.at, 0, Number.MAX_SAFE_INTEGER, name + '.at');
    });
  }

  function validateImport(d) {
    assert(isPlainObject(d), '根节点必须是对象');
    if ('app' in d) assert(d.app === 'zsb-review', '不是本应用的数据文件');
    if ('schemaVersion' in d) assertInteger(d.schemaVersion, 1, SCHEMA_VERSION, 'schemaVersion');
    ['progress', 'cards', 'stats', 'settings'].forEach(key => assert(key in d, '缺少 ' + key));
    validateProgress(d.progress);
    validateCards(d.cards);
    validateStats(d.stats);
    validateSettings(d.settings);
    validateReadPos(d.readPos || {});
    if ('exportedAt' in d) assert(typeof d.exportedAt === 'string' && !Number.isNaN(Date.parse(d.exportedAt)), 'exportedAt 无效');
    return {
      schemaVersion: d.schemaVersion || 1,
      progress: d.progress,
      cards: d.cards,
      stats: d.stats,
      settings: d.settings,
      readPos: d.readPos || {}
    };
  }

  function mergeImport(incoming, current) {
    const progress = Object.assign({}, isPlainObject(current.progress) ? current.progress : {});
    Object.keys(incoming.progress).forEach(qid => {
      const a = progress[qid] || { right: 0, wrong: 0, last: 0, wrongFlag: false };
      const b = incoming.progress[qid];
      progress[qid] = {
        right: Math.min(10000000, (a.right || 0) + (b.right || 0)),
        wrong: Math.min(10000000, (a.wrong || 0) + (b.wrong || 0)),
        last: Math.max(a.last || 0, b.last || 0),
        wrongFlag: !!(a.wrongFlag || b.wrongFlag)
      };
    });

    const cards = Object.assign({}, isPlainObject(current.cards) ? current.cards : {});
    Object.keys(incoming.cards).forEach(cid => {
      const a = cards[cid];
      const b = incoming.cards[cid];
      if (!a || b.due >= a.due) cards[cid] = b;
    });

    const stats = Object.assign({}, isPlainObject(current.stats) ? current.stats : {});
    Object.keys(incoming.stats).forEach(day => {
      const a = stats[day] || { quiz: 0, card: 0, read: 0 };
      const b = incoming.stats[day];
      stats[day] = {
        quiz: (a.quiz || 0) + (b.quiz || 0),
        card: (a.card || 0) + (b.card || 0),
        read: (a.read || 0) + (b.read || 0)
      };
    });

    const readPos = Object.assign({}, isPlainObject(current.readPos) ? current.readPos : {});
    Object.keys(incoming.readPos).forEach(bookId => {
      const a = readPos[bookId];
      const b = incoming.readPos[bookId];
      if (!a || (b.at || 0) >= (a.at || 0)) readPos[bookId] = b;
    });

    return {
      progress,
      cards,
      stats,
      settings: Object.assign({}, isPlainObject(current.settings) ? current.settings : {}, incoming.settings),
      readPos
    };
  }

  const today = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  const Store = {
    // ---------------- 设置 ----------------
    getSettings() {
      const out = Object.assign({
        theme: 'auto',          // auto | light | dark
        fontSize: 16,           // 阅读字号
        dailyQuiz: 20,          // 每日刷题目标
        dailyCard: 30,          // 每日背诵目标
        shuffleOptions: false,  // 打乱选项
        autoNext: true          // 答对自动下一题
      }, load(K.settings, {}));
      return out;
    },
    setSetting(k, v) {
      const s = this.getSettings(); s[k] = v; save(K.settings, s); return s;
    },

    // ---------------- 刷题进度 ----------------
    getProgress() { return load(K.progress, {}); },
    getQStat(qid) {
      const p = this.getProgress();
      return p[qid] || { right: 0, wrong: 0, last: 0, wrongFlag: false };
    },
    recordAnswer(qid, correct) {
      const p = this.getProgress();
      const s = p[qid] || { right: 0, wrong: 0, last: 0, wrongFlag: false };
      if (correct) {
        s.right++;
        // 连续答对 2 次才移出错题本
        if (s.wrongFlag && s.right >= 2) s.wrongFlag = false;
      } else {
        s.wrong++;
        s.wrongFlag = true;
        s.right = 0;
      }
      s.last = Date.now();
      p[qid] = s;
      save(K.progress, p);
      this.bumpStat('quiz', 1);
      return s;
    },
    /** 手动移出错题本 */
    clearWrong(qid) {
      const p = this.getProgress();
      if (p[qid]) { p[qid].wrongFlag = false; save(K.progress, p); }
    },
    clearAllWrong() {
      const p = this.getProgress();
      let changed = false;
      Object.keys(p).forEach(qid => {
        if (p[qid] && p[qid].wrongFlag) {
          p[qid].wrongFlag = false;
          changed = true;
        }
      });
      if (changed) save(K.progress, p);
    },
    getWrongList() {
      const p = this.getProgress();
      return Object.keys(p).filter(k => p[k].wrongFlag);
    },
    getDoneCount() {
      const p = this.getProgress();
      return Object.keys(p).filter(k => p[k].right + p[k].wrong > 0).length;
    },
    getAccuracy() {
      const p = this.getProgress();
      let r = 0, w = 0;
      for (const k of Object.keys(p)) { r += p[k].right; w += p[k].wrong; }
      return (r + w) === 0 ? 0 : Math.round(r * 100 / (r + w));
    },

    // ---------------- 每日统计 ----------------
    getStats() { return load(K.stats, {}); },
    bumpStat(field, n) {
      const s = this.getStats();
      const d = today();
      if (!s[d]) s[d] = { quiz: 0, card: 0, read: 0 };
      s[d][field] = (s[d][field] || 0) + (n || 1);
      save(K.stats, s);
    },
    getTodayStat() {
      const s = this.getStats();
      return s[today()] || { quiz: 0, card: 0, read: 0 };
    },
    /** 最近 n 天数据（含今天），用于绘制简易图表 */
    getRecent(days) {
      const s = this.getStats();
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const p = n => String(n).padStart(2, '0');
        const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        out.push({ date: key, label: (d.getMonth() + 1) + '/' + d.getDate(), v: s[key] || { quiz: 0, card: 0, read: 0 } });
      }
      return out;
    },
    getStreak() {
      const s = this.getStats();
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const p = x => String(x).padStart(2, '0');
        const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        const rec = s[key];
        if (rec && (rec.quiz + rec.card + rec.read) > 0) n++;
        else if (i > 0) break;      // 今天没学不算断
      }
      return n;
    },

    // ---------------- 背诵卡片 SM-2 ----------------
    getCardStates() { return load(K.cards, {}); },
    getCardState(cid) {
      const c = this.getCardStates();
      return c[cid] || { ef: 2.5, interval: 0, reps: 0, due: 0, lapses: 0 };
    },
    /**
     * SM-2 算法改良版（4 档评分）
     * grade: 0=完全不会 1=有点印象（困难） 2=想起来了（正常） 3=很简单
     *
     * 间隔策略：
     *  0 → 重置，10 分钟后再现
     *  1 → 在原间隔基础上缩短到 60%（至少 1 天），保证"困难"不会拉长复习周期
     *  2 → interval × ef（标准 SM-2）
     *  3 → interval × ef × 1.3（简单，加速）
     */
    gradeCard(cid, grade) {
      const all = this.getCardStates();
      const s = all[cid] || { ef: 2.5, interval: 0, reps: 0, due: 0, lapses: 0 };
      const DAY = 86400000;
      const prevInterval = s.interval || 0;      // 记住旧间隔，供困难档计算

      if (grade === 0) {
        // 完全不会：重置，10 分钟后再出现
        s.lapses++;
        s.reps = 0;
        s.interval = 0;
        s.ef = Math.max(1.3, s.ef - 0.25);
        s.due = Date.now() + 10 * 60000;
      } else {
        // 调整难度因子
        const delta = [-0.8, -0.15, 0.0, 0.15][grade] || 0;
        s.ef = Math.min(2.8, Math.max(1.3, s.ef + delta));
        s.reps++;

        if (s.reps === 1) {
          // 首次学习
          s.interval = grade === 1 ? 1 : (grade === 3 ? 3 : 2);
        } else if (s.reps === 2) {
          // 第二次
          s.interval = grade === 1 ? 2 : (grade === 3 ? 8 : 6);
        } else if (grade === 1) {
          // 困难：在原间隔上缩短，绝不增长
          s.interval = Math.max(1, Math.round(prevInterval * 0.6));
        } else {
          // 正常 / 简单：按 ef 增长
          const factor = grade === 3 ? s.ef * 1.3 : s.ef;
          s.interval = Math.round(prevInterval * factor);
          // 保证至少比上次长 1 天（避免 ef 偏小时原地踏步）
          s.interval = Math.max(s.interval, prevInterval + 1);
        }
        s.interval = Math.min(s.interval, 180);   // 上限半年
        s.due = Date.now() + s.interval * DAY;
      }
      all[cid] = s;
      save(K.cards, all);
      this.bumpStat('card', 1);
      return s;
    },
    /** 取出今天该复习的卡片 id 列表 */
    getDueCards(allIds) {
      const all = this.getCardStates();
      const now = Date.now();
      const due = [], fresh = [];
      for (const id of allIds) {
        const s = all[id];
        if (!s) fresh.push(id);
        else if (s.due <= now) due.push(id);
      }
      return { due, fresh };
    },
    getCardSummary(totalIds) {
      const all = this.getCardStates();
      const now = Date.now();
      let learned = 0, due = 0, fresh = 0;
      for (const id of totalIds) {
        const s = all[id];
        if (!s) { fresh++; continue; }
        learned++;
        if (s.due <= now) due++;
      }
      return { total: totalIds.length, learned, due, fresh };
    },
    resetCards() { save(K.cards, {}); },

    // ---------------- 阅读进度 ----------------
    getReadPos() { return load(K.readPos, {}); },
    setReadPos(bookId, chapterId, pct, scroll, overallPct) {
      const r = this.getReadPos();
      const chapterPct = Math.max(0, Math.min(100, Number(pct) || 0));
      const bookPct = overallPct == null ? chapterPct : Math.max(0, Math.min(100, Number(overallPct) || 0));
      r[bookId] = {
        chapterId,
        pct: bookPct,
        chapterPct,
        scroll: Math.max(0, Number(scroll) || 0),
        at: Date.now()
      };
      save(K.readPos, r);
    },

    // ---------------- 离线资料包 ----------------
    getOfflineStatus() { return load(K.offline, null); },
    setOfflineStatus(status) { save(K.offline, status); },

    // ---------------- 全局重置 ----------------
    resetQuiz() { save(K.progress, {}); },
    resetAll() {
      LOCAL_KEYS.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) {}
      });
    },
    exportData() {
      return JSON.stringify({
        app: 'zsb-review',
        schemaVersion: SCHEMA_VERSION,
        progress: this.getProgress(),
        cards: this.getCardStates(),
        stats: this.getStats(),
        settings: this.getSettings(),
        readPos: this.getReadPos(),
        exportedAt: new Date().toISOString()
      });
    },
    importData(json, options) {
      let parsed;
      try { parsed = JSON.parse(json); }
      catch (e) { throw new Error('导入数据格式错误：不是有效的 JSON'); }
      const d = validateImport(parsed);
      const mode = options === 'merge' || (options && options.mode === 'merge') ? 'merge' : 'replace';
      let target = d;
      if (mode === 'merge') {
        target = mergeImport(d, {
          progress: this.getProgress(),
          cards: this.getCardStates(),
          stats: this.getStats(),
          settings: this.getSettings(),
          readPos: this.getReadPos()
        });
        validateProgress(target.progress);
        validateCards(target.cards);
        validateStats(target.stats);
        validateSettings(target.settings);
        validateReadPos(target.readPos);
      }

      // 写入前保存原始值；任一写入失败时整体回滚。
      const backup = {};
      for (const key of DATA_KEYS) backup[key] = localStorage.getItem(key);
      try {
        save(K.progress, target.progress);
        save(K.cards, target.cards);
        save(K.stats, target.stats);
        save(K.settings, target.settings);
        save(K.readPos, target.readPos);
      } catch (e) {
        for (const key of DATA_KEYS) {
          try {
            if (backup[key] == null) localStorage.removeItem(key);
            else localStorage.setItem(key, backup[key]);
          } catch (restoreError) {
            console.error('导入回滚失败', restoreError);
          }
        }
        throw e;
      }
      return { schemaVersion: d.schemaVersion, readPosRestored: true, mode };
    }
  };

  global.Store = Store;
})(window);
