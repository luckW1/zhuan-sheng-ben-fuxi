# 部署到 GitHub Pages（电脑关机也能用）

> **2026-10 更新**：仓库已改为 `main` 分支存放源码 + GitHub Actions 自动部署。
> 日常更新只需在 `复习App` 目录 `git push`，测试通过后自动发布 `site/` 到
> `gh-pages` 分支，无需再手动操作。**本文的手动步骤仅作为备用手段留档**
> （例如排查 Actions 故障时使用）。

## 先说结论

部署到 GitHub Pages 后：

| 场景 | 当前（局域网） | GitHub Pages |
|---|---|---|
| 电脑开着、同一 Wi-Fi | ✅ 可用 | ✅ 可用 |
| **电脑关机** | ❌ 不可用 | ✅ **可用** |
| 手机用 4G/5G、不在家 | ❌ 不可用 | ✅ 可用 |
| 换手机 / 换设备 | 需重新配 | 打开网址即用 |
| 完全离线（飞行模式） | ✅ 可用（已缓存） | ✅ 可用（已缓存） |
| 网址 | `http://10.105.202.229:8899` | `https://你的用户名.github.io/仓库名/` |

**核心区别**：GitHub Pages 是把网站文件放到 GitHub 的服务器上，
你电脑只是一个「上传工具」，上传完就可以关机了。
手机之后从 GitHub 服务器读取内容。

**第一次打开的代价**：手机需要联网下载约 **1.41 MiB** 的核心资源。
Service Worker 安装后会缓存核心功能；正文和搜索默认按访问历史缓存。
在 App 的「我的」页面点击「下载全部资料供离线使用」，
可一次性下载约 **9.36 MiB** 的完整离线包。

---

## 方式一：一键脚本（推荐）

### 第 1 步：创建 GitHub 仓库

1. 浏览器打开 https://github.com/new
2. **Repository name** 填：`zhuan-sheng-ben-fuxi`
   （只能用小写字母、数字、连字符）
3. 选 **Public**（GitHub Pages 免费版要求公开仓库）
4. **不要勾选** Add a README / .gitignore / license
5. 点 **Create repository**

### 第 2 步：运行部署脚本

在交付的 `复习App` 目录打开 PowerShell，执行：

```powershell
.\部署到GitHub-Pages.ps1
```

脚本会自动完成：
- 检查 git 环境（没装会提示）
- 初始化仓库、提交文件
- 提示你粘贴刚才的仓库地址
- 推送到 GitHub

**首次推送会弹出 GitHub 登录窗口**，用你的账号授权即可。

### 第 3 步：开启 GitHub Pages

1. 浏览器打开你的仓库页面（如 `https://github.com/luckW1/zhuan-sheng-ben-fuxi`）
2. 点 **Settings** → 左侧 **Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `gh-pages`，文件夹选 `/ (root)`
5. 点 **Save**

等 1~2 分钟，刷新页面，顶部会出现：

```
Your site is live at https://luckW1.github.io/zhuan-sheng-ben-fuxi/
```

### 第 4 步：手机使用

手机 Chrome 打开那个地址 → ⋮ 菜单 →「添加到主屏幕」。

**此后电脑关机、手机用流量，都能正常使用。**

---

## 方式二：手动命令（不依赖脚本）

```bash
cd site

git init
git checkout -b gh-pages
git add .
git commit -m "专升本复习 App"

# 把 <用户名> 换成你的 GitHub 用户名
git remote add origin https://github.com/<用户名>/zhuan-sheng-ben-fuxi.git
git push -u origin gh-pages
```

然后按上面「第 3 步」开启 Pages。

---

## 常见问题

### Q1：推送时要求输入密码，输不进去？

GitHub 从 2021 年起**不再支持账号密码**推送，需要用 **Personal Access Token**：

1. 打开 https://github.com/settings/tokens
2. 点 **Generate new token** → **Generate new token (classic)**
3. Note 填 `deploy`，Expiration 选 `90 days`
4. 勾选 **`repo`** 这一项（整组勾上）
5. 点最下方 **Generate token**
6. **复制生成的 token**（形如 `ghp_xxxxxxxx`，只显示一次）
7. 推送时，用户名填你的 GitHub 用户名，**密码处粘贴这个 token**

> 更省事的做法：安装 [GitHub Desktop](https://desktop.github.com/)，
> 图形界面操作，自动处理认证。

### Q2：仓库必须是 Public 吗？

是的，GitHub Pages 免费版要求公开仓库。
好消息是：**这个 App 不含任何隐私数据**，学习进度存在手机本地 localStorage，
不上传、不同步。别人即使打开你的网址，也看不到你的学习记录。

但如果你介意资料被公开，可以：
- 买 GitHub Pro 用私有仓库 + Pages
- 或继续用局域网方案

### Q3：更新内容后怎么重新部署？

改完资料重新生成数据，然后：

```powershell
cd site
git add .
git commit -m "更新"
git push
```

**重要**：如果改过 `index.html`、`css` 或 `js`，请把 `sw.js` 里的
`CACHE = 'zsb-review-v5'` 版本号 +1（改成 v6、v7…），
否则用户手机可能仍显示旧版本。

### Q4：手机上打开还是旧内容？

Service Worker 缓存导致。手机上操作：

- **强制刷新**：Chrome 地址栏输入网址后，按 ⋮ → 刷新按钮**长按** → 「硬刷新」
- 或：Chrome 设置 → 站点设置 → 找到你的网址 → 「清除并重置」
- 或：卸载后重新添加主屏幕

本软件已加自动刷新机制（新版本接管后自动 reload 一次），
正常情况下不需要手动处理。

### Q5：提示 404？

按顺序检查：

1. 仓库 Settings → Pages 的 Branch 是否选了 `gh-pages`
2. 等够 1~2 分钟（GitHub 需要构建时间）
3. 网址末尾**一定要有斜杠**：`https://用户名.github.io/仓库名/`
4. Actions 标签页看有没有构建失败记录

### Q6：资料文件会被公开吗？

会。仓库里包含全部 20 份复习资料（约 73 万字）。
如果你不想公开，用方式一之前先考虑清楚，或改用私有部署方案。

---

## 附：站点技术参数

| 项目 | 值 |
|---|---|
| 站点总体积 | 约 9.36 MiB（42 个文件） |
| 首次核心缓存 | 约 1.41 MiB |
| 完整离线包 | 约 9.36 MiB（在「我的」中主动下载） |
| 搜索索引 | 约 3.26 MiB（首次搜索或完整离线下载时获取） |
| GitHub Pages 限制 | 1 GB / 每月 100 GB 流量（软限制） |
| 是否需要构建 | 否，纯静态文件 |
| 自定义域名 | 可，仓库根目录放 `CNAME` 文件填域名 |

以你的使用强度（个人复习），流量限制完全不是问题。
