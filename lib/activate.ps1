# dsh-notify activate.ps1 - toast click handler (ASCII only)
# Preferred: raise the installed dsh-desktop-app via the dsh-notify://
# protocol (its single-instance lock re-focuses the running window, or a
# fresh instance is started and handles the deep link on boot). Fallback:
# open the DSH web UI in the default browser when the desktop app is not
# installed / cannot be launched.
# Input: dsh-notify://open/<base64url(url)>

param([string]$Uri)

function ConvertFrom-Base64Url {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return "" }
    try {
        $b64 = $Value.Replace('-', '+').Replace('_', '/')
        $pad = (4 - ($b64.Length % 4)) % 4
        if ($pad -gt 0) { $b64 = $b64 + ('=' * $pad) }
        $bytes = [Convert]::FromBase64String($b64)
        return [Text.Encoding]::UTF8.GetString($bytes)
    } catch { return "" }
}

# Resolve the actual deep-link target (the decoded http URL).
function Get-Target {
    param([string]$Uri)
    if ([string]::IsNullOrEmpty($Uri)) { return $null }
    try {
        $parsed = New-Object System.Uri $Uri
        $segments = @($parsed.AbsolutePath.Split('/') | Where-Object { $_ -ne "" })
        if ($segments.Count -ge 2 -and $segments[0] -eq "open") {
            $decoded = ConvertFrom-Base64Url $segments[1]
            if (-not [string]::IsNullOrEmpty($decoded)) { return $decoded }
        }
    } catch { }
    return $null
}

$target = Get-Target $Uri
if (-not $target) { $target = "http://127.0.0.1:3080" }

# The desktop app owns the dsh-notify:// protocol (registered on install).
# Launching it with the protocol URL raises the existing instance (via the
# single-instance lock) or boots a fresh one that handles the deep link.
$desktopApp = Join-Path $env:LOCALAPPDATA "Programs\dsh-desktop-app\dsh-desktop-app.exe"
if (Test-Path $desktopApp) {
    try {
        # Re-encode the target as a protocol URL so the desktop app decodes it.
        $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($target)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $protocolUrl = "dsh-notify://open/$b64"
        Start-Process -FilePath $desktopApp -ArgumentList $protocolUrl
        exit 0
    } catch { }
}

# Fallback: no desktop app - open the web UI in the default browser.
Start-Process $target
exit 0
