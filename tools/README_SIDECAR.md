# README_SIDECAR — installazione manuale llama-server.exe (G1)

Se `tools\INSTALL_SIDECAR.bat` non funziona (rete assente, URL cambiato),
seguire questa procedura manuale.

## 1. Download binario ufficiale

- **Pagina releases**: <https://github.com/ggml-org/llama.cpp/releases>
- Scegliere il tag più recente (al 2026-10-23: **b11838**)
- **Asset da scaricare**: `llama-b11838-bin-win-cpu-x64.zip` (~24 MB)
  - Link diretto:
    <https://github.com/ggml-org/llama.cpp/releases/download/b11838/llama-b11838-bin-win-cpu-x64.zip>
  - Variante GPU (se disponibile): `llama-b11838-bin-win-cuda-13.4-x64.zip`
- Alternativa automatica (stessa fonte): `python tools\_install_sidecar.py`

## 2. Estrazione in `tools\`

1. Creare la cartella `<progetto>\tools\` (es.
   `C:\Users\stebo\Desktop\progetti app\StudioIA_7\tools\`)
2. Estrarre **tutto** il contenuto dello zip dentro `tools\`
   (servono `llama-server.exe`, `llama-server-impl.dll`, `llama.dll`,
   `llama-common.dll`, `ggml*.dll`, `libomp.dll`; extra: `llama-bench.exe`)
3. Verificare da prompt:

   ```bat
   cd /d "C:\Users\stebo\Desktop\progetti app\StudioIA_7"
   tools\llama-server.exe --version
   :: atteso: version: 0.7.0-dev (build 11838, ...)
   ```

## 3. Config da impostare

File: `%APPDATA%\NovaStudio\config.json` (gestito da
`data/config_manager.py`). Chiavi:

| chiave                | valore                                        |
| --------------------- | --------------------------------------------- |
| `llama.server_path`   | `C:\...\StudioIA_7\tools\llama-server.exe`    |
| `llama.bench_path`    | `C:\...\StudioIA_7\tools\llama-bench.exe`     |
| `llama.model_path`    | `%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf` (default già corretto) |
| `llama.idle_unload_sec` | `300` (default)                             |
| `llama.n_ctx`         | `4096` (default, clamp 4096–8192)             |

Impostazione rapida (da radice progetto):

```bat
python -c "import os,sys; sys.path.insert(0,'.'); from data.config_manager import ConfigManager; c=ConfigManager(); c.set('llama.server_path', os.path.abspath(r'tools\llama-server.exe')); c.set('llama.bench_path', os.path.abspath(r'tools\llama-bench.exe')); c.save(); print('ok')"
```

## 4. Autotune con llama-bench (H5)

`data/autotune.run_autotune_once` invoca `llama-bench.exe` **senza argomenti**:
il binario usa quindi il path default relativo
`models/7B/ggml-model-q4_0.gguf`. Per renderlo risolvibile dalla radice
progetto (0 byte extra):

```bat
mkdir models\7B 2>nul
mklink /H "models\7B\ggml-model-q4_0.gguf" "%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf"
```

## 5. Fallback

Con `llama.server_path = ''` (o binario assente) il codice non va in errore:
`SidecarServer.start_on_demand()` ritorna `False` (stato `down`), il client
solleva `AiUnavailable('AI non disponibile')` e `LocalLLMClient.
stream_via_sidecar` cade sulla strada **in-process** (llama_cpp).
Verifica: `python tests\testH2_server.py` (11/11) +
`python tests\testG1_sidecar.py`.

## 6. Verifiche

```bat
python tests\testH2_queue.py     &:: 5/5
python tests\testH2_server.py    &:: 11/11
python tests\testG1_sidecar.py   &:: server reale (skip se assente)
python tests\t2a_sidecar.py      &:: misure -> qa\g1_measures.json
```
