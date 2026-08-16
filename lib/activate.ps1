# dsh-notify activate.ps1 - toast click handler (ASCII only)
# Opens the DSH web UI in the default browser.
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

if ([string]::IsNullOrEmpty($Uri)) {
    Start-Process "http://127.0.0.1:3080"
    exit 0
}

try {
    $parsed = New-Object System.Uri $Uri
    $segments = @($parsed.AbsolutePath.Split('/') | Where-Object { $_ -ne "" })
    $target = ""
    if ($segments.Count -ge 2 -and $segments[0] -eq "open") {
        $target = ConvertFrom-Base64Url $segments[1]
    }
    # Security: only open http(s) targets pointing at the local DSH web UI. The
    # decoded value reaches Start-Process, so anything else (file paths, other
    # schemes, remote hosts) could be abused by a locally crafted toast.
    $safe = $false
    try {
        if (-not [string]::IsNullOrEmpty($target)) {
            $u = New-Object System.Uri $target
            $safe = ($u.Scheme -eq 'http' -or $u.Scheme -eq 'https') -and
                    ($u.Host -eq '127.0.0.1' -or $u.Host -eq 'localhost' -or $u.Host -eq '::1' -or $u.Host -eq '[::1]')
        }
    } catch { $safe = $false }
    if (-not $safe) { $target = "http://127.0.0.1:3080" }
    Start-Process $target
} catch {
    Start-Process "http://127.0.0.1:3080"
}
exit 0
