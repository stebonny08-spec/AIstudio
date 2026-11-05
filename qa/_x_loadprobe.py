# -*- coding: utf-8 -*-
"""Probe: perche' llama-cpp-python fallisce su Spark? Carico reale, nessuna simulazione."""
import sys, time, traceback
sys.path.insert(0, ".")
from llama_cpp import Llama
for m in ("tools/models/spark-x2.6-1.7b.gguf",):
    t = time.time()
    try:
        Llama(model_path=m, n_ctx=512, verbose=False, n_gpu_layers=0)
        print("LOAD_OK", m, round(time.time() - t, 1), flush=True)
    except Exception as e:
        print("LOAD_FAIL", m, type(e).__name__, str(e)[:500], flush=True)
        traceback.print_exc()
