#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const APP_ROOT = path.join(__dirname, '..');
const SITE = path.join(APP_ROOT, 'site');
const PORT = 8931;
const DEBUG_PORT = 9331;
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stage = message => console.error('[Edge 测试] ' + message);

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(1000, () => req.destroy(new Error('request timeout')));
  });
}

async function waitForHttp(url, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await request(url);
      if (res.status >= 200 && res.status < 400) return res;
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('等待服务超时: ' + url);
}

async function waitForJson(url, timeout = 15000) {
  const res = await waitForHttp(url, timeout);
  return JSON.parse(res.body);
}

async function main() {
  const edgePath = EDGE_CANDIDATES.find(p => fs.existsSync(p));
  if (!edgePath) throw new Error('未找到 Microsoft Edge');

  stage('创建临时浏览器配置');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zsb-edge-open-'));
  const screenshot = path.join(os.tmpdir(), 'zsb-open-answer.png');
  const mobileReadingScreenshot = path.join(os.tmpdir(), 'zsb-reading-mobile.png');
  const desktopReadingScreenshot = path.join(os.tmpdir(), 'zsb-reading-desktop.png');
  const darkReadingScreenshot = path.join(os.tmpdir(), 'zsb-reading-dark.png');
  stage('启动本地静态服务');
  const server = spawn(process.execPath, [
    path.join(__dirname, 'serve.js'),
    String(PORT),
    SITE,
    '127.0.0.1'
  ], { stdio: 'ignore', windowsHide: true });
  let edge = null;
  let ws = null;

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/`);
    stage('启动 Edge 无头浏览器');
    edge = spawn(edgePath, [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--disable-software-rasterizer',
      '--disable-extensions',
      `http://127.0.0.1:${PORT}/`
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    edge.stderr.on('data', chunk => {
      const text = String(chunk).trim();
      if (text) stage('Edge: ' + text.slice(0, 300));
    });
    edge.on('exit', code => stage(`Edge 进程退出: ${code}`));

    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    stage('查找页面调试目标');
    let target = null;
    const targetEnd = Date.now() + 15000;
    while (!target && Date.now() < targetEnd) {
      const pages = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      target = pages.find(p => p.type === 'page' && p.url.includes(`127.0.0.1:${PORT}`));
      if (!target) await sleep(150);
    }
    if (!target) throw new Error('未找到 Edge 页面调试目标');

    stage('连接页面调试通道');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await Promise.race([new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    }), sleep(5000).then(() => {
      throw new Error('连接 Edge 页面调试通道超时');
    })]);
    stage('页面调试通道已连接');

    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        stage('收到无法解析的调试消息');
        return;
      }
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
    ws.addEventListener('close', () => {
      for (const { reject } of pending.values()) {
        reject(new Error('Edge 页面调试通道已关闭'));
      }
      pending.clear();
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`调试命令超时: ${method}`));
        }, 5000);
        pending.set(id, {
          resolve: value => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          }
        });
        try {
          ws.send(JSON.stringify({ id, method, params: params || {} }));
        } catch (e) {
          pending.delete(id);
          clearTimeout(timer);
          reject(e);
        }
      });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
      }
      return result.result.value;
    }
    async function waitFor(expression, timeout = 12000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await evaluate(expression)) return;
        await sleep(150);
      }
      throw new Error('页面状态等待超时: ' + expression);
    }
    async function waitForController(timeout = 20000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try {
          if (await evaluate(`!!navigator.serviceWorker.controller`)) return true;
        } catch (e) {}
        await sleep(150);
      }
      return false;
    }

    await send('Page.enable');
    await send('Runtime.enable');
    async function setViewport(width, height, mobile = true) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        screenWidth: width,
        screenHeight: height,
        deviceScaleFactor: 2,
        mobile
      });
      await send('Emulation.setTouchEmulationEnabled', {
        enabled: mobile,
        maxTouchPoints: 5
      });
      await sleep(120);
    }

    stage('切换为手机视口并刷新页面');
    await setViewport(390, 844);
    await send('Page.reload', { ignoreCache: true });
    stage('页面调试命令已启用');
    await waitFor(`!document.getElementById('splash')`, 20000);
    await waitFor(`(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration();
      return !!registration && !!registration.active;
    })()`, 20000);
    const controllerReady = await waitForController();
    const swState = await evaluate(`(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        version: document.querySelector('meta[name="app-version"]').content,
        scriptUrl: registration.active ? registration.active.scriptURL : '',
        controller: !!navigator.serviceWorker.controller,
        activeState: registration.active ? registration.active.state : '',
        caches: await caches.keys()
      };
    })()`);
    stage('Service Worker 状态: ' + JSON.stringify(swState));

    const homeLayout = await evaluate(`({
      viewport: innerWidth,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      themeHeight: document.querySelector('#btn-theme').getBoundingClientRect().height,
      tabHeight: document.querySelector('.tab').getBoundingClientRect().height
    })`);

    stage('检查阅读页搜索框');
    await evaluate(`document.querySelector('[data-tab="read"]').click(); true`);
    await waitFor(`!!document.querySelector('.search-box input')`);
    const searchLayout = await evaluate(`({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      fontSize: parseFloat(getComputedStyle(document.querySelector('.search-box input')).fontSize),
      boxHeight: document.querySelector('.search-box').getBoundingClientRect().height
    })`);
    const mobileReadingLayout = await evaluate(`(() => {
      const row = document.querySelector('.book-row');
      const title = row.querySelector('.row-title');
      const meta = row.querySelector('.book-meta');
      const titleRect = title.getBoundingClientRect();
      const metaRect = meta.getBoundingClientRect();
      return {
        rows: document.querySelectorAll('.book-row').length,
        titleGap: metaRect.top - titleRect.bottom,
        rowHeight: row.getBoundingClientRect().height,
        rowWidth: row.getBoundingClientRect().width,
        cardWidth: row.closest('.card').getBoundingClientRect().width,
        metaFits: meta.scrollWidth <= meta.clientWidth + 1,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      };
    })()`);
    const mobileReadingShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(mobileReadingScreenshot, Buffer.from(mobileReadingShot.data, 'base64'));
    const readingWidthChecks = {};
    for (const width of [360, 430]) {
      await setViewport(width, 844);
      readingWidthChecks[width] = await evaluate(`(() => {
        const meta = document.querySelector('.book-meta');
        return {
          viewport: innerWidth,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          metaFits: meta.scrollWidth <= meta.clientWidth + 1
        };
      })()`);
    }
    await setViewport(390, 844);
    await setViewport(1200, 900, false);
    const desktopReadingLayout = await evaluate(`(() => {
      const row = document.querySelector('.book-row');
      const title = row.querySelector('.row-title');
      const meta = row.querySelector('.book-meta');
      return {
        titleGap: meta.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
        rowHeight: row.getBoundingClientRect().height,
        rowWidth: row.getBoundingClientRect().width,
        cardWidth: row.closest('.card').getBoundingClientRect().width,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      };
    })()`);
    const desktopReadingShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(desktopReadingScreenshot, Buffer.from(desktopReadingShot.data, 'base64'));
    await evaluate(`document.querySelector('#btn-theme').click(); true`);
    await sleep(200);
    const darkReadingShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(darkReadingScreenshot, Buffer.from(darkReadingShot.data, 'base64'));
    await evaluate(`document.querySelector('#btn-theme').click(); document.querySelector('#btn-theme').click(); true`);
    await setViewport(390, 844);

    stage('进入编程题练习');
    await evaluate(`document.querySelector('[data-tab="quiz"]').click(); true`);
    await waitFor(`!!document.querySelector('[data-go="type-program"]')`);
    await evaluate(`document.querySelector('[data-go="type-program"]').click(); true`);
    await waitFor(`!!document.querySelector('#open-in') && !!document.querySelector('#open-submit')`);

    stage('检查 360 / 390 / 430px 手机宽度');
    const widthChecks = {};
    for (const width of [360, 390, 430]) {
      await setViewport(width, 844);
      widthChecks[width] = await evaluate(`({
        viewport: innerWidth,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        bodyHasClass: document.body.classList.contains('has-quiz-actions'),
        textareaFont: parseFloat(getComputedStyle(document.querySelector('#open-in')).fontSize),
        submitHeight: document.querySelector('#open-submit').getBoundingClientRect().height,
        actionBottom: document.querySelector('.quiz-actions').getBoundingClientRect().bottom,
        tabTop: document.querySelector('#tabbar').getBoundingClientRect().top,
        viewPaddingBottom: parseFloat(getComputedStyle(document.querySelector('#view')).paddingBottom)
      })`);
    }
    await setViewport(390, 844);

    stage('填写并提交编程作答');
    const initial = await evaluate(`({
      tag: document.querySelector('#open-in').tagName,
      placeholder: document.querySelector('#open-in').placeholder,
      submit: document.querySelector('#open-submit').textContent.trim()
    })`);

    await evaluate(`(() => {
      const input = document.querySelector('#open-in');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, 'public class Test { public static void main(String[] args) { System.out.println("ok"); } }');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#open-submit').click();
      return true;
    })()`);
    await waitFor(`!!document.querySelector('.answer-box')`);
    await evaluate(`(async () => {
      const scroller = document.scrollingElement;
      for (let i = 0; i < 20; i++) {
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return true;
    })()`);

    const result = await evaluate(`({
      text: document.querySelector('.answer-box').innerText,
      userAnswer: document.querySelector('.user-answer pre')?.textContent || '',
      hasTextarea: !!document.querySelector('#open-in'),
      answerBottom: document.querySelector('.answer-box').getBoundingClientRect().bottom,
      actionTop: document.querySelector('.quiz-actions').getBoundingClientRect().top,
      scrollTop: document.scrollingElement.scrollTop,
      maxScroll: document.scrollingElement.scrollHeight - innerHeight,
      viewPaddingBottom: parseFloat(getComputedStyle(document.querySelector('#view')).paddingBottom),
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    })`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));

    stage('检查窄屏背诵评分按钮');
    await evaluate(`document.querySelector('[data-tab="card"]').click(); true`);
    await waitFor(`!!document.querySelector('[data-c="all"]')`);
    await evaluate(`document.querySelector('[data-c="all"]').click(); true`);
    await waitFor(`!!document.querySelector('.flash-grade')`);
    await setViewport(360, 844);
    const cardLayout = await evaluate(`({
      columns: getComputedStyle(document.querySelector('.flash-grade')).gridTemplateColumns.split(' ').length,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      minGradeHeight: Math.min(...Array.from(document.querySelectorAll('.grade-btn')).map(b => b.getBoundingClientRect().height))
    })`);

    stage('检查设置页触控按钮');
    await evaluate(`document.querySelector('[data-tab="me"]').click(); true`);
    await waitFor(`!!document.querySelector('[data-font]')`);
    const settingsLayout = await evaluate(`({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      minButtonHeight: Math.min(...Array.from(document.querySelectorAll('[data-font]')).map(b => b.getBoundingClientRect().height))
    })`);

    stage('检查手机横屏布局');
    await setViewport(844, 390);
    const landscapeHome = await evaluate(`({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      tabLabelDisplay: getComputedStyle(document.querySelector('.tab span:last-child')).display,
      topbarHeight: document.querySelector('#topbar').getBoundingClientRect().height
    })`);
    await evaluate(`document.querySelector('[data-tab="quiz"]').click(); true`);
    await waitFor(`!!document.querySelector('[data-go="type-program"]')`);
    await evaluate(`document.querySelector('[data-go="type-program"]').click(); true`);
    await waitFor(`!!document.querySelector('.quiz-actions')`);
    const landscapeQuiz = await evaluate(`({
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      actionBottom: document.querySelector('.quiz-actions').getBoundingClientRect().bottom,
      tabTop: document.querySelector('#tabbar').getBoundingClientRect().top
    })`);

    stage('汇总交互检查结果');
    const allWidthsClean = Object.values(widthChecks).every(x =>
      x.viewport === x.documentWidth &&
      x.bodyHasClass &&
      x.textareaFont >= 16 &&
      x.submitHeight >= 44 &&
      x.actionBottom <= x.tabTop + 1 &&
      x.viewPaddingBottom >= 126
    );
    const checks = [
      ['首页 390px 无横向溢出', homeLayout.viewport === homeLayout.documentWidth],
      ['Service Worker 已启用 v9 脚本', controllerReady &&
        swState.version === 'v9' && swState.scriptUrl.includes('sw.js?v=9')],
      ['页面已自动进入 Service Worker 控制', swState.controller],
      ['旧缓存已升级到 v9', swState.caches.includes('zsb-review-v9') && !swState.caches.includes('zsb-review-v8')],
      ['顶部图标触控高度至少 44px', homeLayout.themeHeight >= 44],
      ['底部导航触控高度至少 44px', homeLayout.tabHeight >= 44],
      ['阅读页搜索框无横向溢出', searchLayout.documentWidth === 390],
      ['搜索输入字号至少 16px', searchLayout.fontSize >= 16],
      ['搜索框触控高度至少 44px', searchLayout.boxHeight >= 44],
      ['阅读目录标题与统计分行显示', mobileReadingLayout.rows > 0 && mobileReadingLayout.titleGap >= 4],
      ['阅读目录信息区无横向溢出', mobileReadingLayout.metaFits && mobileReadingLayout.documentWidth === 390],
      ['阅读目录行铺满卡片宽度', Math.abs(mobileReadingLayout.rowWidth - mobileReadingLayout.cardWidth) <= 2],
      ['360 / 430px 阅读目录无横向溢出', Object.values(readingWidthChecks).every(x =>
        x.viewport === x.documentWidth && x.metaFits
      )],
      ['桌面阅读目录保持舒适行距', desktopReadingLayout.titleGap >= 4 && desktopReadingLayout.rowHeight >= 68],
      ['360 / 390 / 430px 均无横向溢出', allWidthsClean],
      ['开放题输入字号至少 16px', Object.values(widthChecks).every(x => x.textareaFont >= 16)],
      ['答题操作条紧贴底部导航上方', Object.values(widthChecks).every(x => x.actionBottom <= x.tabTop + 1)],
      ['答题页为固定操作条预留高度', Object.values(widthChecks).every(x => x.viewPaddingBottom >= 126)],
      ['提交后答案不被操作条遮挡', result.answerBottom <= result.actionTop + 1],
      ['编程题显示文本框', initial.tag === 'TEXTAREA'],
      ['文本框有编程作答提示', /编写程序/.test(initial.placeholder)],
      ['提交按钮可见', initial.submit.includes('提交并查看答案')],
      ['提交后答案区出现', result.text.includes('你的作答与参考答案')],
      ['用户代码被保留', result.userAnswer.includes('public class Test')],
      ['参考答案正常展示', /答案|解析/.test(result.text) && result.text.length > 100],
      ['360px 背诵评分按钮改为两列', cardLayout.columns === 2],
      ['背诵评分按钮无横向溢出', cardLayout.documentWidth === 360],
      ['背诵评分按钮触控高度至少 44px', cardLayout.minGradeHeight >= 44],
      ['设置页无横向溢出', settingsLayout.documentWidth === 360],
      ['设置页小按钮触控高度至少 44px', settingsLayout.minButtonHeight >= 44],
      ['横屏 844px 无横向溢出', landscapeHome.documentWidth === 844 && landscapeQuiz.documentWidth === 844],
      ['横屏底部导航隐藏文字并压缩高度', landscapeHome.tabLabelDisplay === 'none' && landscapeHome.topbarHeight <= 48],
      ['横屏答题操作条不脱离底部导航', landscapeQuiz.actionBottom <= landscapeQuiz.tabTop + 1]
    ];
    let failed = 0;
    console.log('=== Edge 手机适配与开放题交互测试 ===\n');
    for (const [name, pass] of checks) {
      console.log(`  ${pass ? '✓' : '✗'} ${name}`);
      if (!pass) failed++;
    }
    console.log('\n开放题截图: ' + screenshot);
    console.log('手机目录截图: ' + mobileReadingScreenshot);
    console.log('桌面目录截图: ' + desktopReadingScreenshot);
    console.log('深色目录截图: ' + darkReadingScreenshot);
    if (failed) process.exitCode = 1;
  } finally {
    stage('清理测试进程');
    if (ws) {
      try { ws.close(); } catch (e) {}
    }
    if (edge) {
      try { edge.kill(); } catch (e) {}
    }
    try { server.kill(); } catch (e) {}
    await sleep(250);
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

main().then(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}).catch(err => {
  console.error('测试失败:', err.message);
  setTimeout(() => process.exit(1), 50);
});
