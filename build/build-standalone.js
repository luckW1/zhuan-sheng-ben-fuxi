#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const SITE = path.join(APP_ROOT, 'site');
const OUTPUT = path.join(APP_ROOT, '专升本复习-离线版.html');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(SITE, rel), 'utf8'));
}

function buildStandalone() {
  const sourcePath = path.join(SITE, 'index.html');
  let html = fs.readFileSync(sourcePath, 'utf8');

  if (/<base\b/i.test(html)) throw new Error('site/index.html 已包含 base 标签');
  // app.js 引用带版本参数（如 ./js/app.js?v=10），需原样匹配后整体替换
  const scriptTags = html.match(/<script src="\.\/js\/app\.js(?:\?v=\d+)?"><\/script>/g) || [];
  if (scriptTags.length !== 1) {
    throw new Error('无法唯一定位 app.js 脚本入口');
  }

  const books = readJson('data/books.json');
  const bookContents = {};
  for (const book of books) {
    bookContents[book.id] = readJson(path.join('data', 'books', book.id + '.json'));
  }

  const data = {
    generatedAt: new Date().toISOString(),
    meta: readJson('data/meta.json'),
    books,
    quiz: readJson('data/quiz.json'),
    cards: readJson('data/cards.json'),
    search: readJson('data/search.json'),
    bookContents
  };

  const payload = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const standaloneScript =
    '<script>window.__ZSB_STANDALONE_DATA__ = ' + payload + ';</script>\n' +
    '<script src="./js/app.js"></script>';

  html = html
    .replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<base href="./site/">')
    // 用函数返回值，避免题库中的 "$`" 等被 String.replace 当作替换模式。
    .replace(scriptTags[0], () => standaloneScript);

  fs.writeFileSync(OUTPUT, html, 'utf8');
  return {
    output: OUTPUT,
    bytes: fs.statSync(OUTPUT).size,
    books: books.length,
    quiz: data.quiz.length,
    cards: data.cards.length,
    search: data.search.length
  };
}

if (require.main === module) {
  try {
    const result = buildStandalone();
    console.log(
      '离线双击版已生成: %s (%s MiB, %d 本书, %d 题, %d 卡片, %d 搜索条目)',
      path.basename(result.output),
      (result.bytes / 1024 / 1024).toFixed(2),
      result.books,
      result.quiz,
      result.cards,
      result.search
    );
  } catch (err) {
    console.error('离线双击版生成失败:', err.message);
    process.exit(1);
  }
}

module.exports = buildStandalone;
