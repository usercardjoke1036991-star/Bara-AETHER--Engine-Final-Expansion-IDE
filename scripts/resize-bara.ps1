Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinMove {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process bara-ide-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Write-Error "bara-ide-desktop no está en ejecución"
  exit 1
}
[void][WinMove]::ShowWindow($proc.MainWindowHandle, 9)
[void][WinMove]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, 40, 20, 1280, 720, 0x0040)
Write-Host "ventana en 1280x720"
