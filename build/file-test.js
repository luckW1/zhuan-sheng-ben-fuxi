#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const SITE = path.join(APP_ROOT, 'site');
const OUTPUT = path.join(APP_ROOT, '专升本复习-离线版.html');
let pass = 0;
let fail = 0;

function ok(name, condition, extra) {
  if (condition) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? ' ' + extra : ''));
  }
}

console.log('=== 双击离线版测试 ===\n');

ok('离线版 HTML 已生成', fs.existsSync(OUTPUT));
const html = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
const appSrc = fs.readFileSync(path.join(SITE, 'js', 'app.js'), 'utf8');

ok('离线版使用 site 目录作为资源基址', /<base href="\.\/site\/">/.test(html));
ok('离线版只保留一个 app.js 入口',
  (html.match(/<script src="\.\/js\/app\.js"><\/script>/g) || []).length === 1);
ok('离线版已内嵌数据入口', html.includes('window.__ZSB_STANDALONE_DATA__'));

const match = html.match(
  /window\.__ZSB_STANDALONE_DATA__ = ([\s\S]*?);<\/script>\s*<script src="\.\/js\/app\.js"><\/script>/
);
let data = null;
try {
  data = match ? JSON.parse(match[1]) : null;
} catch (err) {
  data = null;
}
ok('内嵌数据是可解析的 JSON', !!data);

ok('核心数据数量正确',
  !!data && data.books.length === 20 && data.quiz.length === 414 && data.cards.length === 857,
  data ? `实际 ${data.books.length}/${data.quiz.length}/${data.cards.length}` : '');
ok('全部正文分片已内嵌',
  !!data && data.books.every(book =>
    data.bookContents[book.id] &&
    Array.isArray(data.bookContents[book.id].chapters) &&
    data.bookContents[book.id].chapters.length > 0
  ));
ok('搜索索引已内嵌',
  !!data && Array.isArray(data.search) && data.search.length > 0);
ok('App 支持离线数据并自动跳转误开的站点入口',
  appSrc.includes('window.__ZSB_STANDALONE_DATA__') &&
  appSrc.includes('STANDALONE.bookContents') &&
  appSrc.includes('STANDALONE.search') &&
  appSrc.includes('专升本复习-离线版.html'));

console.log('\n====================================================');
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('====================================================');
process.exit(fail ? 1 : 0);
