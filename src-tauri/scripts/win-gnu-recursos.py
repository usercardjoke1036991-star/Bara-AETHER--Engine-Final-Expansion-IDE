#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════════
#  Bara IDE Desktop — recursos de Windows para toolchains GNU (MinGW)
#
#  Por qué existe este script
#  --------------------------
#  `tauri-build` embebe icono, versión y manifiesto en el `.exe` invocando un
#  compilador de recursos (`windres` en GNU, `rc.exe` en MSVC). Un toolchain
#  `stable-x86_64-pc-windows-gnu` de rustup **no** trae MinGW, así que sin
#  `windres` en el PATH ese recurso no se compila y `src-tauri/build.rs` degrada
#  el paso a un aviso (para no romper `cargo check`).
#
#  Las dos consecuencias de un `.exe` sin recursos son fallos de arranque:
#
#  1. Sin manifiesto no hay contexto de activación Side-by-Side, así que
#     `comctl32.dll` se resuelve contra la versión 5.82 de System32, que **no
#     exporta** `TaskDialogIndirect`. El `.exe` lo importa (menús de tauri vía
#     `muda`) y el proceso muere con 0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND.
#     Con `ShellExecute` parecía funcionar sólo porque el shell honra el
#     manifiesto *externo* (`<exe>.manifest`); `cargo`/`tauri` lanzan con
#     `CreateProcess`, que lo ignora: hay que **embeberlo**.
#  2. Sin `RT_GROUP_ICON`/`RT_ICON`, `tao` no puede cargar el icono por defecto
#     de la ventana y falla con 0x80070715 ERROR_RESOURCE_TYPE_NOT_FOUND.
#
#  Qué hace
#  --------
#  * Embebe `RT_MANIFEST` (id 1) con la dependencia Common-Controls 6.0.0.0.
#  * Embebe `RT_ICON` + `RT_GROUP_ICON` desde `src-tauri/icons/icon.ico`, con el
#    grupo en dos ids: `1` (icono principal del `.exe`, el del Explorador) y
#    `32512` (`tauri_utils::platform::WINDOWS_APP_ICON_RESOURCE_ID`, el que tauri
#    busca para el icono de la ventana).
#  * Copia `WebView2Loader.dll` junto al `.exe`: en MSVC se enlaza estática,
#    pero el `.exe` GNU la importa y debe encontrarla al arrancar.
#
#  Es idempotente y sólo usa la biblioteca estándar (`ctypes`).
#
#  Uso
#  ---
#      python win-gnu-recursos.py --exe RUTA\bara-ide-desktop.exe [--forzar]
#      python win-gnu-recursos.py --exe ... --wait 900      # espera al enlace
#      python win-gnu-recursos.py --exe ... --probar 20     # lanza y observa
#
#  `--wait` lo usa `build.rs` (proceso suelto que parchea en cuanto el enlazador
#  escribe el `.exe`); `--probar` lanza el `.exe` con `CreateProcess` y mide
#  cuántos segundos sobrevive, que es la comprobación de humo del toolchain GNU.
# ══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import ctypes
import os
import shutil
import struct
import tempfile
import time
from ctypes import wintypes

from win_gnu_proceso import cerrar, codigo_de, esperar, iniciar, terminar

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONO = os.path.join(RAIZ, "icons", "icon.ico")

RT_ICON = 3
RT_GROUP_ICON = 14
RT_MANIFEST = 24
LANG_NEUTRAL = 0

# `tauri_utils::platform::WINDOWS_APP_ICON_RESOURCE_ID`: el id con el que tauri
# busca, dentro del `.exe`, el icono de la ventana. Sin el, tauri avisa
# ("failed to load the default window icon...") y deja el icono por defecto.
ID_ICONO_APP = 32512

# `LoadLibraryExW` con esta bandera abre el `.exe` solo como datos (no lo ejecuta).
LOAD_LIBRARY_AS_DATAFILE = 0x00000002

# Manifiesto de la aplicación: lo imprescindible es la dependencia de
# Common-Controls 6.0.0.0 (la que aporta `comctl32!TaskDialogIndirect`).
MANIFIESTO = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="com.aetheromega.bara.ide" version="0.5.0.0" processorArchitecture="amd64"/>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
</assembly>
"""


def _kernel32():
    """`kernel32` con los tipos de las APIs de edicion de recursos."""
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.BeginUpdateResourceW.restype = wintypes.HANDLE
    k.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    k.UpdateResourceW.restype = wintypes.BOOL
    k.UpdateResourceW.argtypes = [
        wintypes.HANDLE, wintypes.LPVOID, wintypes.LPVOID,
        wintypes.WORD, wintypes.LPVOID, wintypes.DWORD,
    ]
    k.EndUpdateResourceW.restype = wintypes.BOOL
    k.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    return k


def _rid(valor):
    """`MAKEINTRESOURCE`: el id viaja como puntero."""
    return ctypes.c_void_p(valor)


def _ruta_real(ruta, etiqueta):
    """Normaliza una ruta de este proceso: sin nulos y sin enlaces sin resolver."""
    if not isinstance(ruta, str) or ruta == "" or "\x00" in ruta:
        raise ValueError(etiqueta + " rechazada")
    return os.path.realpath(os.path.abspath(ruta))


def exe_existente(ruta):
    """Un `.exe` que ya está en disco. No abre el archivo."""
    absoluta = _ruta_real(ruta, "ruta del ejecutable")
    if not os.path.basename(absoluta).lower().endswith(".exe"):
        raise ValueError("se esperaba un archivo .exe")
    if not os.path.isfile(absoluta):
        raise ValueError("el .exe no existe")
    return absoluta


def ico_del_proyecto(ruta, raiz):
    """`.ico` dentro de `src-tauri`, o `None` si todavía no está."""
    absoluta = _ruta_real(ruta, "ruta del icono")
    base = os.path.normcase(os.path.realpath(raiz))
    destino = os.path.normcase(absoluta)
    try:
        comun = os.path.commonpath([base, destino])
    except ValueError:
        raise ValueError("el icono queda fuera de src-tauri") from None
    if comun != base:
        raise ValueError("el icono queda fuera de src-tauri")
    if not destino.endswith(".ico"):
        raise ValueError("se esperaba un .ico del proyecto")
    if not os.path.isfile(absoluta):
        return None
    return absoluta


def dll_webview(ruta):
    """`WebView2Loader.dll` explícita, o `None` para buscarla en el registro."""
    if ruta is None:
        return None
    absoluta = _ruta_real(ruta, "ruta de WebView2")
    if os.path.basename(absoluta).lower() != "webview2loader.dll" or not os.path.isfile(absoluta):
        raise ValueError("se esperaba WebView2Loader.dll")
    return absoluta


def leer_ico():
    """Imagenes de `icons/icon.ico`: [(ancho, alto, colores, planos, bits, bytes)]."""
    with open(ICONO, "rb") as f:
        datos = f.read()
    reservado, tipo, cuenta = struct.unpack_from("<HHH", datos, 0)
    if reservado != 0 or tipo != 1:
        raise ValueError("no es un .ico valido: " + ruta)
    imagenes = []
    for indice in range(cuenta):
        base = 6 + indice * 16
        ancho, alto, colores, _, planos, bits, tam, offset = struct.unpack_from(
            "<BBBBHHII", datos, base
        )
        imagenes.append((ancho, alto, colores, planos, bits, datos[offset:offset + tam]))
    return imagenes


def embebe_recursos(exe, ico=None, manifiesto=MANIFIESTO):
    """Anade `RT_MANIFEST` (id 1) y, si hay `.ico`, icono + grupo (id 1)."""
    k = _kernel32()
    manejar = k.BeginUpdateResourceW(exe, False)
    if not manejar:
        raise OSError("BeginUpdateResourceW fallo (error %d)" % ctypes.get_last_error())
    correcto = False
    try:
        datos = manifiesto.encode("utf-8")
        if not k.UpdateResourceW(manejar, _rid(RT_MANIFEST), _rid(1), LANG_NEUTRAL, datos, len(datos)):
            raise OSError("RT_MANIFEST fallo (error %d)" % ctypes.get_last_error())

        imagenes = []
        if ico and os.path.isfile(ICONO):
            imagenes = leer_ico()
            for indice, (_, _, _, _, _, imagen) in enumerate(imagenes):
                if not k.UpdateResourceW(
                    manejar, _rid(RT_ICON), _rid(indice + 1), LANG_NEUTRAL, imagen, len(imagen)
                ):
                    raise OSError("RT_ICON %d fallo (error %d)" % (indice + 1, ctypes.get_last_error()))
            grupo = struct.pack("<HHH", 0, 1, len(imagenes))
            for indice, (ancho, alto, colores, planos, bits, imagen) in enumerate(imagenes):
                grupo += struct.pack(
                    "<BBBBHHIH", ancho, alto, colores, 0, planos, bits, len(imagen), indice + 1
                )
            # El grupo se registra con dos ids: `1` (icono "principal" del `.exe`,
            # el que muestra el Explorador) y `ID_ICONO_APP` (32512), que es el que
            # busca tauri para el icono de la ventana.
            for identificador in (1, ID_ICONO_APP):
                if not k.UpdateResourceW(
                    manejar, _rid(RT_GROUP_ICON), _rid(identificador), LANG_NEUTRAL, grupo, len(grupo)
                ):
                    raise OSError(
                        "RT_GROUP_ICON %d fallo (error %d)" % (identificador, ctypes.get_last_error())
                    )
        correcto = True
        return len(imagenes)
    finally:
        # `descartar=True` si algo fallo: deja el `.exe` intacto.
        k.EndUpdateResourceW(manejar, not correcto)


def _existe_recurso(exe, tipo, identificador):
    """¿El `.exe` contiene ese recurso? (`LoadLibraryEx` como datos: no ejecuta nada.)"""
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.LoadLibraryExW.restype = wintypes.HMODULE
    k.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    k.FindResourceW.restype = wintypes.HANDLE
    k.FindResourceW.argtypes = [wintypes.HMODULE, wintypes.LPVOID, wintypes.LPVOID]
    k.FreeLibrary.restype = wintypes.BOOL
    k.FreeLibrary.argtypes = [wintypes.HMODULE]
    modulo = k.LoadLibraryExW(exe, None, LOAD_LIBRARY_AS_DATAFILE)
    if not modulo:
        return False
    try:
        return bool(k.FindResourceW(modulo, _rid(identificador), _rid(tipo)))
    finally:
        k.FreeLibrary(modulo)


def ya_tiene_recursos(exe):
    """¿El `.exe` ya lleva el manifiesto y el grupo de iconos que busca tauri?

    Se comprueba la API de Windows (no una busqueda de texto) porque el id del
    grupo vive en el directorio de recursos, no en los datos: es la unica forma
    de saber si el icono esta con el id `ID_ICONO_APP`.
    """
    try:
        exe = exe_existente(exe)
    except ValueError:
        return False
    return _existe_recurso(exe, RT_MANIFEST, 1) and _existe_recurso(exe, RT_GROUP_ICON, ID_ICONO_APP)


def candidatas_webview2():
    """Rutas de `WebView2Loader.dll` en el registro de Cargo o en WebView2.

    No acepta una ruta libre de la línea de comandos: solo estos directorios.
    """
    preferidas = []
    registro = os.path.join(os.path.expanduser("~"), ".cargo", "registry", "src")
    if os.path.isdir(registro):
        for sub in sorted(os.listdir(registro)):
            base = os.path.join(registro, sub)
            if not os.path.isdir(base):
                continue
            try:
                entradas = sorted(os.listdir(base))
            except OSError:
                continue
            for nombre in entradas:
                if nombre.startswith("webview2-com-sys-"):
                    dll = os.path.join(base, nombre, "x64", "WebView2Loader.dll")
                    if os.path.isfile(dll):
                        preferidas.append(dll)

    otras = []
    for base in (
        r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application",
        r"C:\Program Files\Microsoft\EdgeWebView\Application",
        r"C:\Program Files\WSL\wslsettings",
    ):
        if not os.path.isdir(base):
            continue
        if os.path.isfile(os.path.join(base, "WebView2Loader.dll")):
            otras.append(os.path.join(base, "WebView2Loader.dll"))
            continue
        for nombre in sorted(os.listdir(base)):
            dll = os.path.join(base, nombre, "WebView2Loader.dll")
            if os.path.isfile(dll):
                otras.append(dll)

    return preferidas or otras


def buscar_webview2():
    """`WebView2Loader.dll` que empareja con el enlace."""
    candidatas = candidatas_webview2()
    if not candidatas:
        return None
    return candidatas[-1]


def copiar_webview2(exe, origen=None):
    """Deja `WebView2Loader.dll` junto al `.exe`. Devuelve una descripcion."""
    destino = os.path.join(os.path.dirname(exe_existente(exe)), "WebView2Loader.dll")
    candidatas = candidatas_webview2()
    elegida = None
    if origen is None:
        elegida = candidatas[-1] if candidatas else None
    else:
        try:
            pedida = os.path.normcase(_ruta_real(origen, "ruta de WebView2"))
        except ValueError:
            pedida = ""
        for candidata in candidatas:
            if os.path.normcase(os.path.realpath(candidata)) == pedida:
                elegida = candidata
                break
    if not elegida or os.path.basename(elegida) != "WebView2Loader.dll" or not os.path.isfile(elegida):
        return "aviso: no encontre WebView2Loader.dll en el registro de cargo ni en WebView2"
    if os.path.isfile(destino) and os.path.getsize(destino) == os.path.getsize(elegida):
        return "WebView2Loader.dll ya estaba junto al .exe"
    shutil.copy2(elegida, destino)
    return "WebView2Loader.dll copiado desde " + elegida


def _tomar_candado(exe, segundos=120):
    """Candado en `%TEMP%` para que dos parcheadores no escriban a la vez.

    `BeginUpdateResource`/`EndUpdateResource` rehacen el `.exe` entero: si dos
    procesos coinciden, la imagen puede quedar a medias. `build.rs` (que espera
    al enlazador) y el runner de cargo pueden coincidir, de ahi el candado. Si el
    dueno anterior desaparecio (candado mas viejo que 120 s) se toma igual.
    """
    ruta = os.path.join(
        tempfile.gettempdir(),
        "win-gnu-recursos-" + os.path.basename(exe).lower() + ".lock",
    )
    limite = time.time() + segundos
    while time.time() < limite:
        try:
            descriptor = os.open(ruta, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(descriptor, str(os.getpid()).encode("ascii"))
            return ruta, descriptor
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(ruta) > 120:
                    os.unlink(ruta)
                    continue
            except OSError:
                pass
            time.sleep(0.5)
        except OSError:
            return None, None
    return None, None


def _soltar_candado(fichero, descriptor):
    """Suelta el candado de `_tomar_candado` (silencioso si ya no esta)."""
    if descriptor is not None:
        try:
            os.close(descriptor)
        except OSError:
            pass
    if fichero:
        try:
            os.unlink(fichero)
        except OSError:
            pass


def esperar_exe(exe, segundos):
    """Espera a que el enlazador escriba el `.exe` y su tamano se estabilice."""
    limite = time.time() + segundos
    anterior = None
    estable = 0
    while time.time() < limite:
        if os.path.isfile(exe):
            tamano = os.path.getsize(exe)
            if tamano > 0 and tamano == anterior:
                estable += 1
                if estable >= 2:
                    return True
            else:
                estable = 0
            anterior = tamano
        time.sleep(1)
    return False


def probar(exe, segundos):
    """Lanza el `.exe` con `CreateProcessW` y mide cuanto sobrevive."""
    exe = exe_existente(exe)
    if not isinstance(segundos, int) or isinstance(segundos, bool) or segundos < 1 or segundos > 120:
        raise ValueError("la observacion tiene que durar entre 1 y 120 s")
    handle = iniciar(exe, [], os.path.dirname(exe))
    inicio = time.time()
    try:
        while time.time() - inicio < segundos:
            if esperar(handle, 1000):
                print(
                    "MURIO 0x%08x tras %.1fs"
                    % (codigo_de(handle) & 0xFFFFFFFF, time.time() - inicio)
                )
                return 1
        print("VIVO %.1fs (ventana creada, proceso en pie)" % (time.time() - inicio))
        terminar(handle)
        return 0
    finally:
        cerrar(handle)


def main(argv=None):
    raiz = RAIZ
    analizador = argparse.ArgumentParser(
        description="Embebe manifiesto e icono, y copia WebView2Loader.dll, en el .exe de Bara IDE."
    )
    analizador.add_argument("--exe", required=True, help="ruta del .exe recien enlazado")
    analizador.add_argument("--icon", default=os.path.join(raiz, "icons", "icon.ico"))
    analizador.add_argument("--webview2", default=None, help="WebView2Loader.dll a copiar")
    analizador.add_argument("--wait", type=int, default=0, help="segundos a esperar al enlace")
    analizador.add_argument("--probar", type=int, default=0, help="segundos de observacion al lanzar")
    analizador.add_argument("--forzar", action="store_true", help="rehace los recursos aunque existan")
    args = analizador.parse_args(argv)

    if args.wait and not esperar_exe(args.exe, args.wait):
        print("aviso: el .exe no aparecio en %d s" % args.wait)
        return 1
    try:
        exe = exe_existente(args.exe)
        icono = ico_del_proyecto(args.icon, raiz)
        webview = dll_webview(args.webview2)
    except ValueError as error:
        print("error: %s" % error)
        return 1

    candado, descriptor = _tomar_candado(exe)
    try:
        print(copiar_webview2(exe, webview))
        if ya_tiene_recursos(exe) and not args.forzar:
            print("el .exe ya lleva el manifiesto y el icono embebidos; nada que rehacer")
        else:
            imagenes = embebe_recursos(exe, icono)
            print("manifiesto embebido (Common-Controls 6.0.0.0) e icono con %d imagenes" % imagenes)
    finally:
        _soltar_candado(candado, descriptor)
    if args.probar:
        return probar(exe, args.probar)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


