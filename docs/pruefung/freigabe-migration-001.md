# Freigabe Migration 001_braincraft.sql (23.10.2026)

Stand md5 100d8cf82f7a1cc85d5a61e967b09f7b

- Bug-Bodo: bestanden, 118/118 Testfälle (supabase/tests/001_logik.sql), vollständiger Probelauf über Supabase-CLI mit erzwungener Rücknahme, Nachkontrolle sauber.
- Sicherheits-Siggi (2. Prüfung): Freigabe JA. H1–N5 behoben und im Probelauf belegt (Einladungen, Obergrenzen, PIN-Sperre nach 3, PIN für pin_set/family_delete, Fehlercodes, book(), cron). Nachkontrolle sauber.
- Offen (niedrig): N2-Rest (fremde ID erkennbar über „duplicate“ statt Neuanlage; Vorschlag: bei Neuanlage immer gen_random_uuid()), Antworten-Grenze je Familie kann Geschwister blockieren, Speicher nach einigen Monaten prüfen.
- Nicht geprüft: Nebenläufigkeit, Edge Function, App-Code (Token-Speicherort, Eltern-Aufgabe bei der Einrichtung).
