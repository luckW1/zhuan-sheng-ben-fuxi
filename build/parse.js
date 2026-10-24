#!/usr/bin/env node
/**
 * 复习资料解析器 v3
 *
 * 实际文档结构（已通过诊断确认）：
 *   ## 四、本模块自测题
 *      ### 4.1 单项选择题          <- 题目区（按题型分 H3）
 *      ### 4.2 填空题
 *      ...
 *      ### 4.7 参考答案与解析       <- 答案区（H3 容器）
 *          #### （一）单项选择题     <- 答案按题型分 H4
 *          #### （二）填空题
 *
 * 模拟试卷结构：
 *   ## 第一部分 单项选择题          <- 题目区（H2）
 *   ...
 *   ## 参考答案与详解               <- 答案区
 *      ## 第一部分 单项选择题        <- 答案区（同为 H2 层级）
 */

const fs = require('fs');
const path = require('path');
const buildStandalone = require('./build-standalone');

const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || path.join(__dirname, '..', 'site', 'data');
const FENCE = '```';

const readMd = p => { const t = fs.readFileSync(p, 'utf8'); return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t; };
const normalize = s => s.replace(/\u3000/g, ' ').replace(/\r\n/g, '\n');
const stripCode = s => s.replace(new RegExp(FENCE + '\\w*\\n[\\s\\S]*?' + FENCE, 'g'), '\n@@CODE@@\n');

function extractCode(text) {
  const out = []; const re = new RegExp(FENCE + '(\\w*)\\n([\\s\\S]*?)' + FENCE, 'g'); let m;
  while ((m = re.exec(text))) out.push({ lang: m[1] || 'text', code: m[2] });
  return out;
}

/** 按标题层级切分，返回 [{head, body, level}] */
function splitBy(text, level) {
  const marker = '#'.repeat(level) + ' ';
  const lines = text.split('\n');
  const secs = []; let cur = null; let inFence = false;
  for (const ln of lines) {
    if (ln.startsWith(FENCE)) inFence = !inFence;
    if (!inFence && ln.startsWith(marker) && !ln.startsWith(marker + '#')) {
      if (cur) secs.push(cur);
      cur = { head: ln.slice(marker.length).trim(), body: [] };
    } else if (cur) cur.body.push(ln);
  }
  if (cur) secs.push(cur);
  return secs.map(s => ({ head: s.head, body: s.body.join('\n') }));
}

/** 题型识别（返回标准题型 key）
 * 注意：需同时匹配「单项选择题」与「单项选择题答案」这类答案区标题。
 */
function classify(head) {
  if (!head) return null;
  if (/单项选择|选择题|选择/.test(head)) return 'choice';
  if (/多项选择/.test(head)) return 'choice';
  if (/填空/.test(head)) return 'blank';
  if (/判断/.test(head)) return 'judge';
  if (/程序阅读|阅读题|代码阅读/.test(head)) return 'code';
  if (/编程题|程序设计题|编写程序|编程/.test(head)) return 'program';
  if (/简答|问答/.test(head)) return 'short';
  if (/SQL\s*语法|SQL\s*题|查询题|SQL\s*语句|SQL/.test(head)) return 'sql';
  if (/设计题|数据库设计题|E-R/.test(head)) return 'design';
  return null;
}

/** 解析题目 */
function parseQuestions(body, defaultType) {
  const text = normalize(body);
  const lines = text.split('\n');
  // 题号标记必须足够"强"，避免把题干内的编号列表（如 1. 属性：xxx）误认为新题
  // 支持：**1.**  **第 1 题**  **自测 29**  **第 22 题（10 分）**：  第 1 题：
  const reList = [
    /^\*\*\s*(?:第\s*)?(?:自测\s*)?(\d+)\s*(?:题)?\s*(?:[（(][^）)]{0,20}[）)])?\s*[\.、．:：]?\s*\*\*\s*[:：]?\s*(.*)$/,
    /^第\s*(\d+)\s*题\s*[:：]\s*(.*)$/
  ];
  const starts = [];
  lines.forEach((ln, i) => {
    for (const re of reList) {
      const m = ln.match(re);
      if (m) { starts.push({ idx: i, no: parseInt(m[1], 10), re }); return; }
    }
  });
  // 若整段没有任何强标记，退回到宽松解析（含 1. 形式）
  if (!starts.length) {
    const loose = /^(\d+)\s*[\.、．]\s+(.*)$/;
    lines.forEach((ln, i) => {
      const m = ln.match(loose);
      if (m) starts.push({ idx: i, no: parseInt(m[1], 10), re: loose });
    });
  }
  if (!starts.length) return [];

  const qs = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1].idx : lines.length;
    const raw = lines.slice(s.idx, e).join('\n');
    const chunk = raw.replace(s.re, (mm, no, inline) => inline || '');
    const codes = extractCode(chunk);
    const plain = stripCode(chunk);

    const options = []; const seen = new Set();
    for (const ln of plain.split('\n')) {
      const m = ln.trim().match(/^([A-D])[\.、．]\s*(.+)$/);
      if (m && !seen.has(m[1])) { seen.add(m[1]); options.push({ key: m[1], text: m[2].trim() }); }
    }
    if (options.length < 2) {
      for (const p of plain.replace(/\n/g, ' ').split(/\s+(?=[A-D][\.、．]\s)/)) {
        const m = p.trim().match(/^([A-D])[\.、．]\s*(.+?)\s*$/);
        if (m && !seen.has(m[1])) { seen.add(m[1]); options.push({ key: m[1], text: m[2].trim() }); }
      }
    }
    options.sort((a, b) => a.key.localeCompare(b.key));
    // 去重：若某个选项的文本实际包含了后续选项（挤行解析残留），只保留第一段
    for (let i = 0; i < options.length; i++) {
      const dup = options[i].text.match(/^(.*?)\s+(?=[A-D][\.、．]\s)/);
      if (dup && dup[1].length > 1) options[i].text = dup[1].trim();
    }

    let stem = plain;
    const p1 = plain.search(/^\s*A[\.、．]\s/m);
    if (p1 > 0) stem = plain.slice(0, p1);
    else { const p2 = plain.indexOf('A.'); if (p2 > 0) stem = plain.slice(0, p2); }
    stem = stem.replace(/@@CODE@@/g, '').trim();

    let type = defaultType || '';
    if (options.length >= 2) type = 'choice';
    if (!type) type = /（\s*）|\(\s*\)|_\{2,\}|____/.test(stem) ? 'blank' : 'short';

    qs.push({ no: s.no, type, stem, options, codes, raw: raw.trim() });
  }
  return qs;
}

/** 解析答案
 * 支持格式：
 *   **1. 答案：C**            答案在 ** 内部
 *   **第 1 题**\n答案：B      题号与答案分行
 *   1. 答案：D
 */
function parseAnswers(body) {
  const text = normalize(body);
  const lines = text.split('\n');

  // 题号标记：
  //   **1. 答案：C**      **第 1 题：B**      **自测 1**：B      **第 1 题**\n答案：B      1. 答案：D
  const reBold = /^\*\*\s*(?:第\s*)?(?:自测\s*)?(\d+)\s*(?:题)?\s*[\.、．:：]?\s*([\s\S]*?)\s*\*\*\s*([\s\S]*)$/;
  const rePlain = /^(?:第\s*)?(?:自测\s*)?(\d+)\s*(?:题)?\s*[\.、．:：]\s*(.+)$/;

  const marks = [];
  lines.forEach((ln, i) => {
    let m = ln.match(reBold);
    if (m) {
      const inner = ((m[2] || '') + ' ' + (m[3] || '')).trim();
      // 判定是否为答案行：
      //   含「答案/正确/错误」；内容就是单个选项字母；形如「：B」；以「：」开头（**第 N 题**：内容）
      const isAnswerish = /答案|【答案】|正确|错误|解析/.test(inner)
        || /^[A-D]$/.test(inner.trim())
        || /^[:：]/.test(inner.trim())
        || /[:：]\s*[A-D]\s*$/.test(inner);
      if (isAnswerish) {
        marks.push({ line: i, no: parseInt(m[1], 10), inner });
        return;
      }
    }
    m = ln.match(rePlain);
    if (m && /答案|【答案】|正确答案/.test(m[2])) {
      marks.push({ line: i, no: parseInt(m[1], 10), inner: m[2].trim() });
    }
  });

  const map = {};
  for (let k = 0; k < marks.length; k++) {
    const s = marks[k];
    const e = k + 1 < marks.length ? marks[k + 1].line : lines.length;
    const chunk = (s.inner + '\n' + lines.slice(s.line + 1, e).join('\n')).trim();

    let answer = '';
    // 情形一：题号行本身含答案
    const innerTrim = s.inner.trim();
    if (/^[A-D]$/.test(innerTrim)) {
      answer = innerTrim;                                   // **第 1 题：B**
    } else {
      let mm = innerTrim.match(/[:：]\s*\**\s*([A-D])\s*$/);
      if (mm) answer = mm[1];
      // **第 13 题**：**数据库**、**数据库管理系统**   —— 取冒号后的内容
      if (!answer) {
        mm = innerTrim.match(/^[:：]\s*([\s\S]{1,120})$/);
        if (mm) answer = mm[1].trim();
      }
    }
    if (!answer) { let m = chunk.match(/答案\s*[:：]?\s*\**\s*([A-D])(?![A-Za-z])/); if (m) answer = m[1]; }
    if (!answer) { let m = chunk.match(/^\s*\**\s*([A-D])\s*$/m); if (m) answer = m[1]; }
    if (!answer) { let m = chunk.match(/答案\s*[:：]?\s*\**\s*(正确|错误|对|错|√|×|是|否)/); if (m) answer = /正确|对|√|是/.test(m[1]) ? '正确' : '错误'; }
    if (!answer) { let m = chunk.match(/【答案】\s*([^\n]{1,60})/); if (m) answer = m[1].replace(/\**/g, '').trim(); }
    if (!answer) { let m = chunk.match(/答案\s*[:：]?\s*\**\s*([^\s，。；、\n]{1,30})/); if (m) answer = m[1].replace(/\**/g, '').trim(); }
    answer = answer.replace(/\*\*/g, '').replace(/^[:：]\s*/, '').trim();

    // 解析正文：去掉答案行的残留
    let explain = chunk.replace(/^[\s\S]{0,80}?答案\s*[:：]?\s*\**[^\n]*\n?/, '').trim();
    if (explain.length < 2) explain = chunk;
    // 若解析与答案完全一致（开放式题），保留原文
    if (explain === answer) explain = chunk;

    map[s.no] = { answer, explain };
  }
  return map;
}

/** 解析表格形式的答案：| 自测 1 | **B** | 解析文字 | 或 | 1 | B | 解析 | */
function parseTableAnswers(body) {
  const text = normalize(body);
  const map = {};
  const lines = text.split('\n');
  for (const ln of lines) {
    if (!/^\s*\|/.test(ln)) continue;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(ln)) continue;
    const cells = ln.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (cells.length < 2) continue;
    const m = cells[0].match(/(?:自测|第)?\s*(\d+)\s*(?:题)?/);
    if (!m) continue;
    const no = parseInt(m[1], 10);
    if (!no || no > 500) continue;
    // 客观题可直接用裸题号；文本答案必须带「自测/第 N 题」标识，
    // 避免把数据库示例数据表（如部门名称）误判为答案。
    const explicitNo = /(?:自测|第)\s*\d+\s*(?:题)?/.test(cells[0]);
    const rawAnswer = (cells[1] || '').replace(/\**/g, '').trim();
    let answer = '';
    if (/^[A-D]$/.test(rawAnswer)) answer = rawAnswer;
    else if (/^(?:正确|错误|对|错|√|×)$/.test(rawAnswer)) {
      answer = /正确|对|√/.test(rawAnswer) ? '正确' : '错误';
    }
    else if (explicitNo && rawAnswer) answer = rawAnswer;
    if (!answer) continue;
    const explain = (cells[2] || '').trim() || (cells[1] || '').trim();
    if (no && !map[no]) map[no] = { answer, explain };
  }
  return map;
}
function parseOpenAnswers(body) {
  const text = normalize(body);
  const lines = text.split('\n');
  const reList = [
    /^#{2,6}\s*(?:第\s*)?(?:自测\s*)?(\d+)\s*(?:题)?[\s\S]*$/,        // ### 第 21 题 参考答案（xxx）
    /^\*\*\s*(?:第\s*)?(?:自测\s*)?(\d+)\s*(?:题)?\s*\**\s*$/,         // **第 21 题**（独立成行，无后续内容）
    /^\*\*\s*(?:第\s*)?(?:自测\s*)?(\d+)\s*题\s*\**\s*[\s\S]*$/,       // **第 21 题** 参考答案
    /^第\s*(\d+)\s*题\s*[:：]?\s*[\s\S]*$/                              // 第 21 题
  ];
  const marks = [];
  lines.forEach((ln, i) => {
    for (const re of reList) {
      const m = ln.match(re);
      if (m) { marks.push({ line: i, no: parseInt(m[1], 10), head: ln }); return; }
    }
  });
  const map = {};
  for (let k = 0; k < marks.length; k++) {
    const s = marks[k];
    const e = k + 1 < marks.length ? marks[k + 1].line : lines.length;
    const bodyText = lines.slice(s.line + 1, e).join('\n').trim();
    if (!map[s.no] || bodyText.length > (map[s.no].explain || '').length) {
      map[s.no] = { answer: '见参考答案', explain: bodyText };
    }
  }
  return map;
}

// ---------------------------------------------------------------- 主流程
function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const books = [], allQuiz = [], allCards = [];
  const fullBooks = {};      // id -> { chapters: [...] }  正文按需加载
  const searchIndex = [];    // 搜索索引
  const subjects = [
    { dir: 'Java', id: 'java', name: '程序设计基础' },
    { dir: '数据库', id: 'db', name: '数据库原理与应用' }
  ];
  const report = [];

  for (const subj of subjects) {
    const dir = path.join(SRC, subj.dir);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();

    for (const f of files) {
      const text = readMd(path.join(dir, f));
      const base = f.replace(/\.md$/, '');
      const order = parseInt((base.match(/^(\d+)/) || [0, 99])[1], 10);
      const isExam = /模拟试卷/.test(base);

      const h2 = splitBy(text, 2);

      // ---- 电子书：目录与正文分离，正文按需加载
      const chapters = h2.map((s, i) => {
        const subs = splitBy(s.body, 3);
        return {
          id: `${subj.id}-${order}-${i}`,
          title: s.head,
          subs: subs.map((x, j) => ({ id: `${subj.id}-${order}-${i}-${j}`, title: x.head, body: x.body })),
          body: subs.length ? '' : s.body
        };
      });
      const bookId = `${subj.id}-${order}`;
      books.push({
        id: bookId, subject: subj.id, subjectName: subj.name,
        order, title: base, titleShort: base.replace(/^\d+[-—]?/, '').trim(),
        isExam, chars: (text.match(/[\u4e00-\u9fff]/g) || []).length,
        chapterCount: chapters.length,
        // 目录：只保留章节标题与小节标题（不含正文），体积极小
        chapterTitles: chapters.map(c => ({
          id: c.id, title: c.title,
          subs: (c.subs || []).map(s2 => ({ id: s2.id, title: s2.title }))
        }))
      });
      fullBooks[bookId] = { id: bookId, chapters };
      // 搜索用纯文本（去代码块）
      searchIndex.push({ id: bookId, subject: subj.id, title: base, text: stripCode(text).replace(/@@CODE@@/g, ' [代码] ') });

      // ---- 题库
      const pairs = [];   // [{type, qBody, aBody}]

      if (isExam) {
        // 模拟卷：「参考答案与详解」是分界线，其前为题目 H2，其后为答案 H2
        const aSecIdx = h2.findIndex(s => /参考答案/.test(s.head));
        const before = aSecIdx < 0 ? h2 : h2.slice(0, aSecIdx);
        const after = aSecIdx < 0 ? [] : h2.slice(aSecIdx + 1);
        const qParts = before.filter(s => /第[一二三四五六]部分/.test(s.head));
        const aParts = after.filter(s => /第[一二三四五六]部分/.test(s.head));
        // 若答案未按部分分节，则把分界线之后的全部内容当作一个答案块
        if (!aParts.length && aSecIdx >= 0) {
          aParts.push({ head: h2[aSecIdx].head, body: after.map(x => x.body).join('\n\n') });
        }
        for (const qp of qParts) {
          const t = classify(qp.head);
          const ap = aParts.find(x => classify(x.head) === t);
          pairs.push({ type: t, qBody: qp.body, aBody: ap ? ap.body : aParts.map(x => x.body).join('\n\n'), head: qp.head });
        }
      } else {
        // 普通模块：## 四、本模块自测题 → ### 4.x 按题型 → ### 4.x 参考答案与解析 → #### （一）按题型
        const qSec = h2.find(s => /自测题/.test(s.head));
        if (qSec) {
          const h3 = splitBy(qSec.body, 3);
          const ansH3Idx = h3.findIndex(x => /参考答案|答案与解析/.test(x.head));
          const ansH3 = ansH3Idx >= 0 ? h3[ansH3Idx] : null;
          // 题目区 = 答案区之前的题型小节；答案区之后的题型小节属于答案分区
          const qCandidates = ansH3Idx >= 0 ? h3.slice(0, ansH3Idx) : h3;
          const qH3 = qCandidates.filter(x => classify(x.head));
          // 答案分区：优先取容器内部（H4 / 内部 H3），其次取与容器同级的后续小节
          let aTyped = [];
          if (ansH3) {
            const h4 = splitBy(ansH3.body, 4).filter(x => classify(x.head));
            const innerH3 = splitBy(ansH3.body, 3).filter(x => classify(x.head));
            if (h4.length) aTyped = h4;
            else if (innerH3.length) aTyped = innerH3;
            // 容器为空（答案与容器同级）：收集紧随其后的同级小节
            if (!aTyped.length) {
              for (let i = ansH3Idx + 1; i < h3.length; i++) {
                if (classify(h3[i].head)) aTyped.push(h3[i]);
              }
            }
          }
          const outerAns = h2.find(s => /参考答案|答案与解析/.test(s.head));
          if (!aTyped.length && outerAns) {
            const h4 = splitBy(outerAns.body, 4).filter(x => classify(x.head));
            const h3b = splitBy(outerAns.body, 3).filter(x => classify(x.head));
            aTyped = h4.length ? h4 : (h3b.length ? h3b : [{ head: outerAns.head, body: outerAns.body }]);
          }
          if (!aTyped.length) aTyped = [{ head: 'all', body: '' }];

          for (const qh of qH3) {
            const t = classify(qh.head);
            if (!t) continue;                     // 跳过非题型小节（如「统一数据库结构说明」）
            const ap = aTyped.find(x => classify(x.head) === t);
            pairs.push({ type: t, qBody: qh.body, aBody: ap ? ap.body : aTyped.map(x => x.body).join('\n\n'), head: qh.head });
          }
        }
      }

      // ---- 组装
      let fileQ = 0;
      const openTypes = new Set(['design', 'program', 'sql', 'short', 'code']);
      const seenIds = new Set();
      for (const pr of pairs) {
        const qs = parseQuestions(pr.qBody, pr.type);
        const openAns = (pr.aBody && openTypes.has(pr.type)) ? parseOpenAnswers(pr.aBody) : {};
        const ans = pr.aBody ? parseAnswers(pr.aBody) : {};
        const tableAns = pr.aBody ? parseTableAnswers(pr.aBody) : {};
        for (const q of qs) {
          // 开放式题型优先使用「参考答案」分区中的题号，避免示例数据或题干误匹配。
          let a = (openTypes.has(pr.type) && openAns[q.no]) ? openAns[q.no] : (ans[q.no] || {});
          if (!a.answer && tableAns[q.no]) a = tableAns[q.no];
          if (!a.answer && pr.aBody) {
            const all = parseAnswers(pr.aBody);
            if (all[q.no]) a = all[q.no];
          }
          // 程序阅读题/编程题：若答案为单个字母（误匹配），但解析中含代码块，则改判为开放式
          if ((q.type === 'code' || q.type === 'program') && /^[A-D]$/.test(a.answer || '')) {
            if (openAns[q.no] && openAns[q.no].explain) a = openAns[q.no];
            else a = { answer: '见参考答案', explain: a.explain || '' };
          }
          // 程序阅读题答案优先取代码块/文本形式
          if (q.type === 'code' && (!a.answer || a.answer === '见参考答案')) {
            const raw = (a.explain || '');
            if (raw) a = { answer: '见参考答案', explain: raw };
          }
          // 生成唯一 id（同文件同题型可能重复题号，加序号区分）
          let qid = `${subj.id}-${order}-${pr.type || 'q'}-${q.no}`;
          let suffix = 1;
          while (seenIds.has(qid)) { qid = `${subj.id}-${order}-${pr.type || 'q'}-${q.no}-${++suffix}`; }
          seenIds.add(qid);
          // 答案解析中若含代码块，一并提取，供前端折叠展示
          const answerCodes = a.explain ? extractCode(a.explain) : [];
          allQuiz.push({
            id: qid,
            subject: subj.id, subjectName: subj.name, bookOrder: order, bookTitle: base,
            isExam, section: pr.head || '', no: q.no, type: q.type,
            stem: q.stem, options: q.options, codes: q.codes,
            answerCodes,
            answer: a.answer || '', explain: a.explain || '', raw: q.raw
          });
          fileQ++;
        }
      }
      report.push({ file: base, subject: subj.id, q: fileQ });

      // ---- 背诵卡片
      const cardSec = h2.find(s => /背诵清单/.test(s.head));
      if (cardSec) {
        const items = normalize(cardSec.body).split('\n').map(l => l.trim())
          .filter(l => /^\d+\.\s+/.test(l)).map(l => l.replace(/^\d+\.\s+/, '').trim())
          .filter(x => x.length > 3);
        items.forEach((it, i) => allCards.push({
          id: `${subj.id}-${order}-c${i + 1}`, subject: subj.id, subjectName: subj.name,
          bookOrder: order, bookTitle: base, idx: i + 1, text: it
        }));
      }
    }
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    subjects: subjects.map(s => ({ id: s.id, name: s.name })),
    stats: {
      books: books.length, quiz: allQuiz.length, cards: allCards.length,
      chars: books.reduce((a, b) => a + b.chars, 0)
    }
  };

  // 目录文件（小，可快速加载）
  fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify(books), 'utf8');
  fs.writeFileSync(path.join(OUT, 'quiz.json'), JSON.stringify(allQuiz), 'utf8');
  fs.writeFileSync(path.join(OUT, 'cards.json'), JSON.stringify(allCards), 'utf8');
  fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(searchIndex), 'utf8');
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  // 正文分片：每本书一个文件，按需 fetch
  const bookDir = path.join(OUT, 'books');
  if (!fs.existsSync(bookDir)) fs.mkdirSync(bookDir, { recursive: true });
  let totalBookBytes = 0;
  for (const id of Object.keys(fullBooks)) {
    const data = JSON.stringify(fullBooks[id]);
    fs.writeFileSync(path.join(bookDir, id + '.json'), data, 'utf8');
    totalBookBytes += Buffer.byteLength(data, 'utf8');
  }

  const byType = {}; let noAnswer = 0; const noAnsIds = []; let withOpts = 0;
  for (const q of allQuiz) {
    byType[q.type] = (byType[q.type] || 0) + 1;
    if (q.options.length >= 2) withOpts++;
    if (!q.answer) { noAnswer++; if (noAnsIds.length < 12) noAnsIds.push(q.id); }
  }
  console.log('=== 解析完成 v3 ===');
  console.log('书籍 %d | 题目 %d | 卡片 %d', books.length, allQuiz.length, allCards.length);
  console.log('题型:', JSON.stringify(byType));
  console.log('有选项的题:', withOpts, '| 缺答案:', noAnswer);
  if (noAnsIds.length) console.log('缺答案示例:', noAnsIds.join(', '));
  console.log('');
  console.log('各文件题数:');
  for (const r of report.filter(x => x.q > 0)) console.log('  [%s] %s  %d', r.subject, r.file.padEnd(34), r.q);
  console.log('');
  for (const f of ['books.json', 'quiz.json', 'cards.json', 'search.json']) {
    console.log('  %s  %s KB', f.padEnd(14), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1));
  }
  console.log('  %s  %s KB  (%d 个分片)', 'books/'.padEnd(14), (totalBookBytes / 1024).toFixed(1), Object.keys(fullBooks).length);
  const standalone = buildStandalone();
  console.log('  %s  %s MiB', '双击离线版'.padEnd(14), (standalone.bytes / 1024 / 1024).toFixed(2));
}
main();
