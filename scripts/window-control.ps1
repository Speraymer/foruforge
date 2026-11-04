param(
    [ValidateSet('frame','focus','minimize','close','drag')][string]$Action,
    [int]$ProcessId,
    [long]$Handle = 0,
    [string]$Title = '项目约束'
)

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CanvasWindow {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, uint attr, ref int value, uint size);
}
'@

$window = [IntPtr]::Zero
if ($Handle) {
    $window = [IntPtr]::new($Handle)
} else {
    for ($try = 0; $try -lt 100 -and $window -eq [IntPtr]::Zero; $try++) {
        $callback = [CanvasWindow+EnumProc] {
            param($h, $l)
            $pidValue = [uint32]0
            [CanvasWindow]::GetWindowThreadProcessId($h, [ref]$pidValue) | Out-Null
            if ($pidValue -eq $ProcessId -and [CanvasWindow]::IsWindowVisible($h)) {
                $buf = [Text.StringBuilder]::new(256)
                [CanvasWindow]::GetWindowText($h, $buf, 256) | Out-Null
                if ($buf.ToString().StartsWith($Title, [StringComparison]::Ordinal)) { $script:window = $h; return $false }
            }
            return $true
        }
        [CanvasWindow]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
        if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 120 }
    }
}
if ($window -eq [IntPtr]::Zero) { throw '应用窗口未出现' }
$ownerPid = [uint32]0
[CanvasWindow]::GetWindowThreadProcessId($window, [ref]$ownerPid) | Out-Null
$nameBuf = [Text.StringBuilder]::new(256)
[CanvasWindow]::GetWindowText($window, $nameBuf, 256) | Out-Null
if ($ownerPid -ne $ProcessId -or -not $nameBuf.ToString().StartsWith($Title, [StringComparison]::Ordinal)) { throw '窗口所有者或标题不匹配' }

switch ($Action) {
    'frame' {
        $style = [CanvasWindow]::GetWindowLongPtr($window, -16).ToInt64()
        $newStyle = $style -band (-bnot [long]0x00C40000)
        [CanvasWindow]::SetWindowLongPtr($window, -16, [IntPtr]::new($newStyle)) | Out-Null
        if (-not [CanvasWindow]::SetWindowPos($window, [IntPtr]::Zero, 0, 0, 0, 0, 0x27)) { throw '无边框设置失败' }
        $rounded = 2
        [CanvasWindow]::DwmSetWindowAttribute($window, 33, [ref]$rounded, 4) | Out-Null
        @{ pid = $ProcessId; handle = $window.ToInt64(); title = $nameBuf.ToString(); style = $newStyle } | ConvertTo-Json -Compress
    }
    'minimize' { [CanvasWindow]::ShowWindow($window, 6) | Out-Null }
    'focus' { [CanvasWindow]::ShowWindow($window, 9) | Out-Null; [CanvasWindow]::SetForegroundWindow($window) | Out-Null }
    'close' { if (-not [CanvasWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw '关闭窗口失败' } }
    'drag' { if (-not [CanvasWindow]::PostMessage($window, 0x00A1, [IntPtr]::new(2), [IntPtr]::Zero)) { throw '拖动窗口失败' } }
}
