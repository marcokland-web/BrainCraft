# Sicherheits-Siggi: Prüfung 001_braincraft.sql (23.10.2026) – Freigabe NEIN

In Ordnung: search_path bei allen 38 Funktionen, Rechte (anon/authenticated nur 26 App-Funktionen, kein Schema-/Tabellenzugriff), service_role-Funktionen gesperrt, Familiengrenzen, Eltern-Token (15 Min, SHA-256), Bucket privat, keine Änderungen an anderen Apps, cron (läuft als postgres, nur braincraft-Tabellen, wiederholbar). Probelauf ohne Rückstände.

Hoch
- H1 Unbegrenztes Wachstum durch Fremde (bc_create offen): bc_unit_import legt bei reinen Duplikaten Einheiten an (Z. 719); 300er-Grenze zählt nur aktive Fragen (Z. 732); bc_stars_correct unbegrenzt (Z. 993); bc_boss_win freier Inventar-Schlüssel ohne PIN (Z. 907); redeem+storno endlos; bc_answer 1500/Kind/Tag. → Grenzen je Familie inkl. deaktivierter Zeilen (Einheiten ~1000, Fragen ~3000), Inventar ≤100/Kind gegen feste Schlüsselliste, Korrekturen ≤20/Tag, Gutscheine ≤50/Tag/Kind, Antworten ≤1500/Tag/Familie.
- H2 20-Familien-Grenze global, ohne Takt → Fremde können alle Plätze belegen. → Einladungscode (service_role) oder ≤3 neue Familien/24 h.

Mittel
- M1 PIN-Sperre ab 5 statt 3 Fehlversuchen (Z. 438).
- M2 Fehlermeldungen mit Datensatz-Details (CHECK-Verletzungen); nur_server-Fehler bei leerem Claim → eigene Fehlercodes / exception-Handler, nullif(...,'').
- M3 bc_pin_set und bc_family_delete nur mit Token → zusätzlich aktuelle PIN.
- M4 Ersteinrichtung braucht Eltern-Aufgabe in der App (Auflage für App).

Niedrig
- N1 bc_pin_reset meldet false trotz Erfolg (Z. 493).
- N2 ID-Existenz über Familiengrenzen erkennbar (save-Funktionen) → and family_id = f.
- N3 Keine Längengrenze für p_code/p_token.
- N4 bc_round_finish mit neuer round_id = +3 Sterne (durch 100/Tag begrenzt).
- N5 Künftige Migrationen: Rechte-Schleife wiederholen, alte Signaturen löschen.
