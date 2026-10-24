#!/usr/bin/env node
/**
 * 验证 GitHub Pages 部署兼容性：
 *  1. manifest.json 在子路径下是否有效（start_url / scope）
 *  2. Service Worker 的 scope 是否覆盖整个站点
 *  3. 所有资源引用是否为相对路径（可被子路径托管）
 */
const fs = require('fs');
const path = require('path');
const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ %s', n); } else { fail++; console.log('  ✗ %s %s', n, e || ''); } };

console.log('=== GitHub Pages 部署兼容性检查 ===\n');

// 1. manifest
const manifest = JSON.parse(fs.readFileSync(path.join(SITE, 'manifest.json'), 'utf8'));
console.log('--- manifest.json ---');
ok('start_url 用相对路径 ./index.html', manifest.start_url === './index.html', manifest.start_url);
ok('scope 用相对路径 ./', manifest.scope === './', manifest.scope);
ok('display 为 standalone（全屏）', manifest.display === 'standalone', manifest.display);
ok('orientation 为 portrait（竖屏）', manifest.orientation === 'portrait', manifest.orientation);
ok('含 192 与 512 图标', manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'));
ok('含 maskable 图标（Android 自适应）', manifest.icons.some(i => i.purpose === 'maskable'));

// 2. index.html 资源引用
const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
console.log('\n--- index.html ---');
// 找出所有 src / href
const refs = [];
const re = /(?:src|href)="([^"]+)"/g;
let m;
while ((m = re.exec(html))) refs.push(m[1]);
const external = refs.filter(r => /^(https?:)?\/\//i.test(r));
const rootAbs = refs.filter(r => r.startsWith('/') && !r.startsWith('//'));
ok('无外部 CDN 依赖', external.length === 0, external.join(', '));
ok('无根绝对路径（可被子路径托管）', rootAbs.length === 0, rootAbs.join(', '));
console.log('    资源引用:', refs.filter(r => !/^https?:/.test(r)).join(', '));

// 3. Service Worker
const sw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
console.log('\n--- sw.js ---');
ok('SW 注册用 document.baseURI（子路径兼容）', /document\.baseURI/.test(fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')));
ok('SW 缓存列表用 ./ 相对路径', /'\.\/index\.html'/.test(sw));
ok('SW 有版本号机制（可强制更新）', /CACHE = 'zsb-review-v\d+'/.test(sw));
ok('SW 有新版本自动刷新', /controllerchange/.test(sw) || /controllerchange/.test(html));

// 4. app.js 路径解析
const app = fs.readFileSync(path.join(SITE, 'js/app.js'), 'utf8');
console.log('\n--- js/app.js ---');
ok('fetch 用 assetUrl 基于 baseURI 解析', /document\.baseURI/.test(app));
ok('有 booted 防重入', /booted/.test(app));
ok('数据分片按需加载', /loadBook/.test(app));

// 5. 所有资源文件真实存在
console.log('\n--- 资源文件存在性 ---');
let missing = [];
for (const r of refs) {
  if (/^(https?:)?\/\//i.test(r) || r.startsWith('data:')) continue;
  const clean = r.replace(/^\.\//, '').split(/[?#]/)[0];
  if (!fs.existsSync(path.join(SITE, clean))) missing.push(r);
}
ok('index.html 引用的资源全部存在', missing.length === 0, missing.join(', '));

// 6. 图标文件
console.log('\n--- 图标 ---');
for (const f of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png']) {
  ok(f, fs.existsSync(path.join(SITE, f)));
}

// 7. .gitignore 存在（避免把 node_modules 传上去）
console.log('\n--- 部署卫生 ---');
ok('.gitignore 存在', fs.existsSync(path.join(SITE, '.gitignore')));
ok('node_modules 不在 site 内', !fs.existsSync(path.join(SITE, 'node_modules')));
ok('无 package.json（纯静态站点）', !fs.existsSync(path.join(SITE, 'package.json')));

console.log('\n' + '='.repeat(52));
console.log('  通过 %d 项，失败 %d 项', pass, fail);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
