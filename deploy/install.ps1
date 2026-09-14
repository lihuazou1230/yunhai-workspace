<#
  云海工作台 · IIS 子应用一键部署脚本
  ================================================================
  阶段：第八阶段（上线部署到自有服务器 124.220.159.58）

  作用：把本包内的 dist/ 部署成 80 端口主站点下的子应用 /workspace/，
        与主站上原有的「图片添加二维码工具」共存，互不影响。

  在服务器上的运行方式（任选其一，都必须用【管理员】身份）：
    1. 右键 install.ps1 →「使用 PowerShell 运行」
    2. 管理员 PowerShell 里： powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

  特性：幂等 —— 重复运行只会用新产物覆盖旧文件，不会重复建站点、不会报错。
        改完代码在本机重新打包、再拖进来跑一遍即可完成更新。

  可选参数：
    -AppName workspace     子应用名（=URL 里的路径段）
    -SiteName "Default Web Site"   指定主站点名（默认自动探测 80 端口已启动的站点）
    -Port 80               按端口探测主站点
    -SkipRewriteInstall    跳过 URL Rewrite 模块的检测/安装（已装过或离线自备时）
    -NoPause               跑完不等待按键（自动化调用时用）
#>
[CmdletBinding()]
param(
    [string]$AppName = 'workspace',
    [string]$SiteName,
    [int]$Port = 80,
    [switch]$SkipRewriteInstall,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest 的进度条在 RDP 会话里极慢（2012 R2 上能把几 MB 的下载拖成几分钟）
$ProgressPreference = 'SilentlyContinue'

# URL Rewrite 2.0 x64 的官方下载地址（首选 + 备用），离线时可用同目录下的同名 msi
$RewriteUrls = @(
    'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi',
    'https://download.microsoft.com/download/C/9/E/C9E8180D-4E51-40A6-A9BF-776990D8BCA9/rewrite_2.0_rtw_x64.msi'
)

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [警告] $msg" -ForegroundColor Yellow }

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '当前不是管理员会话。请右键脚本 →「以管理员身份运行」，或在管理员 PowerShell 中执行。'
    }
}

function Test-UrlRewriteInstalled {
    if (Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite') { return $true }
    if (Test-Path (Join-Path $env:windir 'system32\inetsrv\rewrite.dll')) { return $true }
    return $false
}

function Install-UrlRewrite {
    # 2012 R2 的 .NET 默认只启用到 TLS 1.0，download.microsoft.com 会直接掐断连接
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {
        Write-Warn "无法启用 TLS 1.2（$($_.Exception.Message)），下载可能失败，可改用离线 msi"
    }

    $msi = $null
    foreach ($name in @('rewrite_amd64_en-US.msi', 'rewrite_2.0_rtw_x64.msi')) {
        $local = Join-Path $PSScriptRoot $name
        if (Test-Path $local) { $msi = $local; Write-Ok "使用包内离线安装包：$name"; break }
    }

    if (-not $msi) {
        $target = Join-Path $env:TEMP 'rewrite_amd64_en-US.msi'
        foreach ($url in $RewriteUrls) {
            try {
                Write-Host "    下载 $url"
                Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing -TimeoutSec 180
                $msi = $target
                break
            } catch {
                Write-Warn "下载失败：$($_.Exception.Message)"
            }
        }
    }

    if (-not $msi) {
        throw '无法获取 URL Rewrite 安装包（服务器可能访问不了外网）。请在能上网的机器上下载 rewrite_amd64_en-US.msi，和本脚本放在同一目录后重跑。'
    }

    Write-Host "    静默安装 $msi"
    $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$msi`"", '/quiet', '/norestart') -Wait -PassThru
    # 0 = 成功；3010 = 成功但待重启（这里不重启也不影响 URL Rewrite 生效）
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        throw "URL Rewrite 安装失败，msiexec 退出码 $($proc.ExitCode)"
    }
    return $true
}

function Get-SiteBindingInfo {
    <#
      取站点的绑定串（形如 *:80: 或 *:80:example.com）。

      坑：Get-Website 返回的是 IIS 配置对象（Microsoft.IIs.PowerShell.Framework.ConfigurationElement），
      $site.Bindings 直接 -match / -join 只会得到字符串化的**类型名**，什么也匹配不到
      （实测在 Windows Server 2012 R2 上就是这么翻车的）。绑定元素要经 .Collection 取，
      属性名 bindingInformation 在部分版本里大小写敏感，所以两种写法都试。
    #>
    param($Site)

    $result = New-Object System.Collections.Generic.List[string]

    # 策略 1：Get-WebBinding —— WebAdministration 里最直白的取绑定方式
    try {
        foreach ($b in @(Get-WebBinding -Name $Site.Name -ErrorAction Stop)) {
            if ($b.bindingInformation) { $result.Add([string]$b.bindingInformation) }
        }
    } catch {
        # 命令不存在或站点无绑定时静默走策略 2
    }

    # 策略 2：直接读站点对象的 Bindings（兼容"包装对象含 Collection"与"直接是元素集合"两种形态）
    if ($result.Count -eq 0 -and $Site.Bindings) {
        $items = @()
        if ($Site.Bindings.PSObject.Properties['Collection']) {
            $items = @($Site.Bindings.Collection)
        } else {
            $items = @($Site.Bindings)
        }
        foreach ($item in $items) {
            if ($item -is [string]) { $result.Add($item); continue }
            foreach ($prop in @('bindingInformation', 'BindingInformation')) {
                if ($item.PSObject.Properties[$prop]) { $result.Add([string]$item.$prop); break }
            }
        }
    }

    return $result
}

function Test-SiteBindsPort {
    param($Site, [int]$PortNumber)
    foreach ($info in (Get-SiteBindingInfo -Site $Site)) {
        # *:80: / *:80:example.com / 192.168.1.5:80: 都算；:8080 不会被 :80 命中
        if ($info -match ":${PortNumber}(:|$)") { return $true }
    }
    return $false
}

function Format-SiteList {
    param($Sites)
    return (($Sites | ForEach-Object {
                $b = @(Get-SiteBindingInfo -Site $_)
                $shown = if ($b.Count -gt 0) { $b -join ' ' } else { '（无绑定）' }
                "$($_.Name) [$shown] ($($_.State))"
            }) -join '; ')
}

function Get-MainSite {
    if ($SiteName) {
        $site = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
        if (-not $site) { throw "找不到名为「$SiteName」的 IIS 站点，请用 -SiteName 指定正确名称。" }
        return $site
    }

    $all = @(Get-Website)
    if ($all.Count -eq 0) { throw 'IIS 里一个站点都没有，请先在 IIS 管理器里建好主站（跑二维码工具的那个）。' }

    $started = @($all | Where-Object { $_.State -eq 'Started' })
    $picked = $null
    $note = ''

    # 1) 绑定该端口且已启动 —— 正常路径
    if ($started.Count -gt 0) {
        $picked = $started | Where-Object { Test-SiteBindsPort -Site $_ -PortNumber $Port } | Select-Object -First 1
    }
    # 2) 只有一个已启动站点（哪怕取不到绑定串）—— 兜底用它，避免像 2012 R2 上那样
    #    因为绑定串取不到就整个流程卡死；绑定信息会一并打印出来供复核
    if (-not $picked -and $started.Count -eq 1) {
        $picked = $started[0]
        $note = "没取到 $Port 端口绑定，但只有一个已启动站点（绑定：$(@(Get-SiteBindingInfo -Site $picked) -join ' ')），按其部署；请复核它确实是 $Port 上的主站。"
    }
    # 3) 绑定该端口但没启动 —— 也用，但说清楚
    if (-not $picked) {
        $picked = $all | Where-Object { Test-SiteBindsPort -Site $_ -PortNumber $Port } | Select-Object -First 1
        if ($picked) { $note = "注意：站点 $($picked.Name) 当前不是 Started 状态，部署完请确认它已启动。" }
    }

    if (-not $picked) {
        throw "没有找到绑定 $Port 端口的站点。现有站点：$(Format-SiteList -Sites $all)。请用 -SiteName 手动指定。"
    }

    if ($note) { Write-Warn $note }
    return $picked
}

function Get-WebAppPath {
    <#
      Get-WebApplication 返回的对象在各 IIS 版本里属性名不一致（Path / Name / PSChildName），
      跟 Bindings 那个坑同源：写死一个属性名就会静默匹配不到，进而把「已存在」误判成「不存在」，
      第二次部署就会去重复创建应用而报错（幂等性直接失效）。这里挨个属性试，统一成 /xxx 形态。
    #>
    param($App)
    foreach ($prop in @('Path', 'Name', 'PSChildName')) {
        if ($App.PSObject.Properties[$prop]) {
            $value = [string]$App.$prop
            if ($value) { return '/' + $value.Trim('/') }
        }
    }
    return ''
}

function Test-WebApplicationExists {
    param($Site, [string]$Name)

    try {
        foreach ($app in @(Get-WebApplication -Site $Site.Name -ErrorAction Stop)) {
            if ((Get-WebAppPath -App $app) -eq "/$Name") { return $true }
        }
    } catch {
        # 属性名全都不认识时走下面的配置查询兜底
    }

    # 兜底：直接查 applicationHost 配置（绕开 WebAdministration 的返回形态差异）
    try {
        $app = Get-WebConfiguration -PSPath "IIS:\Sites\$($Site.Name)" `
            -Filter "system.applicationHost/sites/site/application[@path='/$Name']" -ErrorAction Stop
        if ($app) { return $true }
    } catch { }

    return $false
}

function Get-SiteRootPath {
    param($Site)
    $path = $Site.PhysicalPath
    # 个别环境下 Get-Website 的 PhysicalPath 取不到，退回 IIS 提供程序读
    if (-not $path) {
        try { $path = (Get-Item "IIS:\Sites\$($Site.Name)" -ErrorAction Stop).PhysicalPath } catch { }
    }
    if (-not $path) { throw "取不到站点 $($Site.Name) 的物理路径，请检查 IIS 配置。" }
    return [Environment]::ExpandEnvironmentVariables($path).TrimEnd('\')
}

function Invoke-Deploy {
    Write-Host ''
    Write-Host '========================================' -ForegroundColor White
    Write-Host ' 云海工作台 · IIS 子应用一键部署（第八阶段）' -ForegroundColor White
    Write-Host '========================================' -ForegroundColor White

    Write-Step '0/6 环境自检'
    Assert-Administrator
    Write-Ok '管理员权限'

    $distDir = Join-Path $PSScriptRoot 'dist'
    $configPath = Join-Path $PSScriptRoot 'web.config'
    if (-not (Test-Path (Join-Path $distDir 'index.html'))) {
        throw "包不完整：找不到 $distDir\index.html。请确认 zip 解压完整（dist/ 与 install.ps1 同级）。"
    }
    if (-not (Test-Path $configPath)) { throw "包不完整：找不到 web.config。" }
    $fileCount = @(Get-ChildItem -Path $distDir -Recurse -File).Count
    Write-Ok "产物完整（dist/ 共 $fileCount 个文件）"

    # 子路径构建自检：BASE_PATH 忘了设的话产物里是 /assets/...，部署上去必然白屏
    $indexHtml = Get-Content -Path (Join-Path $distDir 'index.html') -Raw -Encoding UTF8
    if ($indexHtml -match "/$AppName/") {
        Write-Ok "产物已按子路径 /$AppName/ 构建（base 前缀正确）"
    } else {
        Write-Warn "产物里没有出现 /$AppName/ 前缀 —— 可能构建时没设 BASE_PATH，部署后会白屏。"
    }

    Import-Module WebAdministration -ErrorAction Stop
    Write-Ok 'WebAdministration 模块已加载'

    Write-Step '1/6 检查 URL Rewrite 模块（SPA 刷新不 404 的前提）'
    if (Test-UrlRewriteInstalled) {
        Write-Ok 'URL Rewrite 已安装'
    } elseif ($SkipRewriteInstall) {
        Write-Warn 'URL Rewrite 未安装，且指定了 -SkipRewriteInstall —— 子路由刷新会 404'
    } else {
        Write-Host '    未安装，开始自动安装（约 5 MB）...'
        Install-UrlRewrite | Out-Null
        Write-Ok 'URL Rewrite 安装完成，重启 IIS 使模块生效'
        & iisreset /noforce | Out-Null
    }

    Write-Step "2/6 定位主站点（$Port 端口）"
    $site = Get-MainSite
    $siteRoot = Get-SiteRootPath -Site $site
    $target = Join-Path $siteRoot $AppName
    Write-Ok "主站点：$($site.Name)（应用池 $(if ($site.ApplicationPool) { $site.ApplicationPool } else { '未知，将沿用默认池' })）"
    Write-Ok "主站根目录：$siteRoot"
    Write-Ok "子应用目录：$target"

    Write-Step "3/6 创建/复用子应用 /$AppName/"
    $existing = Test-WebApplicationExists -Site $site -Name $AppName
    if ($existing) {
        Write-Ok '子应用已存在 → 只更新文件（幂等）'
    } elseif (Test-Path $target) {
        # 目录已存在（比如上次手动拷过文件）但不是应用：就地升级成应用，不动主站
        $convertArgs = @{ PSPath = "IIS:\Sites\$($site.Name)\$AppName" }
        if ($site.ApplicationPool) { $convertArgs.ApplicationPool = $site.ApplicationPool }
        ConvertTo-WebApplication @convertArgs | Out-Null
        Write-Ok '目录已存在 → 已就地转换为 IIS 子应用'
    } else {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        # 应用池取不到就交给 New-WebApplication 用默认池，避免传空值报参数错误
        $newAppArgs = @{ Site = $site.Name; Name = $AppName; PhysicalPath = $target }
        if ($site.ApplicationPool) { $newAppArgs.ApplicationPool = $site.ApplicationPool }
        New-WebApplication @newAppArgs | Out-Null
        Write-Ok '子应用创建完成（沿用主站应用池，纯静态无需托管代码）'
    }

    Write-Step '4/6 同步文件'
    # 只清空子应用目录内部，目录本身保留（IIS 应用指向它）
    Get-ChildItem -Path $target -Force | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $distDir '*') -Destination $target -Recurse -Force
    Copy-Item -Path $configPath -Destination $target -Force
    $deployed = @(Get-ChildItem -Path $target -Recurse -File).Count
    Write-Ok "已覆盖 $deployed 个文件（含 web.config）"

    Write-Step '5/6 授权与缓存'
    & icacls $target /grant 'IIS_IUSRS:(OI)(CI)(RX)' /T /Q /C | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok 'IIS_IUSRS 读取权限已授予'
    } else {
        Write-Warn "icacls 返回 $LASTEXITCODE，权限可能未生效（若页面 401/403 请手动授权）"
    }
    if ($existing -and $site.ApplicationPool) {
        # 覆盖过 index.html 后回收应用池，避免个别情况下拿到缓存的旧 html
        Restart-WebAppPool -Name $site.ApplicationPool -ErrorAction SilentlyContinue
        Write-Ok "已回收应用池 $($site.ApplicationPool)"
    }

    Write-Step '6/6 本机连通性验证'
    $probeUrls = @("http://127.0.0.1/$AppName/", "http://127.0.0.1/$AppName/dashboard")
    foreach ($url in $probeUrls) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
            Write-Ok "$url → HTTP $($resp.StatusCode)"
        } catch {
            Write-Warn "$url → $($_.Exception.Message)（外网/Bank 内网仍可能正常，请用浏览器复核）"
        }
    }

    Write-Host ''
    Write-Host '========================================' -ForegroundColor White
    Write-Host ' 部署完成' -ForegroundColor Green
    Write-Host '========================================' -ForegroundColor White
    Write-Host " 站点        : $($site.Name)"
    Write-Host " 子应用路径  : /$AppName/"
    Write-Host " 物理目录    : $target"
    Write-Host " 文件数      : $deployed"
    Write-Host ''
    Write-Host ' 现在请在浏览器里复核两条：' -ForegroundColor Cyan
    Write-Host "   1) http://124.220.159.58/$AppName/           ← 工作台首页"
    Write-Host "   2) http://localhost/$AppName/dashboard       ← 刷新子路由不 404（SPA fallback）"
    Write-Host "   3) http://124.220.159.58/                    ← 主站二维码工具应完好无损"
    Write-Host ''
    Write-Host ' 可选（登录/邮件相关）：把 Supabase 控制台 Auth → URL Configuration 的' -ForegroundColor Cyan
    Write-Host "   Site URL / Redirect URLs 加上 http://124.220.159.58/$AppName/" -ForegroundColor Cyan
    Write-Host ''
}

$exitCode = 0
try {
    Invoke-Deploy
} catch {
    Write-Host ''
    Write-Host "部署失败：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}

if (-not $NoPause) {
    Write-Host ''
    Read-Host '按回车键关闭窗口' | Out-Null
}
exit $exitCode
