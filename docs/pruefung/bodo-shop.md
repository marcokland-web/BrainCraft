# Prüfbericht Bug-Bodo: Sternen-Shop (28.10.2026)

Getestet wurde der aktuelle Stand vom 28.10.2026 um 21:15, also nach den Änderungen von Lotte und Doris (Hinweis in der Ansicht, Sparziel, shopSoFar, Griff am Sheet).
Test: `tests/store.spec.mjs`, Abschnitte 6 und 6b. Der Test nutzt einen Fake-Server über `context.route`, Service Worker sind blockiert, und keine fremde Anfrage kommt durch. Die echte Datenbank wurde nicht berührt.
Gebaut wurde in einen eigenen Ordner, weil parallel eine andere Vorschau auf `dist/` lief. Die Vorschau lief auf Port 8797 und ist wieder beendet.

**Ergebnis: Chromium 224/224, WebKit 224/224.**

## Was geprüft wird

- **RPC-Argumente:** Für `bc_redeem`, `bc_reward_save` (alle 8), `bc_reward_delete` und `bc_redemption_resolve` prüft der Test die Schlüssel und Werte genau. Der Fake-Server bildet die SQL-Regeln aus `001_braincraft.sql` (ab Zeile 1111) nach: Idempotenz, `not_enough_stars`, Sichtbarkeit je Kind, Höchstzahl, `pin_required` und gültige Werte.
- **Kind:**
  - Es erscheinen nur aktive Belohnungen für alle oder für das eigene Kind, sortiert nach Preis. Belohnungen für Ben und pausierte sind unsichtbar, Bens Gutscheine ebenfalls.
  - „Einlösen“ ist gesperrt, wenn die Sterne nicht reichen. Ein erzwungener Klick öffnet nichts.
  - Geprüft werden außerdem: Fortschrittsbalken (Breite trotz CSP), `aria-valuetext`, shopSoFar und Sparziel, Gutscheinliste mit allen drei Zuständen und die Knopfhöhe von mindestens 60 px.
- **Warteschlange:** Eine offene Antwort geht vor `bc_redeem` an den Server, danach folgt `bc_pull`.
- **Doppelbuchung:**
  - Geht die Antwort verloren, nachdem der Server gebucht hat, nutzt die Wiederholung dieselbe redemptionId und bucht nur einmal.
  - Ein Doppel-Tipp bei langsamem Netz führt zu genau einer Buchung.
  - Eine neue Rückfrage bekommt eine neue ID.
- **Fehlercodes:**
  - `not_enough_stars` und `reward_not_found`: Das Sheet schließt, der Hinweis erscheint in der Ansicht, `bc_pull` folgt.
  - `limit_reached`, 500 und offline: Die Meldung erscheint im Sheet, das Sheet bleibt offen.
- **Probemodus:** Drei Beispiele, nichts einlösbar, keine Anfrage.
- **Eltern:**
  - Gutscheine „Erledigt“ und „Stornieren“, mit roter Rückfrage, Abbrechen und Rückbuchung.
  - Validierung: Name nur aus Leerzeichen, mehr als 60 Zeichen, Sterne `abc`/0/100001/-5/12a3. Die Vorschläge 60/100/300, Symbol und „Für“ werden geprüft.
  - Bearbeiten und Pausieren, Löschen mit roter Rückfrage und Abbrechen.
  - Höchstzahl, ein Kind ohne „Für“, leere Liste mit Vorschlägen.
- **Elternsperre:** `pin_required` führt zurück zur PIN, danach folgt `bc_pull` ohne Token. Im localStorage stehen keine pausierten Belohnungen, weder entsperrt noch nach dem Sperren noch nach dem Pausieren.
- **Darstellung und Sprache:** Kein seitliches Scrollen in drei Größen, jeweils hell und dunkel, für den Kinder-Shop und den Eltern-Shop. Englisch: keine deutschen Wörter, Datum en-GB, Fehlermeldung englisch.

## Gefunden und behoben

1. **Löschen funktionierte nicht** (`src/components/Sheet.tsx`). Der Wechsel vom Formular zur Löschen-Rückfrage schließt das Formular-Sheet. Das native `close`-Ereignis rief dabei `onClose` auf, das `setDraft(null)` setzt. Folge: Die Rückfrage zeigte „„““, und „Löschen“ tat nichts. Jetzt meldet das Sheet `onClose` nur noch, wenn der Browser selbst schließt.
2. **Esc während des Einlösens** (`Sheet.tsx`). Das Sheet war geschlossen, die Ansicht hielt es aber für offen. Die Fehlermeldung war unsichtbar, und danach öffnete „Einlösen“ nichts mehr. Jetzt fragt Esc die Ansicht (`onCancel` mit preventDefault), und das Sheet gleicht bei jedem Zeichnen ab.
3. **bc_redeem trotz hängender Antworten** (`src/lib/store.ts`, `redeem`). Wenn `flush()` an offline oder einem Serverfehler scheiterte, ging `bc_redeem` trotzdem mit veraltetem Stand hinaus. Jetzt bricht `redeem` ab, solange Antworten oder Runden in der Schlange hängen: Meldung „Keine Verbindung“, sonst die allgemeine Fehlermeldung.
4. **Sterne-Feld zeigte „0“ bei Buchstaben** (`src/views/ShopManager.tsx`). Wenn keine Ziffer übrig bleibt, ist das Feld jetzt leer.

Am Test selbst angepasst: Der Setup-Locator `input` und `dialog.confirm` waren durch neue Dialoge mehrdeutig, außerdem war der Leerzustand im Cockpit nicht eindeutig. Erwartete Texte kommen jetzt aus `src/lib/i18n.ts`.

## Hinweise (nicht geändert)

- **Sternpille in der Kopfzeile** (`src/App.tsx:218`): Sie zeigt „1000“ ohne Tausenderpunkt, der Shop zeigt „1.000“. Das ist ein Fall für Doris.
- **Neue Rückfrage nach Netzabbruch:** Schließt das Kind die Rückfrage nach einem Netzabbruch und öffnet sie neu, entsteht eine neue ID. Hatte der Server schon gebucht, ist eine zweite Buchung möglich, wenn die Sterne reichen. Die Eltern können sie stornieren. Abhilfe wäre, die ID je Belohnung bis zum Erfolg zu merken.
- **Server, nicht geprüft:** `bc_reward_save` mit einer fremden `p_id` legt eine neue Zeile mit dieser ID an. Gehört die ID einer anderen Familie, endet das mit `duplicate`. Einen Probelauf auf Supabase habe ich nicht gemacht.
- **WebKit:** Die CSP-Meldung zu Stylesheets entsteht durch `page.screenshot` und ist im Test für WebKit ausgenommen.
