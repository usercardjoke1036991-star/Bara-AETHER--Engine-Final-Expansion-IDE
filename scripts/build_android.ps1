<#
.SYNOPSIS
    Compila Bara IDE para Android con el contenedor Gradle de Tauri.

.DESCRIPTION
    Resuelve ANDROID_HOME, NDK_HOME y JAVA_HOME (incluido el NDK roto por un
    junction huerfano), instala los targets Rust que falten, compila el frontend
    y ejecuta Gradle directamente. El BuildTask del contenedor compila la
    biblioteca con Cargo y la copia a jniLibs; no se usa la CLI de Tauri porque
    su enlace simbolico de cargo-mobile2 falla en Windows.

.PARAMETER Profile
    `debug` (por defecto) o `release`.

.PARAMETER Format
    `apk` (por defecto) o `aab` (Google Play).

.PARAMETER Targets
    ABIs de Tauri: aarch64, armv7, i686 y x86_64. Por defecto solo aarch64.
    Para un AAB universal: -Targets aarch64,armv7,i686,x86_64

.PARAMETER Ci
    Se acepta por compatibilidad con CI; Gradle no hace preguntas interactivas.

.EXAMPLE
    .\scripts\build_android.ps1

.EXAMPLE
    .\scripts\build_android.ps1 -Profile release -Format aab -Targets aarch64,armv7
#>
[CmdletBinding()]
param(
    [ValidateSet('debug', 'release')]
    [string]$Profile = 'debug',

    [ValidateSet('apk', 'aab')]
    [string]$Format = 'apk',

    [ValidateSet('aarch64', 'armv7', 'i686', 'x86_64')]
    [string[]]$Targets = @('aarch64'),

    [switch]$Ci
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo

function Get-AndroidSdk {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'platform-tools'))) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw 'No encuentro el Android SDK. Define ANDROID_HOME.'
}

function Get-NdkHome {
    param([Parameter(Mandatory = $true)][string]$Sdk)

    $candidates = @()
    if ($env:NDK_HOME) {
        $candidates += $env:NDK_HOME
    }
    $ndkRoot = Join-Path $Sdk 'ndk'
    if (Test-Path $ndkRoot) {
        $candidates += Get-ChildItem $ndkRoot -Directory |
            Sort-Object Name -Descending |
            ForEach-Object { $_.FullName }
    }

    # Un junction huerfano existe pero no tiene source.properties: se descarta.
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'source.properties')) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw 'No hay un NDK valido. Instala uno con: sdkmanager --install "ndk;27.1.12297006"'
}

function Get-JavaHome {
    $candidates = @(
        $env:JAVA_HOME,
        (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr')
    )

    # Adoptium instala cada JDK en su propia carpeta versionada.
    $adoptium = Join-Path $env:ProgramFiles 'Eclipse Adoptium'
    if (Test-Path $adoptium) {
        $candidates += Get-ChildItem $adoptium -Directory |
            Sort-Object Name -Descending |
            ForEach-Object { $_.FullName }
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'bin\java.exe'))) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw 'No encuentro un JDK 17+. Define JAVA_HOME.'
}

try {
    $sdk = Get-AndroidSdk
    $ndk = Get-NdkHome -Sdk $sdk
    $java = Get-JavaHome

    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $env:ANDROID_NDK_HOME = $ndk
    $env:NDK_HOME = $ndk
    $env:JAVA_HOME = $java
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if (Test-Path $cargoBin) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
    $env:PATH = "$java\bin;$sdk\platform-tools;$env:PATH"

    Write-Host "ANDROID_HOME = $sdk"
    Write-Host "NDK_HOME     = $ndk"
    Write-Host "JAVA_HOME    = $java"

    $rustTargetByAbi = @{
        aarch64 = 'aarch64-linux-android'
        armv7   = 'armv7-linux-androideabi'
        i686    = 'i686-linux-android'
        x86_64  = 'x86_64-linux-android'
    }
    $installed = & rustup target list --installed
    if ($LASTEXITCODE -ne 0) {
        throw 'rustup no esta disponible.'
    }
    foreach ($abi in $Targets) {
        $rustTarget = $rustTargetByAbi[$abi]
        if ($installed -notcontains $rustTarget) {
            Write-Host "Instalando target Rust $rustTarget"
            & rustup target add $rustTarget
            if ($LASTEXITCODE -ne 0) {
                throw "No se pudo instalar $rustTarget"
            }
        }
    }

    $androidProject = Join-Path $repo 'src-tauri\gen\android'
    if (-not (Test-Path $androidProject)) {
        Write-Host 'Generando el contenedor Android (tauri android init)...'
        & npm.cmd run tauri -- android init --ci --skip-targets-install
        if ($LASTEXITCODE -ne 0) {
            throw 'tauri android init fallo.'
        }
    }

    # El contenedor generado trae un BuildTask que delega en la CLI. Se
    # reemplaza por la version directa con Cargo, incluso si Tauri acaba de
    # regenerar src-tauri/gen/android.
    $buildTaskTemplate = Join-Path $repo 'scripts\android\BuildTask.kt'
    $buildTaskTarget = Join-Path $androidProject 'buildSrc\src\main\java\com\aetheromega\bara\ide\kotlin\BuildTask.kt'
    if (-not (Test-Path $buildTaskTemplate)) {
        throw "Falta la plantilla del BuildTask: $buildTaskTemplate"
    }
    $needsPatch = -not (Test-Path $buildTaskTarget) -or
        (Get-FileHash $buildTaskTemplate).Hash -ne (Get-FileHash $buildTaskTarget).Hash
    if ($needsPatch) {
        New-Item -ItemType Directory -Force (Split-Path -Parent $buildTaskTarget) | Out-Null
        Copy-Item $buildTaskTemplate $buildTaskTarget -Force
        Write-Host 'Aplicado BuildTask.kt (Cargo directo) al contenedor Gradle.'
    }

    # La CLI de Tauri crea el enlace simbolico de jniLibs con cargo-mobile2,
    # que falla en Windows sin Developer Mode. El BuildTask parcheado compila
    # Cargo directamente y copia el .so, asi que aqui solo hace falta el
    # frontend y el contenedor Gradle.
    Write-Host 'Compilando el frontend (npm run build)...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build fallo con codigo $LASTEXITCODE."
    }

    $archByAbi = @{
        aarch64 = 'arm64'
        armv7   = 'arm'
        i686    = 'x86'
        x86_64  = 'x86_64'
    }
    $abiFolderByAbi = @{
        aarch64 = 'arm64-v8a'
        armv7   = 'armeabi-v7a'
        i686    = 'x86'
        x86_64  = 'x86_64'
    }
    $profileName = if ($Profile -eq 'debug') { 'Debug' } else { 'Release' }
    $verb = if ($Format -eq 'aab') { 'bundle' } else { 'assemble' }
    $gradleArgs = @('--console=plain')

    if ($Targets.Count -eq 1) {
        $arch = $archByAbi[$Targets[0]]
        $flavor = $arch.Substring(0, 1).ToUpperInvariant() + $arch.Substring(1)
        $taskName = "$verb$flavor$profileName"
    }
    else {
        # El flavor universal empaqueta las ABIs de -PabiList y compila los
        # targets de -PtargetList. -ParchList mantiene el orden target->arch.
        $taskName = "${verb}Universal$profileName"
        $gradleArgs += "-ParchList=$((($Targets | ForEach-Object { $archByAbi[$_] }) -join ','))"
        $gradleArgs += "-PabiList=$((($Targets | ForEach-Object { $abiFolderByAbi[$_] }) -join ','))"
        $gradleArgs += "-PtargetList=$($Targets -join ',')"
    }
    $gradleArgs += ":app:$taskName"

    Write-Host ("Ejecutando: gradlew.bat " + ($gradleArgs -join ' '))
    Push-Location $androidProject
    try {
        & .\gradlew.bat @gradleArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Gradle fallo con codigo $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    $outputs = Join-Path $androidProject 'app\build\outputs'
    $pattern = if ($Format -eq 'aab') { '*.aab' } else { '*.apk' }
    $artifact = Get-ChildItem $outputs -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($artifact) {
        Write-Host ''
        Write-Host "Artefacto: $($artifact.FullName)"
        Write-Host ('Tamano:    {0:N1} MB' -f ($artifact.Length / 1MB))
    }
}
finally {
    Pop-Location
}
