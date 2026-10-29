# Prüfung der Spezifikation: Zusammenfassung (23.10.2026)

Beteiligt: Technik-Toni, Sicherheits-Siggi, Daten-Dieter, Lern-Lotte, Gestaltungs-Greta. Einzelberichte in diesem Ordner.

## Einig im ganzen Team
- DDL der Vorgabe nicht ausführen: public-Tabellen wären für jeden mit dem App-Schlüssel les- und löschbar (anon hat im Projekt automatisch volle Rechte auf neue public-Tabellen). Stattdessen Rechenstern-Muster (Schema `braincraft`, RLS, nur `public.bc_*`-Funktionen mit Familien-Code). Entwurf: `supabase/001_braincraft.sql`.
- PIN nie im Klartext, kein Standard „1234“.
- Bucket `bc-scans` privat; Fotos nach der Analyse löschen oder befristen.
- Next.js-API-Route passt nicht zu GitHub Pages; KI-Schlüssel gehört in eine Supabase Edge Function. Modell „Claude 3.5 Sonnet“ veraltet.
- `user-scalable=no` streichen (Barrierefreiheit), `touch-action: manipulation`.
- Studio-Standards ergänzen: Hell/Dunkel/Automatisch, Deutsch/Englisch, Einstellungsmenü, Icon-Set, Logo, Freigabe.
- Keine Marken: Minecraft, Netherite, Steve, Original-Sounds.
- KI-Fragen brauchen Freigabe durch Eltern und eine Strukturprüfung.

## Widersprüche zwischen Vorschlägen (nach Marcos Entscheidung angleichen)
- Falsche Antwort: Lern-Lotte 2 Stufen zurück; Daten-Dieter zurück auf 1 und sofort fällig.
- Boss-Freischaltung: Lern-Lotte 70 % auf Stufe ≥ 3; Daten-Dieter Stufe ≥ 4.
- Sterne-Tagesdeckel: Lern-Lotte 40; Daten-Dieter 500 (technische Missbrauchsgrenze).
