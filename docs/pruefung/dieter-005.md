# Migration 005 Tagesgrenze: Bericht von Daten-Dieter (28.10.2026)

**Datei:** `supabase/005_tagesgrenze.sql`, md5 `730a29b4400162ae2456861fdea9d09b` (Stand 2, mit `bc_round_finish`; Stand 1 war `d2711b54…`)
**Tests:** `supabase/tests/005_tagesgrenze.sql`, md5 `e76d6efb733fa1a480ebf965a8bd8d06`
**Stand:** Entwurf, Probelauf bestanden (44/44); Sicherheits-Siggi hat freigegeben (`siggi-005.md`), **noch nicht eingespielt.** Das Einspielen startet Marco.
Vorher prüfen Bug-Bodo und Sicherheits-Siggi.

## Was die Migration ändert

| Teil | Änderung |
|---|---|
| `braincraft.stars_daily_limit()` | neu, liefert 40. Das ist die einzige Stelle mit der Zahl. Nur intern, anon hat kein EXECUTE. |
| `braincraft.book()` | `100` ersetzt durch `braincraft.stars_daily_limit()`, sonst wortgleich mit 001. Gekürzt wird weiter auf den Rest (38 + 3 → +2). |
| `public.bc_answer` | Im Modus `boss` gibt es keinen Stern mehr, sobald `boss_wins` für Kind und Klassenarbeit der Frage einen Eintrag hat. Die Antwort wird trotzdem protokolliert, der Rest bleibt wortgleich mit 001 (4 Stellen geändert). |
| `public.bc_round_finish` | Nach Siggis Entscheidung a) zählen für den Rundenbonus nur Antworten mit `mode in ('solo','chill')`. Boss- und Gemeinsam-Runden bekommen kein +3. Sonst wortgleich mit 001 Z. 1056–1071, Signatur gleich. |
| `braincraft.items` | Endgültige Teile-Liste von Greta: Namen DE/EN und neue Reihenfolge (guertel 4, schild 5, umhang 6, fernglas 7, kompass 8). `sort` wird erst auf den negativen Wert gesetzt und dann umgedreht, weil `sort` UNIQUE ist. Die Migration bricht ab, wenn nicht genau 12 Teile getroffen werden. |
| Rechte | Dieselbe Schleife wie in 003/004 |

Unverändert bleiben `bc_pull` (`stars_today` zählt dieselben Gründe ab demselben Tagesbeginn) und `bc_boss_win`.

## Antworten auf die Prüffragen

- **Gemeinsam-Abfragen** bucht mit dem Grund `parent_quiz` (001, Z. 1047) und zählt zur Grenze (Test B9/B10).
- **Boss-Antworten** buchen mit dem Grund `answer` und zählen zur Grenze (C1, C12).
- Der **Boss-Siegbonus** (`boss`) ist von der Grenze ausgenommen: Er bringt auch bei 40 die vollen +10, und `stars_today` bleibt 40 (C13, C14).
- **Zweiter Sieg:** `bc_boss_win` liefert schon in 001 `{ok:true, duplicate:true}` ohne Buchung und ohne Teil. Ledger, Stand und Inventar bleiben gleich (C7, C8). Dafür war keine Änderung nötig.
- **Boss-Antwort nach dem Sieg:** Bisher gab es dafür 1 Stern, deshalb ist das in 005 geändert. Jetzt gibt es 0 (C4–C6). Arena-Antworten derselben Arbeit bringen weiter Sterne (C9), Boss-Antworten einer anderen, noch nicht besiegten Arbeit auch (C10).

## Probelauf

Gesendet wurde ein äußerer DO-Block über die CLI: Migration zweimal (prüft, dass sie sich wiederholen lässt), dann die Tests, am Ende eine erzwungene Exception. Ergebnis: **`BRAINCRAFT-005 39/39 bestanden`**. Die CLI kürzt die Meldung, deshalb lief ein zweiter Durchgang, der dieselben Ergebnisse in umgekehrter Reihenfolge ausgibt. So sind alle 39 Zeilen einzeln als OK gesehen.

- A: Grenze = 40; anon ohne Rechte auf `stars_daily_limit`/`book`/Schema; anon darf `bc_answer`; `search_path=''`; md5 der Rümpfe stimmt mit der Datei überein
- B: 38 + 3 → +2; bei 40 bringen Arena, Gemeinsam und Rundenbonus 0; Korrektur nicht begrenzt; Sterne von gestern zählen nicht; schon 60 am Einspieltag → 0, kein Abzug
- C: Boss wie oben
- D: Reihenfolge und Namen der Teile; der erste Sieg bringt den Pilotenhelm; nach helm/handschuhe/stiefel kommt erst der Werkzeuggürtel, dann der Blockschild

Danach war live nichts geblieben: Vorher- und Nachher-Stand stimmen überein (md5 von book/bc_answer/bc_boss_win/bc_pull, items, Ledger 7 Zeilen, Antworten 8, Profile 1, inventory 0, boss_wins 0).

## Hinweise

1. **Teile neu sortiert:** Live gibt es noch keine Boss-Siege und kein Inventar (0/0). Die neue Reihenfolge betrifft also niemanden.
2. **Offline-Randfall:** Antworten aus dem ersten Kampf, die erst nach dem Sieg ankommen (z. B. von einem zweiten Gerät), bekommen keinen Stern mehr. Auf demselben Gerät stehen sie in der Warteschlange vor dem Sieg, das passt also. Auf das vom Gerät gemeldete `answered_at` stütze ich mich bewusst nicht, weil man es zurückdatieren könnte.
3. **App (nicht Teil von 005):** Der Sofort-Stern in `src/lib/store.ts` Z. 229–234 zählt auch über 40 hoch. Er sollte bei `stars_today >= STARS_DAILY_RULE` (`src/lib/session.ts` Z. 93, = 40) ausbleiben. Sonst springt die Anzeige beim nächsten Abgleich zurück.
4. **Rundenbonus:** Die Lücke, dass `bc_round_finish` auch Boss- und Gemeinsam-Antworten mitzählte, ist in Stand 2 geschlossen (siehe Nachtrag).
5. **Kommentar in 001 Z. 18** nennt noch „100 pro Tag“. 001 ist eingespielt und bleibt deshalb unverändert. Gültig ist ab 005 die Funktion `stars_daily_limit()`.

## Nachtrag 28.10.2026: `bc_round_finish` (Siggi a)

- Eingebaut wie in `siggi-005.md` beschrieben. md5 des Rumpfs: `937f6a92098f1fe83ea753fcb01f7cb1`, live vorher `a29c0be0…` (Fassung 001).
- Neue Tests: R1 5 Boss-Antworten → `round_too_short`; R2 5 Gemeinsam-Antworten → `round_too_short`; R3 4 Solo + 1 Boss → `round_too_short`; R4 3 Solo + 2 Chill → +3; R5 md5 stimmt mit der Datei, anon hat EXECUTE, `search_path=''`, SECURITY DEFINER.
- Neuer Probelauf mit zwei Durchgängen (vorwärts und rückwärts, wegen der gekürzten Ausgabe): beide melden **`BRAINCRAFT-005 44/44 bestanden`**. Einzeln sichtbar waren Zeilen 1–20 und 26–44. Zeilen 21–25 (C2–C6) sind in diesem Lauf nur über die Summe 44/44 belegt, im ersten Lauf (39/39) waren sie einzeln OK.
- Vorher- und Nachher-Stand live sind gleich, jetzt einschließlich md5 von `bc_round_finish`. Es ist nichts geblieben.
