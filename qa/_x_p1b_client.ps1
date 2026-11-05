$p = 'C:\Users\stebo\Desktop\progetti app\StudioIA_7\core\sidecar\client.py'
$t = [IO.File]::ReadAllText($p)
$nl = [Environment]::NewLine
$a = '        cfg = self._spec_flags()' + $nl + '        model = str(cfg.get("spec.draft_model", "") or "").strip()' + $nl + '        if not model or not os.path.exists(model):' + $nl + '            return False'
$c = ([regex]::Matches($t, [regex]::Escape($a))).Count
if ($c -ne 1) { Write-Output ('ANCHOR=' + $c); exit 1 }
$r = @'
        cfg = self._spec_flags()
        model = str(cfg.get("spec.draft_model", "") or "").strip()
        if not model or not os.path.exists(model):
            # P1b.1: n-gram draftless su LONG-FORM (esito A/B qa/p1b_ngram.json:
            # ngram-map-k d5 = 3.073x pro / 2.343x base, acceptance 1.0, output
            # identici al greedy). La chiave e' letta SOLO dalla config reale
            # (l'override `spec` dei test R13/R22 non la contiene -> il
            # comportamento storico con draft_model vuoto resta invariato).
            # Nessun costo RAM (draftless) -> nessuna guardia budget RSS.
            if bool(cfg.get("spec.ngram_longform", False)) and (
                    profile == "think" or classe == "think"):
                return True
            return False
'@
$t = $t.Replace($a, $r.TrimEnd())
[IO.File]::WriteAllText($p, $t)
Write-Output 'APPLIED'
