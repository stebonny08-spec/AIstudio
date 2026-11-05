# -*- coding: utf-8 -*-
"""qa/_test_settings_api.py — verifica hook R15b (progress passthrough + app_settings)."""
import sys
import types

sys.path.insert(0, ".")
if "webview" not in sys.modules:
    m = types.ModuleType("webview")
    m.FileDialog = type("FD", (), {"OPEN": "open", "SAVE": "save"})
    m.windows = []
    sys.modules["webview"] = m

from backend.api import StudioIAAPI  # noqa: E402
from data.config_manager import ConfigManager  # noqa: E402

api = StudioIAAPI.__new__(StudioIAAPI)
api.config = ConfigManager()

r = api.app_settings_get("{}")
assert r["ok"] and "gate.threshold" in r["settings"], r
print("get ok:", sorted(r["settings"].keys()))

r2 = api.app_settings_set('{"settings": {"gate.threshold": 0.42, "web.mode": "sempre", "ciccio.x": 1}}')
assert r2["ok"] and sorted(r2["saved"]) == ["gate.threshold", "web.mode"], r2
print("set ok:", r2)

r3 = api.app_settings_get('{"keys": ["gate.threshold"]}')
assert r3["settings"]["gate.threshold"] == 0.42, r3
print("reread ok:", r3)

# riporta i default (nessun residuo per i test)
api.config.set("gate.threshold", 0.45)
api.config.set("web.mode", "auto")
api.config.save()
print("defaults ripristinati (0.45 / auto)")
print("SETTINGS_API OK")
