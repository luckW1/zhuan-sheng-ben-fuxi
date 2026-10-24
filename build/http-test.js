#!/usr/bin/env node
/**
 * HTTP 回归测试：启动临时静态服务器，验证正常访问、目录穿越拒绝、
 * 畸形 URL 返回 400，并确认异常请求后服务器仍然存活。
 */
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const SERVE = path.join(__dirname, 'serve.js');
const ROOT = path.join(__dirname, '..', 'site');
let pass = 0;
let fail = 0;

function ok(name, condition, extra) {
  if (condition) {
    pass++;
    console.log('  ✓ %s', name);
  } else {
    fail++;
    console.log('  ✗ %s %s', name, extra || '');
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(err => err ? reject(err) : resolve(port));
    });
  });
}

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(
        'GET ' + requestPath + ' HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + port + '\r\n' +
        'Connection: close\r\n\r\n'
      );
    });
    socket.setTimeout(4000);
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(raw);
      resolve({ status: match ? Number(match[1]) : 0, raw });
    });
    socket.on('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('请求超时: ' + requestPath));
      }
    });
    socket.on('error', err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 6000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('服务器提前退出，退出码 ' + child.exitCode);
    try {
      const response = await rawRequest(port, '/');
      if (response.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('服务器启动超时');
}

async function main() {
  const port = await getFreePort();
  let stderr = '';
  const child = spawn(
    process.execPath,
    [SERVE, String(port), ROOT, '127.0.0.1'],
    { cwd: path.join(__dirname, '..'), windowsHide: true }
  );
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  try {
    await waitForServer(port, child);
    console.log('=== HTTP 回归测试 ===\n');

    const home = await rawRequest(port, '/');
    ok('GET / 返回 200', home.status === 200, '实际 ' + home.status);
    ok('首页包含应用标题', home.raw.includes('专升本复习'));

    const traversal = await rawRequest(port, '/../README.md');
    ok('GET /../README.md 返回 403', traversal.status === 403, '实际 ' + traversal.status);

    const malformed = await rawRequest(port, '/%zz');
    ok('GET /%zz 返回 400', malformed.status === 400, '实际 ' + malformed.status);

    const after = await rawRequest(port, '/');
    ok('异常请求后服务器继续响应', after.status === 200, '实际 ' + after.status);
    ok('异常请求后服务器进程仍存活', child.exitCode === null, '退出码 ' + child.exitCode);
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  if (fail && stderr) console.error('\n服务器输出:\n' + stderr);
  console.log('\n' + '='.repeat(52));
  console.log('  通过 %d 项，失败 %d 项', pass, fail);
  console.log('='.repeat(52));
  process.exitCode = fail ? 1 : 0;
}

main().catch(err => {
  console.error('HTTP 测试启动失败:', err.message || err);
  process.exitCode = 1;
});
