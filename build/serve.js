/**
 * 极简静态服务器（本地测试 + 手机局域网访问）
 * 用法: node serve.js [port] [root] [host]
 *   port  默认 8899
 *   root  默认 ../site
 *   host  默认 0.0.0.0（绑定所有网卡，手机才能通过局域网 IP 访问）
 *        如需仅本机访问，传 127.0.0.1
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.argv[2] || '8899', 10);
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'site'));
const HOST = process.argv[4] || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/** 列出本机所有局域网 IPv4，方便手机访问 */
function listLanIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(String(req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request: URL 编码无效');
    return;
  }
  if (!p.startsWith('/') || p.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);

  // 防目录穿越
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + p);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
    });
    stream.pipe(res);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请换一个端口，例如：node serve.js 8900');
  } else {
    console.error('启动失败:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const ips = listLanIps();
  console.log('');
  console.log('  专升本复习 App 已启动');
  console.log('  ─────────────────────────────────────');
  console.log('  站点目录: ' + ROOT);
  console.log('');
  console.log('  电脑访问:  http://127.0.0.1:' + PORT);
  for (const ip of ips) {
    console.log('  手机访问:  http://' + ip + ':' + PORT + '   ← 手机连同一 Wi-Fi');
  }
  console.log('');
  console.log('  提示: 保持此窗口开启，关闭即停止服务。按 Ctrl+C 退出。');
  console.log('');
});
