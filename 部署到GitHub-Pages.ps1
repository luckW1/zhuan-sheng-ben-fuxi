# ============================================================
#  一键部署到 GitHub Pages
#
#  用法：在本目录（复习App）打开 PowerShell，执行
#        .\部署到GitHub-Pages.ps1
#
#  做的事：
#    1. 检查 git 环境与用户配置
#    2. 把 site 目录初始化为 git 仓库（仅首次）
#    3. 提交所有文件
#    4. 引导你关联 GitHub 仓库并推送
#
#  部署完成后，GitHub 仓库 Settings -> Pages ->
#  Source 选 "Deploy from a branch" -> Branch 选 gh-pages / root
# ============================================================

$ErrorActionPreference = 'Continue'
$SITE = Join-Path $PSScriptRoot "site"

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "    专升本复习 App  -  部署到 GitHub Pages" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. 检查 git ----------
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "  [错误] 未安装 git" -ForegroundColor Red
    Write-Host "  请先安装：https://git-scm.com/download/win （保持默认选项）" -ForegroundColor Yellow
    Read-Host "  按回车退出"
    exit 1
}
Write-Host "  [OK] git 已安装" -ForegroundColor Green

# ---------- 2. 检查用户配置 ----------
$userName = & git config --global user.name 2>$null
$userEmail = & git config --global user.email 2>$null
if (-not $userName -or -not $userEmail) {
    Write-Host "  [提示] 首次使用，需要配置 git 身份" -ForegroundColor Yellow
    $n = Read-Host "  请输入你的名字（随意，如 zhangsan）"
    $e = Read-Host "  请输入你的邮箱（建议用 GitHub 邮箱）"
    & git config --global user.name "$n"
    & git config --global user.email "$e"
    Write-Host "  [OK] 已配置" -ForegroundColor Green
} else {
    Write-Host "  [OK] git 身份: $userName <$userEmail>" -ForegroundColor Green
}

# ---------- 3. 检查站点 ----------
if (-not (Test-Path (Join-Path $SITE "index.html"))) {
    Write-Host "  [错误] 未找到 site/index.html" -ForegroundColor Red
    Read-Host "  按回车退出"
    exit 1
}

Push-Location $SITE
try {
    # git 的提示信息（如 "Switched to a new branch"）会写到 stderr，
    # 直接用 2>&1 会让 PowerShell 误报红色错误，故统一用临时文件捕获输出。
    $gitOut = Join-Path $env:TEMP ("git-out-" + [Guid]::NewGuid().ToString("N") + ".txt")
    $gitErr = Join-Path $env:TEMP ("git-err-" + [Guid]::NewGuid().ToString("N") + ".txt")

    function Invoke-Git {
        param([string]$SubArgs)
        # 用 cmd /c 执行 git 并把 stderr 重定向到文件。
        # 原因：git 的正常提示（如 "Switched to a new branch"）也写入 stderr，
        # 直接用 & git 调用时 PowerShell 会把这些提示当错误显示成红色警告。
        # 这里重定向掉输出，只用退出码判断成败。
        $cmd = "git " + $SubArgs + " 1> `"" + $gitOut + "`" 2> `"" + $gitErr + "`""
        & cmd /c $cmd | Out-Null
        return $LASTEXITCODE
    }

    function Show-GitErr([int]$MaxLines) {
        if (Test-Path $gitErr) {
            Get-Content $gitErr -ErrorAction SilentlyContinue |
                Where-Object { $_.Trim() -ne "" } |
                Select-Object -First $MaxLines |
                ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
        }
    }

    # ---------- 4. 初始化仓库 ----------
    if (-not (Test-Path ".git")) {
        Write-Host "  [进行中] 初始化 git 仓库" -ForegroundColor Yellow
        $code = Invoke-Git "init"
        if ($code -eq 0) { $code = Invoke-Git "checkout -b gh-pages" }
        if ($code -eq 0) {
            Write-Host "  [OK] 已初始化，当前分支 gh-pages" -ForegroundColor Green
        } else {
            Write-Host "  [错误] 初始化失败" -ForegroundColor Red
            Show-GitErr 5
            Pop-Location
            Read-Host "  按回车退出"
            exit 1
        }
    } else {
        Write-Host "  [OK] git 仓库已存在" -ForegroundColor Green
        # 空仓库时 rev-parse 会报错，用 symbolic-ref 更稳（只看分支名，不查提交）
        $branch = & git symbolic-ref --short HEAD 2>$null
        if ($LASTEXITCODE -ne 0) { $branch = "" }
        if ($branch -ne "gh-pages") {
            $curName = $branch
            if (-not $curName) { $curName = "未命名" }
            Write-Host "  [进行中] 切换到 gh-pages 分支，当前分支: $curName" -ForegroundColor Yellow
            $code = Invoke-Git "checkout gh-pages"
            if ($code -ne 0) { $code = Invoke-Git "checkout -b gh-pages" }
            if ($code -eq 0) {
                Write-Host "  [OK] 已切换到 gh-pages" -ForegroundColor Green
            } else {
                Write-Host "  [警告] 切换分支未成功" -ForegroundColor Yellow
                Show-GitErr 3
            }
        }
    }

    # ---------- 5. 添加并提交 ----------
    Write-Host "  [进行中] 添加并提交文件" -ForegroundColor Yellow
    $null = Invoke-Git "add -A"
    $status = & git status --porcelain 2>$null
    if ($status) {
        $msg = "更新复习 App " + (Get-Date -Format "yyyy-MM-dd HH:mm")
        $code = Invoke-Git ("commit -m " + [char]34 + $msg + [char]34)
        if ($code -eq 0) {
            Write-Host "  [OK] 已提交: $msg" -ForegroundColor Green
        } else {
            Write-Host "  [错误] 提交失败" -ForegroundColor Red
            Show-GitErr 5
        }
    } else {
        Write-Host "  [OK] 没有改动，无需提交" -ForegroundColor Green
    }

    # ---------- 6. 关联远程仓库 ----------
    $remote = & git remote get-url origin 2>$null
    if (-not $remote) {
        Write-Host ""
        Write-Host "  --------------------------------------------" -ForegroundColor DarkCyan
        Write-Host "  需要你提供 GitHub 仓库地址" -ForegroundColor White
        Write-Host ""
        Write-Host "  先做这一步（2 分钟）：" -ForegroundColor White
        Write-Host "    1. 浏览器打开 https://github.com/new" -ForegroundColor Gray
        Write-Host "    2. Repository name 填: zhuan-sheng-ben-fuxi" -ForegroundColor Gray
        Write-Host "    3. 选 Public（GitHub Pages 免费版必须公开仓库）" -ForegroundColor Gray
        Write-Host "    4. 不要勾选 Add a README / .gitignore / license" -ForegroundColor Gray
        Write-Host "    5. 点 Create repository" -ForegroundColor Gray
        Write-Host ""
        $repoUrl = Read-Host "  创建好后，把仓库地址粘贴到这里（如 https://github.com/luckW1/zhuan-sheng-ben-fuxi.git）"
        if (-not $repoUrl) {
            Write-Host "  [已取消] 未输入地址" -ForegroundColor Yellow
            Pop-Location
            Read-Host "  按回车退出"
            exit 0
        }
        $code = Invoke-Git ("remote add origin " + $repoUrl)
        if ($code -eq 0) {
            Write-Host "  [OK] 已关联远程仓库" -ForegroundColor Green
        } else {
            Write-Host "  [错误] 关联远程仓库失败（地址可能不正确）" -ForegroundColor Red
            Show-GitErr 3
            Pop-Location
            Read-Host "  按回车退出"
            exit 1
        }
    } else {
        Write-Host "  [OK] 远程仓库: $remote" -ForegroundColor Green
    }

    # ---------- 7. 推送 ----------
    Write-Host ""
    Write-Host "  [进行中] 正在推送到 GitHub..." -ForegroundColor Yellow
    Write-Host "      首次推送会弹出登录窗口，请用 GitHub 账号授权" -ForegroundColor DarkGray
    Write-Host ""
    # 推送输出直接显示（便于看到登录提示与进度），用退出码判断成败
    & git push -u origin gh-pages
    $pushOk = ($LASTEXITCODE -eq 0)

    if ($pushOk) {
        Write-Host ""
        Write-Host "  ============================================" -ForegroundColor Green
        Write-Host "    推送成功！" -ForegroundColor Green
        Write-Host "  ============================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  最后一步：开启 GitHub Pages" -ForegroundColor White
        Write-Host "    1. 浏览器打开你的仓库页面" -ForegroundColor Gray
        Write-Host "    2. Settings -> Pages" -ForegroundColor Gray
        Write-Host "    3. Source 选 Deploy from a branch" -ForegroundColor Gray
        Write-Host "    4. Branch 选 gh-pages，文件夹选 / (root)" -ForegroundColor Gray
        Write-Host "    5. 点 Save，等 1-2 分钟" -ForegroundColor Gray
        Write-Host ""
        $remoteNow = & git remote get-url origin 2>$null
        $m = [regex]::Match($remoteNow, 'github\.com[:/]([^/]+)/([^/.]+)')
        if ($m.Success) {
            Write-Host "  部署完成后，手机访问这个地址：" -ForegroundColor White
            Write-Host ""
            Write-Host "      https://$($m.Groups[1].Value).github.io/$($m.Groups[2].Value)/" -ForegroundColor Green
            Write-Host ""
        }
    } else {
        Write-Host ""
        Write-Host "  [失败] 推送未成功（退出码 $LASTEXITCODE）" -ForegroundColor Red
        Write-Host "  常见原因：" -ForegroundColor Yellow
        Write-Host "    1. 仓库地址输错，或仓库不属于你的账号" -ForegroundColor Gray
        Write-Host "    2. GitHub 已不支持密码推送，需用 Personal Access Token" -ForegroundColor Gray
        Write-Host "       （详见 GitHub-Pages部署指南.md 的常见问题 Q1）" -ForegroundColor Gray
        Write-Host "    3. 网络问题，可稍后重试" -ForegroundColor Gray
    }
}
finally {
    Pop-Location
    # 清理临时文件
    Remove-Item $gitOut -ErrorAction SilentlyContinue
    Remove-Item $gitErr -ErrorAction SilentlyContinue
}

Write-Host ""
Read-Host "  按回车关闭"
