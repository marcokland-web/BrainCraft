# Migration 005 Tagesgrenze: Logik-Prüfung von Bug-Bodo (28.10.2026)

**Datei:** `supabase/005_tagesgrenze.sql`, md5 `730a29b4400162ae2456861fdea9d09b` (direkt vor dem Lauf nachgerechnet, stimmt)
**Tests:** `supabase/tests/005_tagesgrenze.sql`, md5 `e76d6efb733fa1a480ebf965a8bd8d06`
**Grundlage:** `dieter-005.md`, `siggi-005.md`, `001_braincraft.sql`, `004_folien.sql` (aktuelles `bc_pull`), `src/lib/store.ts`, `src/App.tsx`

## Freigabe: JA

Kein Befund, der das Einspielen blockiert. Die Hinweise unten betreffen die App oder spätere Migrationen.

## Eigener Probelauf (erzwungene Rücknahme)

Ein äußerer `DO`-Block über die CLI. Darin lief die Migration zweimal ohne begin/commit, danach Dieters Tests und 22 eigene Zusatztests. Am Ende stand eine Exception, die nur die Fehlzeilen ausgibt.

Ergebnis: **`BODO-005 66/66 bestanden`, keine Fehler** (44 von Dieter, 22 von mir).

Nach dem Lauf habe ich live kontrolliert. Die md5 von `book`, `bc_answer`, `bc_round_finish`, `bc_boss_win` und `bc_pull` sind unverändert (Fassung 001/004), `stars_daily_limit` gibt es nicht, Teile und Namen sind wie vorher, es gibt 1 Familie, 0 Boss-Siege und 0 Inventar. Antworten (8 → 15) und Ledger (7 → 14) sind gewachsen. Das kam von echter Nutzung zur selben Zeit: Familie `736cc7a4…`, Solo-Antworten und ein Rundenbonus um 21:44–21:45 Uhr. Von meinen Testfamilien ist nichts geblieben.

### Zusatztests (X1–X22)

| Nr | Fall | Ergebnis |
|---|---|---|
| X1–X2 | 39 + Rundenbonus → +1, danach 0, Stand 40 | OK |
| X3–X4 | 39 + Antwort → 1, dann Chill-Antwort → 0, `bc_pull` 40 | OK |
| X5–X6 | 40 Sterne um 23:59:59 am Vortag (Berlin) → heute +1, `stars_today` 1 | OK |
| X7 | 40 Sterne genau um 00:00:00 heute → 0, `stars_today` 40 | OK |
| X8 | 40 Sterne um 00:30 Berlin (UTC-Vortag) → 0 | OK |
| X9–X13 | Bei 40: Einlösen (−15), Storno (+15 voll) und Korrektur (−10) gehen durch. Sie geben aber keinen Platz frei: danach weiter 0, `stars_today` bleibt 40 | OK |
| X14–X17 | Nach dem Boss-Sieg: Boss-Antwort mit `first_try = null` → 0. Gemeinsam-Abfragen derselben Arbeit → 1. `stars_today` = 1, der Boss-Bonus zählt nicht | OK |
| X18 | Rundenbonus bei 40 → `ok` mit 0, keine Ledger-Zeile | OK |
| X19–X21 | Andere Zeitzone (`Pacific/Kiritimati`, UTC+14): `book` und `bc_pull` setzen den Tagesbeginn gleich, 38 + 3 → +2, `stars_today` 40 | OK |
| X22 | Sortier-Tausch mit einem 13. Teil (künftige Migration) scheitert nicht an UNIQUE | OK |

## Statische Prüfung

- **`book()`**: Die einzige Änderung zu 001 Z. 486–509 ist `100` → `stars_daily_limit()`. Gezählt werden nur positive Beträge der Gründe answer/round/parent_quiz ab Mitternacht der Familie. Das sind dieselben Gründe und derselbe Tagesbeginn wie `bc_pull` in 004 Z. 96–99. Die Zahlen passen also zusammen, belegt durch B7, B11, C14 und X4–X21. Die Sperre `for update of p` liegt vor dem Summieren, gleichzeitige Buchungen laufen deshalb nacheinander. Gleichzeitigkeit kann ich in einer Transaktion nicht testen, nur lesen.
- **`bc_answer`**: Die Boss-Sperre (Z. 177–181) prüft `boss_wins` für Kind und Arbeit. `v_exam_id` stammt aus der Abfrage, die Familie und Kind schon prüft. Der Rest ist wortgleich mit 001.
- **`bc_round_finish`**: Nur solo/chill zählen (Z. 205–209). Das ist nötig, denn die App sendet `roundId: boss.id` auch bei Boss-Antworten (`src/App.tsx` Z. 196). Siggis Satz „App sendet roundId nur mit solo/chill“ stimmt also nicht ganz. Ohne die Änderung in 005 könnte eine spätere Boss-Ansicht +3 holen. Heute ruft keine Boss-Ansicht `queueRoundFinish` auf.
- **Teile**: Der Tausch über negative Werte ist sicher, auch beim zweiten Lauf und mit einem 13. Teil (X22). Der Abbruch bei ≠ 12 Teilen schützt vor Tippfehlern.
- **Wiederholbarkeit**: Die Migration lief zweimal hintereinander ohne Fehler, A7/R5 (md5 der Rümpfe) bestanden.

## App-Seite (`src/lib/store.ts`)

- `queueAnswer` Z. 233–239: Den Sofort-Stern gibt es nur bei `stars_today < STARS_DAILY_RULE` (40, `session.ts` Z. 93) und nicht in der Wiederholung eines schon geschafften Boss-Kampfs (`bossWon`). Das passt zum Server: Antworten bringen immer +1, deshalb ist keine Kürzung auf den Rest nötig.
- `queueBossWin` Z. 257–274: Zeigt +10, ändert `stars_today` nicht (richtig, der Boss-Bonus ist ausgenommen) und wählt das nächste fehlende Teil nach `sort` aus `pull.items`. Das ist dieselbe Wahl wie `bc_boss_win`, sobald der Pull die neue Reihenfolge hat.
- Rundenbonus: Die App zeigt lokal nichts und lädt nach dem Senden neu. Auch hier ist keine Kürzung nötig.

## Hinweise (nicht blockierend)

1. **Siggis Freigabe gilt für Stand 1** (md5 `d2711b54…`), nicht für den Stand, der eingespielt werden soll (`730a29b4…`). Neu ist nur `bc_round_finish` nach Siggis eigenem Vorschlag a). Eine kurze Bestätigung von Siggi für Stand 2 wäre sauber.
2. **App über Mitternacht offen:** `stars_today` stammt bis zum nächsten Laden vom Vortag. Wer am Vortag 40 erreicht hat, sieht am neuen Tag bis zum ersten Rundenende keine Sofort-Sterne, obwohl der Server bucht. Es betrifft nur die Anzeige und korrigiert sich selbst. Vorschlag: In `queueAnswer` `stars_today` als 0 behandeln, wenn `pull.today` nicht mehr der heutige Tag der Familie ist, oder bei `visibilitychange` neu laden.
3. **Teile-Vorhersage mit altem Pull:** Hat ein Gerät noch den Pull von vor 005 und gewinnt einen Boss, bevor es neu geladen hat, zeigt es nach alter Reihenfolge „Blockschild“, der Server vergibt aber den „Werkzeuggürtel“. Nach dem Neuladen stimmt es. Weil die App beim Start lädt (`store.ts` Z. 489) und es live 0 Siege gibt, ist das Risiko sehr klein.
4. **Apostroph EN:** In der DB steht `Winner's trophy` (gerade), in `i18n.ts` Z. 343 `Winner’s trophy` (typografisch). Die App nimmt i18n, die DB ist nur Ersatz. Bei der nächsten Gelegenheit angleichen.
5. **Schon in 001 so:** Ein Rundenbonus bei 40 hinterlässt keine Ledger-Zeile. Wird dieselbe `round_id` an einem späteren Tag noch einmal gesendet, bucht sie dort +3. Das geht nicht über die Grenze hinaus und ist deshalb harmlos.
6. Antworten, die offline gegeben und erst nach Mitternacht gesendet werden, zählen zum neuen Tag (Ledger-Zeit = Serverzeit). `book` und `bc_pull` sind sich darin einig.

## Decken die Tests das Wesentliche ab?

Dieters 44 Tests decken die Kernfälle ab: 38 + 3, genau 40, Boss vor und nach dem Sieg, Gemeinsam, Rundenbonus, Teile und Rechte. Es fehlten der Tageswechsel an der echten Mitternachtsgrenze (B9 nimmt nur „vor 24 h“), 39 + 3, Einlösen, Storno und negative Korrektur bei 40, eine andere Zeitzone sowie der Rundenbonus bei 40. Das decken jetzt X1–X22 ab. Vorschlag: X1–X22 in `supabase/tests/005_tagesgrenze.sql` übernehmen. Die Datei liegt unter `/private/tmp/claude-502/-Users-marcokland-Apps-BrainCraft/c320fd2a-dd20-4278-af79-91eb3953cf77/scratchpad/bodo_tests.sql` und braucht `pg_temp.chk/kid/ex/q/earn/bal` aus Dieters Datei.

## Nicht geprüft

- Echte Gleichzeitigkeit (zwei Sitzungen buchen zugleich), nur statisch über die Sperre.
- Sommerzeit-Umstellung im Lauf (der Wechsel liegt in Berlin um 2/3 Uhr, Mitternacht gibt es immer).
- Die App im Browser (keine sichtbare Änderung beauftragt, kein Playwright-Lauf).
