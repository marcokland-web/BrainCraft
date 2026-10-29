# Umgebung (geprüft am 23.10.2026)

- Supabase-Projekt „Zähler“ `asfwbuptsfcrgmmgdgim`, geteilt von zaehler-app (public: households, household_members, trackers, entries, push_subscriptions), Gewohnheiten (Schema `gewohnheiten`) und Rechenstern (Schema `rechenstern`).
- Keine Objekte mit `bc_` vorhanden (Tabellen, Typen, Funktionen). Keine Storage-Buckets vorhanden.
- Erweiterungen: pgcrypto, uuid-ossp, pg_cron, pg_net, supabase_vault.
- Rechenstern-Muster (`~/Apps/DasTeam/apps/rechenstern/quelle/supabase/README.md`): eigenes Schema, nicht über die API erreichbar, RLS an ohne Policies; Zugriff nur über `public.rechenstern_*`-Funktionen mit Familien-Code (nur als SHA-256 gespeichert); Grenzen gegen Missbrauch; Daten zuerst lokal, Sync optional („Geräte verbinden“).
- Rechenstern-App: statische Dateien (index.html, app.js, style.css, sw.js) aus einer Quell-HTML, gehostet auf GitHub Pages; Liquid Glass, Studio-Einstellungsmenü, de/en.
