# Schritt 2 ausliefern (KI-Analyse der Heftfotos)

Erst nach Freigabe durch Sicherheits-Siggi und Bug-Bodo. Die Befehle startet Marco selbst (Claude Code darf Änderungen an Supabase nicht selbst ausführen).

## 1. Anthropic-Schlüssel und Ausgabenlimit

1. In der Anthropic-Konsole (console.anthropic.com) einen API-Schlüssel nur für BrainCraft anlegen.
2. Dort unter „Limits“ ein monatliches Ausgabenlimit setzen (Pflicht laut Siggi).
3. Im Supabase-Dashboard: Projekt „Zähler“ → Edge Functions → Secrets → `ANTHROPIC_API_KEY` mit dem Schlüssel anlegen.
   Nicht im Terminal eintippen, damit der Schlüssel nicht in der Befehlshistorie landet.

Optional im selben Dialog:
- `BC_MODEL`: Modell, Standard `claude-opus-5-5`; günstiger: `claude-sonnet-5-5`.
- `BC_EFFORT`: `low`, `medium` (Standard) oder `high`.

## 2. Edge Function ausliefern (vor der Migration, sonst bekommt der neue Zeitplan Fehler)

```
! cd ~/Apps/Gewohnheiten && npx supabase functions deploy bc-extract --workdir ~/Apps/BrainCraft --project-ref asfwbuptsfcrgmmgdgim --no-verify-jwt --use-api
```

`--no-verify-jwt`, weil die App nur den öffentlichen Schlüssel nutzt; die Rechte prüfen die bc_*-Funktionen.

## 3. Migration 002 einspielen

```
! cd ~/Apps/Gewohnheiten && npx supabase db query --linked --project-ref asfwbuptsfcrgmmgdgim -f ~/Apps/BrainCraft/supabase/002_scan.sql
```

## 4. Kontrolle (macht Claude, nur lesend)

- Spalten, Funktionen, Rechte, Bucket nur JPEG, Zeitplan `braincraft-fotos`, Vault-Secret vorhanden.
- Nach 15 Minuten: Antwort des Zeitplans in `net._http_response` ist 200 (`{cleaned, orphans, failed}`).
