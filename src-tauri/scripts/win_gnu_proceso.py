#!/usr/bin/env python3
# Arranque de un .exe ya enlazado, el mismo camino que usan cargo y tauri:
# CreateProcessW, sin shell y sin interpretar la línea como un comando.

from __future__ import annotations

import ctypes
import subprocess
from ctypes import wintypes

_ESPERA_LISTO = 0
_ESPERA_AGOTADA = 0x00000102
_ESPERA_INFINITA = 0xFFFFFFFF

_KERNEL = ctypes.WinDLL("kernel32", use_last_error=True)


class _Arranque(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("lpReserved", wintypes.LPWSTR),
        ("lpDesktop", wintypes.LPWSTR),
        ("lpTitle", wintypes.LPWSTR),
        ("dwX", wintypes.DWORD),
        ("dwY", wintypes.DWORD),
        ("dwXSize", wintypes.DWORD),
        ("dwYSize", wintypes.DWORD),
        ("dwXCountChars", wintypes.DWORD),
        ("dwYCountChars", wintypes.DWORD),
        ("dwFillAttribute", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("wShowWindow", wintypes.WORD),
        ("cbReserved2", wintypes.WORD),
        ("lpReserved2", ctypes.POINTER(wintypes.BYTE)),
        ("hStdInput", wintypes.HANDLE),
        ("hStdOutput", wintypes.HANDLE),
        ("hStdError", wintypes.HANDLE),
    ]


class _Proceso(ctypes.Structure):
    _fields_ = [
        ("hProcess", wintypes.HANDLE),
        ("hThread", wintypes.HANDLE),
        ("dwProcessId", wintypes.DWORD),
        ("dwThreadId", wintypes.DWORD),
    ]


_KERNEL.CreateProcessW.argtypes = [
    wintypes.LPCWSTR,
    wintypes.LPWSTR,
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.BOOL,
    wintypes.DWORD,
    ctypes.c_void_p,
    wintypes.LPCWSTR,
    ctypes.POINTER(_Arranque),
    ctypes.POINTER(_Proceso),
]
_KERNEL.CreateProcessW.restype = wintypes.BOOL
_KERNEL.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
_KERNEL.WaitForSingleObject.restype = wintypes.DWORD
_KERNEL.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
_KERNEL.GetExitCodeProcess.restype = wintypes.BOOL
_KERNEL.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
_KERNEL.TerminateProcess.restype = wintypes.BOOL
_KERNEL.CloseHandle.argtypes = [wintypes.HANDLE]
_KERNEL.CloseHandle.restype = wintypes.BOOL


def iniciar(aplicacion, argumentos, directorio=None):
    """Crea el proceso y devuelve su handle. El hilo principal ya está cerrado."""
    linea = subprocess.list2cmdline([aplicacion, *argumentos])
    buffer = ctypes.create_unicode_buffer(linea)
    arranque = _Arranque()
    arranque.cb = ctypes.sizeof(_Arranque)
    info = _Proceso()
    ok = _KERNEL.CreateProcessW(
        aplicacion,
        buffer,
        None,
        None,
        False,
        0,
        None,
        directorio,
        ctypes.byref(arranque),
        ctypes.byref(info),
    )
    if not ok:
        raise OSError("CreateProcessW fallo (error %d)" % ctypes.get_last_error())
    _KERNEL.CloseHandle(info.hThread)
    return info.hProcess


def esperar(handle, milisegundos):
    """True si el proceso terminó dentro del plazo."""
    return _KERNEL.WaitForSingleObject(handle, milisegundos) == _ESPERA_LISTO


def codigo_de(handle):
    codigo = wintypes.DWORD()
    if not _KERNEL.GetExitCodeProcess(handle, ctypes.byref(codigo)):
        raise OSError("GetExitCodeProcess fallo (error %d)" % ctypes.get_last_error())
    return int(codigo.value)


def terminar(handle):
    _KERNEL.TerminateProcess(handle, 1)
    _KERNEL.WaitForSingleObject(handle, _ESPERA_INFINITA)


def cerrar(handle):
    if handle:
        _KERNEL.CloseHandle(handle)


def lanzar(aplicacion, argumentos, directorio=None):
    """Espera a que el proceso termine y devuelve su código de salida."""
    handle = iniciar(aplicacion, argumentos, directorio)
    try:
        esperar(handle, _ESPERA_INFINITA)
        return codigo_de(handle)
    finally:
        cerrar(handle)
