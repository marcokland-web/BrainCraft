# Daten-Dieter: Datenmodell (23.10.2026)

Entwurf: supabase/001_braincraft.sql (NICHT ausgeführt, nicht gegen Postgres getestet → erst in Supabase-Branch).

Befunde der Vorgabe
1. Kritisch: public-Tabellen ohne RLS/Familie; im Projekt bekommt anon auf neue public-Tabellen automatisch volle Rechte (pg_default_acl anon=arwdDxtm).
2. Kritisch: PIN Klartext Default 1234, keine Fehlversuch-Sperre.
3. Hoch: Lernstand an der Frage statt am Kind; total_stars ohne Ledger; Einlösen nicht atomar; Redemptions-CASCADE löscht offene Gutscheine; inventory.item_key global UNIQUE.
4. Mittel: exam_id/unit_id können sich widersprechen; Status freier Text; leitner_box ohne Check; CREATE TYPE nicht idempotent; Stufe 5 ohne Intervall; CURRENT_DATE in UTC; image_urls vs. ablaufende Signed URLs.

Entwurf
- Schema braincraft (13 Tabellen), RLS an, keine Policies, Zugriff nur über public.bc_*.
- families → profiles, subjects, exams (pro Kind), units, questions; zusammengesetzte FKs gegen Familien-übergreifende Verweise.
- progress pro Kind und Frage; Antwort-Protokoll idempotent (Geräte-ID); Chill/Boss schieben keine Stufe.
- star_ledger, Stand CHECK >= 0, bc_redeem atomar, Storno bucht zurück.
- PIN Pflicht, bcrypt, wachsende Sperre ab 5 Fehlversuchen, Eltern-Token 15 Min.
- payload per CHECK je Typ; Import alles-oder-nichts mit Duplikat-Überspringen; Löschen = deaktivieren.
- Grenzen: 20 Familien, 5 Kinder, 300 Fragen/Arbeit, 1500 Antworten und 500 Sterne/Tag.
- Bucket bc-scans privat, max. 1 MB, JPEG/PNG/WebP, keine Storage-Policies (nur service_role).

Offen: Hosting; Stufe 5 = 14 Tage, falsch = sofort fällig; Sterne je Antwort, Tagesdeckel, Boss-Bonus; Boss ab 70 % auf Stufe ≥ 4; Arbeit pro Kind; PIN 4/6 Stellen + Reset; Antwort-Protokoll nach 400 Tagen löschen; Lernstand bei bearbeiteter Frage zurücksetzen?
Noch zu tun: Test gegen Postgres 17, Rechte auf storage.buckets, Tests von Bug-Bodo für bc_answer/bc_redeem, Rechte-Prüfung durch Sicherheits-Siggi.
