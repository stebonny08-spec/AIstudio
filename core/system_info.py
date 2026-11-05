"""
core/system_info.py
--------------------
Rileva le risorse hardware del PC (RAM, CPU) e suggerisce i parametri
migliori per il modello LLM e per il RAG.

- n_ctx: dimensione della context window del modello
- rag_max_tokens: tetto massimo di token che il testo del RAG può
  occupare in una singola chiamata. Oltre questo, il testo viene diviso
  in più parti e l'utente può proseguire con il pulsante "continua".

Soglie RAM a 31/23/15/7 GB (non 32/24/16/8) per compensare la RAM
"hardware reserved" di Windows.
"""

from __future__ import annotations

import os
import sys
import platform
from typing import Optional


# ======================================================================
# RILEVAMENTO RAM
# ======================================================================

def _ram_gb_windows() -> Optional[float]:
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return stat.ullTotalPhys / (1024 ** 3)
    except Exception as e:
        print(f"[SystemInfo] Rilevamento RAM Windows fallito: {e}")
    return None


def _ram_gb_linux() -> Optional[float]:
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    return kb / (1024 ** 2)
    except Exception as e:
        print(f"[SystemInfo] Rilevamento RAM Linux fallito: {e}")
    return None


def _ram_gb_macos() -> Optional[float]:
    try:
        import subprocess
        out = subprocess.check_output(
            ["sysctl", "-n", "hw.memsize"], text=True, timeout=3
        ).strip()
        return int(out) / (1024 ** 3)
    except Exception as e:
        print(f"[SystemInfo] Rilevamento RAM macOS fallito: {e}")
    return None


def get_total_ram_gb() -> float:
    if sys.platform.startswith("win"):
        v = _ram_gb_windows()
    elif sys.platform == "darwin":
        v = _ram_gb_macos()
    else:
        v = _ram_gb_linux()

    if v is None or v <= 0:
        try:
            pages = os.sysconf("SC_PHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            v = (pages * page_size) / (1024 ** 3)
        except Exception:
            print("[SystemInfo] Impossibile rilevare la RAM. Assumo 8 GB.")
            return 8.0

    return round(v, 1)


def get_cpu_cores() -> int:
    return os.cpu_count() or 4


def get_system_info() -> dict:
    return {
        "ram_gb": get_total_ram_gb(),
        "cpu_cores": get_cpu_cores(),
        "platform": platform.system(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "architecture": platform.machine(),
    }


# ======================================================================
# SCELTA DI n_ctx IN BASE ALLA RAM
# ======================================================================

_RAM_THRESHOLDS = [
    (31.0, 128000),
    (23.0, 100000),
    (15.0, 62000),
    (7.0, 8000),
    (0.0, 4096),
]


def recommended_n_ctx(ram_gb: Optional[float] = None) -> int:
    if ram_gb is None:
        ram_gb = get_total_ram_gb()
    for threshold_gb, n_ctx in _RAM_THRESHOLDS:
        if ram_gb >= threshold_gb:
            return n_ctx
    return 4096


# ======================================================================
# TETTO RAG IN BASE ALLA RAM
# ----------------------------------------------------------------------
# Quanti token al massimo il testo del RAG può occupare in una singola
# chiamata. Oltre, il router divide in più parti e l'utente prosegue
# con "continua".
# ======================================================================

_RAG_THRESHOLDS = [
    (31.0, 50000),   # PC nominale 32+ GB
    (23.0, 40000),   # PC nominale 24 GB
    (15.0, 25000),   # PC nominale 16 GB
    (7.0, 5000),     # PC nominale 8 GB
    (0.0, 3000),     # < 8 GB
]


def recommended_rag_max_tokens(ram_gb: Optional[float] = None) -> int:
    if ram_gb is None:
        ram_gb = get_total_ram_gb()
    for threshold_gb, tokens in _RAG_THRESHOLDS:
        if ram_gb >= threshold_gb:
            return tokens
    return 3000


def describe_auto_choice(ram_gb: Optional[float] = None) -> str:
    if ram_gb is None:
        ram_gb = get_total_ram_gb()
    n_ctx = recommended_n_ctx(ram_gb)
    rag_max = recommended_rag_max_tokens(ram_gb)
    return f"RAM rilevata {ram_gb:.1f} GB → n_ctx: {n_ctx}, rag_max: {rag_max} token"