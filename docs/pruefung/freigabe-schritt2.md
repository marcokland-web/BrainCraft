# Freigabe Schritt 2 (23.10.2026)

Stände: index.ts md5 1fabb4e922fdde245f26819c00a96ea0, validate.ts md5 563af54f42a1b944a97847945f5aa2cb, 002_scan.sql md5 d1188360bd0ab70bb8a800e21c9e8cfc

- Daten-Dieter: 002_scan.sql Probelauf 55/55, Kontrolle sauber (Vault und cron mit zurückgerollt).
- Bug-Bodo: Bildverkleinerung bestanden (Chromium und WebKit, tests/images.spec.mjs); validate.ts 16/16 (tests/validate.test.ts, PGlite-Abgleich mit payload_ok, 3000 Mutationen), letzter Lauf durch Claude nach Korrektur der Telefon-Erkennung (Fehlalarme bei Datum und Tausendergruppen behoben).
- Sicherheits-Siggi (2. Prüfung): Freigabe JA. Pflicht vor dem Deploy: monatliches Ausgabenlimit in der Anthropic-Konsole. N7 und N9 danach umgesetzt. Probelauf von 002 durch Siggi wurde von der Rechteprüfung gestoppt (Schreibzugriff braucht Marcos Erlaubnis); Grundlage ist Dieters Lauf.
- Offen (niedrig): N3 eigenes Ticket-Secret; N8 Eltern-Token 15 Min. bei langen Scans → Eltern-Ansicht prüft Restzeit; rechenstern_secret für anon ausführbar (innen geschützt) → spätere Rechenstern-Migration; Aufbewahrung der API-Daten bei Anthropic nachlesen; Beta server-side-fallback live prüfen.
