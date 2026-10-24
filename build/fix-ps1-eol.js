#!/usr/bin/env node
/**
 * 统一 PowerShell 脚本行尾为 CRLF + UTF-8 BOM
 *
 * 背景：用编辑器/工具写入的 .ps1 默认是 LF 行尾，
 * Windows PowerShell 5.1 解析时会把 Read-Host 后紧跟的 } 误判为语法错误。
 * 本脚本把指定 .ps1 全部转成 CRLF + BOM，确保 5.1 与 7.x 都能正常执行。
 *
 * 用法：node fix-ps1-eol.js [目录]
 */
const fs = require('fs');
const path = require('path');

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [
  path.join(__dirname, '..'),
  path.join(__dirname, '..', '..', '..', '复习资料（专升本专业课）', '2', '复习App')
];

let total = 0, fixed = 0;

function walk(d) {
  if (!fs.existsSync(d)) return;
  const st = fs.statSync(d);
  if (!st.isDirectory()) return;
  // 跳过 node_modules
  if (path.basename(d) === 'node_modules') return;
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) { walk(p); continue; }
    if (!name.toLowerCase().endsWith('.ps1')) continue;
    total++;
    const raw = fs.readFileSync(p);
    let text = raw.toString('utf8').replace(/^\uFEFF/, '');
    const needLf = /\r\n/.test(text) ? false : (/\n/.test(text) && !/\r\n/.test(text));
    const hasBom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
    if (!needLf && hasBom) continue;               // 已是 CRLF + BOM
    // 统一为 CRLF，写为 UTF-8 with BOM
    text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    fs.writeFileSync(p, '\uFEFF' + text, 'utf8');
    fixed++;
    console.log('  已修复:', p);
  }
}

console.log('=== 统一 PowerShell 脚本行尾为 CRLF + BOM ===');
for (const d of dirs) {
  console.log('扫描目录:', d);
  walk(path.resolve(d));
}
console.log('');
console.log('共扫描 .ps1 文件 ' + total + ' 个，修复 ' + fixed + ' 个');
