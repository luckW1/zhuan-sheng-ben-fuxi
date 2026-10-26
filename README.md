# 专升本复习 App（PWA）

专为软件工程专业专升本转段考核制作的手机复习软件。
从 21 份 Markdown 复习资料自动生成结构化数据，五大功能：
**阅读资料 / 刷题判分 / SQL 与 Java 代码专项 / 背诵卡片（SM-2 遗忘曲线）/ 错题本与学习统计**。

学习记录全部保存在手机本地，不联网上传。核心资源默认缓存；
正文和搜索索引可访问后缓存，也可在「我的」中主动下载完整离线包。

---

## 一、软件包含什么

| 功能 | 说明 |
|---|---|
| **阅读** | 21 份资料按章节阅读，支持全文搜索、代码高亮、表格自适应、字号调节 |
| **刷题** | 414 道题自动判分，含单选/填空/判断/程序阅读/编程/SQL/设计八大题型 |
| **代码专项** | SQL 与 Java 答案代码可折叠、可复制，程序阅读题可逐行对照 |
| **背诵卡片** | 857 条背诵清单，SM-2 遗忘曲线调度（4 档评价：完全不会/有点印象/想起来了/很简单） |
| **错题本** | 答错自动入本，连续答对 2 次自动移出；支持全部重做 |
| **统计** | 每日学习量条形图、连续天数、正确率、各模块掌握度 |

---

## 二、目录结构

```
site/
├── index.html              入口页面
├── manifest.json           PWA 配置（安装到桌面用）
├── sw.js                   Service Worker（离线缓存）
├── css/
│   ├── app.css             主样式（深浅色主题）
│   ├── hljs-light.css      代码高亮（浅色）
│   └── hljs-dark.css       代码高亮（深色）
├── js/
│   ├── app.js              主应用逻辑
│   ├── store.js            本地存储 + SM-2 算法
│   └── vendor/
│       ├── marked.js       Markdown 渲染
│       └── highlight.min.js 代码高亮（已裁剪为 10 种语言）
├── data/
│   ├── meta.json           元信息
│   ├── books.json          书籍目录（84 KB）
│   ├── quiz.json           题库（约 826 KiB）
│   ├── cards.json          背诵卡片（214 KB）
│   ├── search.json         搜索索引（约 3.26 MiB，按需下载）
│   └── books/*.json        20 个正文分片（按需下载）
└── icons/                  应用图标
```

根目录还会生成 `专升本复习-离线版.html`（约 8.97 MiB）。它把题库、
21 本书正文和搜索索引全部内嵌，**直接双击即可使用**，不依赖服务器或网络。

**加载策略**：核心缓存资源合计约 **1.41 MiB**（不含 search.json 与正文分片）。
打开某一本书时才下载它的正文分片（15 KB ~ 576 KB），
首次搜索时才下载搜索索引。Service Worker 会把访问过的正文和搜索索引自动缓存。
若要首次安装后不再逐章访问即可完整离线使用，请进入「我的」点击
「下载全部资料供离线使用」；完整离线包约 **9.36 MiB**。

---

## 三、本地测试（5 分钟）

### 方式 A：一键启动（推荐，手机可访问）

在本目录（`复习App`）打开 PowerShell，执行：

```powershell
.\一键启动-手机访问.ps1
```

它会自动做三件事：查找 Node.js、显示手机可访问的地址、启动服务器。

> 若提示无法执行脚本（执行策略限制），先运行一次：
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 方式 B：Node 手动启动

```powershell
node build\serve.js 8899 site 0.0.0.0
```

第三个参数 `0.0.0.0` 表示绑定所有网卡，**手机才能通过局域网 IP 访问**。
省略该参数时也默认绑定 `0.0.0.0`；若只允许本机访问，最后传入 `127.0.0.1`。

### 方式 C：VS Code Live Server

VS Code 安装 Live Server 插件 → 右键 `site/index.html` → Open with Live Server。

### 方式 D：直接双击（无需 Node.js）

双击根目录的 `专升本复习-离线版.html`。该文件内嵌全部学习数据，
在 `file://` 协议下也能直接刷题、阅读和搜索。

> 如果误双击了 `site/index.html`，应用会自动跳转到离线版。
> 离线版不启用 Service Worker 和 PWA 安装；需要手机访问或安装到桌面时，
> 仍请使用方式 A 或部署到 HTTPS。

---

## 四、安装到手机桌面（Android）

**前提**：电脑与手机连接**同一个 Wi-Fi**，且服务已启动（见第三节）。

### 步骤

1. 手机 Chrome 打开启动时显示的地址，例如
   `http://10.105.202.229:8899`（以你电脑的实际 IP 为准）
2. 点右上角 **⋮** 菜单 → **「添加到主屏幕」** / **「安装应用」**
3. 桌面出现「专升本复习」图标，点开即全屏使用，与原生 App 体验一致

### 查看电脑 IP

```powershell
ipconfig | Select-String IPv4
```

找「无线局域网适配器 WLAN」下的 IPv4 地址（形如 `10.x.x.x` 或 `192.168.x.x`）。

### 离线使用

首次打开后，Service Worker 会自动缓存核心资源（约 1.41 MiB），
之后可离线刷题、背卡片和查看已缓存内容。
正文和搜索索引默认按访问历史缓存；在「我的」中下载完整离线包后，
可离线阅读全部 21 本书并使用搜索。

> **注意**：Chrome 要求 PWA 的 Service Worker 必须通过 **HTTPS** 或 **localhost** 注册。
> 局域网 IP（`http://10.x.x.x`）可用于在线访问和刷题，但 Service Worker
> 与完整离线能力通常不会在该非安全地址启用。需要稳定离线使用时，
> 请按第五节部署到 GitHub Pages（免费 HTTPS）。

---

## 五、部署到 GitHub Pages（免费、稳定、电脑关机也能用）

部署后得到 `https://<用户名>.github.io/<仓库名>/`，手机 Chrome 打开后
「添加到主屏幕」，即获得完整 PWA 体验：**电脑关机、手机用流量、换设备都能用**。

> 📖 **详细图文步骤见同目录《GitHub-Pages部署指南.md》**

### 日常更新方式（自动部署，推荐）

仓库 `main` 分支包含全部源码、构建脚本和测试。日常更新只需：

```powershell
git add .
git commit -m "说明这次改了什么"
git push
```

推送后 GitHub Actions 自动执行全部测试（单元 / Pages 兼容 / HTTP / 离线版 / e2e），
通过后把 `site/` 目录发布到 `gh-pages` 分支，约 1~3 分钟线上生效。
进度可在仓库的 **Actions** 页查看；测试失败时不会发布，线上保持旧版。

> 双击离线版 `专升本复习-离线版.html` 是本地生成产物（约 9 MB），
> 已加入 `.gitignore` 不入库，需要时运行 `node build\parse.js ".."` 重新生成。

### 首次部署（已完成，仅留档）

首次搭建用的是手动方式，脚本和指南仍可作为无 GitHub Actions 时的备用手段：

```powershell
# 1. 先在浏览器创建仓库：https://github.com/new
#    名称填 zhuan-sheng-ben-fuxi，选 Public，不勾选任何初始化选项

# 2. 运行一键部署脚本
.\部署到GitHub-Pages.ps1

# 3. 仓库 Settings -> Pages -> Source 选 Deploy from a branch
#    Branch 选 gh-pages，文件夹选 / (root)，Save
```

等 1~2 分钟，访问 `https://<用户名>.github.io/zhuan-sheng-ben-fuxi/`。

### 兼容性已验证

`npm run check:pages` 会检查 22 项部署前提，全部通过：
manifest 用相对路径、无外部 CDN 依赖、无根绝对路径、
Service Worker 子路径兼容、资源文件齐全等。

### 注意

- **仓库会公开**：免费版 GitHub Pages 要求 Public 仓库，资料内容（约 73.5 万字）会被公开。
  如介意请继续用局域网方案。
- **更新后**：改过 `index.html`/`css`/`js` 时，把 `sw.js` 里 `CACHE` 版本号 +1。
- **在线更新**：v9 起页面导航使用网络优先，资源地址带版本参数；新 Service Worker
  接管后会自动刷新一次。已安装的旧版 PWA 若仍显示旧页面，重新打开或强制刷新一次即可迁移。
- **推送认证**：GitHub 不支持密码推送，需用 Personal Access Token，
  详见部署指南「常见问题 Q1」。

---

## 六、重新生成数据（资料有更新时）

如果项目上一级目录中的 `Java/` 或 `数据库/` 复习资料有改动，
在本目录（`复习App`）运行：

```powershell
node build\parse.js ".."
node build\bundle-hljs.js     # 只有更换 highlight.js 语言列表时才需要
python build\icons.py         # 只有更换图标样式时才需要
```

`parse.js` 默认读取项目上一级目录中的教材，并重新输出
`site/data/` 下的全部 JSON、正文分片和根目录双击离线版。若教材在其他目录，可把 `".."` 
换成实际路径。

---

## 七、运行测试

> 基础测试与 HTTP 测试只依赖 Node.js；DOM 端到端测试依赖固定版本的 `jsdom`。
> **软件本身运行不需要安装依赖。**

```powershell
# 在 复习App 目录运行
npm install
npm test                    # 89 项单元 + 22 项 Pages + 6 项 HTTP + 9 项离线版检查
npm run test:file           # 双击离线版结构与内嵌数据检查
npm run test:e2e            # jsdom 端到端测试（需先 npm install）
npm run test:mobile         # Edge 手机视口、触控尺寸与答题条遮挡检查
npm run test:final          # 从交付目录走五大功能
node build\repro.js         # 验证根路径和子路径下的资源解析
```

`test:mobile` 使用本机 Edge 自动检查 360 / 390 / 430px 竖屏和
844×390 横屏，同时检查阅读目录的标题分行、行宽、深色模式和桌面行距，
不依赖 `jsdom`。

`package.json` 将 `jsdom` 固定为 `26.1.0`。当前交付环境没有 `npm`，
因此本次未能生成 `package-lock.json`；在具备 npm 的开发机上执行一次
`npm install` 后应提交锁文件，以完全固定依赖树。

**如果打开后提示「资料载入失败」**，按以下顺序排查：

1. **双击根目录的 `专升本复习-离线版.html`**。如果该文件缺失，运行
   `node build\parse.js` 重新生成。
2. **HTTP 模式**：运行 `node build\serve.js 8899`，确定使用
   `http://127.0.0.1:8899`，不要使用 `file://`。
3. **确认 data 目录与 index.html 同级**，即 `site/data/` 存在。
4. **部署在子路径时**（如 GitHub Pages 的 `/仓库名/`），本软件已用 `document.baseURI`
   解析资源路径，可正常工作；若仍失败，检查 `site/` 内容是否确实在站点根目录。
5. **清缓存重试** —— Service Worker 可能缓存了旧版本。开发工具 → Application →
   Service Workers → Unregister，然后刷新。
   （本软件已加自动刷新机制：新版本接管后会自动 reload 一次；
    修改代码后请把 `sw.js` 里的 `CACHE` 版本号 +1。）

> 已修复的历史问题：
> - 早期版本在子路径部署时资源 404，且 `boot()` 会被重复触发导致数据请求两次
>   （已加 `booted` 防重入守卫与基于 `document.baseURI` 的路径解析）
> - 资料里的 `[01-计算机基础知识](01-计算机基础知识.md)` 链接曾被渲染成真实超链接，
>   点击后请求不存在的 .md 文件返回 **404 Not Found**
>   （已改为应用内跳转，并按科目区分 Java / 数据库，避免同名文件跳错）

---

## 八、数据说明

| 数据 | 数量 | 来源 |
|---|---|---|
| 电子书 | 21 份 / 1094 个小节 | 21 份 md 资料 |
| 题目 | 414 道 | 各模块自测题 + 2 套模拟卷 |
| 解析覆盖 | 100%（0 道缺答案） | 与答案区自动配对 |
| 背诵卡片 | 857 条 | 各模块「背诵清单」 |
| 正文总字数 | 约 73.5 万字 | — |

题型分布：单选 126、填空 109、判断 68、程序阅读 28、编程 25、SQL 34、设计 7、简答 17。

---

## 九、技术要点

- **零构建**：纯静态站点，无需 Webpack/Vite，`site/` 目录拷到任何静态服务器即可运行
- **无后端**：所有学习进度存 `localStorage`，支持导出/导入 JSON 备份
- **离线**：Service Worker 缓存核心资源，正文与搜索按访问缓存，并支持主动下载完整离线包
- **响应式**：手机优先设计，支持动态视口、安全区、横竖屏触控优化、深色模式和字号调节
- **SM-2 算法**：4 档评分，间隔 1→2/3→6 天起步，按 ef 因子增长，上限 180 天

---

## 十、常见问题

**Q：运行 `.ps1` 脚本报「表达式或语句中包含意外的标记"}」」？**
A：脚本行尾符是 LF 导致 Windows PowerShell 5.1 解析失败。修复：

```powershell
node build\fix-ps1-eol.js
```

该脚本会把所有 `.ps1` 转成 CRLF + UTF-8 BOM 格式，5.1 与 7.x 都能正常执行。

**Q：提示「禁止运行脚本 / execution policy」？**
A：以管理员身份运行 PowerShell，执行一次：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

或临时绕过：`powershell -ExecutionPolicy Bypass -File .\部署到GitHub-Pages.ps1`

**Q：iOS 能用吗？**
A：可以。Safari 打开 → 分享按钮 → 「添加到主屏幕」。iOS 的 PWA 支持比 Android 弱
（如后台同步受限），但阅读、刷题、背诵核心功能都正常。

**Q：手机打不开，提示无法访问 / 连接超时？**
A：按顺序检查：
1. 手机与电脑是否连**同一个 Wi-Fi**（不是 4G/5G，也不是不同频段）
2. 电脑 IP 是否变了（重启路由器或切换网络后会变，用 `ipconfig | Select-String IPv4` 重查）
3. 服务是否还在运行（启动脚本的窗口是否被关掉了）
4. 防火墙是否阻挡：以**管理员身份**运行 PowerShell 执行
   `New-NetFirewallRule -DisplayName "专升本复习App" -Direction Inbound -LocalPort 8899 -Protocol TCP -Action Allow`
5. 部分公共 Wi-Fi（如公司、校园网）开启了「AP 隔离/客户端隔离」，禁止设备互相访问，
   这种情况下手机连不上电脑。解决方式：用手机热点让电脑连接，或部署到 GitHub Pages。

**Q：换手机了，学习进度能迁移吗？**
A：可以。「我的」→「导出学习数据」得到 JSON 文件，在新手机上「导入学习数据」即可。

**Q：为什么第一次打开有点慢？**
A：首次打开需要下载约 1.41 MiB 核心资源。之后由 Service Worker 从本地缓存提供。

**Q：搜索为什么第一次要等一下？**
A：搜索索引 3.3 MB，为不拖慢启动，改成首次搜索时才下载，之后即缓存。

**Q：能加更多资料吗？**
A：可以。把新的 md 文件放进项目上一级的 `Java/` 或 `数据库/` 目录，
重新运行 `node build\parse.js ".."` 即可。建议保持「## 四、本模块自测题」的六段式结构，
这样题目能自动解析进题库。
