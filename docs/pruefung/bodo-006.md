# Migration 006 Zurücksetzen: Prüfung von Bug-Bodo (29.10.2026)

**Freigabe: ja.** 006 darf so eingespielt werden. Auf der App-Seite gab es einen sichtbaren Fehler und vier Logikfehler. Ich habe sie behoben und mit Tests abgesichert (siehe unten).

- Datei `supabase/006_zuruecksetzen.sql`: md5 `3bebfe7ff2e5ed164f4ea29b5e8e9b25`, vor dem Lauf und danach geprüft. Rumpf `bc_progress_reset`: md5 `79834daaff8946fd282eea74b846d86a`. 006 habe ich nicht geändert.
- Probelauf über die CLI als ein DO-Block mit erzwungener Exception, also mit vollständiger Rücknahme:
  - Dieters Tests (Migration zweimal): **43/43**
  - meine Randfälle (`bodo006.sql`, Migration einmal): **31/31**
- Live-Stand vorher und nachher gleich: `bc_progress_reset` 0, `progress_resets` fehlt, 31 `bc_*`-Funktionen, md5 über Rümpfe und Rechte `9592f26ed5d3b311083a348ce5a04dbb`, 1 Familie, 78 answers, 83 Ledger-Zeilen.

## Randfälle in der Datenbank (alle bestanden)

| Fall | Ergebnis |
|---|---|
| Kind ohne Daten | `ok 1`, alles bleibt 0, kein Fehler |
| Tagesgrenze | Vorher 40 Sterne, die 41. Antwort bucht 0, der Rundenbonus wird gekürzt. Nach dem Zurücksetzen gibt es **am selben Tag wieder volle 40**, die 41. Antwort bucht 0. `bc_pull` zeigt 40/40/1, die Ledger-Summe stimmt mit dem Stand überein |
| Boss | Direkt nach dem Zurücksetzen `boss_locked`, weil der Lernstand fehlt. Mit Stufe 3 gibt es wieder **Pilotenhelm und +10** (über der Grenze), ein zweiter Sieg ergibt `duplicate`. Boss-Antworten bringen vor dem neuen Sieg wieder 1 Stern, nach dem Sieg 0 |
| Shop | Nach neu verdienten Sternen klappt das Einlösen (45). Ein alter Gutschein lässt sich nicht mehr stornieren (`not_found`), es gibt keine Rückbuchung und der Stand bleibt |
| Alle Kinder (eines davon leer) | `ok 3`, alle 0. Belohnungen, Fragen und Arbeiten bleiben, Gutscheine, Siege und Teile sind leer |
| Bremse | Das 5. Zurücksetzen geht, das 6. ergibt `limit_reached`, und `err_code` reicht den Code durch |

## Hinweise zur Datenbank (blockieren nicht, Vorschlag für 007)

1. **Alte IDs werden nach dem Zurücksetzen neu gebucht.** Das bestätigt Dieters Hinweis 1 (Test M5). Eine alte Antwort-ID bringt wieder +1, eine alte Gutschein-ID bucht neu (L2). Ein alter Rundenbonus bleibt geschützt (`round_too_short`). Vorschlag wie bei Dieter: `profiles.progress_reset_at`, dann ignorieren `bc_answer` und `bc_redeem` Einträge, die älter sind. Für die Übergangszeit steht in der App jetzt der Tipp „Öffnet vorher alle Geräte einmal mit Internet“.
2. **Das Zurücksetzen leert auch die Missbrauchsgrenzen**, die aus den gelöschten Tabellen zählen: 1500 Antworten in 24 h, 50 Gutscheine in 24 h, 20 Korrekturen in 24 h. Mit der Bremse sind höchstens 6 Durchläufe am Tag möglich, und auslösen können es nur die Eltern. Das Risiko ist gering. Abhilfe: dieselbe `reset_at`-Grenze oder Zählung über `progress_resets`.
3. **Wettlauf mit `bc_boss_win` (nur theoretisch):** Der Lernstand wird vor der Kindsperre geprüft. Ein gleichzeitiger Sieg kann deshalb direkt nach dem Zurücksetzen landen. Antworten und Gutscheine sind über die Sperre in `book()` sauber.

## App-Seite: Befunde und Korrekturen

| # | Befund | Korrektur |
|---|---|---|
| A1 | **Die Segment-Steuerung „Für: Alle Kinder / Lia / Ben“ war zerschossen.** `.field input` (all:unset, min-height 50) traf auch die Radio-Knöpfe. Ergebnis: eine leere Fläche von 74 px Höhe, darunter ein gewählter Teil von 20 px. Klickbar war sie trotzdem. Die alte Abhilfe galt nur für `.reward-form` | `src/styles/base.css:306` gilt jetzt für jedes `.field .seg input`. **Design-Doris bitte kurz ansehen** |
| A2 | Siggi N2a: Hing beim Zurücksetzen noch eine Antwort in der Leitung, konnte sie nach dem Zurücksetzen ankommen | `src/lib/store.ts:440`: vorher `await flush()` |
| A3 | Siggi N2b: `slice(1)` entfernte nach einer gekürzten oder ersetzten Schlange den falschen Eintrag. Der Fehler ließ sich nachstellen: Während A unterwegs ist, trennen und neu verbinden, dann neue Antwort C. C ging verloren | `store.ts:311` und `:324`: Der Eintrag wird über sich selbst entfernt |
| A4 | Hatte das Zurücksetzen geklappt und scheiterte danach das Nachladen, zeigte die App „Das hat nicht geklappt“. Die Eltern hätten es dann erneut versucht | `store.ts:445` `refresh().catch` |
| A5 | Bei `limit_reached` stand da „Bitte zuerst etwas löschen oder abhaken“, was nicht passt | Neuer Text `resetLimit` (DE/EN, `i18n.ts:292/613`), `Manage.tsx:72`. **Text-Tina bitte prüfen** |
| A6 | Bei `profile_not_found` (Kind auf einem anderen Gerät gelöscht) blieb die Auswahl veraltet | `Manage.tsx:38` lädt neu, `:110` setzt die Auswahl beim Öffnen zurück |

Geprüft und in Ordnung: `applyPull` ersetzt den Stand vollständig und führt nichts zusammen (lokale +1 werden 0). Bei falscher PIN, Sperre, Bremse und fehlender Funktion bleibt die Schlange stehen. `pin_required` sperrt das Cockpit. Esc während des Sendens lässt das Sheet offen. Das Filtern der Schlange ist richtig: bei einem Kind bleiben die Einträge der Geschwister, bei allen wird sie leer.

## Tests

- `tests/store.test.ts`: 5 neue Unit-Tests, insgesamt **24/24**. Gegenprobe: Ich habe jede der Korrekturen A2, A3 und A4 einzeln zurückgenommen, und jedes Mal schlägt genau ein Test fehl.
- `tests/reset.spec.mjs` (neu, Fake-Server, Service Worker blockiert, echte DB nie): **98/98 in Chromium und WebKit**. Abgedeckt sind:
  - iPhone, iPad und Desktop, jeweils hell und dunkel, ohne seitliches Scrollen
  - die Geometrie der Segment-Steuerung (Gegenprobe mit altem CSS: schlägt fehl, Höhe 74 und Auswahl 20)
  - ein Dialog von höchstens 440 px, Knöpfe ab 44 px, roter Knopf
  - PIN falsch und Sperre, ein Kind und alle, die Warteschlange, Esc, alle Fehlercodes, Englisch
- Ältere Specs mit dem neuen Stand: store 359/359, arena 1144/1144, boss 110/110, images bestanden.

**Nicht geprüft:** echte Geräte und Installation (für diese Änderung nicht betroffen). Den Ablauf „zweites Gerät mit alter Warteschlange“ habe ich nur in der Datenbank geprüft (M5, L2), nicht als Ende-zu-Ende-Test. `tests/validate.test.ts` braucht Deno und ist von 006 nicht betroffen, deshalb habe ich ihn nicht laufen lassen.
