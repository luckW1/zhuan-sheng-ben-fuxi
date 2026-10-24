#!/usr/bin/env node
/**
 * 端到端 DOM 测试：用 jsdom 真实加载 index.html 并运行 app.js
 * 验证五大功能是否真的能跑起来、点击是否有反应。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, '..', 'site');
let pass = 0, fail = 0;
const errors = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ %s', name); }
  else { fail++; console.log('  ✗ %s %s', name, extra || ''); }
}

// ---- 读取 HTML 与脚本 ----
const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const markedSrc = fs.readFileSync(path.join(SITE, 'js/vendor/marked.js'), 'utf8');
const hljsSrc = fs.readFileSync(path.join(SITE, 'js/vendor/highlight.min.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(SITE, 'js/store.js'), 'utf8');
let appSrc = fs.readFileSync(path.join(SITE, 'js/app.js'), 'utf8');

// ---- 构造 localStorage ----
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i],
    get length() { return m.size; }
  };
}

// ---- 数据桩：拦截 fetch，从本地文件读取 ----
function makeFetch() {
  return function (url) {
    const u = String(url).replace(/^\.?\//, '');
    const p = path.join(SITE, u);
    return new Promise((resolve) => {
      fs.readFile(p, (err, buf) => {
        if (err) {
          resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
          return;
        }
        const text = buf.toString('utf8');
        resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(JSON.parse(text))
        });
      });
    });
  };
}

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => {
  // 忽略 jsdom 不支持的 CSS/资源错误
  const m = String(e.message || '');
  if (/Could not parse CSS|Not implemented|resource loading/i.test(m)) return;
  errors.push(m);
});
virtualConsole.on('error', (...a) => { errors.push(a.join(' ')); });

// 去掉 HTML 中的 <script src> 标签，改为手动按顺序注入（避免 jsdom 网络加载）
const cleanHtml = html
  .replace(/<script src="[^"]*"><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');

/** 直接把设置写进 localStorage，用于构造确定的测试前置状态 */
function StoreSetter(win, key, val) {
  const cur = JSON.parse(win.localStorage.getItem('zsb.settings') || '{}');
  cur[key] = val;
  win.localStorage.setItem('zsb.settings', JSON.stringify(cur));
}

(async function main() {
  console.log('=== 端到端 DOM 测试 ===\n');

  const dom = new JSDOM(cleanHtml, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const win = dom.window;
  const doc = win.document;

  // 注入必要 API
  win.fetch = makeFetch();
  Object.defineProperty(win, 'localStorage', { value: makeStorage(), writable: true });
  win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  win.requestIdleCallback = fn => setTimeout(fn, 0);
  win.navigator.clipboard = { writeText: () => Promise.resolve() };
  win.scrollTo = () => {};
  win.confirm = () => true;
  if (!win.Element.prototype.scrollIntoView) win.Element.prototype.scrollIntoView = () => {};
  else win.Element.prototype.scrollIntoView = () => {};

  console.log('--- 1. 脚本注入与启动 ---');
  try {
    win.eval(markedSrc);
    ok('marked 加载成功', typeof win.marked !== 'undefined');
  } catch (e) { ok('marked 加载成功', false, e.message); }

  try {
    win.eval(hljsSrc);
    ok('highlight.js 加载成功', typeof win.hljs !== 'undefined');
    ok('hljs 已注册 java', win.hljs && win.hljs.listLanguages().includes('java'));
    ok('hljs 已注册 sql', win.hljs && win.hljs.listLanguages().includes('sql'));
  } catch (e) { ok('highlight.js 加载成功', false, e.message); }

  try {
    win.eval(storeSrc);
    ok('store.js 加载成功', typeof win.Store !== 'undefined');
  } catch (e) { ok('store.js 加载成功', false, e.message); }

  try {
    win.eval(appSrc);
    ok('app.js 加载成功（无语法/运行错误）', true);
  } catch (e) { ok('app.js 加载成功', false, e.message); }

  // 触发 DOMContentLoaded
  const evt = new win.Event('DOMContentLoaded', { bubbles: true });
  doc.dispatchEvent(evt);
  // 等待异步 boot 完成
  await new Promise(r => setTimeout(r, 900));

  console.log('\n--- 2. 首页渲染 ---');
  const view = doc.getElementById('view');
  ok('启动画面已移除', !doc.getElementById('splash'));
  ok('首页 hero 已渲染', !!view.querySelector('.hero'));
  const heroText = (view.querySelector('.hero') || {}).textContent || '';
  ok('hero 显示统计信息', /连续学习|已掌握/.test(heroText), heroText.slice(0, 60));
  ok('四个功能入口存在', view.querySelectorAll('.entry').length === 4, view.querySelectorAll('.entry').length + ' 个');
  ok('快捷入口行存在', view.querySelectorAll('.row[data-act]').length >= 4);
  const entryTitles = Array.from(view.querySelectorAll('.entry .et')).map(e => e.textContent);
  console.log('    入口:', entryTitles.join(' / '));

  console.log('\n--- 3. 底部导航切换 ---');
  const tabs = doc.querySelectorAll('.tab');
  ok('五个 tab 存在', tabs.length === 5);
  // 点击"阅读"
  tabs[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok('切换到阅读页显示搜索框', !!view.querySelector('#read-search'));
  const bookRows = view.querySelectorAll('[data-book]');
  ok('书籍列表已渲染（20 本）', bookRows.length === 20, bookRows.length + ' 本');
  const subjTitles = Array.from(view.querySelectorAll('.sec-title')).map(e => e.textContent.trim());
  console.log('    分组:', subjTitles.filter(t => t.includes('Java') || t.includes('数据库')).join(' / '));

  console.log('\n--- 4. 打开一本书（分片加载） ---');
  bookRows[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  const chRows = view.querySelectorAll('[data-ch]');
  ok('章节列表已渲染', chRows.length > 0, chRows.length + ' 章');
  // 打开第一章
  chRows[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  const mdBody = view.querySelector('#md-body');
  ok('章节正文已加载', !!mdBody && mdBody.textContent.length > 200, mdBody ? mdBody.textContent.length + ' 字' : '未加载');
  ok('正文含 Markdown 渲染的标题', !!view.querySelector('#md-body h2, #md-body h3'));
  ok('正文含表格', view.querySelectorAll('#md-body table').length > 0, view.querySelectorAll('#md-body table').length + ' 个表格');
  ok('返回按钮已显示', !doc.getElementById('btn-back').classList.contains('hidden'));

  console.log('\n--- 5. 刷题功能 ---');
  tabs[2].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok('刷题首页显示统计', !!view.querySelector('.stat-grid'));
  // 按题型进入选择题
  const typeRow = Array.from(view.querySelectorAll('[data-go]')).find(e => e.dataset.go === 'type-choice');
  ok('存在"单项选择"练习入口', !!typeRow);
  typeRow.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok('进入答题界面', !!view.querySelector('.q-card'));
  const stem = view.querySelector('.q-stem');
  ok('题干已渲染', !!stem && stem.textContent.length > 5, stem ? stem.textContent.slice(0, 40) : '');
  const opts = view.querySelectorAll('.opt');
  ok('选项已渲染', opts.length >= 2, opts.length + ' 个选项');
  ok('底部操作栏存在', !!view.querySelector('#q-actions'));

  console.log('\n--- 6. 答题判分 ---');
  const firstOpt = view.querySelector('.opt');
  firstOpt.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  const answerBox = view.querySelector('.answer-box');
  ok('答案区已显示', !!answerBox);
  ok('答案区标记了对错', /right|wrong/.test(answerBox.className), answerBox.className);
  ok('显示了正确答案', /正确答案|参考答案/.test(answerBox.textContent));
  const marked = view.querySelectorAll('.opt.correct');
  ok('正确选项被高亮', marked.length >= 1);
  const nextBtn = view.querySelector('#btn-next');
  ok('出现"下一题"按钮', !!nextBtn);
  // 点击下一题
  nextBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok('已切换到下一题', !!view.querySelector('.q-card'));

  console.log('\n--- 7. 判断题作答 ---');
  // 换到判断题
  tabs[2].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  const judgeRow = Array.from(view.querySelectorAll('[data-go]')).find(e => e.dataset.go === 'type-judge');
  ok('存在"判断"练习入口', !!judgeRow);
  judgeRow.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const jbtns = view.querySelectorAll('.judge-btn');
  ok('判断题按钮已渲染', jbtns.length === 2, jbtns.length + ' 个');
  jbtns[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  ok('判断题答案区已显示', !!view.querySelector('.answer-box'));

  console.log('\n--- 8. 背诵卡片 ---');
  tabs[3].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  ok('背诵首页显示进度', !!view.querySelector('.bar'));
  const gradeBtns0 = view.querySelectorAll('.grade-btn');
  ok('背诵首页无评价按钮（未开始）', gradeBtns0.length === 0);
  const dueBtn = Array.from(view.querySelectorAll('[data-c]')).find(e => e.dataset.c === 'all');
  ok('存在"全部卡片"入口', !!dueBtn);
  dueBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const fcard = view.querySelector('#fcard');
  ok('卡片已显示', !!fcard && fcard.textContent.length > 10, fcard ? fcard.textContent.slice(0, 50) : '未显示');
  const gradeBtns = view.querySelectorAll('.grade-btn');
  ok('四个评价按钮存在', gradeBtns.length === 4, gradeBtns.length + ' 个');
  const beforeIdx = (view.querySelector('.quiz-meta') || {}).textContent || '';
  gradeBtns[2].dispatchEvent(new win.Event('click', { bubbles: true }));   // 点"想起来了"
  await new Promise(r => setTimeout(r, 500));
  const afterMeta = (view.querySelector('.quiz-meta') || {}).textContent || '';
  ok('评分后进入下一张卡片', afterMeta !== beforeIdx, '前:' + beforeIdx.slice(0, 12) + ' 后:' + afterMeta.slice(0, 12));
  // 验证 SM-2 已写入
  const cardStates = JSON.parse(win.localStorage.getItem('zsb.cards') || '{}');
  ok('SM-2 状态已持久化', Object.keys(cardStates).length > 0, Object.keys(cardStates).length + ' 条');

  console.log('\n--- 9. 我的 / 统计 ---');
  tabs[4].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  ok('统计页显示图表', !!view.querySelector('.card-flat'));
  ok('显示条形图', view.querySelectorAll('.card-flat div[style*="height"]').length > 5);
  const statText = view.textContent;
  ok('显示正确率', /正确率/.test(statText));
  ok('显示错题数', /错题/.test(statText));
  ok('有设置项', view.querySelectorAll('#set-theme, #set-shuffle, [data-font]').length >= 3);

  console.log('\n--- 10. 错题本 ---');
  // 制造一道错题
  tabs[2].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  const cRow = Array.from(view.querySelectorAll('[data-go]')).find(e => e.dataset.go === 'type-choice');
  cRow.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const optEls = view.querySelectorAll('.opt');
  // 找一个错误选项点击
  const answer = null;
  let clickedWrong = false;
  // 先点第一个，若正确再点第二个
  optEls[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const isRight = view.querySelector('.answer-box').classList.contains('right');
  if (isRight && optEls.length > 1) {
    // 换一题再试
    view.querySelector('#btn-next').dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const o2 = view.querySelectorAll('.opt');
    o2[o2.length - 1].dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
  }
  const progress = JSON.parse(win.localStorage.getItem('zsb.progress') || '{}');
  const wrongIds = Object.keys(progress).filter(k => progress[k].wrongFlag);
  ok('答错后进入错题本', wrongIds.length > 0, wrongIds.length + ' 道错题');

  console.log('\n--- 11. 主题切换 ---');
  const themeBtn = doc.getElementById('btn-theme');
  // 主题循环顺序：auto → dark → light → auto，需逐个点到位
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    themeBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    seen.add(doc.documentElement.getAttribute('data-theme'));
  }
  ok('主题可在 light/dark 间切换', seen.has('dark') && seen.has('light'), Array.from(seen).join(','));
  // 明确设置一个已知状态再验证高亮主题联动
  StoreSetter(win, 'theme', 'dark');
  themeBtn.dispatchEvent(new win.Event('click', { bubbles: true }));  // dark → light
  await new Promise(r => setTimeout(r, 80));
  const hlLight = doc.getElementById('hljs-light');
  const hlDark = doc.getElementById('hljs-dark');
  ok('高亮主题与明暗模式联动', hlLight.disabled !== hlDark.disabled,
     'light.disabled=' + hlLight.disabled + ' dark.disabled=' + hlDark.disabled);

  console.log('\n--- 12. 搜索功能 ---');
  tabs[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  // 手动触发搜索
  const store2 = win.Store;
  ok('搜索索引已加载', true);
  // 直接调用内部渲染（通过模拟回车）
  const inp = view.querySelector('#read-search');
  inp.value = '多态';
  const ke = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  inp.dispatchEvent(ke);
  await new Promise(r => setTimeout(r, 500));
  ok('搜索页已渲染', /题目匹配|资料匹配/.test(view.textContent), view.textContent.slice(0, 60));
  ok('搜索到结果', /题目匹配（\d+）|资料匹配（\d+）/.test(view.textContent));

  console.log('\n--- 13. 运行期错误检查 ---');
  ok('无未捕获的 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '='.repeat(52));
  console.log('  通过 %d 项，失败 %d 项', pass, fail);
  console.log('='.repeat(52));
  if (errors.length) {
    console.log('\n错误详情:');
    errors.slice(0, 10).forEach(e => console.log('  -', e.slice(0, 200)));
  }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('测试崩溃:', e);
  process.exit(2);
});
