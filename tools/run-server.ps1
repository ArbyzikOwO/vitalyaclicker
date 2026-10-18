# =====================================================================
#  VitalyaClicker — запуск сервера + туннеля cloudflared (Windows)
#
#  Что делает:
#    1) запускает игровой сервер (node server/server.js);
#    2) поднимает туннель: cloudflared tunnel --url http://127.0.0.1:<порт>;
#    3) вытаскивает публичный адрес и пишет его в tools\server.txt;
#    4) если заданы GITHUB_REPO и GH_TOKEN — публикует server.txt в репозиторий;
#    5) каждые N часов (по умолчанию 6) перезапускает туннель и обновляет адрес.
#
#  Запуск:  run-server.cmd            (или напрямую этот файл в PowerShell)
#  Параметры: -Port 3000 -RestartHours 6 -NoTunnel -NoPublish
#  server.txt публикуется в GitHub, если заданы токен и репозиторий
#  (см. tools\gh.config.json). Отключить: -NoPublish
# =====================================================================
param(
  [int]$Port = 3000,
  [int]$RestartHours = 6,
  [string]$Cloudflared = "",
  [switch]$NoTunnel,
  [switch]$NoPublish
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$toolsDir  = $PSScriptRoot
$root      = Split-Path -Parent $toolsDir
$logDir    = Join-Path $toolsDir 'logs'
$serverTxt = Join-Path $toolsDir 'server.txt'
$srvOut    = Join-Path $logDir 'server.log'
$srvErr    = Join-Path $logDir 'server.err.log'
$cfOut     = Join-Path $logDir 'cloudflared.log'
$cfErr     = Join-Path $logDir 'cloudflared.err.log'

New-Item -ItemType Directory -Force $logDir | Out-Null

function Log($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }

function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  throw 'Node.js не найден. Установите Node или добавьте его в PATH.'
}

function Find-Cloudflared {
  if ($Cloudflared) { if (Test-Path $Cloudflared) { return $Cloudflared } else { throw "cloudflared не найден: $Cloudflared" } }
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $local = Join-Path $toolsDir 'cloudflared.exe'
  if (Test-Path $local) { return $local }
  Log 'cloudflared не найден — скачиваю последнюю версию...'
  Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $local
  Log "cloudflared скачан: $local"
  return $local
}

function Stop-Quiet($p) {
  if ($p) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } catch {} }
}

function Wait-Http($url, $seconds) {
  for ($i = 0; $i -lt ($seconds * 2); $i++) {
    try { Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null; return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

function Write-ServerTxt($url) {
  Set-Content -Path $serverTxt -Value $url -Encoding ASCII -NoNewline
  Log "адрес записан в $serverTxt"
}

function Get-GhConfig {
  $f = Join-Path $toolsDir 'gh.config.json'
  if (Test-Path $f) { try { return (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null } }
  return $null
}

function Publish-ServerTxt($url) {
  $cfg = Get-GhConfig
  $token = if ($env:GH_TOKEN) { $env:GH_TOKEN } elseif ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } elseif ($cfg) { $cfg.token } else { '' }
  $repo = if ($env:GITHUB_REPO) { $env:GITHUB_REPO } elseif ($cfg) { $cfg.repo } else { '' }
  if (-not $token -or -not $repo) { Log 'публикация server.txt пропущена: нет токена/репозитория'; return }
  $api = "https://api.github.com/repos/$repo/contents/server.txt"
  $headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'VitalyaClicker'; Accept = 'application/vnd.github+json' }
  $sha = $null
  try { $sha = (Invoke-RestMethod -Uri $api -Headers $headers -Method Get -TimeoutSec 15).sha } catch {}
  $body = @{
    message = "server: обновлён адрес туннеля"
    content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($url + "`n"))
  }
  if ($sha) { $body['sha'] = $sha }
  try {
    Invoke-RestMethod -Uri $api -Headers $headers -Method Put -Body ($body | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 20 | Out-Null
    Log "server.txt опубликован в GitHub ($repo)"
  } catch { Log ('публикация не удалась: ' + $_.Exception.Message) }
}

# ------------------------------------------------------------------ старт
$node = Find-Node
Log "Node: $node"
Log "Игра: $root"

Log 'запускаю игровой сервер...'
$env:PORT = "$Port"
$nodeProc = Start-Process -FilePath $node -ArgumentList 'server/server.js' -WorkingDirectory $root -PassThru `
  -RedirectStandardOutput $srvOut -RedirectStandardError $srvErr -WindowStyle Hidden

if (-not (Wait-Http "http://127.0.0.1:$Port/api/ping" 30)) {
  Log 'сервер не ответил за 30 секунд — смотрите tools\logs\server.err.log'
  Stop-Quiet $nodeProc
  exit 1
}
Log "сервер работает: http://127.0.0.1:$Port"

$tunnelProc = $null
try {
  if ($NoTunnel) {
    Log 'туннель отключён (-NoTunnel): игра доступна только локально'
    while ($true) { Start-Sleep -Seconds 3600 }
  }

  $cf = Find-Cloudflared
  Log "cloudflared: $cf"

  while ($true) {
    Remove-Item $cfOut, $cfErr -Force -ErrorAction SilentlyContinue
    Log 'поднимаю туннель...'
    $tunnelProc = Start-Process -FilePath $cf -PassThru -WindowStyle Hidden `
      -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port") `
      -RedirectStandardOutput $cfOut -RedirectStandardError $cfErr

    $url = $null
    for ($i = 0; $i -lt 120; $i++) {
      Start-Sleep -Milliseconds 500
      foreach ($f in @($cfErr, $cfOut)) {
        if (Test-Path $f) {
          $m = Select-String -Path $f -Pattern 'https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue |
               Select-Object -First 1
          if ($m) { $url = $m.Matches[0].Value; break }
        }
      }
      if ($url) { break }
      if ($tunnelProc.HasExited) { break }
    }

    if (-not $url) {
      Log 'не удалось получить публичный адрес (смотрите tools\logs\cloudflared.err.log) — повтор через 30 с'
      Stop-Quiet $tunnelProc
      Start-Sleep -Seconds 30
      continue
    }

    Log "публичный адрес: $url"
    Write-ServerTxt $url
    if (-not $NoPublish) { Publish-ServerTxt $url }

    $mins = $RestartHours * 60
    Log "туннель перезапустится через $RestartHours ч ($mins мин)"
    Start-Sleep -Seconds ($RestartHours * 3600)
    Log 'перезапускаю туннель...'
    Stop-Quiet $tunnelProc
    Start-Sleep -Seconds 2
  }
} finally {
  Log 'останавливаю...'
  Stop-Quiet $tunnelProc
  Stop-Quiet $nodeProc
}
