#!/usr/bin/env node
/**
 * 验证 .md 链接改写：确保资料里的 [xx](yy.md) 在 App 内跳转，不再 404
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ %s', n); } else { fail++; console.log('  ✗ %s %s', n, e || ''); } };

function mkStore() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}
function mkFetch() {
  return url => {
    const u = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\.?\//, '');
    const p = path.join(SITE, u);
    return new Promise(res => fs.readFile(p, (e, b) => {
      if (e) return res({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      const t = b.toString('utf8');
      res({ ok: true, status: 200, text: () => Promise.resolve(t), json: () => Promise.resolve(JSON.parse(t)) });
    }));
  };
}

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { const m = String(e.message || ''); if (/Could not parse CSS|Not implemented/i.test(m)) return; errs.push(m); });
vc.on('error', (...a) => errs.push(a.map(String).join(' ')));

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

win.eval(fs.readFileSync(path.join(SITE, 'js/vendor/marked.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(SITE, 'js/vendor/highlight.min.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(SITE, 'js/store.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(SITE, 'js/app.js'), 'utf8'));
doc.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));

(async () => {
  await new Promise(r => setTimeout(r, 900));
  const view = doc.getElementById('view');
  const tabs = doc.querySelectorAll('.tab');

  console.log('=== 打开「总目录」（含 21 本书籍的资料） ===');
  tabs[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const books = view.querySelectorAll('[data-book]');
  ok('书籍列表渲染', books.length === 21, books.length + ' 本');

  // 打开 Java 总目录（第一本，order=0）
  books[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const chRows = view.querySelectorAll('[data-ch]');
  ok('章节列表渲染', chRows.length > 0, chRows.length + ' 章');

  // 打开「二、大纲考点与资料模块对应表」——这一章才含 10 个 .md 链接
  let targetIdx = 0;
  const bookData0 = JSON.parse(fs.readFileSync(path.join(SITE, 'data/books/java-0.json'), 'utf8'));
  bookData0.chapters.forEach((c, i) => {
    const full = (c.subs || []).map(s => s.title + s.body).join('') + (c.body || '');
    if (/\]\([^)]+\.md\)/.test(full) && targetIdx === 0) targetIdx = i;
  });
  console.log('    打开章节索引:', targetIdx, '（含 .md 链接的章节）');
  chRows[targetIdx].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 800));

  const mdBody = view.querySelector('#md-body');
  ok('正文加载成功', !!mdBody && mdBody.textContent.length > 100);

  // 核心断言：不再有指向 .md 的链接
  const mdLinks = view.querySelectorAll('a[href$=".md"], a[href*=".md"]');
  ok('不再有指向 .md 文件的原始链接', mdLinks.length === 0,
     mdLinks.length ? '仍有 ' + mdLinks.length + ' 个，首个 href=' + mdLinks[0].getAttribute('href') : '');

  const bookLinks = view.querySelectorAll('a[data-book]');
  console.log('    应用内书籍链接数:', bookLinks.length);
  ok('生成了应用内跳转链接', bookLinks.length > 0, bookLinks.length + ' 个');

  // 验证 data-book 的 id 真实存在
  const bookData = JSON.parse(fs.readFileSync(path.join(SITE, 'data/books.json'), 'utf8'));
  const ids = new Set(bookData.map(b => b.id));
  const badId = Array.from(bookLinks).find(a => !ids.has(a.dataset.book));
  ok('所有 data-book 均指向真实书籍', !badId, badId ? '无效 id: ' + badId.dataset.book : '');

  // 模拟点击第一个链接，应跳转到对应书籍章节页（而非 404）
  if (bookLinks.length) {
    const beforeTitle = doc.getElementById('page-title').textContent;
    bookLinks[0].dispatchEvent(new win.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const afterTitle = doc.getElementById('page-title').textContent;
    ok('点击链接后发生应用内跳转', beforeTitle !== afterTitle,
       beforeTitle + ' → ' + afterTitle);
    ok('跳转后显示的是章节内容页', !!view.querySelector('[data-ch]') || !!view.querySelector('#md-body'));
    // 页面不应出现 404 文本
    ok('页面无 404 内容', !/404 Not Found/.test(view.textContent));
  }

  // 验证 URL 未变化（没有触发浏览器导航）
  ok('浏览器地址未被修改（仍是应用页）', win.location.pathname === '/', win.location.pathname);

  console.log('\n=== 跨科目场景：数据库总目录的链接应跳 db-* ===');
  // 直接切到「阅读」tab 重新进入（避免依赖返回栈层级）
  tabs[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const books2 = view.querySelectorAll('[data-book]');
  ok('返回书籍列表', books2.length === 21, books2.length + ' 本');

  // 数据库总目录
  const allBooks = JSON.parse(fs.readFileSync(path.join(SITE, 'data/books.json'), 'utf8'));
  let dbIdx = allBooks.findIndex(b => b.subject === 'db' && b.order === 0);
  console.log('    数据库总目录索引:', dbIdx);
  books2[dbIdx].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const ch2 = view.querySelectorAll('[data-ch]');
  const dbBook = JSON.parse(fs.readFileSync(path.join(SITE, 'data/books/db-0.json'), 'utf8'));
  let dbTarget = 0;
  dbBook.chapters.forEach((c, i) => {
    const full = (c.subs || []).map(s => s.title + s.body).join('') + (c.body || '');
    if (/\]\([^)]+\.md\)/.test(full) && dbTarget === 0) dbTarget = i;
  });
  ch2[dbTarget].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));

  const dbLinks = view.querySelectorAll('a[data-book]');
  console.log('    数据库总目录的链接数:', dbLinks.length);
  ok('生成了跳转链接', dbLinks.length > 0);
  const wrongOne = Array.from(dbLinks).find(a => !a.dataset.book.startsWith('db-'));
  ok('全部指向 db-* 科目（未误跳 java）', !wrongOne, wrongOne ? '错误示例: ' + wrongOne.dataset.book : '');

  console.log('\n=== 无 JS 错误 ===');
  ok('运行期零错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n' + '='.repeat(46));
  console.log('  通过 %d 项，失败 %d 项', pass, fail);
  console.log('='.repeat(46));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃:', e); process.exit(2); });
