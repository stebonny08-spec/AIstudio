$p = 'C:\Users\stebo\Desktop\progetti app\StudioIA_7\web_frontend\html\index.html'
$t = [IO.File]::ReadAllText($p)
$nl = [Environment]::NewLine
$anchor = '            item.appendChild(nameBtn);' + $nl + '' + $nl + '            const action = document.createElement(''div'');'
$cnt = ([regex]::Matches($t, [regex]::Escape($anchor))).Count
if ($cnt -ne 1) { Write-Output ('ANCHOR_COUNT=' + $cnt); exit 1 }
if ($t.Contains('model-draft-flag')) { Write-Output 'ALREADY'; exit 0 }
$new = @'
            // R23 X4.4: colonna info (nome + flag draft sotto)
            const info = document.createElement('div');
            info.style.cssText = 'display:flex;flex-direction:column;flex:1;min-width:0;';
            info.appendChild(nameBtn);
            if (m.draft) {
                const flag = document.createElement('span');
                flag.className = 'model-draft-flag';
                flag.style.cssText = 'font-size:11px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                flag.textContent = m.draft_enabled
                    ? ('draft ' + m.draft + ': ATTIVO')
                    : ('draft ' + m.draft + ': OFF (speedup 1,24x < 1,30)');
                flag.title = 'Draft ' + m.draft + ' disponibile; stato: ' +
                    (m.draft_enabled ? 'attivo (spec.draft_model configurato)'
                        : 'OFF di default - regola R23 X4.2 (speedup 1.240 < 1.30; acceptance 0.8402 ok), qa/x3_compare.json');
                info.appendChild(flag);
            }
            item.appendChild(info);

            const action = document.createElement('div');
'@
$t = $t.Replace($anchor, $new)
[IO.File]::WriteAllText($p, $t)
Write-Output 'INSERTED'
