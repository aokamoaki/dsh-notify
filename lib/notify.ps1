# dsh-notify notify.ps1 - sound + Windows toast (ASCII only, BOM-free safe)
# Called hidden by the dsh-notify host plugin.
param(
    [string]$Name = "DeepSeek Harness",   # title row: session name (chat-app style)
    [string]$Detail = "",                 # body: event subject (wraps 2 lines max)
    [string]$SoundType = "done",          # done | error | ask | goal
    [double]$Volume = 1.0,                # 0.0 - 1.0 (applies to generated WAV)
    [string]$Tag = "",                    # toast tag: same-session toasts replace each other
    [string]$Url = "http://127.0.0.1:3080",
    [switch]$NoSound,
    [switch]$NoToast
)

$Volume = [Math]::Max(0.0, [Math]::Min(1.0, $Volume))

# ---------- sound ----------
# Generate a short pleasant two-tone "ding-dong" WAV in memory with the
# requested amplitude (real volume control, no audio file needed).
function New-DingDongWav {
    param([double]$Vol, [string]$Path)
    $sampleRate = 44100
    $tones = @(@(620.0, 0.09), @(880.0, 0.16))
    $total = [int](($tones | ForEach-Object { $_[1] }) | Measure-Object -Sum).Sum * $sampleRate
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    $dataLen = $total * 2
    $bw.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $bw.Write([int](36 + $dataLen)); $bw.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
    $bw.Write([Text.Encoding]::ASCII.GetBytes('fmt ')); $bw.Write([int]16)
    $bw.Write([int16]1); $bw.Write([int16]1)
    $bw.Write([int]$sampleRate); $bw.Write([int]($sampleRate * 2))
    $bw.Write([int16]2); $bw.Write([int16]16)
    $bw.Write([Text.Encoding]::ASCII.GetBytes('data')); $bw.Write([int]$dataLen)
    foreach ($tone in $tones) {
        $freq = $tone[0]; $n = [int]($tone[1] * $sampleRate)
        for ($i = 0; $i -lt $n; $i++) {
            $sample = [Math]::Sin(2 * [Math]::PI * $freq * $i / $sampleRate) * $Vol * 32000
            $bw.Write([int16]$sample)
        }
    }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $bw.Dispose(); $ms.Dispose()
}

if (-not $NoSound) {
    try {
        if ($SoundType -eq 'error') {
            [System.Media.SystemSounds]::Hand.Play()
            Start-Sleep -Milliseconds 400
        } elseif ($SoundType -eq 'ask') {
            # "waiting for you" - attention tone, distinct from done/error
            [System.Media.SystemSounds]::Asterisk.Play()
            Start-Sleep -Milliseconds 400
        } else {
            $wav = Join-Path $env:TEMP ("dsh-notify-" + [guid]::NewGuid().ToString('N') + '.wav')
            New-DingDongWav -Vol $Volume -Path $wav
            $player = New-Object System.Media.SoundPlayer $wav
            $player.PlaySync()
            $player.Dispose()
            Remove-Item $wav -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}

# ---------- toast ----------
if (-not $NoToast) {
    try {
        $AUMID = 'DshNotify.Notifier'
        # Distinct shortcut name: the desktop app installer also creates a
        # "DeepSeek Harness.lnk" - overwriting that would hijack the app's own
        # Start Menu entry.
        $lnkName = 'DeepSeek Harness Notify.lnk'
        $lnkPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$lnkName"
        $activateScript = Join-Path $PSScriptRoot 'activate.ps1'

        # Ensure the AUMID is registered via a Start Menu shortcut (unregistered
        # app ids are silently dropped by Windows). The shortcut name is the
        # notification "source" shown in the action center.
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut($lnkPath)
        $sc.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
        $expectedArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $activateScript + '"'
        $icoPath = Join-Path $PSScriptRoot '..\dsh.ico'
        if (Test-Path $icoPath) { $sc.IconLocation = "$icoPath, 0" }
        $needAumid = -not (Test-Path $lnkPath)
        if ($sc.Arguments -ne $expectedArgs) { $sc.Arguments = $expectedArgs; $needAumid = $true }
        $sc.Save()
        if ($needAumid) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshNotifyAumid {
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT {
        public ushort vt;
        public ushort wReserved1, wReserved2, wReserved3;
        public IntPtr pValue;
        public IntPtr pValue2;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PROPERTYKEY pkey);
        void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        void Commit();
    }
    const ushort VT_LPWSTR = 31;
    const int GPS_READWRITE = 0x2;
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string pszPath, IntPtr pbc, int flags, ref Guid riid, out IntPtr ppv);
    public static void Set(string lnkPath, string aumid) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IntPtr ppv;
        int hr = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, GPS_READWRITE, ref iid, out ppv);
        if (hr != 0) throw new COMException("property store open failed 0x" + hr.ToString("X8"));
        IPropertyStore ps = (IPropertyStore)Marshal.GetObjectForIUnknown(ppv);
        PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
        PROPVARIANT pv = new PROPVARIANT();
        pv.vt = VT_LPWSTR;
        pv.pValue = Marshal.StringToCoTaskMemUni(aumid);
        try {
            ps.SetValue(ref key, ref pv);
            ps.Commit();
        } finally {
            Marshal.FreeCoTaskMem(pv.pValue);
            Marshal.Release(ppv);
        }
    }
}
'@ -ErrorAction Stop
            [DshNotifyAumid]::Set($lnkPath, $AUMID)
        }

        # Chat-app style toast: session name as title, event as
        # source (action center) comes from the AUMID shortcut name, so no
        # attribution text is needed. Whole-card click opens the UI.
        $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Url)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $launch = 'dsh-notify://open/' + $b64
        function Esc-Xml([string]$s) { return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;') }
        $nameXml = Esc-Xml $Name
        $detailXml = Esc-Xml $Detail
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $inner = ""
        $inner += "<text hint-maxLines='1'>$nameXml</text>"
        if (-not [string]::IsNullOrEmpty($Detail)) { $inner += "<text hint-maxLines='2'>$detailXml</text>" }
        $xml.LoadXml("<toast launch='$(Esc-Xml $launch)'><visual><binding template='ToastGeneric'>$inner</binding></visual></toast>")
        $toast = New-Object Windows.UI.Notifications.ToastNotification -ArgumentList $xml
        if ($Tag) { $toast.Tag = $Tag; $toast.Group = 'dsh-notify' }
        $appId = if (Test-Path $lnkPath) { $AUMID } else { 'dsh-notify' }
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    } catch { }
}

exit 0
