# BrainCraft

App des Familien-App-Studios. Chef ist Marco.

- **Regeln:** Es gelten die Studio-Standards und das Designsystem aus `~/Apps/DasTeam/studio/regeln/` (über `~/.claude/rules/` in jedem Projekt aktiv).
- **Team:** Fachaufgaben gehen an die Studio-Agenten (`~/.claude/agents/`, Quelle `~/Apps/DasTeam/studio/agents/`). Vor dem Bauen Plan-Paula; ist BrainCraft eine Lern-App, Lern-Lotte; nach sichtbaren Änderungen Design-Doris, nach Logik Bug-Bodo, bei Daten Daten-Dieter und Sicherheits-Siggi.
- **Befehle:** `/studio-umstellung` (App auf Studio-Stil umstellen), `/studio-freigabe` (vor jeder Auslieferung), `/studio-lektion` (Feedback festhalten).
- **Logo:** Logo-Luisa entwirft das Symbol ausgehend von `~/Apps/DasTeam/studio/brand/vorlage.svg`.
- **Team aktualisieren:** `git -C ~/Apps/DasTeam pull && bash ~/Apps/DasTeam/studio/installieren.sh`

## Technik (Stand 23.10.2026)

- Vite + React + TS als PWA, GitHub Pages unter `/BrainCraft/`; CSS aus Rechenstern übernommen (`src/styles/`), eigene Klassen mit `bc-` oder unter der Ansicht. Texte nur über `src/lib/i18n.ts`, Einstellungen in `src/lib/prefs.ts` (localStorage-Schlüssel mit `braincraft:`).
- Supabase-Projekt „Zähler“ `asfwbuptsfcrgmmgdgim`, geteilt mit Zähler, Gewohnheiten, Rechenstern. Alles in Schema `braincraft` (RLS an, keine Policies), Zugriff nur über `public.bc_*`. Nie Objekte anderer Apps anfassen.
- Migrationen als neue nummerierte Datei in `supabase/`; vorher Probelauf mit erzwungener Rücknahme über die CLI (`cd ~/Apps/Gewohnheiten && npx supabase db query --linked --project-ref asfwbuptsfcrgmmgdgim -f <datei>`), Prüfung durch Bug-Bodo und Sicherheits-Siggi; dauerhaft einspielen startet Marco selbst.
- Entscheidungen: `docs/entscheidungen.md`; Prüfberichte: `docs/pruefung/`.
