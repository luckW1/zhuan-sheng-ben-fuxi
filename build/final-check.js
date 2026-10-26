#!/usr/bin/env node
/**
 * 最终验收：从交付目录加载页面，完整走一遍五大功能
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ %s', n); } else { fail++; console.log('  ✗ %s %s', n, e || ''); } };

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const marked = fs.readFileSync(path.join(SITE, 'js/vendor/marked.js'), 'utf8');
const hljs = fs.readFileSync(path.join(SITE, 'js/vendor/highlight.min.js'), 'utf8');
const store = fs.readFileSync(path.join(SITE, 'js/store.js'), 'utf8');
const app = fs.readFileSync(path.join(SITE, 'js/app.js'), 'utf8');

function mkStore() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}
const fetchCount = {};
function mkFetch() {
  return url => {
    const u = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\.?\//, '');
    fetchCount[u] = (fetchCount[u] || 0) + 1;
    const p = path.join(SITE, u);
    return new Promise(res => fs.readFile(p, (e, b) => {
      if (e) return res({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      const t = b.toString('utf8');
      res({ ok: true, status: 200, text: () => Promise.resolve(t), json: () => Promise.resolve(JSON.parse(t)) });
    }));
  };
}

const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', e => { const m = String(e.message || ''); if (/Could not parse CSS|Not implemented/i.test(m)) return; jsErrors.push(m); });
vc.on('error', (...a) => jsErrors.push(a.map(String).join(' ')));

const clean = html.replace(/<script src="[^"]*"><\/script>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(clean, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const win = dom.window, doc = win.document;
win.fetch = mkFetch();
Object.defineProperty(win, 'localStorage', { value: mkStore(), writable: true });
win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
win.requestIdleCallback = f => setTimeout(f, 0);
win.scrollTo = () => {};
win.navigator.clipboard = { writeText: () => Promise.resolve() };
if (!win.Element.prototype.scrollIntoView) win.Element.prototype.scrollIntoView = () => {};

(async () => {
  console.log('=== 从交付目录做最终验收 ===\n');
  win.eval(marked); win.eval(hljs); win.eval(store); win.eval(app);
  doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1000));

  const view = doc.getElementById('view');
  console.log('--- 启动 ---');
  ok('启动画面已消失', !doc.getElementById('splash'));
  ok('首页正常渲染（不再报"资料载入失败"）', !!view.querySelector('.hero'));
  ok('统计数字正确（414 题 / 857 卡片）', /414/.test(view.textContent) && /857/.test(view.textContent));

  console.log('\n--- 数据只加载一次（防重入生效）---');
  ok('meta.json 只请求 1 次', fetchCount['data/meta.json'] === 1, '实际 ' + fetchCount['data/meta.json']);
  ok('books.json 只请求 1 次', fetchCount['data/books.json'] === 1, '实际 ' + fetchCount['data/books.json']);
  ok('quiz.json 只请求 1 次', fetchCount['data/quiz.json'] === 1, '实际 ' + fetchCount['data/quiz.json']);

  console.log('\n--- 阅读 ---');
  doc.querySelectorAll('.tab')[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok('书籍列表 21 本', view.querySelectorAll('[data-book]').length === 21);
  view.querySelectorAll('[data-book]')[2].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  view.querySelectorAll('[data-ch]')[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  ok('正文分片加载成功', !!view.querySelector('#md-body') && view.querySelector('#md-body').textContent.length > 300);

  console.log('\n--- 刷题 ---');
  doc.querySelectorAll('.tab')[2].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  Array.from(view.querySelectorAll('[data-go]')).find(e => e.dataset.go === 'type-choice')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  ok('题目渲染', !!view.querySelector('.q-card'));
  view.querySelector('.opt').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok('判分并显示答案', !!view.querySelector('.answer-box'));
  ok('下一题按钮出现', !!view.querySelector('#btn-next'));

  console.log('\n--- 背诵卡片 ---');
  doc.querySelectorAll('.tab')[3].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  Array.from(view.querySelectorAll('[data-c]')).find(e => e.dataset.c === 'all')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  ok('卡片显示', !!view.querySelector('#fcard'));
  view.querySelectorAll('.grade-btn')[2].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  ok('评分后切换卡片', !!view.querySelector('#fcard'));

  console.log('\n--- 统计 ---');
  doc.querySelectorAll('.tab')[4].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok('统计页渲染', !!view.querySelector('.card-flat'));

  console.log('\n--- 无 JS 错误 ---');
  ok('运行期零错误', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  console.log('\n' + '='.repeat(46));
  console.log('  通过 %d 项，失败 %d 项', pass, fail);
  console.log('='.repeat(46));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃:', e); process.exit(2); });
