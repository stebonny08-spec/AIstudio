$p = 'C:\Users\stebo\Desktop\progetti app\StudioIA_7\core\rag\vector_store_sqlite.py'
$t = [IO.File]::ReadAllText($p)
$nl = [Environment]::NewLine

# ---- R1a: helpers PRIMA di def _vec_query (anchor ASCII) ----
$a1 = '    def _vec_query(self, query_embedding: List[float], k: int) -> List[dict]:'
$c1 = ([regex]::Matches($t, [regex]::Escape($a1))).Count
if ($c1 -ne 1) { Write-Output ('R1a=' + $c1); exit 1 }
$r1 = @'
    # ------------------------------------------------------------------
    # P1b.2 - layer HNSW caldo (usearch) accanto a sqlite-vec
    # ------------------------------------------------------------------
    def _usearch_layer_get(self):
        """Singleton layer HNSW per questo store (lazy, uno per istanza)."""
        layer = getattr(self, "_usearch_layer", None)
        if layer is None:
            from core.rag.usearch_layer import UsearchLayer
            layer = UsearchLayer(self.persist_dir, self.store_key)
            self._usearch_layer = layer
        return layer

    def _usearch_invalidate(self) -> None:
        """sqlite e' cambiato (add/delete/reset) -> prossimo ensure rebuild."""
        layer = getattr(self, "_usearch_layer", None)
        if layer is not None:
            layer.invalidate()

    def _usearch_search(self, query_embedding: List[float], k: int):
        """Top-k dal layer HNSW. [(rowid, dist)] oppure None -> il caller
        cade su sqlite-vec (stessa semantica: distanza = 1 - cos)."""
        from core.rag.usearch_layer import usearch_enabled
        if not usearch_enabled():
            return None
        layer = self._usearch_layer_get()

        def _info():
            dim = 0
            try:
                row = self._conn.execute(
                    f"SELECT embedding FROM {self._vec_table} LIMIT 1"
                ).fetchone()
                if row and row[0]:
                    dim = len(bytes(row[0])) // 4
            except sqlite3.Error:
                pass
            cnt = self.count()
            emb = str(self.get_index_meta("embedding_model_id") or "") or EMBEDDER_ID
            return dim, cnt, emb

        def _build():
            with self._lock:
                try:
                    rows = self._conn.execute(
                        f"SELECT rowid, embedding FROM {self._vec_table}"
                    ).fetchall()
                except sqlite3.Error:
                    rows = []
                if not rows:
                    try:
                        rows = self._conn.execute(
                            f"SELECT rowid, embedding FROM {self._nb_table}"
                        ).fetchall()
                    except sqlite3.Error:
                        return None
            if not rows:
                return None
            import numpy as np
            ids = [r[0] for r in rows]
            mat = np.frombuffer(b"".join(bytes(r[1]) for r in rows),
                                dtype=np.float32)
            if not len(ids) or len(mat) % len(ids):
                return None
            dim = len(mat) // len(ids)
            if dim <= 0:
                return None
            return ids, mat.reshape(len(ids), dim)

        idx = layer.ensure(info=_info, build=_build)
        if idx is None:
            return None
        return layer.search(query_embedding, k)

'@ + $a1
$t = $t.Replace($a1, $r1.TrimEnd())

# ---- R1b: ramo usearch dopo 'return []' del _vec_query ----
$a1b = '            return []' + $nl + '        if self._vec_backend == "sqlite-vec":'
$c1b = ([regex]::Matches($t, [regex]::Escape($a1b))).Count
if ($c1b -ne 1) { Write-Output ('R1b=' + $c1b); exit 1 }
$r1b = '            return []' + $nl + '        # P1b.2: se il layer caldo risponde, sqlite-vec non viene' + $nl + '        # interrogato per la parte vettoriale (fusion/hybrid identici).' + $nl + '        uh = self._usearch_search(query_embedding, k)' + $nl + '        if uh is not None:' + $nl + '            return self._rows_for_hits(uh) if uh else []' + $nl + '        if self._vec_backend == "sqlite-vec":'
$t = $t.Replace($a1b, $r1b)

# ---- R2: invalidate in add_chunks ----
$a2 = '            self._sync_batch_embedder(str(embedder_id))'
$c2 = ([regex]::Matches($t, [regex]::Escape($a2))).Count
if ($c2 -ne 1) { Write-Output ('R2=' + $c2); exit 1 }
$r2 = $a2 + $nl + '        # P1b.2: corpus cambiato -> HNSW ricostruito alla prossima query' + $nl + '        self._usearch_invalidate()'
$t = $t.Replace($a2, $r2)

# ---- R3: invalidate in reset ----
$a3 = '            except sqlite3.Error:' + $nl + '                self._conn.rollback()' + $nl + '                raise' + $nl + '' + $nl + '    def _bump_versions(self, doc_ids) -> None:'
$c3 = ([regex]::Matches($t, [regex]::Escape($a3))).Count
if ($c3 -ne 1) { Write-Output ('R3=' + $c3); exit 1 }
$r3 = '            except sqlite3.Error:' + $nl + '                self._conn.rollback()' + $nl + '                raise' + $nl + '        # P1b.2' + $nl + '        self._usearch_invalidate()' + $nl + '' + $nl + '    def _bump_versions(self, doc_ids) -> None:'
$t = $t.Replace($a3, $r3)

[IO.File]::WriteAllText($p, $t)
Write-Output 'APPLIED=3'
