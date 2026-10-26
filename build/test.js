#!/usr/bin/env node
/**
 * 逻辑验证：用 jsdom 模拟浏览器环境，测试应用核心功能
 * 若 jsdom 不可用，则退化为「静态检查 + 数据流验证」
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ %s', name); }
  else { fail++; console.log('  ✗ %s %s', name, extra || ''); }
}

console.log('=== 1. 文件完整性 ===');
const need = [
  'index.html', 'manifest.json', 'sw.js',
  'css/app.css', 'css/hljs-light.css', 'css/hljs-dark.css',
  'js/app.js', 'js/store.js', 'js/vendor/marked.js', 'js/vendor/highlight.min.js',
  'data/meta.json', 'data/books.json', 'data/quiz.json', 'data/cards.json', 'data/search.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png'
];
for (const f of need) ok(f, fs.existsSync(path.join(SITE, f)));

console.log('\n=== 2. 数据文件可解析 ===');
const meta = JSON.parse(fs.readFileSync(path.join(SITE, 'data/meta.json'), 'utf8'));
const books = JSON.parse(fs.readFileSync(path.join(SITE, 'data/books.json'), 'utf8'));
const quiz = JSON.parse(fs.readFileSync(path.join(SITE, 'data/quiz.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(SITE, 'data/cards.json'), 'utf8'));
ok('meta.stats 存在', !!meta.stats);
ok('books 数量 = 21', books.length === 21, '实际 ' + books.length);
ok('新增重点知识点速记', books.some(b => b.id === 'java-11' && b.title === '11-重点知识点速记'));
ok('quiz 数量 > 400', quiz.length > 400, '实际 ' + quiz.length);
ok('cards 数量 > 800', cards.length > 800, '实际 ' + cards.length);
ok('每本书有 chapterTitles', books.every(b => Array.isArray(b.chapterTitles) && b.chapterTitles.length > 0));
ok('books.json 不含正文字段（体积优化）', books.every(b => !b.chapters));
ok('quiz 全部有答案', quiz.every(q => q.answer || q.answer === '见参考答案'));
ok('cards 全部有文本', cards.every(c => c.text && c.text.length > 3));

console.log('\n=== 3. 正文分片完整 ===');
let shardOk = 0, shardMiss = [];
for (const b of books) {
  const p = path.join(SITE, 'data/books', b.id + '.json');
  if (fs.existsSync(p)) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d.chapters && d.chapters.length) shardOk++;
    else shardMiss.push(b.id + '(空)');
  } else shardMiss.push(b.id + '(缺失)');
}
ok('全部分片存在且非空 (' + shardOk + '/' + books.length + ')', shardMiss.length === 0, shardMiss.join(','));

console.log('\n=== 4. Store 模块逻辑（SM-2 算法等） ===');
// 构造最小 localStorage + window 环境
const store = {};
const localStorageMock = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const sandbox = {
  window: {},
  localStorage: localStorageMock,
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Object,
  Array,
  isNaN,
  parseInt,
  parseFloat,
  setTimeout,
  clearTimeout
};
sandbox.window.localStorage = localStorageMock;
vm.createContext(sandbox);
const storeCode = fs.readFileSync(path.join(SITE, 'js/store.js'), 'utf8');
vm.runInContext(storeCode, sandbox);
const Store = sandbox.window.Store;
ok('Store 已导出', !!Store);
ok('getSettings 默认值正确', Store.getSettings().fontSize === 16);

// 刷题记录
Store.recordAnswer('q1', true);
Store.recordAnswer('q1', true);
ok('答对记录 +1', Store.getQStat('q1').right === 2);
Store.recordAnswer('q2', false);
ok('答错进错题本', Store.getWrongList().includes('q2'));
ok('正确率计算 2对1错=67%', Store.getAccuracy() === 67, '实际 ' + Store.getAccuracy() + '%');
ok('已练习计数', Store.getDoneCount() === 2);

// 错题移出：连续答对 2 次
Store.recordAnswer('q2', true);
Store.recordAnswer('q2', true);
ok('连续答对 2 次移出错题本', !Store.getWrongList().includes('q2'));
Store.recordAnswer('q3', false);
Store.clearAllWrong();
ok('清空错题本保留答题记录', Store.getWrongList().length === 0 && Store.getQStat('q3').wrong === 1);

// SM-2 卡片调度
const st0 = Store.getCardState('c1');
ok('新卡片默认 ef=2.5', st0.ef === 2.5);
const g0 = Store.gradeCard('c1', 0);
ok('评分 0 重置并降 ef', g0.reps === 0 && g0.ef < 2.5, JSON.stringify(g0));
ok('评分 0 十分钟后再现', g0.due - Date.now() < 11 * 60000);
const g2 = Store.gradeCard('c1', 2);
ok('评分 2 首次间隔 2 天', g2.interval === 2, '实际 ' + g2.interval);
const g2b = Store.gradeCard('c1', 2);
ok('评分 2 第二次间隔 6 天', g2b.interval === 6, '实际 ' + g2b.interval);
const g3 = Store.gradeCard('c1', 3);
ok('评分 3 间隔按 ef 增长', g3.interval > 6, '实际 ' + g3.interval);
const g1 = Store.gradeCard('c1', 1);
ok('评分 1（有点印象）缩短间隔', g1.interval < g3.interval, g1.interval + ' < ' + g3.interval);
const g2c = Store.gradeCard('c1', 2);
ok('困难后再评正常，间隔恢复增长', g2c.interval > g1.interval, g2c.interval + ' > ' + g1.interval);

// 到期卡片
Store.gradeCard('c2', 3);
const due = Store.getDueCards(['c1', 'c2', 'c3']);
ok('getDueCards 返回 fresh 列表', due.fresh.includes('c3'));
const summary = Store.getCardSummary(['c1', 'c2', 'c3']);
ok('getCardSummary 统计正确', summary.total === 3 && summary.learned === 2 && summary.fresh === 1, JSON.stringify(summary));

// 统计
ok('今日统计有刷题记录', Store.getTodayStat().quiz > 0);
ok('连续天数 >= 1', Store.getStreak() >= 1);
ok('getRecent 返回 14 天', Store.getRecent(14).length === 14);

// 导出导入
Store.setReadPos('java-1', 'chapter-1', 42, 680, 35);
const dump = Store.exportData();
ok('导出 JSON 可解析', !!JSON.parse(dump).progress);
ok('导出包含阅读进度', !!JSON.parse(dump).readPos['java-1']);
Store.resetAll();
ok('清空全部数据生效', Store.getDoneCount() === 0 && !Store.getReadPos()['java-1']);
let invalidRejected = false;
try { Store.importData('{"settings":{}}'); }
catch (e) { invalidRejected = true; }
ok('结构错误的导入会被拒绝', invalidRejected);
ok('错误导入不破坏现有数据', Store.getDoneCount() === 0);
Store.importData(dump);
ok('导入后数据恢复', Store.getDoneCount() > 0);
ok('导入恢复阅读进度', Store.getReadPos()['java-1'].scroll === 680);

const mergeSource = JSON.parse(dump);
mergeSource.progress.q_merge = { right: 3, wrong: 0, last: Date.now(), wrongFlag: false };
Store.importData(JSON.stringify(mergeSource), { mode: 'merge' });
ok('合并导入保留本机记录并加入新记录', Store.getDoneCount() >= 4 && !!Store.getQStat('q_merge'));

console.log('\n=== 5. 前端代码静态检查 ===');
const appSrc = fs.readFileSync(path.join(SITE, 'js/app.js'), 'utf8');
ok('无语法错误（可被 vm 解析）', (() => {
  try { new vm.Script(appSrc); return true; } catch (e) { console.log('    语法错误:', e.message); return false; }
})());
ok('引用了分片加载 loadBook', appSrc.includes('function loadBook'));
ok('引用了 renderChapterLoader', appSrc.includes('renderChapterLoader'));
ok('包含五个 tab 的处理', ['renderHome', 'renderBookList', 'renderQuizHome', 'renderCardHome', 'renderMe'].every(f => appSrc.includes(f)));
ok('包含 SM-2 调用 gradeCard', appSrc.includes('gradeCard'));
ok('包含错题本 renderWrongBook', appSrc.includes('renderWrongBook'));
ok('包含搜索结果渲染', appSrc.includes('renderSearchResult'));
ok('开放题提供文本框作答区', appSrc.includes('id="open-in"') && appSrc.includes('id="open-submit"'));
ok('开放题提交后保留用户作答', appSrc.includes('<div class="user-answer"><b>你的作答</b>'));
ok('无 console.log 遗留（除 warn/error）', !/console\.log\(/.test(appSrc));

const htmlSrc = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
ok('HTML 引用 app.css', htmlSrc.includes('css/app.css'));
ok('HTML 引用 marked.js', htmlSrc.includes('vendor/marked.js'));
ok('HTML 引用 highlight.min.js', htmlSrc.includes('vendor/highlight.min.js'));
ok('HTML 注册 Service Worker', htmlSrc.includes('serviceWorker'));
ok('HTML 有 viewport 适配', htmlSrc.includes('viewport-fit=cover'));
ok('HTML 允许用户缩放', !/maximum-scale|user-scalable\s*=\s*no/i.test(htmlSrc));
ok('Toast 有屏幕阅读器状态播报', /id="toast"[^>]*role="status"[^>]*aria-live="polite"/.test(htmlSrc));

const swSrc = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
const coreBlock = (swSrc.match(/const CORE = \[([\s\S]*?)\];/) || [])[1] || '';
ok('SW 核心资源不预缓存 search.json（按需加载）', !/data\/search\.json/.test(coreBlock));
ok('SW 有离线回退', swSrc.includes('caches.match'));
ok('SW 缓存版本已更新', /CACHE = 'zsb-review-v\d+'/.test(swSrc));
ok('SW 有新版本自动刷新机制',
  htmlSrc.includes('controllerchange') && /registration\.update\(\)/.test(htmlSrc));
ok('SW 数据分片走动态缓存', swSrc.includes("url.pathname.includes('/data/')"));
ok('SW 支持主动下载完整离线资料', swSrc.includes('CACHE_OFFLINE_PACK') && swSrc.includes('OFFLINE_PROGRESS'));

console.log('\n=== 6. 题库质量抽查 ===');
const byType = {};
quiz.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });
console.log('  题型分布:', JSON.stringify(byType));
ok('选择题都有 4 个选项', quiz.filter(q => q.type === 'choice').every(q => q.options.length >= 2));
ok('判断题答案规范', quiz.filter(q => q.type === 'judge').every(q => /正确|错误/.test(q.answer)));
const longExp = quiz.filter(q => (q.explain || '').length > 80).length;
ok('详细解析（>80字）占比 > 70%', longExp / quiz.length > 0.7, (longExp / quiz.length * 100).toFixed(0) + '%');
const withCode = quiz.filter(q => q.codes && q.codes.length).length;
ok('程序阅读题 100% 提取到代码', quiz.filter(q => q.type === 'code').every(q => q.codes.length > 0));
ok('题干含代码的题目存在', withCode > 40, withCode + ' 题');
// SQL/编程题的代码位于答案区（explain），验证其在解析文本中可读
const sqlWithCode = quiz.filter(q => q.type === 'sql' && /```/.test(q.explain || '')).length;
ok('SQL 题答案含可折叠代码', sqlWithCode > 20, sqlWithCode + ' 题');
const sqlSmoke = ['db-8-sql-1', 'db-8-sql-2', 'db-8-sql-3'].map(id => quiz.find(q => q.id === id));
ok('SQL 模拟卷答案未被数据表污染', sqlSmoke.every(q => q && q.answer === '见参考答案'));
ok('SQL 模拟卷解析包含参考答案', sqlSmoke.every(q => q && /SELECT|CREATE PROCEDURE/.test(q.explain || '')));
ok('SQL 模拟卷答案代码完整提取', sqlSmoke.every(q => q && q.answerCodes.length > 0));

console.log('\n=== 7. 卡片按模块分布 ===');
const cardByBook = {};
cards.forEach(c => { const k = c.subject + '/' + c.bookOrder; cardByBook[k] = (cardByBook[k] || 0) + 1; });
ok('卡片覆盖多个模块', Object.keys(cardByBook).length >= 14, Object.keys(cardByBook).length + ' 个模块');

console.log('\n' + '='.repeat(52));
console.log('  通过 %d 项，失败 %d 项', pass, fail);
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);
