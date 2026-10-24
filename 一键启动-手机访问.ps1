# ============================================================
#  一键启动「手机访问」模式
#
#  用法（任选一种）：
#   1. 在本目录（复习App）打开 PowerShell，执行：
#        .\一键启动-手机访问.ps1
#   2. 文件资源管理器中右键本文件 → 「使用 PowerShell 运行」
#
#  作用：自动查找 Node.js、放行防火墙、显示手机可访问的地址，
#        然后启动服务器（关闭窗口即停止）。
# ============================================================

param(
    [ValidateSet('Y', 'N', 'Q')]
    [string]$PortChoice
)

$ErrorActionPreference = 'Continue'
$PORT = 8899
$ROOT = Join-Path $PSScriptRoot "site"

function Get-LanAddresses {
    $addresses = @()
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.IPAddress -notmatch '^(127\.|169\.254\.)') {
            $addresses += $_.IPAddress
        }
    }
    return $addresses
}

function Test-PortListening {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(500)) { return $false }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "    专升本复习 App  -  手机访问启动器" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. 查找 Node.js ----------
$NODE = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) {
    $NODE = $cmd.Source
    Write-Host "  [OK] 已找到 Node.js" -ForegroundColor Green
} else {
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $NODE = $c; break }
    }
    if ($NODE) {
        Write-Host "  [OK] 已找到 Node.js: $NODE" -ForegroundColor Green
    } else {
        Write-Host "  [错误] 未找到 Node.js" -ForegroundColor Red
        Write-Host "  请先安装 Node.js：https://nodejs.org/ （保持默认选项，装完重开窗口）" -ForegroundColor Yellow
        Read-Host "  按回车退出"
        exit 1
    }
}

# ---------- 2. 检查站点目录 ----------
if (-not (Test-Path (Join-Path $ROOT "index.html"))) {
    Write-Host "  [错误] 未找到站点文件: $ROOT\index.html" -ForegroundColor Red
    Read-Host "  按回车退出"
    exit 1
}
Write-Host "  [OK] 站点目录: $ROOT" -ForegroundColor Green

# ---------- 3. 检查端口占用 ----------
$inUse = Test-PortListening -Port $PORT
if ($inUse) {
    Write-Host "  [提示] 端口 $PORT 已被占用（服务可能已在运行）" -ForegroundColor Yellow
    if ($PortChoice) {
        $choice = $PortChoice.ToUpperInvariant()
    } else {
        do {
            $choice = Read-Host "  直接使用现有服务？(Y=使用 / N=改用端口 $($PORT+1) / Q=退出)"
            $choice = if ($choice) { $choice.Trim().ToUpperInvariant() } else { '' }
        } while ($choice -notin @('Y', 'N', 'Q'))
    }

    if ($choice -eq 'Q') { exit 0 }
    if ($choice -eq 'Y') {
        $verified = $false
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/" -UseBasicParsing -TimeoutSec 3
            $verified = $response.StatusCode -eq 200 -and $response.Content -match '专升本复习'
        } catch {
            $verified = $false
        }
        if (-not $verified) {
            Write-Host "  [错误] 端口 $PORT 上的服务不是当前复习 App，请重新运行并选择 N 改用其他端口。" -ForegroundColor Red
            Read-Host "  按回车退出"
            exit 1
        }
        Write-Host "  [OK] 已连接现有复习 App 服务，不再启动第二个进程。" -ForegroundColor Green
        Write-Host ""
        Write-Host "  --------------------------------------------" -ForegroundColor DarkCyan
        Write-Host "  请用手机浏览器打开（手机需与电脑同一 Wi-Fi）：" -ForegroundColor White
        Write-Host ""
        foreach ($ip in (Get-LanAddresses)) {
            Write-Host "        http://${ip}:$PORT" -ForegroundColor Green
        }
        Write-Host ""
        Write-Host "  --------------------------------------------" -ForegroundColor DarkCyan
        Write-Host ""
        exit 0
    } else {
        $PORT = $PORT + 1
    }
}

# ---------- 4. 防火墙规则（失败不阻塞，仅提示） ----------
$ruleName = "专升本复习App-$PORT"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "  [提示] 正在放行防火墙端口 $PORT ..." -ForegroundColor Yellow
    try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $PORT `
            -Protocol TCP -Action Allow -Profile Any -ErrorAction Stop | Out-Null
        Write-Host "  [OK] 防火墙已放行" -ForegroundColor Green
    } catch {
        Write-Host "  [警告] 无法自动放行防火墙（需要管理员权限）" -ForegroundColor Yellow
        Write-Host "         若手机连不上，请右键本文件 → 使用 PowerShell 以管理员身份运行" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [OK] 防火墙规则已存在" -ForegroundColor Green
}

# ---------- 5. 显示手机访问地址 ----------
$ips = Get-LanAddresses

Write-Host ""
Write-Host "  --------------------------------------------" -ForegroundColor DarkCyan
Write-Host "  请用手机浏览器打开（手机需与电脑同一 Wi-Fi）：" -ForegroundColor White
Write-Host ""
foreach ($ip in $ips) {
    Write-Host "        http://${ip}:$PORT" -ForegroundColor Green
}
Write-Host ""
Write-Host "  Android 安装到桌面：Chrome 菜单 -> 添加到主屏幕" -ForegroundColor DarkGray
Write-Host "  --------------------------------------------" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  正在启动服务... 关闭本窗口即停止" -ForegroundColor DarkGray
Write-Host ""

# ---------- 6. 启动服务器 ----------
& $NODE (Join-Path $PSScriptRoot "build\serve.js") $PORT $ROOT "0.0.0.0"
