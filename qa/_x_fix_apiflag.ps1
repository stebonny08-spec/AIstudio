$p = 'C:\Users\stebo\Desktop\progetti app\StudioIA_7\backend\api.py'
$t = [IO.File]::ReadAllText($p)
$nl = [Environment]::NewLine
$anchor = '            m["loading"] = (state == "loading" and m["key"] == loading_key)' + $nl + '        return models'
$cnt = ([regex]::Matches($t, [regex]::Escape($anchor))).Count
if ($cnt -ne 1) { Write-Output ('ANCHOR_COUNT=' + $cnt); exit 1 }
if ($t.Contains('draft_enabled')) { Write-Output 'ALREADY'; exit 0 }
$new = @'
        # R23 X4.4: il flag draft e' True SOLO se il draft e' configurato
        # (spec.draft_model); default R23 = OFF (regola X4.2: acceptance
        # 0.8402 ok ma speedup 1.240 < 1.30, qa/x3_compare.json).
        draft_on = bool(str(self.config.get("spec.draft_model", "") or "").strip())
        for m in models:
            dp = self.models_manager.get_downloaded_path(m["key"])
            m["active"] = bool(dp) and os.path.normpath(dp) == active_norm
            # R22: la voce in caricamento mostra "caricamento..." in menu
            m["loading"] = (state == "loading" and m["key"] == loading_key)
            # R23 X4.4: presenza draft in catalogo + stato attivo/off
            m["draft_enabled"] = draft_on and bool(m.get("draft"))
        return models
'@
$rep = $new
$t = $t.Replace($anchor, $rep)
[IO.File]::WriteAllText($p, $t)
Write-Output 'INSERTED'
