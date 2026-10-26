/* ============================================================
   专升本复习 PWA —— 主应用
   五大功能：阅读 / 刷题 / 背诵 / 错题统计 / 设置
   ============================================================ */
(function () {
  'use strict';

  // ---------------- 全局状态 ----------------
  const S = {
    books: [], quiz: [], cards: [], meta: null, searchIdx: [],
    bookCache: {},          // 正文分片缓存
    tab: 'home',
    stack: [],              // 页面栈，用于返回
    quizSession: null,      // 当前刷题会话
    cardSession: null,      // 当前背诵会话
    readMarked: new Set(),  // 本次会话已计数的章节
    searchReady: false,
    searchLoading: null
  };
  const STANDALONE = (typeof window !== 'undefined' && window.__ZSB_STANDALONE_DATA__) || null;
  const $ = sel => document.querySelector(sel);
  const view = $('#view');
  const titleEl = $('#page-title');
  const backBtn = $('#btn-back');

  /** 按需加载某本书的正文分片 */
  async function loadBook(id) {
    if (S.bookCache[id]) return S.bookCache[id];
    if (STANDALONE) {
      const data = STANDALONE.bookContents && STANDALONE.bookContents[id];
      if (!data) throw new Error('离线版缺少正文分片: ' + id);
      S.bookCache[id] = data;
      return data;
    }
    const r = await fetch(assetUrl('data/books/' + id + '.json'));
    if (!r.ok) throw new Error('分片不存在: ' + id);
    const d = await r.json();
    S.bookCache[id] = d;
    return d;
  }

  // ---------------- 工具 ----------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function formatChars(chars) {
    const n = Number(chars) || 0;
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万字';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' 千字';
    return n + ' 字';
  }
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms || 1600);
  }
  function md(text) {
    if (!text) return '';
    let html;
    try {
      marked.setOptions({ breaks: true, gfm: true });
      html = marked.parse(text);
    } catch (e) { return '<p>' + esc(text) + '</p>'; }
    // 资料里的「[xx](yy.md)」链接在 App 中无对应文件，
    // 统一改写为应用内跳转（点击 → 打开对应书籍），避免 404
    return rewriteMdLinks(html);
  }

  /** 当前正在渲染的书籍上下文，用于把 .md 链接解析到同科目的目标书籍 */
  let mdLinkCtx = null;   // { subject, bookId }
  let pageCleanup = null;

  /**
   * 把 Markdown 渲染出的 .md 超链接改写为应用内跳转。
   * href 形如 "01-计算机基础知识.md"（可能带 URL 编码），
   * 输出 <a href="javascript:void(0)" data-book="java-1">...</a>
   *
   * 注意：Java 与数据库两个科目的资料存在同名文件（如 00-总目录与复习规划），
   * 因此必须结合当前书籍的 subject 才能唯一定位目标。
   */
  function rewriteMdLinks(html) {
    const ctx = mdLinkCtx;
    return html.replace(/<a\s+href="([^"]*\.md)(#[^"]*)?"([^>]*)>/gi, (m, href, hash, rest) => {
      let file;
      try { file = decodeURIComponent(href).split('/').pop(); }
      catch (e) { file = String(href).split('/').pop(); }
      const stem = file.replace(/\.md$/i, '');
      // 先在同科目内找，找不到再全局找（避免同名文件跳错科目）
      let book = null;
      if (ctx && ctx.subject) {
        book = S.books.find(b => b.subject === ctx.subject && b.title === stem);
      }
      if (!book) book = S.books.find(b => b.title === stem);
      if (!book) {
        // 找不到对应书籍时降级为不可点击文本，避免 404
        return m.replace(/^<a\s+href="[^"]*"/i, '<a href="javascript:void(0)" data-dead="1"');
      }
      return '<a href="javascript:void(0)" data-book="' + book.id + '"' + rest + '>';
    });
  }

  /** 在容器内绑定 .md 链接的应用内跳转 */
  function bindMdLinks(container) {
    if (!container) return;
    container.querySelectorAll('a[data-book]').forEach(a => {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        const b = S.books.find(x => x.id === a.dataset.book);
        if (b) push(renderBook(b), b.titleShort);
        else toast('未找到该资料');
      });
    });
    container.querySelectorAll('a[data-dead]').forEach(a => {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        toast('该链接指向的资料不存在');
      });
    });
  }
  function highlight(container) {
    if (!container) return;
    const h = (typeof window !== 'undefined' && window.hljs) ? window.hljs : (typeof globalThis !== 'undefined' && globalThis.hljs ? globalThis.hljs : null);
    if (!h || typeof h.highlightElement !== 'function') return;
    const nodes = container.querySelectorAll ? container.querySelectorAll('pre code') : [];
    nodes.forEach(el => {
      try { h.highlightElement(el); } catch (e) { /* 单块失败不影响整体 */ }
    });
  }
  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }
  const TYPE_NAME = {
    choice: '单项选择', blank: '填空', judge: '判断', code: '程序阅读',
    program: '编程题', short: '简答', sql: 'SQL 语法', design: '数据库设计'
  };
  const TYPE_ORDER = ['choice', 'blank', 'judge', 'code', 'program', 'short', 'sql', 'design'];
  const OPEN_TYPES = ['code', 'program', 'short', 'sql', 'design'];
  const CODE_OPEN_TYPES = ['code', 'program', 'sql'];

  // ---------------- 导航 ----------------
  /** 统一把「工厂函数」转为「渲染函数」：工厂函数无参数，渲染函数接收 root */
  function toRenderFn(fn) {
    if (typeof fn !== 'function') return function () {};
    if (fn.length >= 1) return fn;          // 已是渲染函数 (root) => {}
    try {
      const maybe = fn();                   // 工厂函数，调用得到渲染函数
      if (typeof maybe === 'function') return maybe;
    } catch (e) {
      console.warn('页面工厂函数执行出错', e);
    }
    return function (root) {
      root.innerHTML = '<div class="empty"><span class="ei">!</span><p>页面加载出错</p></div>';
    };
  }

  function push(fn, title) {
    S.stack.push({ render: toRenderFn(fn), title: title || titleEl.textContent });
    render();
  }
  function go(fn, title) {
    S.stack = [{ render: toRenderFn(fn), title: title || '专升本复习' }];
    render();
  }
  function back() {
    if (S.stack.length > 1) { S.stack.pop(); render(); }
  }
  function render() {
    const top = S.stack[S.stack.length - 1];
    if (!top) return;
    if (pageCleanup) {
      try { pageCleanup(); }
      catch (e) { console.warn('页面清理失败', e); }
      pageCleanup = null;
    }
    titleEl.textContent = top.title || '专升本复习';
    backBtn.classList.toggle('hidden', S.stack.length <= 1);
    view.innerHTML = '';
    document.body.classList.remove('has-quiz-actions');
    try {
      top.render(view);
    } catch (e) {
      console.error('渲染异常', e);
      view.innerHTML = '<div class="empty"><span class="ei">!</span><p>页面渲染出错<br>' +
        String(e.message || e).replace(/</g, '&lt;') + '</p></div>';
    } finally {
      document.body.classList.toggle('has-quiz-actions', !!view.querySelector('.quiz-actions'));
    }
    window.scrollTo(0, 0);
  }
  function setTab(t) {
    S.tab = t;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  }

  /** 复制文本到剪贴板（兼容旧浏览器） */
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast('已复制到剪贴板')).catch(() => fallbackCopy(txt));
    } else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); }
    catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }

  // ============================================================
  //  首页
  // ============================================================
  function renderHome() {
    return function (root) {
      const today = Store.getTodayStat();
      const set = Store.getSettings();
      const quizDone = Store.getDoneCount();
      const acc = Store.getAccuracy();
      const wrongN = Store.getWrongList().length;
      const cardIds = S.cards.map(c => c.id);
      const cs = Store.getCardSummary(cardIds);
      const streak = Store.getStreak();

      root.innerHTML = `
        <div class="hero">
          <h2>距离考试，每天进步一点</h2>
          <p>连续学习 ${streak} 天 · 已掌握 ${quizDone} 题 · 正确率 ${acc}%</p>
          <div class="hero-stats">
            <div class="hero-stat"><b>${today.quiz}</b><span>今日刷题</span></div>
            <div class="hero-stat"><b>${today.card}</b><span>今日背诵</span></div>
            <div class="hero-stat"><b>${cs.due + cs.fresh > 0 ? cs.due + cs.fresh : cs.learned}</b><span>待复习卡片</span></div>
          </div>
        </div>

        <div class="entry-grid">
          <button class="entry" data-act="read"><span class="ei">▤</span><span class="et">阅读资料</span><span class="ed">${S.books.length} 份 md 资料，${(S.meta.stats.chars / 10000).toFixed(1)} 万字</span></button>
          <button class="entry" data-act="quiz"><span class="ei">✎</span><span class="et">开始刷题</span><span class="ed">${S.quiz.length} 道题，自动判分</span></button>
          <button class="entry" data-act="card"><span class="ei">⚑</span><span class="et">背卡片</span><span class="ed">${S.cards.length} 条清单，遗忘曲线</span></button>
          <button class="entry" data-act="wrong"><span class="ei">✗</span><span class="et">错题本</span><span class="ed">${wrongN} 道待巩固</span></button>
        </div>

        <div class="sec-title">快捷开始</div>
        <div class="card">
          <button class="row" data-act="quick-quiz-java">
            <span class="row-num" style="background:var(--blue-soft);color:var(--blue)">J</span>
            <span class="row-main"><span class="row-title">程序设计基础 · 随机 20 题</span><span class="row-sub">选择题 / 判断题 / 填空，即时判分</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-act="quick-quiz-db">
            <span class="row-num" style="background:var(--green-soft);color:var(--green)">D</span>
            <span class="row-main"><span class="row-title">数据库原理与应用 · 随机 20 题</span><span class="row-sub">含 SQL 语法题与设计题</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-act="quick-card-due">
            <span class="row-num" style="background:var(--amber-soft);color:var(--amber)">⚑</span>
            <span class="row-main"><span class="row-title">复习今日到期卡片</span><span class="row-sub">${cs.due} 张到期 · ${cs.fresh} 张未学</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-act="quick-wrong">
            <span class="row-num" style="background:var(--red-soft);color:var(--red)">!</span>
            <span class="row-main"><span class="row-title">重做错题</span><span class="row-sub">${wrongN} 道错题待攻克</span></span>
            <span class="row-arrow">›</span>
          </button>
        </div>

        <div class="sec-title">学习概览</div>
        <div class="stat-grid">
          <div class="stat-box"><b>${S.quiz.length}</b><span>题库总题数</span></div>
          <div class="stat-box"><b>${quizDone}</b><span>已练习题目</span></div>
          <div class="stat-box"><b>${acc}%</b><span>历史正确率</span></div>
          <div class="stat-box"><b>${cs.learned}/${cs.total}</b><span>卡片已学</span></div>
        </div>
        <div style="height:14px"></div>
      `;

      root.querySelectorAll('[data-act]').forEach(el => {
        el.addEventListener('click', () => {
          const a = el.dataset.act;
          if (a === 'read') { setTab('read'); go(renderBookList, '阅读资料'); }
          else if (a === 'quiz') { setTab('quiz'); go(renderQuizHome, '刷题'); }
          else if (a === 'card') { setTab('card'); go(renderCardHome, '背诵卡片'); }
          else if (a === 'wrong') { showWrongBook(); }
          else if (a === 'quick-quiz-java') { startQuiz({ subject: 'java', count: 20, mode: 'random', title: '程序设计基础练习' }); }
          else if (a === 'quick-quiz-db') { startQuiz({ subject: 'db', count: 20, mode: 'random', includeOpen: true, title: '数据库原理练习' }); }
          else if (a === 'quick-card-due') { startCards({ mode: 'due' }); }
          else if (a === 'quick-wrong') { showWrongBook(); }
        });
      });
    };
  }

  // ============================================================
  //  阅读模式
  // ============================================================
  function renderBookList() {
    return function (root) {
      const bySubj = { java: [], db: [] };
      S.books.forEach(b => { (bySubj[b.subject] || []).push(b); });
      const renderGroup = (name, list) => {
        if (!list.length) return '';
        return `<div class="sec-title">${name}</div><div class="card">` +
          list.sort((a, b) => a.order - b.order).map(b => {
            const pos = Store.getReadPos()[b.id];
            const pct = pos ? Math.round(pos.pct || 0) : 0;
            const progressClass = pct >= 100 ? 'done' : pct > 0 ? 'reading' : 'new';
            const progressText = pct >= 100 ? '已读完' : pct > 0 ? `已读 ${pct}%` : '未开始';
            return `<button class="row book-row" data-book="${b.id}">
              <span class="row-num">${b.order === 0 ? '目' : b.order}</span>
              <span class="row-main">
                <span class="row-title">${esc(b.titleShort)}</span>
                <span class="book-meta">
                  <span class="book-facts">
                    <span>${b.chapterCount || b.chapterTitles.length} 章</span>
                    <span>${formatChars(b.chars)}</span>
                  </span>
                  <span class="book-progress ${progressClass}">${progressText}</span>
                </span>
              </span>
              <span class="row-arrow" aria-hidden="true">›</span>
            </button>`;
          }).join('') + '</div>';
      };
      root.innerHTML = `
        <div class="search-wrap"><div class="search-box">
          <span class="si">⌕</span><input id="read-search" placeholder="搜索全部资料内容…" autocomplete="off">
        </div></div>
        ${renderGroup('程序设计基础（Java）', bySubj.java)}
        ${renderGroup('数据库原理与应用', bySubj.db)}
        <div style="height:14px"></div>
      `;
      root.querySelectorAll('[data-book]').forEach(el => {
        el.addEventListener('click', () => {
          const b = S.books.find(x => x.id === el.dataset.book);
          push(renderBook(b), b.titleShort);
        });
      });
      const inp = root.querySelector('#read-search');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(inp.value); });
      inp.addEventListener('search', () => doSearch(inp.value));
      // 输入即搜（延迟）
      let tm;
      inp.addEventListener('input', () => {
        clearTimeout(tm);
        const v = inp.value.trim();
        if (v.length >= 2) tm = setTimeout(() => doSearch(v), 420);
      });
    };
  }

  /** 按需加载搜索索引（体积较大，首次搜索时才下载） */
  async function ensureSearchIndex() {
    if (S.searchReady) return true;
    if (S.searchLoading) return S.searchLoading;
    S.searchLoading = (async () => {
      try {
        let data;
        if (STANDALONE) {
          data = STANDALONE.search;
        } else {
          const r = await fetch(assetUrl('data/search.json'));
          if (!r.ok) throw new Error('HTTP ' + r.status);
          data = await r.json();
        }
        if (!Array.isArray(data)) throw new Error('索引格式异常');
        S.searchIdx = data;
        S.searchReady = true;
        return true;
      } catch (e) {
        console.warn('搜索索引加载失败', e);
        S.searchIdx = [];
        return false;
      } finally {
        S.searchLoading = null;
      }
    })();
    return S.searchLoading;
  }

  function doSearch(q) {
    q = (q || '').trim();
    if (!q) return;
    push(renderSearchResult(q), '搜索：' + q);
  }

  function renderSearchResult(q) {
    return function (root) {
      const kw = q.toLowerCase();
      root.innerHTML = '<div style="padding:20px 14px"><div class="skeleton" style="height:15px;margin-bottom:9px"></div><div class="skeleton" style="height:15px;width:70%"></div></div>';

      ensureSearchIndex().then(ready => {
        if (!root.isConnected) return;
        if (!ready) {
          root.innerHTML = `
            <div class="empty">
              <span class="ei">!</span>
              <p>搜索索引加载失败<br>请检查网络后重试</p>
              <p style="margin-top:12px"><button class="btn" id="search-retry">重新加载</button></p>
            </div>`;
          root.querySelector('#search-retry').addEventListener('click', () => {
            renderSearchResult(q)(root);
          });
          return;
        }
        const hits = [];
        for (const doc of S.searchIdx) {
          const lower = doc.text.toLowerCase();
          let idx = 0, n = 0;
          while (n < 8) {
            idx = lower.indexOf(kw, idx);
            if (idx < 0) break;
            const from = Math.max(0, idx - 45);
            const to = Math.min(doc.text.length, idx + q.length + 70);
            hits.push({ doc, snippet: doc.text.slice(from, to).replace(/\s+/g, ' ').trim() });
            idx += q.length; n++;
          }
        }
        const qHits = S.quiz.filter(x =>
          (x.stem || '').toLowerCase().includes(kw) ||
          (x.explain || '').toLowerCase().includes(kw)
        ).slice(0, 60);

        let html = `<div class="sec-title">题目匹配（${qHits.length}）</div>`;
        if (qHits.length) {
          html += '<div class="card">' + qHits.slice(0, 20).map(x => `
            <button class="row" data-qid="${x.id}">
              <span class="row-num" style="font-size:11px">${(TYPE_NAME[x.type] || '题').slice(0, 2)}</span>
              <span class="row-main">
                <span class="row-title" style="font-weight:400;font-size:14px">${esc(cleanStem(x.stem).slice(0, 58))}</span>
                <span class="row-sub">${esc(x.bookTitle)} · 第 ${x.no} 题</span>
              </span>
              <span class="row-arrow">›</span>
            </button>`).join('') + '</div>';
        }
        html += `<div class="sec-title">资料匹配（${hits.length}）</div>`;
        if (hits.length) {
          html += '<div class="card">' + hits.slice(0, 40).map((h, i) => {
            // 高亮关键词
            const snip = esc(h.snippet);
            const hl = snip.replace(new RegExp(escRe(esc(q)), 'gi'), m => `<mark style="background:var(--amber-soft);color:var(--amber);padding:0 2px;border-radius:3px">${m}</mark>`);
            return `<button class="row" data-bi="${i}">
              <span class="row-main">
                <span class="row-sub" style="color:var(--blue);margin-bottom:3px;display:block">${esc(h.doc.title.replace(/^\d+-/, ''))}</span>
                <span class="row-title" style="font-weight:400;font-size:13.5px;line-height:1.6;white-space:normal">${hl}</span>
              </span>
            </button>`;
          }).join('') + '</div>';
        }
        if (!hits.length && !qHits.length) {
          html += '<div class="empty"><span class="ei">⌕</span><p>没有找到相关内容</p></div>';
        }
        html += '<div style="height:14px"></div>';
        root.innerHTML = html;
        bindMdLinks(root);

        root.querySelectorAll('[data-qid]').forEach(el => {
          el.addEventListener('click', () => {
            const qq = S.quiz.find(x => x.id === el.dataset.qid);
            push(renderSingleQuestion(qq), '题目详情');
          });
        });
        root.querySelectorAll('[data-bi]').forEach(el => {
          el.addEventListener('click', async () => {
            const h = hits[+el.dataset.bi];
            const book = S.books.find(b => b.id === h.doc.id);
            if (!book) return;
            // 定位到包含该内容的章节
            try {
              const data = await loadBook(book.id);
              let bestIdx = 0, bestScore = -1;
              data.chapters.forEach((c, ci) => {
                const full = (c.subs || []).map(s2 => s2.title + s2.body).join('') + (c.body || '');
                const sc = full.toLowerCase().includes(kw) ? full.length : 0;
                if (sc > bestScore) { bestScore = sc; bestIdx = ci; }
              });
              push(renderChapterLoader(book, bestIdx), book.chapterTitles[bestIdx].title.slice(0, 18));
            } catch (e) { toast('打开失败'); }
          });
        });
      });
    };
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function renderBook(book) {
    return function (root) {
      const pos = Store.getReadPos()[book.id];
      const resumeIdx = pos ? book.chapterTitles.findIndex(ch => ch.id === pos.chapterId) : -1;
      let html = `<div class="sec-title">${esc(book.titleShort)}（${book.chapterTitles.length} 章）</div><div class="card">`;
      if (resumeIdx >= 0) {
        const chapter = book.chapterTitles[resumeIdx];
        const pct = Math.round(Math.max(0, Math.min(100, Number(pos.chapterPct != null ? pos.chapterPct : pos.pct) || 0)));
        html += `<button class="row" data-ch="${resumeIdx}">
          <span class="row-num" style="background:var(--amber-soft);color:var(--amber)">续</span>
          <span class="row-main"><span class="row-title">继续上次阅读</span>
          <span class="row-sub">${esc(chapter.title)}${pct > 0 ? ' · 本章 ' + pct + '%' : ''}</span></span>
          <span class="row-arrow">›</span>
        </button><div style="height:1px;background:var(--border)"></div>`;
      }
      book.chapterTitles.forEach((ch, i) => {
        html += `<button class="row" data-ch="${i}">
          <span class="row-num">${i + 1}</span>
          <span class="row-main"><span class="row-title">${esc(ch.title)}</span>
          <span class="row-sub">${ch.subs && ch.subs.length ? ch.subs.length + ' 个小节' : ''}</span></span>
          <span class="row-arrow">›</span>
        </button>`;
      });
      html += '</div><div style="height:14px"></div>';
      root.innerHTML = html;
      root.querySelectorAll('[data-ch]').forEach(el => {
        el.addEventListener('click', async () => {
          const i = +el.dataset.ch;
          const t = book.chapterTitles[i];
          push(renderChapterLoader(book, i), t.title.slice(0, 18));
        });
      });
    };
  }

  /** 章节加载器：先显示骨架，再替换为正文 */
  function renderChapterLoader(book, chapterIdx) {
    return function (root) {
      root.innerHTML = `<div style="padding:20px 14px">
        <div class="skeleton" style="height:26px;width:60%;margin-bottom:16px"></div>
        <div class="skeleton" style="height:15px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:15px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:15px;width:80%;margin-bottom:9px"></div>
        <div class="skeleton" style="height:60px;margin-top:18px"></div>
        <div class="skeleton" style="height:15px;margin-top:18px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:15px;width:70%"></div>
      </div>`;
      loadBook(book.id).then(data => {
        const ch = data.chapters[chapterIdx];
        if (!ch) { root.innerHTML = '<div class="empty"><p>章节内容缺失</p></div>'; return; }
        renderChapterContent(root, book, ch, chapterIdx);
      }).catch(err => {
        root.innerHTML = `<div class="empty"><span class="ei">!</span><p>正文加载失败<br>${esc(err.message)}</p>
          <p style="margin-top:10px;font-size:12px">请确认 data/books/ 目录下的分片文件存在</p></div>`;
      });
    };
  }

  function renderChapterContent(root, book, ch, chapterIdx) {
    const set = Store.getSettings();
    // 设置链接上下文：让 .md 链接解析到同科目的目标书籍
    const prevCtx = mdLinkCtx;
    mdLinkCtx = { subject: book.subject, bookId: book.id };
    let html = `<div class="md" style="font-size:${set.fontSize}px" id="md-body">`;
    if (ch.subs && ch.subs.length) {
      html += md('## ' + ch.title);
      ch.subs.forEach((sub, i) => {
        html += `<div id="sub-${i}">` + md('### ' + sub.title + '\n\n' + sub.body) + '</div>';
      });
    } else {
      html += md('## ' + ch.title + '\n\n' + (ch.body || ''));
    }
    html += '</div><div style="height:20px"></div>';
    root.innerHTML = html;
    mdLinkCtx = prevCtx;
    highlight(root);
    bindMdLinks(root);

    const chapterCount = Math.max(1, book.chapterTitles.length);
    const stored = Store.getReadPos()[book.id];
    const hasStored = stored && stored.chapterId === ch.id;
    const savedScroll = hasStored ? Math.max(0, Number(stored.scroll) || 0) : 0;
    let restoreTimer = null;
    let saveTimer = null;
    let animFrame = null;
    let restoring = savedScroll > 0;

    function savePosition() {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const scroll = Math.max(0, window.scrollY || window.pageYOffset || 0);
      const chapterPct = maxScroll <= 1 ? 100 : Math.min(100, scroll * 100 / maxScroll);
      const overallPct = Math.max(0, Math.min(100, (chapterIdx + chapterPct / 100) * 100 / chapterCount));
      const readKey = book.id + '/' + ch.id;
      if (chapterPct >= 90 && !S.readMarked.has(readKey)) {
        Store.bumpStat('read', 1);
        S.readMarked.add(readKey);
      }
      Store.setReadPos(book.id, ch.id, chapterPct, scroll, overallPct);
    }
    function scheduleSave() {
      if (restoring) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(savePosition, 500);
    }
    function onScroll() {
      if (animFrame) return;
      animFrame = requestAnimationFrame(() => {
        animFrame = null;
        scheduleSave();
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    restoreTimer = setTimeout(() => {
      if (savedScroll > 0) window.scrollTo(0, savedScroll);
      restoring = false;
      savePosition();
    }, savedScroll > 0 ? 80 : 0);

    pageCleanup = function () {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(restoreTimer);
      clearTimeout(saveTimer);
      if (animFrame) cancelAnimationFrame(animFrame);
      savePosition();
    };
  }

  // ============================================================
  //  刷题模式
  // ============================================================
  function renderQuizHome() {
    return function (root) {
      const wrongN = Store.getWrongList().length;
      const done = Store.getDoneCount();
      const acc = Store.getAccuracy();

      function countBy(subject, type) {
        return S.quiz.filter(q => (!subject || q.subject === subject) && (!type || q.type === type)).length;
      }

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat-box"><b>${done}</b><span>已练习</span></div>
          <div class="stat-box"><b>${acc}%</b><span>正确率</span></div>
          <div class="stat-box"><b>${wrongN}</b><span>错题待复习</span></div>
          <div class="stat-box"><b>${S.quiz.length}</b><span>题库总量</span></div>
        </div>
        <div style="height:14px"></div>

        <div class="sec-title">按科目练习</div>
        <div class="card">
          <button class="row" data-go="subj-java">
            <span class="row-num">J</span>
            <span class="row-main"><span class="row-title">程序设计基础</span><span class="row-sub">共 ${countBy('java')} 题</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-go="subj-db">
            <span class="row-num" style="background:var(--green-soft);color:var(--green)">D</span>
            <span class="row-main"><span class="row-title">数据库原理与应用</span><span class="row-sub">共 ${countBy('db')} 题</span></span>
            <span class="row-arrow">›</span>
          </button>
        </div>

        <div class="sec-title">按题型练习</div>
        <div class="card">
          ${TYPE_ORDER.map(t => {
            const n = countBy(null, t);
            if (!n) return '';
            return `<button class="row" data-go="type-${t}">
              <span class="row-num" style="font-size:11px">${TYPE_NAME[t].slice(0, 2)}</span>
              <span class="row-main"><span class="row-title">${TYPE_NAME[t]}</span><span class="row-sub">共 ${n} 题</span></span>
              <span class="row-arrow">›</span>
            </button>`;
          }).join('')}
        </div>

        <div class="sec-title">专项</div>
        <div class="card">
          <button class="row" data-go="wrong">
            <span class="row-num" style="background:var(--red-soft);color:var(--red)">!</span>
            <span class="row-main"><span class="row-title">错题重做</span><span class="row-sub">${wrongN} 道</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-go="exam">
            <span class="row-num" style="background:var(--amber-soft);color:var(--amber)">卷</span>
            <span class="row-main"><span class="row-title">模拟试卷</span><span class="row-sub">完整套卷演练</span></span>
            <span class="row-arrow">›</span>
          </button>
        </div>
        <div style="height:14px"></div>
      `;

      root.querySelectorAll('[data-go]').forEach(el => {
        el.addEventListener('click', () => {
          const v = el.dataset.go;
          if (v === 'subj-java') startQuiz({ subject: 'java', count: 20, includeOpen: true, title: '程序设计基础练习' });
          else if (v === 'subj-db') startQuiz({ subject: 'db', count: 20, includeOpen: true, title: '数据库原理练习' });
          else if (v === 'wrong') showWrongBook();
          else if (v === 'exam') renderExamList();
          else if (v.startsWith('type-')) {
            const t = v.slice(5);
            startQuiz({ type: t, count: 30, includeOpen: true, title: TYPE_NAME[t] + '练习' });
          }
        });
      });
    };
  }

  function renderExamList() {
    const exams = S.quiz.filter(q => q.isExam);
    const byBook = {};
    exams.forEach(q => { (byBook[q.bookTitle] = byBook[q.bookTitle] || []).push(q); });
    const titles = Object.keys(byBook);
    if (!titles.length) { toast('暂无模拟试卷'); return; }

    push(function (root) {
      root.innerHTML = `<div class="sec-title">选择试卷</div><div class="card">` +
        titles.map(t => `<button class="row" data-exam="${esc(t)}">
          <span class="row-num" style="background:var(--amber-soft);color:var(--amber)">卷</span>
          <span class="row-main"><span class="row-title">${esc(t)}</span>
          <span class="row-sub">${byBook[t].length} 题</span></span>
          <span class="row-arrow">›</span>
        </button>`).join('') + '</div><div style="height:14px"></div>';
      root.querySelectorAll('[data-exam]').forEach(el => {
        el.addEventListener('click', () => {
          const list = byBook[el.dataset.exam];
          startQuiz({ questions: list, title: el.dataset.exam });
        });
      });
    }, '模拟试卷');
  }

  function startWrongQuiz() {
    const ids = Store.getWrongList();
    if (!ids.length) { toast('错题本是空的，先去刷题吧'); return; }
    const list = ids.map(id => S.quiz.find(q => q.id === id)).filter(Boolean);
    startQuiz({ questions: list, title: '错题重做' });
  }

  function showWrongBook() {
    setTab('quiz');
    push(renderWrongBook, '错题本');
  }

  function startQuiz(opts) {
    opts = opts || {};
    let list;
    if (opts.questions) list = opts.questions.slice();
    else {
      list = S.quiz.filter(q => {
        if (opts.subject && q.subject !== opts.subject) return false;
        if (opts.type && q.type !== opts.type) return false;
        // 只练有明确答案的客观题（选择/判断/填空）
        if (!opts.includeOpen && !['choice', 'judge', 'blank'].includes(q.type)) return false;
        return true;
      });
      list = shuffle(list).slice(0, opts.count || 20);
    }
    if (!list.length) { toast('没有符合条件的题目'); return; }

    S.quizSession = {
      list, idx: 0, answered: {}, right: 0, wrong: 0,
      title: opts.title || '刷题练习', startAt: Date.now(),
      opts: Object.assign({}, opts, opts.questions ? { questions: list.slice() } : {})
    };
    setTab('quiz');
    go(renderQuizRunner, S.quizSession.title);
  }

  function renderQuizRunner() {
    return function (root) {
      const sess = S.quizSession;
      if (!sess) { root.innerHTML = '<div class="empty"><p>会话已结束</p></div>'; return; }
      const q = sess.list[sess.idx];
      if (!q) return renderResult(root);

      const set = Store.getSettings();
      const st = Store.getQStat(q.id);

      let opts = q.options.slice();
      if (set.shuffleOptions && opts.length) opts = shuffle(opts);

      let html = `
        <div class="quiz-head">
          <div class="quiz-meta">
            <span>${sess.idx + 1} / ${sess.list.length} · ${TYPE_NAME[q.type] || '题目'}</span>
            <span>✓ ${sess.right} ✗ ${sess.wrong}</span>
          </div>
          <div class="bar"><i style="width:${(sess.idx / sess.list.length * 100).toFixed(0)}%"></i></div>
        </div>
        <div class="q-card">
          <div class="q-stem">${md(cleanStem(q.stem)).replace(/^<p>|<\/p>$/g, '')}</div>
          ${q.codes.map(c => `<div class="q-code">${esc(c.code)}</div>`).join('')}
          <div id="opt-area"></div>
        </div>
        <div class="quiz-actions" id="q-actions"></div>
      `;
      root.innerHTML = html;
      const optArea = root.querySelector('#opt-area');
      const actArea = root.querySelector('#q-actions');

      // 未作答状态
      function showOptions() {
        if (q.type === 'choice' && opts.length) {
          optArea.innerHTML = opts.map(o =>
            `<button class="opt" data-key="${o.key}">
               <span class="opt-key">${o.key}</span>
               <span class="opt-text">${md(cleanStem(o.text)).replace(/^<p>|<\/p>$/g, '')}</span>
             </button>`).join('');
          optArea.querySelectorAll('[data-key]').forEach(b => {
            b.addEventListener('click', () => answer(b.dataset.key));
          });
        } else if (q.type === 'judge') {
          optArea.innerHTML = `<div class="judge-row">
            <button class="judge-btn" data-key="正确">✓ 正确</button>
            <button class="judge-btn" data-key="错误">✗ 错误</button>
          </div>`;
          optArea.querySelectorAll('[data-key]').forEach(b => {
            b.addEventListener('click', () => answer(b.dataset.key));
          });
        } else if (q.type === 'blank') {
          optArea.innerHTML = `<div style="display:flex;gap:9px;margin-bottom:12px">
            <input id="blank-in" placeholder="输入你的答案…" style="flex:1;padding:12px;border:1.5px solid var(--border);border-radius:11px;background:var(--bg-card);outline:none">
            <button class="btn" id="blank-ok">提交</button>
          </div>`;
          const inp = optArea.querySelector('#blank-in');
          optArea.querySelector('#blank-ok').addEventListener('click', () => answer(inp.value.trim()));
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') answer(inp.value.trim()); });
          setTimeout(() => inp.focus(), 120);
        } else {
          // 开放式题：先作答，再对照参考答案自评
          const placeholder = {
            code: '写出程序运行结果，或记录你的分析过程…',
            program: '在这里编写程序…',
            short: '写下答案要点…',
            sql: '在这里编写 SQL 语句…',
            design: '写出表结构、关系和设计思路…'
          }[q.type] || '写下你的答案…';
          const codeClass = CODE_OPEN_TYPES.includes(q.type) ? ' open-answer-code' : '';
          optArea.innerHTML = `
            <label class="open-answer-label" for="open-in">你的作答</label>
            <textarea id="open-in" class="open-answer${codeClass}" rows="${CODE_OPEN_TYPES.includes(q.type) ? 10 : 7}"
              placeholder="${placeholder}" spellcheck="${CODE_OPEN_TYPES.includes(q.type) ? 'false' : 'true'}"></textarea>
            <div class="open-answer-meta">
              <span>本题为开放题，提交后对照参考答案自评</span>
              <span id="open-count">0 字</span>
            </div>
            <div class="open-answer-actions">
              <button class="btn" id="open-submit">提交并查看答案</button>
              <button class="btn btn-ghost" id="open-reveal">直接看答案</button>
            </div>`;
          const openInp = optArea.querySelector('#open-in');
          const countEl = optArea.querySelector('#open-count');
          function submitOpen() {
            const text = openInp.value.trim();
            if (!text) {
              toast('先写下你的作答，或直接查看参考答案');
              openInp.focus();
              return;
            }
            answer(text, true);
          }
          openInp.addEventListener('input', () => {
            countEl.textContent = openInp.value.trim().length + ' 字';
          });
          openInp.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitOpen();
          });
          optArea.querySelector('#open-submit').addEventListener('click', submitOpen);
          optArea.querySelector('#open-reveal').addEventListener('click', () => answer(null, true));
          setTimeout(() => openInp.focus(), 120);
        }
        actArea.innerHTML = `<button class="btn btn-ghost" id="btn-skip" style="flex:1">跳过</button>`;
        actArea.querySelector('#btn-skip').addEventListener('click', () => {
          sess.idx++; render();
        });
      }

      // 判断填空白答案是否正确
      function judgeBlank(input, answer) {
        if (!input || !answer) return false;
        const norm = s => String(s).replace(/[\s，。；、,.;：:（）()《》「」"'"']/g, '').toLowerCase();
        const a = norm(input), b = norm(answer);
        if (!a || !b) return false;
        if (a === b) return true;
        // 答案可能含多个空（用、分隔）
        const parts = b.split(/[、,，;；\/]+/).filter(Boolean);
        return parts.some(p => p === a || (p.length > 1 && a.includes(p)));
      }

      // 作答
      function answer(key, isOpen) {
        const correct = isOpen ? null : (
          q.type === 'blank' ? judgeBlank(key, q.answer) : String(key) === String(q.answer)
        );
        sess.answered[q.id] = { key, correct };
        if (correct === true) sess.right++;
        else if (correct === false) sess.wrong++;
        if (correct !== null) Store.recordAnswer(q.id, correct);
        showAnswer(key, correct, isOpen);
      }

      function showAnswer(chosen, correct, isOpen) {
        // 高亮选项
        if (q.type === 'choice' && opts.length) {
          optArea.querySelectorAll('.opt').forEach(b => {
            const k = b.dataset.key;
            b.disabled = true;
            if (k === q.answer) b.classList.add('correct');
            else if (k === chosen) b.classList.add('wrong');
            else b.classList.add('dim');
          });
        } else if (q.type === 'judge') {
          optArea.querySelectorAll('.judge-btn').forEach(b => {
            const k = b.dataset.key;
            b.disabled = true;
            if (k === q.answer) b.classList.add('correct');
            else if (k === chosen) b.classList.add('wrong');
            else b.classList.add('dim');
          });
        } else if (q.type === 'blank') {
          const inp = optArea.querySelector('#blank-in');
          if (inp) inp.disabled = true;
          const btn = optArea.querySelector('#blank-ok');
          if (btn) btn.classList.add('hidden');
        } else {
          optArea.innerHTML = '';
        }

        const isOpenQuestion = OPEN_TYPES.includes(q.type);
        const right = correct === true;
        const boxCls = correct === null ? '' : (right ? 'right' : 'wrong');
        const title = isOpenQuestion
          ? (chosen ? '你的作答与参考答案' : '参考答案与解析')
          : (correct === null ? '参考答案' : (right ? '✓ 答对了' : '✗ 答错了'));
        let ansHtml = '';
        if (isOpenQuestion && chosen) {
          ansHtml = `<div class="user-answer"><b>你的作答</b><pre>${esc(chosen)}</pre></div>`;
        } else if (isOpenQuestion) {
          ansHtml = '<div class="open-answer-note">未填写作答，直接查看参考答案。</div>';
        } else if (q.type !== 'blank' && q.answer && q.answer !== '见参考答案') {
          ansHtml = `<div style="margin-bottom:8px"><b>正确答案：</b><span class="pill ${right ? 'pill-green' : 'pill-red'}">${esc(q.answer)}</span>${chosen && !right ? ` <span class="pill pill-gray">你选了 ${esc(chosen)}</span>` : ''}</div>`;
        } else if (q.type === 'blank') {
          ansHtml = `<div style="margin-bottom:8px"><b>参考答案：</b>${esc(q.answer || '见解析')}</div>`;
        }
        const reference = q.explain || (isOpenQuestion && q.answer !== '见参考答案' ? q.answer : '');
        const expHtml = reference
          ? `<div class="answer-body">${md(reference)}</div>`
          : '<div class="answer-body" style="color:var(--text-faint)">暂无解析</div>';

        const box = document.createElement('div');
        box.className = 'answer-box ' + boxCls;
        box.innerHTML = `<div class="answer-title">${title}</div>${ansHtml}${expHtml}`;
        optArea.appendChild(box);
        highlight(box);
        bindMdLinks(box);

        // 答案中含代码时，提供折叠/展开
        const preBlocks = box.querySelectorAll('.answer-body pre code');
        if (preBlocks.length) {
          const bar = document.createElement('div');
          bar.style.cssText = 'display:flex;gap:8px;margin:10px 0 2px';
          bar.innerHTML = `<button class="btn btn-sm btn-ghost" id="code-toggle">收起代码</button>
            <button class="btn btn-sm btn-ghost" id="code-copy">复制代码</button>`;
          box.insertBefore(bar, box.querySelector('.answer-body'));
          let shown = true;
          bar.querySelector('#code-toggle').addEventListener('click', () => {
            shown = !shown;
            box.querySelectorAll('.answer-body pre').forEach(p => { p.style.display = shown ? '' : 'none'; });
            bar.querySelector('#code-toggle').textContent = shown ? '收起代码' : '展开代码';
          });
          bar.querySelector('#code-copy').addEventListener('click', () => {
            const txt = Array.from(box.querySelectorAll('.answer-body pre code')).map(c => c.textContent).join('\n\n');
            copyText(txt);
          });
        }

        const isLast = sess.idx >= sess.list.length - 1;
        actArea.innerHTML = `
          <button class="btn btn-ghost" id="btn-prev" style="flex:1" ${sess.idx === 0 ? 'disabled' : ''}>上一题</button>
          <button class="btn" id="btn-next" style="flex:1.4">${isLast ? '查看成绩' : '下一题'}</button>
        `;
        const prev = actArea.querySelector('#btn-prev');
        if (prev) prev.addEventListener('click', () => { if (sess.idx > 0) { sess.idx--; render(); } });
        actArea.querySelector('#btn-next').addEventListener('click', () => {
          if (isLast) { renderResult(root); }
          else { sess.idx++; render(); }
        });

        // 自动滚动到答案
        setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
      }

      // 已作答过则直接显示答案
      const prev = sess.answered[q.id];
      if (prev) { showOptions(); showAnswer(prev.key, prev.correct, prev.correct === null); }
      else showOptions();
    };
  }

  function cleanStem(s) {
    return String(s || '')
      .replace(/^\*\*第\s*\d+\s*题\*\*\s*[:：]?\s*/, '')
      .replace(/^\*\*(?:自测\s*)?\d+\s*[\.、．]?\*\*\s*[:：]?\s*/, '')
      .replace(/^\d+\s*[\.、．]\s+/, '')
      .trim();
  }

  function renderResult(root) {
    const sess = S.quizSession;
    const total = Object.keys(sess.answered).length;
    const right = sess.right, wrong = sess.wrong;
    const scored = right + wrong;
    const acc = scored ? Math.round(right * 100 / scored) : 0;
    const mins = Math.max(1, Math.round((Date.now() - sess.startAt) / 60000));

    // 找出错题
    const wrongQs = sess.list.filter(q => sess.answered[q.id] && sess.answered[q.id].correct === false);

    root.innerHTML = `
      <div class="hero" style="margin-top:8px">
        <h2>${acc >= 80 ? '表现很棒！' : acc >= 60 ? '继续加油' : '还需巩固'}</h2>
        <p>用时 ${mins} 分钟 · 共作答 ${scored} 题</p>
        <div class="hero-stats">
          <div class="hero-stat"><b>${right}</b><span>答对</span></div>
          <div class="hero-stat"><b>${wrong}</b><span>答错</span></div>
          <div class="hero-stat"><b>${acc}%</b><span>正确率</span></div>
        </div>
      </div>
      ${wrongQs.length ? `
        <div class="sec-title">本次错题（${wrongQs.length}）</div>
        <div class="card">
          ${wrongQs.map(q => `<button class="row" data-qid="${q.id}">
            <span class="row-num" style="background:var(--red-soft);color:var(--red);font-size:11px">${(TYPE_NAME[q.type] || '题').slice(0,2)}</span>
            <span class="row-main"><span class="row-title" style="font-weight:400;font-size:14px">${esc(cleanStem(q.stem).slice(0, 52))}</span>
            <span class="row-sub">正确答案：${esc(q.answer || '见解析')}</span></span>
            <span class="row-arrow">›</span>
          </button>`).join('')}
        </div>` : '<div class="sec-title">全部答对，太棒了！</div>'}
      <div style="padding:14px">
        <button class="btn btn-block" id="btn-again">再来一组</button>
        <div style="height:9px"></div>
        <button class="btn btn-block btn-outline" id="btn-home">返回刷题首页</button>
      </div>
      <div style="height:14px"></div>
    `;
    root.querySelectorAll('[data-qid]').forEach(el => {
      el.addEventListener('click', () => {
        const q = S.quiz.find(x => x.id === el.dataset.qid);
        push(renderSingleQuestion(q), '错题详情');
      });
    });
    root.querySelector('#btn-again').addEventListener('click', () => {
      const opts = sess.opts || {};
      startQuiz(opts);
    });
    root.querySelector('#btn-home').addEventListener('click', () => { S.quizSession = null; go(renderQuizHome, '刷题'); });
    document.body.classList.remove('has-quiz-actions');
  }

  function renderSingleQuestion(q) {
    return function (root) {
      root.innerHTML = `
        <div class="q-card">
          <div class="quiz-meta" style="margin-bottom:9px">
            <span>${TYPE_NAME[q.type] || '题目'} · ${esc(q.bookTitle)}</span>
            <span>第 ${q.no} 题</span>
          </div>
          <div class="q-stem">${md(cleanStem(q.stem)).replace(/^<p>|<\/p>$/g, '')}</div>
          ${q.codes.map(c => `<div class="q-code">${esc(c.code)}</div>`).join('')}
          ${q.options.length ? `<div style="margin:12px 0">${q.options.map(o =>
            `<div class="opt" style="pointer-events:none${o.key === q.answer ? ';border-color:var(--green);background:var(--green-soft)' : ''}">
              <span class="opt-key"${o.key === q.answer ? ' style="background:var(--green);border-color:var(--green);color:#fff"' : ''}>${o.key}</span>
              <span class="opt-text">${md(cleanStem(o.text)).replace(/^<p>|<\/p>$/g, '')}</span>
            </div>`).join('')}</div>` : ''}
          <div class="answer-box">
            <div class="answer-title">参考答案</div>
            <div style="margin-bottom:8px"><b>${esc(q.answer || '见解析')}</b></div>
            <div class="answer-body">${q.explain ? md(q.explain) : '暂无解析'}</div>
          </div>
        </div><div style="height:14px"></div>
      `;
      highlight(root);
      bindMdLinks(root);
    };
  }

  // ============================================================
  //  背诵卡片
  // ============================================================
  function renderCardHome() {
    return function (root) {
      const ids = S.cards.map(c => c.id);
      const sum = Store.getCardSummary(ids);
      const pct = sum.total ? Math.round(sum.learned * 100 / sum.total) : 0;

      root.innerHTML = `
        <div class="card-flat" style="padding:16px 15px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px">
            <b style="font-size:15px">学习进度</b>
            <span style="font-size:13px;color:var(--text-faint)">${sum.learned} / ${sum.total}</span>
          </div>
          <div class="bar" style="height:7px"><i style="width:${pct}%"></i></div>
          <div style="display:flex;gap:14px;margin-top:11px;font-size:12.5px;color:var(--text-faint)">
            <span>到期 <b style="color:var(--amber)">${sum.due}</b></span>
            <span>未学 <b style="color:var(--blue)">${sum.fresh}</b></span>
            <span>已掌握 <b style="color:var(--green)">${sum.learned - sum.due > 0 ? sum.learned - sum.due : 0}</b></span>
          </div>
        </div>

        <div class="sec-title">开始背诵</div>
        <div class="card">
          <button class="row" data-c="due">
            <span class="row-num" style="background:var(--amber-soft);color:var(--amber)">⚑</span>
            <span class="row-main"><span class="row-title">复习到期卡片</span><span class="row-sub">${sum.due} 张待复习${sum.due === 0 ? '（今天已完成）' : ''}</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-c="new">
            <span class="row-num" style="background:var(--blue-soft);color:var(--blue)">＋</span>
            <span class="row-main"><span class="row-title">学习新卡片</span><span class="row-sub">${sum.fresh} 张未学习</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-c="all">
            <span class="row-num">∞</span>
            <span class="row-main"><span class="row-title">全部卡片顺序复习</span><span class="row-sub">${sum.total} 张，按资料顺序</span></span>
            <span class="row-arrow">›</span>
          </button>
        </div>

        <div class="sec-title">按科目</div>
        <div class="card">
          <button class="row" data-c="java">
            <span class="row-num">J</span>
            <span class="row-main"><span class="row-title">程序设计基础</span><span class="row-sub">${S.cards.filter(x => x.subject === 'java').length} 条</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" data-c="db">
            <span class="row-num" style="background:var(--green-soft);color:var(--green)">D</span>
            <span class="row-main"><span class="row-title">数据库原理与应用</span><span class="row-sub">${S.cards.filter(x => x.subject === 'db').length} 条</span></span>
            <span class="row-arrow">›</span>
          </button>
        </div>

        <div class="sec-title">按模块</div>
        <div class="card">
          ${S.books.filter(b => S.cards.some(c => c.bookOrder === b.order && c.subject === b.subject)).map(b => {
            const n = S.cards.filter(c => c.bookOrder === b.order && c.subject === b.subject).length;
            return `<button class="row" data-c="book:${b.subject}:${b.order}">
              <span class="row-num">${b.order === 0 ? '目' : b.order}</span>
              <span class="row-main"><span class="row-title" style="font-size:14px">${esc(b.titleShort)}</span><span class="row-sub">${n} 条</span></span>
              <span class="row-arrow">›</span>
            </button>`;
          }).join('')}
        </div>
        <div style="height:14px"></div>
      `;

      root.querySelectorAll('[data-c]').forEach(el => {
        el.addEventListener('click', () => {
          const v = el.dataset.c;
          if (v === 'due') startCards({ mode: 'due' });
          else if (v === 'new') startCards({ mode: 'new' });
          else if (v === 'all') startCards({ mode: 'all' });
          else if (v === 'java') startCards({ mode: 'due', subject: 'java', includeNew: true });
          else if (v === 'db') startCards({ mode: 'due', subject: 'db', includeNew: true });
          else if (v.startsWith('book:')) {
            const [, subj, ord] = v.split(':');
            startCards({ mode: 'due', subject: subj, bookOrder: +ord, includeNew: true });
          }
        });
      });
    };
  }

  function startCards(opts) {
    let list = S.cards.slice();
    if (opts.subject) list = list.filter(c => c.subject === opts.subject);
    if (opts.bookOrder != null) list = list.filter(c => c.bookOrder === opts.bookOrder);

    const ids = list.map(c => c.id);
    const { due, fresh } = Store.getDueCards(ids);
    let picked;
    if (opts.mode === 'due') {
      picked = list.filter(c => due.includes(c.id));
      if (opts.includeNew) picked = picked.concat(list.filter(c => fresh.includes(c.id)));
    } else if (opts.mode === 'new') {
      picked = list.filter(c => fresh.includes(c.id));
    } else {
      picked = list;
    }
    if (!picked.length) {
      toast(opts.mode === 'due' ? '今天没有到期卡片，去学新卡片吧' : '没有符合条件的卡片');
      return;
    }
    S.cardSession = {
      list: picked, idx: 0, done: 0, right: 0, startAt: Date.now(),
      title: '背诵卡片', opts: Object.assign({}, opts)
    };
    setTab('card');
    go(renderCardRunner, S.cardSession.title);
  }

  function renderCardRunner() {
    return function (root) {
      const sess = S.cardSession;
      if (!sess || sess.idx >= sess.list.length) return renderCardDone(root);
      const c = sess.list[sess.idx];
      const st = Store.getCardState(c.id);

      root.innerHTML = `
        <div class="quiz-head">
          <div class="quiz-meta">
            <span>${sess.idx + 1} / ${sess.list.length}</span>
            <span>${st.reps > 0 ? '复习 ' + st.reps + ' 次 · 间隔 ' + st.interval + ' 天' : '新卡片'}</span>
          </div>
          <div class="bar"><i style="width:${(sess.idx / sess.list.length * 100).toFixed(0)}%"></i></div>
        </div>
        <div class="flash-card" id="fcard">
          <div class="flash-meta">
            <span>${esc(c.subjectName)} · ${esc(c.bookTitle.replace(/^\d+-/, ''))}</span>
            <span>#${c.idx}</span>
          </div>
          <div class="flash-text">${md(c.text)}</div>
        </div>
        <div style="padding:0 14px 10px">
          <div style="font-size:12.5px;color:var(--text-faint);text-align:center">
            先自己回想，再评价掌握程度 —— 评价决定下次出现时间
          </div>
        </div>
        <div class="flash-grade">
          <button class="grade-btn g0" data-g="0">完全不会<small>10 分钟后到期</small></button>
          <button class="grade-btn g1" data-g="1">有点印象<small>较短</small></button>
          <button class="grade-btn g2" data-g="2">想起来了<small>正常</small></button>
          <button class="grade-btn g3" data-g="3">很简单<small>很长</small></button>
        </div>
        <div style="height:14px"></div>
      `;
      highlight(root);
      bindMdLinks(root);

      root.querySelectorAll('[data-g]').forEach(b => {
        b.addEventListener('click', () => {
          const g = +b.dataset.g;
          const next = Store.gradeCard(c.id, g);
          sess.done++; if (g >= 2) sess.right++;
          const card = root.querySelector('#fcard');
          card.classList.add('flip-out');
          setTimeout(() => {
            sess.idx++;
            if (sess.idx >= sess.list.length) renderCardDone(root);
            else render();
          }, 240);
        });
      });
    };
  }

  function renderCardDone(root) {
    const sess = S.cardSession || { done: 0, right: 0, list: [] };
    const mins = Math.max(1, Math.round((Date.now() - (sess.startAt || Date.now())) / 60000));
    const ids = S.cards.map(c => c.id);
    const sum = Store.getCardSummary(ids);

    root.innerHTML = `
      <div style="height:10px"></div>
      <div class="hero">
        <h2>本轮背诵完成 🎉</h2>
        <p>用时 ${mins} 分钟 · 复习 ${sess.done} 张卡片</p>
        <div class="hero-stats">
          <div class="hero-stat"><b>${sess.done}</b><span>本轮卡片</span></div>
          <div class="hero-stat"><b>${sum.learned}</b><span>累计已学</span></div>
          <div class="hero-stat"><b>${sum.due}</b><span>仍待复习</span></div>
        </div>
      </div>
      <div style="padding:14px">
        <button class="btn btn-block" id="c-more">再背一轮</button>
        <div style="height:9px"></div>
        <button class="btn btn-block btn-outline" id="c-home">返回背诵首页</button>
      </div>
      <div style="height:14px"></div>
    `;
    root.querySelector('#c-more').addEventListener('click', () => {
      startCards((sess.opts && Object.assign({}, sess.opts)) || { mode: 'due', includeNew: true });
    });
    root.querySelector('#c-home').addEventListener('click', () => { S.cardSession = null; go(renderCardHome, '背诵卡片'); });
  }

  // ============================================================
  //  我的 / 统计
  // ============================================================
  function requestOfflineCache(onProgress) {
    return new Promise(async (resolve, reject) => {
      if (!('serviceWorker' in navigator)) {
        reject(new Error('当前浏览器不支持离线缓存'));
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const target = navigator.serviceWorker.controller || reg.active;
        if (!target) throw new Error('离线服务尚未就绪，请刷新后重试');

        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('message', onMessage);
        };
        const onMessage = event => {
          const data = event.data || {};
          if (data.type === 'OFFLINE_PROGRESS') onProgress(data);
          else if (data.type === 'OFFLINE_COMPLETE') {
            cleanup();
            resolve(data);
          } else if (data.type === 'OFFLINE_ERROR') {
            cleanup();
            reject(new Error(data.message || '离线资料下载失败'));
          }
        };
        navigator.serviceWorker.addEventListener('message', onMessage);
        timer = setTimeout(() => {
          cleanup();
          reject(new Error('下载超时，请检查网络后重试'));
        }, 5 * 60000);
        target.postMessage({ type: 'CACHE_OFFLINE_PACK' });
      } catch (e) {
        reject(e);
      }
    });
  }

  function renderMe() {
    return function (root) {
      const set = Store.getSettings();
      const offline = Store.getOfflineStatus();
      const recent = Store.getRecent(14);
      const maxV = Math.max(1, ...recent.map(r => r.v.quiz));
      const wrongN = Store.getWrongList().length;
      const acc = Store.getAccuracy();
      const done = Store.getDoneCount();
      const ids = S.cards.map(c => c.id);
      const sum = Store.getCardSummary(ids);
      const totalStat = Store.getStats();
      let totalQ = 0, totalC = 0;
      for (const k of Object.keys(totalStat)) { totalQ += totalStat[k].quiz || 0; totalC += totalStat[k].card || 0; }

      root.innerHTML = `
        <div class="hero" style="margin-top:6px">
          <h2>学习统计</h2>
          <p>坚持 ${Store.getStreak()} 天 · 累计答题 ${totalQ} 次 · 背诵 ${totalC} 次</p>
          <div class="hero-stats">
            <div class="hero-stat"><b>${done}</b><span>练过题目</span></div>
            <div class="hero-stat"><b>${acc}%</b><span>正确率</span></div>
            <div class="hero-stat"><b>${wrongN}</b><span>错题</span></div>
          </div>
        </div>

        <div class="sec-title">最近 14 天刷题量</div>
        <div class="card-flat" style="padding:14px">
          <div style="display:flex;align-items:flex-end;gap:3px;height:90px">
            ${recent.map(r => `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
                <div style="width:100%;height:${Math.max(2, r.v.quiz / maxV * 74)}px;background:${r.v.quiz > 0 ? 'linear-gradient(180deg,var(--blue-light),var(--blue))' : 'var(--bg-sunken)'};border-radius:3px 3px 0 0"></div>
              </div>`).join('')}
          </div>
          <div style="display:flex;gap:3px;margin-top:5px">
            ${recent.map((r, i) => `<div style="flex:1;text-align:center;font-size:9px;color:var(--text-faint)">${i % 2 === 0 ? r.label : ''}</div>`).join('')}
          </div>
        </div>

        <div class="sec-title">详细数据</div>
        <div class="card">
          <div class="row"><span class="row-main"><span class="row-title">题库总量</span></span><span style="color:var(--text-faint)">${S.quiz.length} 题</span></div>
          <div class="row"><span class="row-main"><span class="row-title">已练习</span></span><span style="color:var(--text-faint)">${done} 题</span></div>
          <div class="row"><span class="row-main"><span class="row-title">错题本</span></span><span style="color:var(--text-faint)">${wrongN} 题</span></div>
          <div class="row"><span class="row-main"><span class="row-title">卡片已学 / 总数</span></span><span style="color:var(--text-faint)">${sum.learned} / ${sum.total}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">今日待复习卡片</span></span><span style="color:var(--text-faint)">${sum.due} 张</span></div>
        </div>

        <div class="sec-title">设置</div>
        <div class="card">
          <div class="row">
            <span class="row-main"><span class="row-title">阅读字号</span><span class="row-sub">当前 ${set.fontSize}px</span></span>
            <span style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" data-font="-1">A－</button>
              <button class="btn btn-sm btn-ghost" data-font="1">A＋</button>
            </span>
          </div>
          <button class="row" id="set-theme">
            <span class="row-main"><span class="row-title">深色模式</span><span class="row-sub">${set.theme === 'dark' ? '已开启' : set.theme === 'light' ? '已关闭' : '跟随系统'}</span></span>
            <span class="row-arrow">›</span>
          </button>
          <button class="row" id="set-shuffle">
            <span class="row-main"><span class="row-title">打乱选项顺序</span><span class="row-sub">${set.shuffleOptions ? '已开启' : '已关闭'}</span></span>
            <span class="row-arrow">${set.shuffleOptions ? '✓' : '›'}</span>
          </button>
        </div>

        <div class="sec-title">数据管理</div>
        <div class="card">
          <button class="row" id="exp"><span class="row-main"><span class="row-title">导出学习数据</span><span class="row-sub">保存为 JSON，可换设备恢复</span></span><span class="row-arrow">›</span></button>
          <button class="row" id="imp-merge"><span class="row-main"><span class="row-title">导入并合并学习数据</span><span class="row-sub">保留本机记录，适合多设备汇总</span></span><span class="row-arrow">›</span></button>
          <button class="row" id="imp-replace"><span class="row-main"><span class="row-title">导入并覆盖学习数据</span><span class="row-sub">用备份完整替换本机记录</span></span><span class="row-arrow">›</span></button>
          <button class="row" id="offline-download">
            <span class="row-main"><span class="row-title">下载全部资料供离线使用</span>
            <span class="row-sub" id="offline-sub">${offline && offline.complete ? '已下载 · ' + esc(offline.at || '') : '正文和搜索需联网使用过才能离线，建议先完整下载'}</span></span>
            <span class="row-arrow">↓</span>
          </button>
          <button class="row" id="rst-quiz"><span class="row-main"><span class="row-title" style="color:var(--red)">清空刷题记录</span><span class="row-sub">保留卡片进度</span></span><span class="row-arrow">›</span></button>
          <button class="row" id="rst-all"><span class="row-main"><span class="row-title" style="color:var(--red)">清空全部数据</span><span class="row-sub">不可恢复，请谨慎操作</span></span><span class="row-arrow">›</span></button>
        </div>

        <div class="sec-title">关于</div>
        <div class="card">
          <div class="row"><span class="row-main"><span class="row-title">资料规模</span><span class="row-sub">${S.books.length} 份资料 · ${(S.meta.stats.chars / 10000).toFixed(1)} 万字 · ${S.quiz.length} 题 · ${S.cards.length} 条卡片</span></span></div>
          <div class="row"><span class="row-main"><span class="row-title">数据存储</span><span class="row-sub">全部保存在本机浏览器，不联网上传</span></span></div>
          <div class="row"><span class="row-main"><span class="row-title">安装到桌面</span><span class="row-sub">浏览器菜单 → 添加到主屏幕</span></span></div>
        </div>
        <div style="height:16px"></div>
      `;

      root.querySelectorAll('[data-font]').forEach(b => {
        b.addEventListener('click', () => {
          const d = +b.dataset.font;
          const nv = Math.min(24, Math.max(13, Store.getSettings().fontSize + d));
          Store.setSetting('fontSize', nv);
          toast('字号：' + nv + 'px');
          render();
        });
      });
      root.querySelector('#set-theme').addEventListener('click', () => {
        const cur = Store.getSettings().theme;
        const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
        Store.setSetting('theme', next);
        applyTheme();
        render();
        toast(next === 'auto' ? '跟随系统' : next === 'dark' ? '深色模式' : '浅色模式');
      });
      root.querySelector('#set-shuffle').addEventListener('click', () => {
        Store.setSetting('shuffleOptions', !Store.getSettings().shuffleOptions);
        render();
      });
      root.querySelector('#exp').addEventListener('click', () => {
        const data = Store.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'zsb-review-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        toast('已导出备份文件');
      });
      function chooseImport(mode) {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = () => {
          const f = inp.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try {
              Store.importData(r.result, { mode });
              toast(mode === 'merge' ? '合并导入成功' : '覆盖导入成功');
              render();
            } catch (e) {
              toast('导入失败：' + (e.message || '文件格式不正确'), 3600);
            }
          };
          r.readAsText(f);
        };
        inp.click();
      }
      root.querySelector('#imp-merge').addEventListener('click', () => chooseImport('merge'));
      root.querySelector('#imp-replace').addEventListener('click', () => {
        if (confirm('覆盖导入会替换本机全部学习记录，确定继续选择文件吗？')) chooseImport('replace');
      });
      root.querySelector('#offline-download').addEventListener('click', async () => {
        const btn = root.querySelector('#offline-download');
        const sub = root.querySelector('#offline-sub');
        btn.disabled = true;
        sub.textContent = '正在准备离线资料…';
        try {
          const result = await requestOfflineCache(p => {
            sub.textContent = `正在缓存 ${p.done} / ${p.total} 个文件…`;
          });
          const at = new Date().toLocaleString('zh-CN', { hour12: false });
          const complete = !result.failed;
          Store.setOfflineStatus({ complete, at, files: result.done });
          sub.textContent = complete ? '已下载 · ' + at : `部分完成：${result.failed} 个文件失败`;
          toast(complete ? '全部资料已缓存，可离线使用' : '部分文件缓存失败，请稍后重试', 2600);
        } catch (e) {
          sub.textContent = '下载失败：' + (e.message || '请检查网络');
          toast(sub.textContent, 3000);
        } finally {
          btn.disabled = false;
        }
      });
      root.querySelector('#rst-quiz').addEventListener('click', () => {
        if (confirm('确定清空全部刷题记录与错题本吗？此操作不可恢复。')) {
          Store.resetQuiz(); toast('已清空刷题记录'); render();
        }
      });
      root.querySelector('#rst-all').addEventListener('click', () => {
        if (confirm('确定清空全部数据吗？包括刷题记录、错题本、背诵进度。此操作不可恢复！')) {
          if (confirm('再次确认：所有学习进度将丢失，确定继续？')) {
            Store.resetAll(); toast('已清空全部数据');
            setTimeout(() => location.reload(), 600);
          }
        }
      });
    };
  }

  function renderWrongBook() {
    return function (root) {
      const ids = Store.getWrongList();
      const list = ids.map(id => S.quiz.find(q => q.id === id)).filter(Boolean);
      if (!list.length) {
        root.innerHTML = '<div class="empty"><span class="ei">✓</span><p>错题本是空的<br>继续保持！</p></div>';
        return;
      }
      root.innerHTML = `
        <div class="sec-title">错题本（${list.length} 道）
          <span style="float:right;display:flex;gap:8px">
            <button class="more" id="w-start">全部重做</button>
            <button class="more" id="w-clear" style="color:var(--red)">清空</button>
          </span>
        </div>
        <div class="card">
          ${list.map(q => {
            const st = Store.getQStat(q.id);
            return `<div class="row wrong-item">
              <button class="wrong-open" data-qid="${q.id}">
                <span class="row-num" style="background:var(--red-soft);color:var(--red);font-size:11px">${(TYPE_NAME[q.type] || '题').slice(0, 2)}</span>
                <span class="row-main">
                  <span class="row-title" style="font-weight:400;font-size:14px">${esc(cleanStem(q.stem).slice(0, 50))}</span>
                  <span class="row-sub">错 ${st.wrong} 次 · 对 ${st.right} 次 · ${esc(q.bookTitle)}</span>
                </span>
              </button>
              <button class="btn btn-sm btn-ghost" data-remove="${q.id}">移出</button>
            </div>`;
          }).join('')}
        </div>
        <div style="height:14px"></div>
      `;
      root.querySelector('#w-start').addEventListener('click', () => {
        startWrongQuiz();
      });
      root.querySelector('#w-clear').addEventListener('click', () => {
        if (!confirm('确定清空错题本吗？刷题记录和正确率仍会保留。')) return;
        Store.clearAllWrong();
        toast('错题本已清空');
        render();
      });
      root.querySelectorAll('[data-qid]').forEach(el => {
        el.addEventListener('click', () => {
          const q = S.quiz.find(x => x.id === el.dataset.qid);
          push(renderSingleQuestion(q), '错题详情');
        });
      });
      root.querySelectorAll('[data-remove]').forEach(el => {
        el.addEventListener('click', () => {
          Store.clearWrong(el.dataset.remove);
          toast('已移出错题本');
          render();
        });
      });
    };
  }

  // ============================================================
  //  主题
  // ============================================================
  function applyTheme() {
    const t = Store.getSettings().theme;
    let dark = false;
    if (t === 'dark') dark = true;
    else if (t === 'auto') {
      dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const l = document.getElementById('hljs-light');
    const d = document.getElementById('hljs-dark');
    if (l && d) { l.disabled = dark; d.disabled = !dark; }
  }

  // ============================================================
  //  数据加载（带防重入与路径解析修正）
  // ============================================================
  let booted = false;

  /** 把相对路径解析为绝对 URL，避免子路径部署时拼错地址 */
  function assetUrl(rel) {
    if (/^(https?:)?\/\//i.test(rel)) return rel;
    // document.baseURI 始终指向 index.html 所在目录
    const base = (typeof document !== 'undefined' && document.baseURI) || (location.href);
    try { return new URL(rel.replace(/^\.\//, ''), base).href; }
    catch (e) { return rel; }
  }

  /** 统一的 JSON 加载，失败时抛出可读错误 */
  async function loadJson(rel) {
    if (STANDALONE) {
      const key = {
        'data/meta.json': 'meta',
        'data/books.json': 'books',
        'data/quiz.json': 'quiz',
        'data/cards.json': 'cards'
      }[rel];
      if (key && STANDALONE[key] != null) return STANDALONE[key];
    }
    const url = assetUrl(rel);
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + rel);
    return r.json();
  }

  async function boot() {
    if (booted) return;            // 防止重复初始化
    booted = true;

    applyTheme();
    // 浏览器禁止 file:// 页面 fetch 本地 JSON。误开站点入口时，
    // 自动转到已内嵌全部数据的离线版。
    if (!STANDALONE && location.protocol === 'file:' &&
        /\/site\/index\.html$/i.test(location.pathname.replace(/\\/g, '/'))) {
      location.replace(new URL('../专升本复习-离线版.html', location.href).href);
      return;
    }
    try {
      const [meta, books, quiz, cards] = await Promise.all([
        loadJson('data/meta.json'),
        loadJson('data/books.json'),
        loadJson('data/quiz.json'),
        loadJson('data/cards.json')
      ]);
      if (!Array.isArray(books) || !Array.isArray(quiz) || !Array.isArray(cards)) {
        throw new Error('数据格式异常');
      }
      S.meta = meta; S.books = books; S.quiz = quiz; S.cards = cards;
      // 搜索索引较大（约 3 MB），改为首次搜索时才下载，避免拖慢启动
      S.searchReady = false;
    } catch (e) {
      console.error('数据加载失败', e);
      const sp = document.getElementById('splash');
      if (sp) {
        sp.innerHTML =
          '<div class="empty"><span class="ei">!</span>' +
          '<p><b>资料载入失败</b><br>' + String(e.message || e).replace(/</g, '&lt;') + '</p>' +
          '<p style="margin-top:14px;font-size:12.5px;line-height:1.8">' +
          '请确认：<br>1. 双击「复习App」目录下的「专升本复习-离线版.html」<br>' +
          '2. 或运行「一键启动-手机访问.ps1」后使用 http 地址<br>' +
          '3. 若部署在子路径，请确认 site 目录内容在站点根</p>' +
          '<p style="margin-top:14px"><button class="btn" onclick="location.reload()">重新加载</button></p></div>';
      }
      return;
    }

    // 事件绑定
    backBtn.addEventListener('click', back);
    $('#btn-theme').addEventListener('click', () => {
      const cur = Store.getSettings().theme;
      const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
      Store.setSetting('theme', next);
      applyTheme();
      toast(next === 'auto' ? '跟随系统' : next === 'dark' ? '深色模式' : '浅色模式');
    });
    document.querySelectorAll('.tab').forEach(b => {
      b.addEventListener('click', () => {
        const t = b.dataset.tab;
        setTab(t);
        if (t === 'home') go(renderHome, '专升本复习');
        else if (t === 'read') go(renderBookList, '阅读资料');
        else if (t === 'quiz') go(renderQuizHome, '刷题');
        else if (t === 'card') go(renderCardHome, '背诵卡片');
        else if (t === 'me') go(renderMe, '我的');
      });
    });
    // 错题本入口：长按"我的"或首页入口
    setTab('home');
    go(renderHome, '专升本复习');

    // 隐藏启动画面
    const sp = document.getElementById('splash');
    sp.classList.add('gone');
    setTimeout(() => sp.remove(), 400);

    // 监听系统主题变化
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (Store.getSettings().theme === 'auto') applyTheme();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
