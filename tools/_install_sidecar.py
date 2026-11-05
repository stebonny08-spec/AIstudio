"""Download + estrazione binario llama-server (lato G1, usato da INSTALL_SIDECAR.bat)."""
import os
import sys
import time
import zipfile
import urllib.request

URL = "https://github.com/ggml-org/llama.cpp/releases/download/b11838/llama-b11838-bin-win-cpu-x64.zip"
HERE = os.path.dirname(os.path.abspath(__file__))
ZIP = os.path.join(HERE, "_llama-win-cpu-x64.zip")

def main() -> int:
    t0 = time.time()
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (G1-sidecar)"})
    data = urllib.request.urlopen(req, timeout=60).read()
    print(f"downloaded {len(data)} bytes in {time.time()-t0:.1f}s -> {ZIP}")
    with open(ZIP, "wb") as f:
        f.write(data)
    with zipfile.ZipFile(ZIP) as z:
        names = z.namelist()
        print("zip entries:", len(names))
        z.extractall(HERE)
    # localizza llama-server.exe (top-level o sottocartella)
    target = None
    for root, _dirs, files in os.walk(HERE):
        if "llama-server.exe" in files:
            target = os.path.join(root, "llama-server.exe")
            break
    if not target:
        print("ERROR: llama-server.exe not found after extraction", file=sys.stderr)
        return 2
    exe_dir = os.path.dirname(target)
    if os.path.normpath(exe_dir) != os.path.normpath(HERE):
        # promuovi contenuti della sottocartella in tools/
        for name in os.listdir(exe_dir):
            src = os.path.join(exe_dir, name)
            dst = os.path.join(HERE, name)
            if not os.path.exists(dst):
                os.replace(src, dst)
        print("promoted files from", exe_dir)
    print("exe:", os.path.join(HERE, "llama-server.exe"), "OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
