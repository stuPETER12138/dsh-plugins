#!/usr/bin/env pwsh
<#
.SYNOPSIS
  在隔离的临时 DSH_HOME / profile 里验证本仓库所有 DSH 插件能被真实 CLI 安装、组合并加载。

.DESCRIPTION
  对每个插件依次执行：

    1. dsh plugin --profile <name> add "link:<plugin dir>"   安装（pnpm link:）
    2. dsh --profile <name> --dump-config                    断言组合树里出现该插件行
    3. dsh --profile <name> --port 0 --no-open               后台启动 Web 服务
    4. HTTP：首页 HTML 的 __DSH_BOOT__ 必须列出该插件的 client 模块，
       且 /plugins/??@local/<plugin>/client.js&rev=<rev> 返回 200

  之后停止 Web 服务进程并清理临时目录。全程只写 -TempHome 指定的临时
  DSH_HOME（默认在系统临时目录），绝不读取或修改用户真实的 ~/.dsh。

.PARAMETER DshCli
  dsh CLI 的可执行文件（.cmd 或 .exe）。省略时依次尝试：环境变量 DSH_CLI、
  PATH 上的 dsh、以及 DSH Desktop 的常见安装位置；都找不到时请显式传入本参数。

.PARAMETER RepoRoot
  仓库根目录（包含各插件子目录）。默认为本脚本所在目录的上一级。

.PARAMETER TempHome
  临时 DSH_HOME 目录；默认在系统临时目录下新建 dsh-plugins-verify-*。
  传入已存在的目录时会先清空它（脚本只允许清空自己命名的目录或系统临时目录下的目录）。

.PARAMETER ProfileName
  临时 profile 名，默认 verify-install。

.PARAMETER KeepTempHome
  保留临时 DSH_HOME（默认验证结束后删除），便于排查问题。

.EXAMPLE
  pwsh -File scripts/verify-install.ps1

.EXAMPLE
  pwsh -File scripts/verify-install.ps1 -DshCli 'C:\DSH\resources\runtime\cli\bin\dsh.cmd' -TempHome "$env:TEMP\dsh-verify-manual"

.NOTES
  退出码：0 = 全部通过；1 = 至少一项失败（会打印失败原因）。
#>
[CmdletBinding()]
param(
    [string]$DshCli = '',
    [string]$RepoRoot = '',
    [string]$TempHome = '',
    [string]$ProfileName = 'verify-install',
    [int]$StartupTimeoutSec = 120,
    [switch]$KeepTempHome
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:Failures = [System.Collections.Generic.List[string]]::new()
$script:Checks = 0
$script:ServerProcess = $null
$script:OriginalDshHome = $env:DSH_HOME

# Resolve the dsh CLI when the caller did not name one: explicit env var, then the
# DSH Desktop bundled CLI in common install locations, then `dsh` on PATH.
if ([string]::IsNullOrWhiteSpace($DshCli)) {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:DSH_CLI)) { $candidates += $env:DSH_CLI }
    $candidates += @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeekHarness\resources\runtime\cli\bin\dsh.cmd'),
        (Join-Path $env:ProgramFiles 'DeepSeekHarness\resources\runtime\cli\bin\dsh.cmd'),
        'D:\Software\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd'
    )
    $dshOnPath = Get-Command dsh -ErrorAction SilentlyContinue
    if ($null -ne $dshOnPath) { $candidates += $dshOnPath.Source }
    $resolvedCli = $candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($null -eq $resolvedCli) {
        throw 'dsh CLI not found: pass -DshCli <path to dsh.cmd>, or set DSH_CLI, or put dsh on PATH'
    }
    $DshCli = $resolvedCli
}

function Write-Step([string]$Message) { Write-Host ''; Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Pass([string]$Message) { $script:Checks++; Write-Host "  PASS  $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { $script:Checks++; $script:Failures.Add($Message); Write-Host "  FAIL  $Message" -ForegroundColor Red }
function Test-Check([bool]$Condition, [string]$Message, [string]$Detail = '') {
    if ($Condition) { Write-Pass $Message } else { Write-Fail ($Message + $(if ($Detail) { " :: $Detail" } else { '' })) }
}
function Write-Evidence([string]$Title, [string]$Text) {
    Write-Host "  -- $Title" -ForegroundColor DarkGray
    ($Text -split "`r?`n" | Select-Object -First 12) | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
}

function Invoke-Dsh {
    param([string[]]$Arguments, [string]$Label)
    $output = & $DshCli @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Evidence "$Label (exit $code)" $output
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Stop-ServerProcess {
    if ($null -eq $script:ServerProcess) { return }
    try {
        if (-not $script:ServerProcess.HasExited) {
            if ($IsWindows -or $env:OS -eq 'Windows_NT') {
                & taskkill.exe /PID $script:ServerProcess.Id /T /F 2>&1 | Out-Null
            }
            if (-not $script:ServerProcess.HasExited) { Stop-Process -Id $script:ServerProcess.Id -Force -ErrorAction SilentlyContinue }
        }
    } catch {
        Write-Host "  WARN  stop web server: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        $script:ServerProcess = $null
    }
}

function Get-PluginDirectories([string]$Root) {
    $dirs = @()
    foreach ($entry in Get-ChildItem -LiteralPath $Root -Directory | Sort-Object Name) {
        $manifestPath = Join-Path $entry.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        } catch {
            throw "invalid package.json in $($entry.Name): $($_.Exception.Message)"
        }
        if ($null -ne $manifest.dsh -and $null -ne $manifest.dsh.bundle) { $dirs += $entry }
    }
    return $dirs
}

# ---------------------------------------------------------------------------
# 0. 准备：参数、临时目录、只允许清理自己的目录
# ---------------------------------------------------------------------------
try {
    if (-not (Test-Path -LiteralPath $DshCli)) { throw "dsh CLI not found: $DshCli" }
    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        $RepoRoot = Split-Path -Parent $PSScriptRoot
    }
    if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "repository root not found: $RepoRoot" }
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

    $plugins = Get-PluginDirectories $RepoRoot
    if ($plugins.Count -eq 0) { throw "no DSH plugin directories found under $RepoRoot" }

    if ([string]::IsNullOrWhiteSpace($TempHome)) {
        $TempHome = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-plugins-verify-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    } else {
        $TempHome = [System.IO.Path]::GetFullPath($TempHome)
    }
    $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $underSystemTemp = $TempHome.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase)
    $underDotDshTmp = $TempHome -match '(?i)[\\/]\.dsh-tmp[\\/]'
    $ownLeafName = (Split-Path -Leaf $TempHome) -match '(?i)^(?:dsh-plugins-)?verify[-_][A-Za-z0-9._-]*$'
    if (-not ($underSystemTemp -or $underDotDshTmp -or $ownLeafName)) {
        throw "refusing to wipe TempHome outside a temp location: $TempHome (pass a fresh path under `$env:TEMP or a .dsh-tmp directory)"
    }
    if (Test-Path -LiteralPath $TempHome) {
        # Guard against a typo pointing at a real DSH home or the active profile directory.
        $realHomes = @()
        if ($env:USERPROFILE) { $realHomes += (Join-Path $env:USERPROFILE '.dsh') }
        if ($script:OriginalDshHome) { $realHomes += $script:OriginalDshHome }
        foreach ($realHome in $realHomes) {
            if ($realHome -and ($TempHome.TrimEnd('\') -eq $realHome.TrimEnd('\'))) { throw "refusing to wipe a real DSH_HOME: $TempHome" }
        }
        Remove-Item -LiteralPath $TempHome -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TempHome -Force | Out-Null
    $logDir = Join-Path $TempHome 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null

    $env:DSH_HOME = $TempHome
    Write-Step "Environment"
    Write-Host "  repo:        $RepoRoot"
    Write-Host "  dsh CLI:     $DshCli"
    Write-Host "  DSH_HOME:    $TempHome (isolated; real home untouched)"
    Write-Host "  profile:     $ProfileName"
    Write-Host "  plugins:     $($plugins.Count) -> $($plugins.Name -join ', ')"

    $version = Invoke-Dsh @('-V') 'dsh -V'
    Test-Check ($version.ExitCode -eq 0) 'dsh CLI runs' $(if ($version.ExitCode -ne 0) { "exit $($version.ExitCode)" } else { '' })
    $cliVersion = ($version.Output -replace "`r?`n", '').Trim()
    Write-Host "  dsh version: $cliVersion"

    # -----------------------------------------------------------------------
    # 1. 创建临时 profile
    # -----------------------------------------------------------------------
    Write-Step "Create isolated profile '$ProfileName' from the shipped web template"
    $create = Invoke-Dsh @('--profile', $ProfileName, '--from-default-profile', 'web', '--dump-config') "create profile"
    Test-Check ($create.ExitCode -eq 0) 'profile created' "exit $($create.ExitCode)"
    if ($create.ExitCode -ne 0) { throw 'cannot create the temporary profile; see output above' }
    $profileDir = Join-Path $TempHome "profiles/$ProfileName"
    Test-Check (Test-Path -LiteralPath (Join-Path $profileDir 'package.json')) 'profile directory exists inside TempHome'

    # -----------------------------------------------------------------------
    # 2. 逐个安装插件
    # -----------------------------------------------------------------------
    $installResults = @()
    foreach ($plugin in $plugins) {
        $manifest = Get-Content -LiteralPath (Join-Path $plugin.FullName 'package.json') -Raw | ConvertFrom-Json
        $packageName = $manifest.name
        $patchFile = Join-Path $plugin.FullName ([string]$manifest.dsh.bundle.patch)
        $patchId = $null
        if (Test-Path -LiteralPath $patchFile) {
            $patchText = Get-Content -LiteralPath $patchFile -Raw
            $idMatch = [regex]::Match($patchText, '(?m)^\s*-\s*id:\s*([A-Za-z0-9_.-]+)\s*$')
            if ($idMatch.Success) { $patchId = $idMatch.Groups[1].Value }
        }
        Write-Step "Install $packageName ($($plugin.Name))"
        $add = Invoke-Dsh @('plugin', '--profile', $ProfileName, 'add', "link:$($plugin.FullName)") "dsh plugin add $($plugin.Name)"
        $installed = ($add.ExitCode -eq 0) -and $add.Output.Contains($packageName)
        Test-Check $installed "installed ($packageName)" $(if (-not $installed) { "exit $($add.ExitCode)" } else { '' })
        Write-Evidence "dsh plugin add output (tail)" (($add.Output -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Last 6) -join "`n")
        $installResults += [pscustomobject]@{
            Directory   = $plugin.Name
            PackageName = $packageName
            PatchId     = $patchId
            Installed   = $installed
        }
    }

    # -----------------------------------------------------------------------
    # 3. profile 清单 + 组合后的配置树
    # -----------------------------------------------------------------------
    Write-Step 'Assert profile manifest records every plugin bundle'
    $profileManifest = Get-Content -LiteralPath (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
    $bundles = @($profileManifest.dsh.profile.bundles)
    foreach ($result in $installResults) {
        Test-Check ($bundles -contains $result.PackageName) "dsh.profile.bundles contains $($result.PackageName)"
        Test-Check ($null -ne $profileManifest.dependencies.$($result.PackageName)) "profile dependency recorded for $($result.PackageName)"
    }

    Write-Step 'Assert the composed config tree inserts every plugin row'
    $dump = Invoke-Dsh @('--profile', $ProfileName, '--dump-config') 'dump-config'
    $dumpFile = Join-Path $logDir 'dump-config.txt'
    $dump.Output | Set-Content -LiteralPath $dumpFile -Encoding utf8
    Test-Check ($dump.ExitCode -eq 0) 'dump-config succeeds' "exit $($dump.ExitCode)"
    foreach ($result in $installResults) {
        if ($null -eq $result.PatchId) {
            Write-Fail "no patch row id found in $($result.Directory)/cordis.patch.yml"
            continue
        }
        $rowPattern = "(?m)^-\s*id:\s*" + [regex]::Escape($result.PatchId) + "\s*`r?`n\s*name:\s*'" + [regex]::Escape($result.PackageName) + "'\s*$"
        $hasRow = $dump.Output -match $rowPattern
        Test-Check $hasRow "composed config has row id=$($result.PatchId) name=$($result.PackageName)"
    }

    # -----------------------------------------------------------------------
    # 4. 启动 Web 服务并断言 client bundle 由 /plugins 路由提供
    # -----------------------------------------------------------------------
    Write-Step 'Start the isolated Web server (dsh --port 0 --no-open)'
    $serverOut = Join-Path $logDir 'web-server.log'
    $serverErr = Join-Path $logDir 'web-server.err.log'
    $startArgs = @('--profile', $ProfileName, '--port', '0', '--no-open')
    $script:ServerProcess = Start-Process -FilePath $DshCli -ArgumentList $startArgs -PassThru -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -NoNewWindow
    $baseUrl = $null
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $serverLog = ''
        if (Test-Path -LiteralPath $serverOut) { $serverLog += (Get-Content -LiteralPath $serverOut -Raw -ErrorAction SilentlyContinue) }
        if (Test-Path -LiteralPath $serverErr) { $serverLog += (Get-Content -LiteralPath $serverErr -Raw -ErrorAction SilentlyContinue) }
        $urlMatch = [regex]::Match($serverLog, 'https?://[^\s"'']+')
        if ($urlMatch.Success) { $baseUrl = $urlMatch.Value.TrimEnd('/'); break }
        if ($script:ServerProcess.HasExited) { break }
    }
    Test-Check (-not $script:ServerProcess.HasExited) 'web server process stays up' $(if ($script:ServerProcess.HasExited) { "exited with $($script:ServerProcess.ExitCode)" } else { '' })
    Test-Check ($null -ne $baseUrl) "web server printed its URL" $(if ($null -eq $baseUrl) { "no URL within ${StartupTimeoutSec}s" } else { '' })
    if ($null -eq $baseUrl) { throw 'web server did not start; cannot verify client bundles' }
    # The printed URL carries the auth token in its query; the client bundle routes live under its origin.
    $baseUri = [uri]$baseUrl
    $origin = "$($baseUri.Scheme)://$($baseUri.Authority)"
    Write-Host "  url:         $origin/?token=<redacted>"

    $session = $null
    $html = $null
    foreach ($attempt in 1..30) {
        try {
            $html = (Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 20 -SessionVariable session).Content
            if ($html.Length -gt 1000) { break }
        } catch {
            if ($attempt -eq 30) { throw "GET $baseUrl failed: $($_.Exception.Message)" }
            Start-Sleep -Seconds 1
        }
    }
    Test-Check ($null -ne $html -and $html.Length -gt 1000) 'GET / returns the Web UI HTML'

    foreach ($result in $installResults) {
        $htmlHasPlugin = $html -match ('@local/' + [regex]::Escape($result.Directory))
        Test-Check $htmlHasPlugin "HTML __DSH_BOOT__ lists @local/$($result.Directory)"

        $revMatch = [regex]::Match($html, '"id":"@local/' + [regex]::Escape($result.Directory) + '","url":"plugins/\?\?@local/' + [regex]::Escape($result.Directory) + '/client\.js&rev=([0-9a-f]+)"')
        if (-not $revMatch.Success) {
            Write-Fail "no client module URL/rev found for @local/$($result.Directory)"
            continue
        }
        $clientUrl = "$origin/plugins/??@local/$($result.Directory)/client.js&rev=$($revMatch.Groups[1].Value)"
        $status = 'ERR'
        $length = 0
        $body = ''
        try {
            $response = Invoke-WebRequest -Uri $clientUrl -UseBasicParsing -TimeoutSec 20 -WebSession $session
            $status = [int]$response.StatusCode
            $length = $response.RawContentLength
            # Use the raw byte stream so no charset rewriting happens.
            $body = $response.Content
        } catch {
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        }
        $served = ($status -eq 200) -and ($length -gt 1000) -and ($body -match 'sourceMappingURL|@local/' + [regex]::Escape($result.Directory))
        Test-Check $served "client bundle served for @local/$($result.Directory) (status=$status bytes=$length)"

        $localFile = Join-Path (Join-Path $RepoRoot $result.Directory) 'client.js'
        $localSize = (Get-Item -LiteralPath $localFile).Length
        $sizeMatch = ($status -eq 200) -and ($length -ge $localSize) -and (($length - $localSize) -lt 4096)
        Test-Check $sizeMatch "served bundle matches client.js size (served=$length local=$localSize)"
    }

    # 未知插件必须不被提供（路由确实按已安装模块工作）。
    try {
        $control = Invoke-WebRequest -Uri "$origin/plugins/??@local/dsh-does-not-exist/client.js&rev=0" -UseBasicParsing -TimeoutSec 10 -WebSession $session
        $controlStatus = [int]$control.StatusCode
    } catch {
        $controlStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'ERR' }
    }
    Test-Check ($controlStatus -ne 200) "unknown plugin client bundle is not served (status=$controlStatus)"

    # 服务端输出不应包含加载失败。
    $serverText = ''
    if (Test-Path -LiteralPath $serverOut) { $serverText += (Get-Content -LiteralPath $serverOut -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path -LiteralPath $serverErr) { $serverText += (Get-Content -LiteralPath $serverErr -Raw -ErrorAction SilentlyContinue) }
    $serverText | Set-Content -LiteralPath (Join-Path $logDir 'web-server-combined.log') -Encoding utf8
    $loadErrors = @($serverText -split "`r?`n" | Where-Object { $_ -match '(?i)(error|failed|cannot|exception|ENOENT)' -and $_ -notmatch '(?i)0 error' })
    Test-Check ($loadErrors.Count -eq 0) 'web server log has no load errors' (($loadErrors | Select-Object -First 3) -join ' | ')
}
catch {
    $script:Failures.Add("fatal: $($_.Exception.Message)")
    Write-Host "FATAL  $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    Write-Step 'Cleanup'
    Stop-ServerProcess
    Write-Host '  web server stopped'
    if ($script:OriginalDshHome) { $env:DSH_HOME = $script:OriginalDshHome } else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
    # Give file handles a moment, then remove the temporary home unless kept.
    Start-Sleep -Milliseconds 300
    if ($KeepTempHome) {
        Write-Host "  kept temp DSH_HOME: $TempHome"
    } elseif (Test-Path -LiteralPath $TempHome) {
        try { Remove-Item -LiteralPath $TempHome -Recurse -Force } catch { Write-Host "  WARN  could not remove $TempHome : $($_.Exception.Message)" -ForegroundColor Yellow }
        Write-Host '  temp DSH_HOME removed'
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host ('=' * 72)
Write-Host "verify-install: $script:Checks checks, $($script:Failures.Count) failure(s)"
if ($script:Failures.Count -gt 0) {
    foreach ($failure in $script:Failures) { Write-Host "FAIL  $failure" -ForegroundColor Red }
    Write-Host 'verify-install: FAILED' -ForegroundColor Red
    exit 1
}
Write-Host 'verify-install: OK - every plugin installed, composed and served its client bundle' -ForegroundColor Green
exit 0
