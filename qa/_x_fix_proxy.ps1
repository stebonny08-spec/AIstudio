$p = 'C:\Users\stebo\Desktop\progetti app\StudioIA_7\core\local_llm_client.py'
$t = [IO.File]::ReadAllText($p)
$nl = [Environment]::NewLine
$anchor = '    def __getattr__(self, name):' + $nl + '        return getattr(self._target, name)'
$cnt = ([regex]::Matches($t, [regex]::Escape($anchor))).Count
if ($cnt -ne 1) { Write-Output ('ANCHOR_COUNT=' + $cnt); exit 1 }
if ($t.Contains('caricamento sidecar fallito')) { Write-Output 'ALREADY'; exit 0 }
$new = @'
    def load_model_blocking(self):
        """R23: con llm.backend=sidecar il caricamento passa dal sidecar
        REALE (llama-server + llama.cpp legge Spark).

        Perche': llama-cpp-python 0.3.35 NON supporta l'architettura Spark
        (ValueError 'Failed to load model from file' - probe reale
        qa/_x_loadprobe.py): il vecchio delega in-process faceva fallire
        ogni load di Spark-base/pro e _watch_model_load cascava in fallback
        silenzioso al MiniCPM5-2B (QA-1 qa/x_qa1_switch.json: 2/2 switch
        Spark non attivi prima del fix).

        Ritorna il model_path del target; solleva LocalLLMError se il
        sidecar non parte (modello corrotto/incompatibile -> stessa via
        d'errore di prima: stato 'error' + fallback gestito dal watcher).
        """
        from core.sidecar import server as srv_mod
        srv = srv_mod.get_server()
        try:
            started = bool(srv.start_on_demand())
        except Exception as exc:
            raise LocalLLMError("caricamento sidecar fallito: %s" % exc)
        if not started or not srv.health():
            msg = getattr(srv, "message", "") or "sidecar non avviato"
            raise LocalLLMError("caricamento sidecar fallito: %s" % msg)
        return getattr(self._target, "model_path", "")

'@
$t = $t.Replace($anchor, $new + $nl + $anchor)
[IO.File]::WriteAllText($p, $t)
Write-Output 'INSERTED'
