# BrainCraft

Lern-App des Familien-App-Studios: Lernstoff aus dem Schulheft wird zum Spiel. Live unter
https://marcokland-web.github.io/BrainCraft/ (Vite + React + TS als PWA, Supabase-Projekt `asfwbuptsfcrgmmgdgim`).

## Anmeldung

- Ein Elternteil meldet das Gerät einmal mit **Google** an („Mit Google anmelden“). Beim ersten Mal legt es die Familie
  an (erstes Kind, Eltern-PIN). Danach wählt das Kind nur noch sein Profil und spielt ohne Anmeldung, auch offline.
- Das **Eltern-Cockpit** (Zahnrad → Eltern-Cockpit) öffnet nur die Eltern-PIN. Dort: Fragen freigeben, Shop,
  Klassenarbeiten, **weitere Eltern per Gmail-Adresse einladen** und **Gerät abmelden** (mit Rückfrage).
- Eingeladene melden sich mit dieser Gmail-Adresse bei BrainCraft an und sehen dann die Einladung mit „Annehmen“ oder „Ablehnen“.

## Einrichten in Supabase (einmalig)

1. Authentication → Providers → **Google** einschalten (Client-ID und Secret aus der Google Cloud Console; dort als
   autorisierte Weiterleitung `https://asfwbuptsfcrgmmgdgim.supabase.co/auth/v1/callback`).
2. Authentication → URL Configuration → Redirect-URLs:
   `https://marcokland-web.github.io/BrainCraft/`, `http://localhost:5173/BrainCraft/`, `http://localhost:8797/BrainCraft/`,
   `http://localhost:5179/braincraft-cli` (Terminal-Werkzeug `tools/braincraft.ts`).
3. Migrationen in dieser Reihenfolge einspielen (jede in einer Transaktion, vorher Probelauf mit Rücknahme):
   `supabase/007_google.sql` → App ausliefern → alle Geräte einmal mit Google anmelden → `supabase/008_code_entfernen.sql`.

Bereits installierte App auf dem iPad: Nach dem Update erscheint einmal „BrainCraft hat eine neue Anmeldung“.
Ein Elternteil tippt „Mit Google anmelden“; Sterne und Fortschritt bleiben erhalten.

## Entwickeln und prüfen

```sh
npm ci
npm run dev                                   # http://localhost:5173/BrainCraft/
TZ=Europe/Berlin node --test tests/store.test.ts tests/session.test.ts
npm run build && npx vite preview --port 8797 --strictPort
node tests/store.spec.mjs                     # ebenso boss, arena, images; reset mit BASE=http://localhost:8797/BrainCraft/
node supabase/tests/007_google.probe.mjs      # Migrationen 007/008 lokal in PGlite (ohne Live-Datenbank)
```

Klassenarbeiten scannen: siehe Eltern-Cockpit → „Klassenarbeit scannen“ und `tools/braincraft.ts`.
