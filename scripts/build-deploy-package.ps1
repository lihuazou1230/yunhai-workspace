<#
  云海工作台 · 打包「一键部署包」（第八阶段）
  ================================================================
  本机执行，产出一个 zip：拖进 RDP 会话解压、跑 install.ps1 即完成部署。

  用法（本机 PowerShell，无需管理员）：
      pnpm deploy:package
      # 或
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-deploy-package.ps1

  注意：pnpm 转发额外参数时会插一个多余的 `--`（脚本会报参数名歧义），
        需要带 -SkipBuild 这类参数时，直接用上面那条 powershell -File 调用。

  产物：
      deploy-package.zip          ← 交付物（dist/ + web.config + install.ps1 + 部署说明.txt）
      build/deploy-package/       ← 中间暂存目录（已 gitignore，方便肉眼核对内容）

  参数：
      -BasePath '/workspace/'   子路径前缀（与服务器子应用名一致，改动需同步 install.ps1 -AppName）
      -AgentEndpoint '...'      构建进前端的**默认** agent 基地址（默认 http://124.220.159.58/yhai，
                                即服务器上 IIS 同源反代的那个子路径；传空字符串可还原成 127.0.0.1:8000）
      -SkipBuild                复用当前 dist/（只重新打包，不重新构建）
      -SkipVerify               跳过对产物 base 前缀的校验（不建议）
#>
[CmdletBinding()]
param(
    [string]$BasePath = '/workspace/',
    [string]$AgentEndpoint = 'http://124.220.159.58/yhai',
    [switch]$SkipBuild,
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Fail($msg) { throw $msg }

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot 'dist'
$deploySrc = Join-Path $repoRoot 'deploy'
$staging = Join-Path $repoRoot 'build\deploy-package'
$zipPath = Join-Path $repoRoot 'deploy-package.zip'

Write-Host ''
Write-Host '========================================' -ForegroundColor White
Write-Host " 云海工作台 · 打包部署包（base = $BasePath）" -ForegroundColor White
Write-Host '========================================' -ForegroundColor White

Write-Step '1/5 构建前端产物'
if ($SkipBuild) {
    Write-Ok '已指定 -SkipBuild，复用现有 dist/'
} else {
    $env:BASE_PATH = $BasePath
    Write-Host "    `$env:BASE_PATH = $BasePath"
    # 默认 agent 基地址：部署页在服务器上跑，连不到访问者本机的 127.0.0.1，
    # 必须指向服务器上的同源地址（见 deploy\部署说明.txt 的「AI 助手基地址」一节）
    $env:VITE_AGENT_ENDPOINT = $AgentEndpoint
    $shownEndpoint = $AgentEndpoint
    if (-not $shownEndpoint) { $shownEndpoint = '(空 → 回退 127.0.0.1:8000)' }
    Write-Host "    `$env:VITE_AGENT_ENDPOINT = $shownEndpoint"
    # 注意：不要用 2>&1 把 stderr 并进成功流，Windows PowerShell 会把原生命令的
    # stderr 当成 NativeCommandError 抛出来，明明构建成功也会被判失败
    Push-Location $repoRoot
    try {
        & pnpm.cmd build
        if ($LASTEXITCODE -ne 0) { Fail "pnpm build 失败（退出码 $LASTEXITCODE）" }
    } finally {
        Pop-Location
    }
    Write-Ok '构建完成'
}

if (-not (Test-Path (Join-Path $distDir 'index.html'))) { Fail "找不到 $distDir\index.html" }

Write-Step '2/5 校验产物 base 前缀'
$indexHtml = Get-Content -Path (Join-Path $distDir 'index.html') -Raw -Encoding UTF8
if ($SkipVerify) {
    Write-Ok '已指定 -SkipVerify，跳过'
} elseif ($indexHtml -match [regex]::Escape($BasePath)) {
    Write-Ok "index.html 中已带 $BasePath 前缀"
} else {
    Fail @"
产物里没有 $BasePath 前缀，不能打包（这样部署上去必然白屏）。
  常见原因：dist/ 被别的构建覆盖过 —— 桌面版构建、或不带 BASE_PATH 的 pnpm build 都会写成 base=/。
  处理：去掉 -SkipBuild 重新跑一次本脚本（它会带上正确的 BASE_PATH 重新构建）。
"@
}

# 默认 agent 基地址也得真的进了产物：没进去的话，部署页打开仍默认连 127.0.0.1:8000，
# 用户看到的就是「连不上 Agent 后端」——而那个地址在服务器页面上永远连不通。
if ($AgentEndpoint) {
    $hit = Get-ChildItem -Path (Join-Path $distDir 'assets') -Filter '*.js' -Recurse -ErrorAction SilentlyContinue |
        Select-String -SimpleMatch -Pattern $AgentEndpoint -List | Select-Object -First 1
    if ($hit) {
        Write-Ok "产物里已带 agent 基地址 $AgentEndpoint"
    } elseif ($SkipVerify) {
        Write-Ok '已指定 -SkipVerify，跳过 agent 基地址校验'
    } else {
        Fail @"
产物里找不到 agent 基地址 $AgentEndpoint。
  常见原因：dist/ 是加这个变量之前构建的（比如用了 -SkipBuild）。
  处理：去掉 -SkipBuild 重新构建；或显式传 -AgentEndpoint。
"@
    }
}

Write-Step '3/5 组装暂存目录'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -Path $distDir -Destination (Join-Path $staging 'dist') -Recurse -Force
$extra = @('web.config', 'install.ps1', '部署说明.txt')
foreach ($name in $extra) {
    $src = Join-Path $deploySrc $name
    if (-not (Test-Path $src)) { Fail "缺少 deploy\$name" }
    Copy-Item -Path $src -Destination (Join-Path $staging $name) -Force
}
$staged = @(Get-ChildItem -Path $staging -Recurse -File)
$sizeKb = [Math]::Round(($staged | Measure-Object -Property Length -Sum).Sum / 1KB, 1)
Write-Ok "共 $($staged.Count) 个文件，$sizeKb KB"

Write-Step '4/5 脚本预检'
$installPath = Join-Path $staging 'install.ps1'

# 服务器是 Windows Server 2012 R2 + Windows PowerShell 4.0：无 BOM 的 UTF-8 会被按 GBK 读，
# 中文提示全成乱码。先补 BOM，再做后面的语法解析
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
foreach ($name in @('install.ps1', '部署说明.txt')) {
    $path = Join-Path $staging $name
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    if (-not $hasBom) {
        $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        [System.IO.File]::WriteAllText($path, $text, $utf8Bom)
        Write-Ok "$name 已补 UTF-8 BOM"
    } else {
        Write-Ok "$name 已带 UTF-8 BOM"
    }
}

# 交付的脚本要在服务器上跑，本机先做语法解析，别把打不开的脚本发出去。
# 显式按 UTF-8 读出文本再解析：Parser::ParseFile 在部分环境下按 ANSI 读，
# 会让中文注释/字符串被误判成语法错误（假红）
$installText = [System.IO.File]::ReadAllText($installPath, [System.Text.Encoding]::UTF8)
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseInput($installText, $installPath, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors -and $errors.Count -gt 0) {
    Fail "install.ps1 语法错误：$($errors[0].Message)（行 $($errors[0].Extent.StartLineNumber)）"
}
Write-Ok 'install.ps1 语法解析通过'

Write-Step '5/5 生成 zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = $zip.Entries
    $zipKb = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)
    # Windows PowerShell 的 Compress-Archive 用反斜杠做条目分隔符，比较前统一成正斜杠
    $names = @($entries | ForEach-Object { $_.FullName -replace '\\', '/' })
    $roots = ($names | ForEach-Object { if ($_ -match '/') { ($_ -split '/')[0] } else { $_ } } | Sort-Object -Unique) -join ', '
    Write-Ok "$zipPath（$zipKb KB，$($entries.Count) 个条目）"
    Write-Ok "根目录内容：$roots"
    foreach ($need in @('install.ps1', 'web.config', '部署说明.txt', 'dist/index.html', 'dist/assets')) {
        $hit = $names | Where-Object { $_ -eq $need -or $_ -like "$need/*" } | Select-Object -First 1
        if (-not $hit) { Fail "zip 里缺少 $need" }
    }
    Write-Ok 'zip 结构校验通过'
} finally {
    $zip.Dispose()
}

Write-Host ''
Write-Host '========================================' -ForegroundColor White
Write-Host ' 打包完成' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor White
Write-Host " 交付物 : $zipPath"
Write-Host ' 下一步 : RDP 登录 124.220.159.58 → 把 zip 粘进远程会话 → 解压'
Write-Host '          → 右键 install.ps1「使用 PowerShell 运行」'
Write-Host " 验证   : http://124.220.159.58$BasePath"
Write-Host "          AI 助手页应默认连 $AgentEndpoint（服务器上的同源反代；未部署 agent 时该页会报连不上，属正常）"
Write-Host ''
