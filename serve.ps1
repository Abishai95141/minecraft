# Static file server for SowmiCraft on Windows, with no Node and no Python.
#
# ES modules will not load over file:// — browsers block them by CORS — so the game
# has to come over HTTP even though it has no build step. This uses HttpListener,
# which ships with .NET, and falls back to a raw TcpListener if the HTTP.SYS
# namespace reservation is unavailable to a non-admin user.
#
#   .\serve.ps1            # http://localhost:8000
#   .\serve.ps1 -Port 9000

[CmdletBinding()]
param(
  [int]$Port = 8000,
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'

# PowerShell 5.1 does not populate $PSScriptRoot while binding parameter defaults,
# so resolve the script's own directory here instead.
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = if ($PSScriptRoot) { $PSScriptRoot }
          elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path }
          else { (Get-Location).Path }
}
$Root = (Resolve-Path -LiteralPath $Root).Path

$MIME = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  # Must be a JavaScript type or the browser refuses the module.
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.map'  = 'application/json'
}

function Get-ContentType([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($MIME.ContainsKey($ext)) { return $MIME[$ext] }
  return 'application/octet-stream'
}

# Resolves a URL path to a file inside $Root, or $null if it escapes the root.
function Resolve-Target([string]$urlPath) {
  $clean = [System.Uri]::UnescapeDataString($urlPath.Split('?')[0])
  $clean = $clean.TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($clean)) { $clean = 'index.html' }
  $full = [System.IO.Path]::GetFullPath((Join-Path $Root $clean))
  # Directory traversal guard.
  if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }
  if (-not (Test-Path $full -PathType Leaf)) { return $null }
  return $full
}

Write-Host ""
Write-Host "  SowmiCraft  ->  http://localhost:$Port/" -ForegroundColor Green
Write-Host "  serving     $Root" -ForegroundColor DarkGray
Write-Host "  Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

# ---------------------------------------------------------------- HttpListener

$listener = $null
try {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$Port/")
  $listener.Start()
} catch {
  Write-Host "  HttpListener unavailable ($($_.Exception.Message.Trim())) - using raw sockets." -ForegroundColor Yellow
  if ($listener) { try { $listener.Close() } catch {} }
  $listener = $null
}

if ($listener) {
  try {
    while ($listener.IsListening) {
      $ctx = $listener.GetContext()
      $req = $ctx.Request
      $res = $ctx.Response
      try {
        # Dev hook: the page POSTs a base64 screenshot here and it lands on disk,
        # which is how the game gets verified visually when the browser pane
        # cannot composite frames.
        if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/__shot') {
          $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
          $b64 = $reader.ReadToEnd()
          $reader.Close()
          $name = $req.QueryString['name']
          if ([string]::IsNullOrWhiteSpace($name)) { $name = 'shot' }
          $name = ($name -replace '[^a-zA-Z0-9_-]', '')
          $shotDir = Join-Path $Root '.shots'
          if (-not (Test-Path $shotDir)) { New-Item -ItemType Directory -Path $shotDir | Out-Null }
          [System.IO.File]::WriteAllBytes((Join-Path $shotDir "$name.jpg"), [Convert]::FromBase64String($b64))
          $bytes = [System.Text.Encoding]::UTF8.GetBytes('ok')
          $res.StatusCode = 200
          $res.ContentType = 'text/plain'
          $res.Headers['Access-Control-Allow-Origin'] = '*'
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          $res.OutputStream.Close()
          continue
        }

        $target = Resolve-Target $req.Url.AbsolutePath
        if ($null -eq $target) {
          $res.StatusCode = 404
          $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $($req.Url.AbsolutePath)")
          $res.ContentType = 'text/plain; charset=utf-8'
        } else {
          $res.StatusCode = 200
          $bytes = [System.IO.File]::ReadAllBytes($target)
          $res.ContentType = Get-ContentType $target
        }
        # No caching: this is a dev loop and stale modules waste a lot of time.
        $res.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch {
        try { $res.StatusCode = 500 } catch {}
      } finally {
        try { $res.OutputStream.Close() } catch {}
      }
    }
  } finally {
    try { $listener.Stop(); $listener.Close() } catch {}
  }
  return
}

# ---------------------------------------------------------------- socket fallback

$tcp = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$tcp.Start()

try {
  while ($true) {
    $client = $tcp.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 5000

      # Read just the request line and headers.
      $sb = New-Object System.Text.StringBuilder
      $buf = New-Object byte[] 1
      $seen = 0
      while ($seen -lt 4) {
        if ($stream.Read($buf, 0, 1) -le 0) { break }
        $ch = [char]$buf[0]
        [void]$sb.Append($ch)
        if (($seen -eq 0 -or $seen -eq 2) -and $ch -eq "`r") { $seen++ }
        elseif (($seen -eq 1 -or $seen -eq 3) -and $ch -eq "`n") { $seen++ }
        else { $seen = 0 }
        if ($sb.Length -gt 16384) { break }
      }

      $head = $sb.ToString()
      $line = ($head -split "`r`n")[0]
      $parts = $line -split ' '
      $urlPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

      $target = Resolve-Target $urlPath
      if ($null -eq $target) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
        $status = '404 Not Found'
        $ctype = 'text/plain; charset=utf-8'
      } else {
        $body = [System.IO.File]::ReadAllBytes($target)
        $status = '200 OK'
        $ctype = Get-ContentType $target
      }

      $header = "HTTP/1.1 $status`r`n" +
                "Content-Type: $ctype`r`n" +
                "Content-Length: $($body.Length)`r`n" +
                "Cache-Control: no-store, no-cache, must-revalidate`r`n" +
                "Connection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($body, 0, $body.Length)
      $stream.Flush()
    } catch {
      # A dropped connection is normal while a page is reloading.
    } finally {
      try { $client.Close() } catch {}
    }
  }
} finally {
  try { $tcp.Stop() } catch {}
}
