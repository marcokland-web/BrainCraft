# Technik-Toni: Architektur und Betrieb (23.10.2026)

- Kein Next.js/Vercel: Vite + React + TS (wie Gewohnheiten) als PWA auf GitHub Pages; Tailwind/Framer Motion möglich, Tokens aus Designsystem.
- Vision-Analyse als Supabase Edge Function `bc-extract`; Anthropic-Schlüssel nur in Secrets/Vault.
- Datenbank nach Rechenstern-Muster: Schema `braincraft`, RLS an, Zugriff nur über `public.bc_*`-RPCs mit Familien-Code (SHA-256), Missbrauchsgrenzen.
- Eltern-PIN nur gehasht und nur auf dem Gerät.
- Fotos: privater Bucket `bc-scans`, Signed Upload URL; nach Analyse löschen oder befristet behalten.
- Pro Foto ein Aufruf (Laufzeitgrenze, Fortschritt, Wiederholung), Zusammenführen/Deduplizieren danach.
- Structured Outputs/Tool-Schema mit 7 Fragetypen + serverseitige Zod-Prüfung (correct_index 0–3, genau ein [GAP], genau ein Hochstapler).
- Modell: aktuelles Sonnet/Opus statt „Claude 3.5 Sonnet“, ID als Konfiguration.
- Offline: Lernstand lokal (IndexedDB), Leitner-Logik im Client, Sync mit merge3 wie Rechenstern; Sterne als Ereignisprotokoll.
- Audio-Entsperrung wie rechenstern/app.js:266; eigene/lizenzfreie Sounds.
- Vorlesen: onboundary auf iOS unzuverlässig → Rückfall satzweise Hervorhebung.
- Etappen: 0 Entscheidungen · 1 DB · 2 Gerüst/Logo/Manifest/Einstellungen · 3 Engine+Tests · 4 Minigames/Audio · 5 Scan-Pipeline · 6 Wissens-Hub · 7 Shop/Boss/Eltern · 8 Sync · 9 Freigabe.
- Offen/ungeprüft: Edge-Function-Grenzen im Tarif, onboundary auf echtem iPad (Deploy-Dennis vor Etappe 5).

Fragen: Vite statt Next.js? Rechenstern-Muster? Foto-Aufbewahrung? Kostengrenze/Modell? Englisch für KI-Inhalte? Ein Kind oder mehrere?
