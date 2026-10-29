#Requires -Version 5.1
<#
.SYNOPSIS
  Guarda espacio en C: borrando sólo artefactos regenerables del workspace Bara.

.DESCRIPTION
  -Analizar (defecto): tabla de rutas, tamaño y si es seguro borrar.
  -Limpiar: borra incremental → target\debug → npm cache → cargo registry\cache
            → TEMP (>2 días) hasta alcanzar -MinGB libres en C:.

  NUNCA toca: código fuente, .git, target\release\bundle, AppData\Local\Bara IDE,
  llavero, D:\, keystore-backup, Documents, Downloads (salvo target del workspace).
#>
[CmdletBinding(DefaultParameterSetName = "Analizar")]
param(
    [Parameter(ParameterSetName = "Analizar")]
    [switch] $Analizar,

    [Parameter(ParameterSetName = "Limpiar")]
    [switch] $Limpiar,

    [Parameter(ParameterSetName = "Limpiar")]
    [ValidateRange(1, 500)]
    [double] $MinGB = 10,

    # Raíz del workspace Cargo (padre de BAR + bara-ide). Si vacío, se detecta.
    [string] $WorkspaceRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Limpiar -and -not $Analizar) {
    $Analizar = $true
}

function Get-FreeGB {
    $drive = Get-PSDrive -Name C -ErrorAction Stop
    return [math]::Round(($drive.Free / 1GB), 2)
}

function Get-DirSizeBytes {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return [int64]0
    }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return [int64]0
    }
    if (-not $item.PSIsContainer) {
        return [int64]$item.Length
    }
    # Sumar archivos; ignorar errores de acceso.
    $sum = [int64]0
    Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
        ForEach-Object { $sum += $_.Length }
    return $sum
}

function Format-Size {
    param([int64] $Bytes)
    if ($Bytes -ge 1GB) { return ("{0:N2} GB" -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ("{0:N1} MB" -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ("{0:N0} KB" -f ($Bytes / 1KB)) }
    return ("{0} B" -f $Bytes)
}

function Resolve-WorkspaceRoot {
    param([string] $Hint)
    if ($Hint -and (Test-Path -LiteralPath (Join-Path $Hint "Cargo.toml"))) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $here = $PSScriptRoot
    # scripts/ → bara-ide/ → Downloads/
    $candidates = @(
        (Join-Path $here "..\.."),
        (Join-Path $here ".."),
        (Get-Location).Path
    )
    foreach ($c in $candidates) {
        $full = [System.IO.Path]::GetFullPath($c)
        $cargo = Join-Path $full "Cargo.toml"
        if (Test-Path -LiteralPath $cargo) {
            $text = Get-Content -LiteralPath $cargo -Raw -ErrorAction SilentlyContinue
            if ($text -match '\[workspace\]') {
                return $full
            }
        }
    }
    # Fallback: padre de bara-ide
    return [System.IO.Path]::GetFullPath((Join-Path $here "..\.."))
}

function Assert-NotDriveD {
    param([string] $Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full -match '^[Dd]:') {
        throw "RECHAZADO: disk-guard no opera en D: ($full)."
    }
}

function Remove-TreeSafe {
    param(
        [string] $Path,
        [string] $Label
    )
    Assert-NotDriveD $Path
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host "  (omitido, no existe) $Label"
        return [int64]0
    }
    $before = Get-DirSizeBytes $Path
    Write-Host ("  borrando {0} ({1})…" -f $Label, (Format-Size $before))
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    } catch {
        # Reintento: archivos bloqueados
        Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
            Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $Path) {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $after = Get-DirSizeBytes $Path
    $freed = [math]::Max([int64]0, $before - $after)
    Write-Host ("  liberado ~{0}" -f (Format-Size $freed))
    return $freed
}

function Clear-OldTempFiles {
    param([string] $TempPath)
    Assert-NotDriveD $TempPath
    if (-not (Test-Path -LiteralPath $TempPath)) {
        return [int64]0
    }
    $cutoff = (Get-Date).AddDays(-2)
    $freed = [int64]0
    Get-ChildItem -LiteralPath $TempPath -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            $size = if ($_.PSIsContainer) { Get-DirSizeBytes $_.FullName } else { [int64]$_.Length }
            try {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
                $freed += $size
            } catch {
                # ignorar bloqueados
            }
        }
    return $freed
}

# ─── Rutas ───────────────────────────────────────────────────────────────
$ws = Resolve-WorkspaceRoot $WorkspaceRoot
Assert-NotDriveD $ws

$target = Join-Path $ws "target"
$paths = [ordered]@{
    "C: libre"                     = $null
    "target\debug"                 = (Join-Path $target "debug")
    "target\debug\incremental"     = (Join-Path $target "debug\incremental")
    "target\release (sin bundle)"  = (Join-Path $target "release")
    "target\release\bundle"        = (Join-Path $target "release\bundle")
    "npm-cache"                    = (Join-Path $env:LOCALAPPDATA "npm-cache")
    "cargo registry\cache"         = (Join-Path $env:USERPROFILE ".cargo\registry\cache")
    "web\node_modules\.vite"       = (Join-Path $PSScriptRoot "..\web\node_modules\.vite")
    "TEMP usuario"                 = [System.IO.Path]::GetTempPath().TrimEnd('\')
}

# Tamaño de release sin bundle: suma release menos bundle
function Get-ReleaseSansBundleBytes {
    $rel = Join-Path $target "release"
    $bun = Join-Path $target "release\bundle"
    $total = Get-DirSizeBytes $rel
    $bundle = Get-DirSizeBytes $bun
    return [math]::Max([int64]0, $total - $bundle)
}

Write-Host ""
Write-Host ("disk-guard · workspace: {0}" -f $ws)
Write-Host ("Espacio libre en C: {0} GB" -f (Get-FreeGB))
Write-Host ""

$rows = @()
foreach ($name in $paths.Keys) {
    if ($name -eq "C: libre") {
        $rows += [pscustomobject]@{
            Ruta           = "C:\"
            Tamano         = ("{0} GB libres" -f (Get-FreeGB))
            Bytes          = [int64]0
            SeguroBorrar   = "no (sistema)"
        }
        continue
    }
    $p = $paths[$name]
    $p = [System.IO.Path]::GetFullPath($p)
    Assert-NotDriveD $p
    if ($name -eq "target\release (sin bundle)") {
        $bytes = Get-ReleaseSansBundleBytes
    } else {
        $bytes = Get-DirSizeBytes $p
    }
    $safe = switch -Wildcard ($name) {
        "target\debug\incremental" { "sí" }
        "target\debug" { "sí" }
        "npm-cache" { "sí" }
        "cargo registry\cache" { "sí" }
        "TEMP usuario" { "sí (solo >2 días)" }
        "web\node_modules\.vite" { "sí (regenerable)" }
        "target\release\bundle" { "NO (instaladores)" }
        "target\release (sin bundle)" { "NO por defecto (rebuild caro)" }
        default { "no" }
    }
    $rows += [pscustomobject]@{
        Ruta         = $p
        Tamano       = (Format-Size $bytes)
        Bytes        = $bytes
        SeguroBorrar = $safe
    }
}

$rows | Select-Object Ruta, Tamano, SeguroBorrar | Format-Table -AutoSize | Out-String | Write-Host

if ($Analizar -and -not $Limpiar) {
    Write-Host "Modo -Analizar: no se ha borrado nada."
    exit 0
}

# ─── Limpieza ────────────────────────────────────────────────────────────
$freeBefore = Get-FreeGB
Write-Host ("Limpiar hasta ≥ {0} GB libres (ahora {1} GB)…" -f $MinGB, $freeBefore)
$totalFreed = [int64]0

function Enough {
    return ((Get-FreeGB) -ge $MinGB)
}

# 1. incremental
if (-not (Enough)) {
    $totalFreed += Remove-TreeSafe (Join-Path $target "debug\incremental") "target\debug\incremental"
}
# 2. target\debug completo
if (-not (Enough)) {
    $totalFreed += Remove-TreeSafe (Join-Path $target "debug") "target\debug"
}
# 3. npm cache
if (-not (Enough)) {
    Write-Host "  npm cache clean --force…"
    try {
        $npmBefore = Get-DirSizeBytes (Join-Path $env:LOCALAPPDATA "npm-cache")
        & npm cache clean --force 2>$null | Out-Null
        $npmAfter = Get-DirSizeBytes (Join-Path $env:LOCALAPPDATA "npm-cache")
        $delta = [math]::Max([int64]0, $npmBefore - $npmAfter)
        $totalFreed += $delta
        Write-Host ("  liberado ~{0}" -f (Format-Size $delta))
    } catch {
        Write-Host "  (npm cache clean falló; se continúa)"
    }
}
# 4. cargo registry cache
if (-not (Enough)) {
    $totalFreed += Remove-TreeSafe (Join-Path $env:USERPROFILE ".cargo\registry\cache") "cargo registry\cache"
}
# 5. TEMP > 2 días
if (-not (Enough)) {
    $temp = [System.IO.Path]::GetTempPath().TrimEnd('\')
    Write-Host "  TEMP usuario (archivos/carpetas >2 días)…"
    $t = Clear-OldTempFiles $temp
    $totalFreed += $t
    Write-Host ("  liberado ~{0}" -f (Format-Size $t))
}

$freeAfter = Get-FreeGB
Write-Host ""
Write-Host ("Liberado estimado: {0}" -f (Format-Size $totalFreed))
Write-Host ("Espacio libre final en C: {0} GB (antes {1} GB)" -f $freeAfter, $freeBefore)

if ($freeAfter -lt $MinGB) {
    Write-Host ""
    Write-Host ("ERROR: tras limpiar quedan {0} GB libres; se necesitan al menos {1} GB." -f $freeAfter, $MinGB) -ForegroundColor Red
    Write-Host "Libera más espacio a mano (no se tocan instaladores ni la app) o baja -MinGB." -ForegroundColor Red
    exit 1
}

Write-Host "OK: espacio suficiente para continuar." -ForegroundColor Green
exit 0
