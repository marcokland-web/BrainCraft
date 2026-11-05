# BrainCraft

Lern-App des Familien-App-Studios: Lernstoff aus dem Schulheft wird zum Spiel. Live unter
https://marcokland-web.github.io/BrainCraft/ (Vite + React + TS als PWA, Supabase-Projekt `asfwbuptsfcrgmmgdgim`).

## Anmeldung

- **Eltern-Gerät** (Handy, Mac): „Mit Google anmelden“. Beim ersten Mal legt man die Familie an (erstes Kind,
  Eltern-PIN) oder nimmt eine Einladung an („Annehmen“ / „Ablehnen“).
- **Kinder-Gerät** (z. B. iPad): kein Google. Auf dem Eltern-Gerät im Eltern-Cockpit „Gerät koppeln“ wählen,
  auf dem Kinder-Gerät „Kinder-Gerät verbinden“ und den Code eingeben oder den QR-Code mit der Kamera scannen.
  Danach wählt das Kind nur sein Profil und spielt, auch offline.
- Das **Eltern-Cockpit** (Zahnrad → Eltern-Cockpit) öffnet nur die Eltern-PIN. Auf dem Eltern-Gerät zusätzlich:
  weitere Eltern per Gmail-Adresse einladen, Kinder-Geräte koppeln und entfernen, abmelden (nur hier, auch
  „Auf allen Geräten abmelden“). Auf dem Kinder-Gerät: „Gerät trennen“.
- Wird ein Kinder-Gerät entfernt oder läuft eine Anmeldung ab, spielt das Kind die Runde zu Ende und sieht dann
  „Gleich geht's weiter …“. Sterne und Antworten bleiben auf dem Gerät, bis es neu verbunden ist.

## Einrichten in Supabase (einmalig)

1. Authentication → Providers → **Google** einschalten (Client-ID und Secret aus der Google Cloud Console; dort als
   autorisierte Weiterleitung `https://asfwbuptsfcrgmmgdgim.supabase.co/auth/v1/callback`).
2. Authentication → URL Configuration → Redirect-URLs:
   `https://marcokland-web.github.io/BrainCraft/`, `http://localhost:5173/BrainCraft/`, `http://localhost:8797/BrainCraft/`,
   `http://localhost:5179/braincraft-cli` (Terminal-Werkzeug `tools/braincraft.ts`).
3. Migrationen in dieser Reihenfolge einspielen (jede in einer Transaktion, vorher Probelauf mit Rücknahme):
   `supabase/007_google.sql` → App ausliefern → Altgeräte einmal öffnen (tauschen ihren Familien-Code selbst gegen ein
   Geräte-Token) bzw. neu koppeln → `supabase/008_code_entfernen.sql`.

Bereits installierte App auf dem iPad: Nach dem Update tauscht sie ihren Familien-Code selbst gegen ein
Geräte-Token und spielt weiter (solange 008 noch nicht eingespielt ist). Sterne und Fortschritt bleiben erhalten.

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
