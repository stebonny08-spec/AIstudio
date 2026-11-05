"""Sidecar: componenti di supporto del core.

- Coda a priorita' AI (queue.py, preesistente)
- Profili sampling + clamp budget (profiles.py)
- Client/Server llama-server con AiUnavailable (client.py / server.py)
"""

from .queue import CodaPriorita, PrioritaJob
from .profiles import (
    SAMPLING_PROFILES,
    TOKEN_BUDGET,
    build_args,
    clamp_max_tokens,
    get_profile,
)
from .client import (
    AiUnavailable,
    SidecarClient,
    parse_sse_line,
    parse_sse_text,
)
from .server import SidecarServer, get_server

__all__ = [
    "CodaPriorita",
    "PrioritaJob",
    "SAMPLING_PROFILES",
    "TOKEN_BUDGET",
    "build_args",
    "clamp_max_tokens",
    "get_profile",
    "AiUnavailable",
    "SidecarClient",
    "parse_sse_line",
    "parse_sse_text",
    "SidecarServer",
    "get_server",
]
