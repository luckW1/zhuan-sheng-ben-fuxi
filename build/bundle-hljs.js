#!/usr/bin/env node
/**
 * 把 highlight.js（CommonJS）打包成浏览器可用的 IIFE 单文件。
 * 做法：用一层极简的 require 模拟器，把各语言模块注册进 core 实例。
 */
const fs = require('fs');
const path = require('path');

const HLJSDIR = path.join(__dirname, '..', 'node_modules', 'highlight.js', 'lib');
const OUT = path.join(__dirname, '..', 'site', 'js', 'vendor', 'highlight.min.js');

const LANGS = ['java', 'sql', 'bash', 'json', 'xml', 'markdown', 'plaintext', 'javascript', 'css', 'ini'];

function read(p) { return fs.readFileSync(p, 'utf8'); }

const out = [];
out.push('/*! highlight.js (browser bundle) — languages: ' + LANGS.join(', ') + ' */');
out.push('(function(global){');
out.push('"use strict";');

// ---- 模块系统（极简 CJS 模拟） ----
out.push('var __modules = {};');
out.push('var __cache = {};');
out.push('function __define(name, fn){ __modules[name] = fn; }');
out.push('function __require(name){');
out.push('  if (__cache[name]) return __cache[name].exports;');
out.push('  var m = { exports: {} };');
out.push('  __cache[name] = m;');
out.push('  var fn = __modules[name];');
out.push('  if (!fn) return m.exports;');
out.push('  fn(m, m.exports, __require);');
out.push('  return m.exports;');
out.push('}');

// ---- core ----
out.push('__define("highlight.js/lib/core", function(module, exports, require){');
out.push(read(path.join(HLJSDIR, 'core.js')));
out.push('});');

// ---- 语言 ----
for (const l of LANGS) {
  const p = path.join(HLJSDIR, 'languages', l + '.js');
  if (!fs.existsSync(p)) continue;
  out.push('__define("highlight.js/lib/languages/' + l + '", function(module, exports, require){');
  out.push(read(p));
  out.push('});');
}

// ---- 注册 ----
out.push('var hljs = __require("highlight.js/lib/core");');
out.push('var __langs = ' + JSON.stringify(LANGS) + ';');
out.push('for (var i = 0; i < __langs.length; i++) {');
out.push('  try {');
out.push('    var nm = __langs[i];');
out.push('    hljs.registerLanguage(nm, __require("highlight.js/lib/languages/" + nm));');
out.push('  } catch (e) { /* 忽略缺失语言 */ }');
out.push('}');
// 同时挂到 window / self / globalThis，确保任何宿主都能访问
out.push('try { if (typeof window !== "undefined") window.hljs = hljs; } catch (e) {}');
out.push('try { if (typeof self !== "undefined") self.hljs = hljs; } catch (e) {}');
out.push('try { if (typeof globalThis !== "undefined") globalThis.hljs = hljs; } catch (e) {}');
out.push('return hljs;');
out.push('})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));');

fs.writeFileSync(OUT, out.join('\n'), 'utf8');
console.log('已生成:', OUT);
console.log('大小:', (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');

// ---- 验证：在 Node 中模拟运行，确认注册成功 ----
try {
  const sandbox = { console };
  const vm = require('vm');
  const code = fs.readFileSync(OUT, 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const h = sandbox.hljs;
  if (!h) throw new Error('hljs 未导出');
  const langs = h.listLanguages();
  console.log('验证通过 — 已注册语言:', langs.join(', '));
  const r = h.highlight('public class A { }', { language: 'java' });
  console.log('高亮测试(java) 输出片段:', r.value.slice(0, 90).replace(/\n/g, ' '));
  const r2 = h.highlight('SELECT * FROM t WHERE id = 1;', { language: 'sql' });
  console.log('高亮测试(sql)  输出片段:', r2.value.slice(0, 90).replace(/\n/g, ' '));
} catch (e) {
  console.error('验证失败:', e.message);
}
