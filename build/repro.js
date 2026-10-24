#!/usr/bin/env node
/**
 * 复现用户的「资料载入失败」：从「已部署的站点根」加载页面
 * 关键差异：真实浏览器中 index.html 通过相对路径 'data/meta.json' 请求，
 * 而 jsdom 需要 fetch 桩。这里重点验证 fetch 的 URL 解析是否正确。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site'));

console.log('站点根目录:', SITE);
console.log('index.html 存在:', fs.existsSync(path.join(SITE, 'index.html')));

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');

// 检查 index.html 中的脚本引用路径
const scriptSrcs = (html.match(/<script src="([^"]+)"/g) || []).map(s => s.replace(/<script src="|"/g, ''));
console.log('\n脚本引用:');
scriptSrcs.forEach(s => {
  const p = path.join(SITE, s);
  console.log('  %-34s %s', s, fs.existsSync(p) ? '存在' : '缺失!');
});
const cssHrefs = (html.match(/<link[^>]+href="([^"]+\.css)"/g) || []).map(s => s.match(/href="([^"]+)"/)[1]);
console.log('\n样式引用:');
cssHrefs.forEach(s => {
  const p = path.join(SITE, s);
  console.log('  %-34s %s', s, fs.existsSync(p) ? '存在' : '缺失!');
});

function makeStorage() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}

const fetchLog = [];
function makeFetch(baseUrl) {
  return function (url) {
    // 真实浏览器行为：相对 URL 基于 document.baseURI（即 index.html 所在目录）解析
    const resolved = new URL(String(url), baseUrl);
    const u = decodeURIComponent(resolved.pathname).replace(/^\/+/, '');
    // 站点根是 SITE，页面若在 baseUrl 的子目录下，需把该子目录前缀剥掉再映射到 SITE
    const basePath = new URL(baseUrl).pathname.replace(/^\/+/, '').replace(/\/$/, '');
    let rel = u;
    if (basePath && u.startsWith(basePath + '/')) rel = u.slice(basePath.length + 1);
    const p = path.join(SITE, rel);
    fetchLog.push({ requested: String(url), resolved: u, mapped: rel, exists: fs.existsSync(p) });
    return new Promise(res => {
      fs.readFile(p, (err, buf) => {
        if (err) {
          console.log('  [fetch 404]', u, '(映射到', rel + ')');
          return res({ ok: false, status: 404, json: () => Promise.reject(new Error('404')), text: () => Promise.reject(new Error('404')) });
        }
        const t = buf.toString('utf8');
        res({ ok: true, status: 200, text: () => Promise.resolve(t), json: () => { try { return Promise.resolve(JSON.parse(t)); } catch (e) { console.log('  [JSON 解析失败]', u, e.message); return Promise.reject(e); } } });
      });
    });
  };
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String(e.message || '');
  if (/Could not parse CSS|Not implemented/i.test(m)) return;
  console.log('[jsdomError]', m.slice(0, 300));
});
vc.on('error', (...a) => console.log('[error]', a.map(String).map(s => s.slice(0, 250)).join(' ')));

// 关键：用带路径的 URL 模拟 GitHub Pages 的 /repo/ 子路径部署
const BASE = process.argv[3] || 'http://localhost/';
console.log('\n模拟页面地址:', BASE);

const cleanHtml = html.replace(/<script src="[^"]*"><\/script>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(cleanHtml, { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const win = dom.window;

win.fetch = makeFetch(BASE);
Object.defineProperty(win, 'localStorage', { value: makeStorage(), writable: true });
win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
win.requestIdleCallback = fn => setTimeout(fn, 0);
win.scrollTo = () => {};
win.navigator.clipboard = { writeText: () => Promise.resolve() };
if (!win.Element.prototype.scrollIntoView) win.Element.prototype.scrollIntoView = () => {};

// 注入脚本
for (const s of ['js/vendor/marked.js', 'js/vendor/highlight.min.js', 'js/store.js', 'js/app.js']) {
  const p = path.join(SITE, s);
  if (!fs.existsSync(p)) { console.log('脚本缺失:', s); process.exit(1); }
  try { win.eval(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.log('脚本执行失败:', s, e.message); process.exit(1); }
}

console.log('\n触发启动...');
win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));

setTimeout(() => {
  console.log('\n=== fetch 请求记录 ===');
  fetchLog.forEach(f => console.log('  %-24s -> %-40s %s', f.requested, f.resolved, f.exists ? 'OK' : '404!'));

  console.log('\n=== 最终 DOM 状态 ===');
  const splash = win.document.getElementById('splash');
  const view = win.document.getElementById('view');
  console.log('splash 存在:', !!splash);
  console.log('view 内容长度:', view.textContent.length);
  console.log('view 前 200 字:', JSON.stringify(view.textContent.trim().slice(0, 200)));
  if (view.querySelector('.hero')) console.log('结论: 首页渲染成功 ✓');
  else if (view.querySelector('.empty')) console.log('结论: 显示错误提示 ->', view.querySelector('.empty').textContent.trim().slice(0, 120));
  process.exit(0);
}, 1500);
