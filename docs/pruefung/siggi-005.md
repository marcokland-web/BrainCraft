# Migration 005 Tagesgrenze: Sicherheitsprüfung von Sicherheits-Siggi (28.10.2026)

**Datei:** `supabase/005_tagesgrenze.sql`, md5 `d2711b5455c01f8f2495fb9eadd567cf` (lokal nachgerechnet, stimmt)
**Grundlage:** `docs/pruefung/dieter-005.md`, `supabase/tests/005_tagesgrenze.sql`, `docs/plan-boss-gemeinsam.md` Z. 209–212

## Freigabe: JA

Ich habe keinen Befund, der das Einspielen blockiert. Die Änderung a) unten empfehle ich vor dem Einspielen in 005 aufzunehmen. Sie ist aber keine Bedingung für die Freigabe.

## Wie geprüft

- **Statisch:** 005 Zeile für Zeile gegen 001 gelesen. `diff` von `bc_answer` (001 Z. 956–1054 gegen 005 Z. 85–189) zeigt nur die 3 erwarteten Stellen: `v_exam_id` deklariert, `e.id` mitgelesen, Boss-Sperre Z. 175–179. `book()` unterscheidet sich nur durch `stars_daily_limit()` statt `100`.
- **Live nur lesend** (keine Schreibzugriffe, kein Probelauf von mir): Die Rümpfe von `book`, `bc_answer`, `bc_round_finish` und `bc_boss_win` haben live dasselbe md5 wie in 001 (`ac8fa22f…`, `5e22e5af…`, `a29c0be0…`, `0dd5614e…`). Alle sind SECURITY DEFINER mit `search_path=""`. anon hat EXECUTE auf `bc_*`, aber nicht auf `book`. `stars_daily_limit` gibt es live noch nicht. Außerdem: 12 Teile, 0 Boss-Siege, 0 Inventar, Zeitzone nur `Europe/Berlin`.
- **Kein eigener Probelauf.** Dieters Probelauf mit erzwungener Rücknahme (39/39 bestanden) habe ich nicht wiederholt. Ein Probelauf im geteilten Projekt braucht Marcos eigene Erlaubnis.

## Ergebnisse

| Punkt | Ergebnis | Beleg |
|---|---|---|
| Schema und Zugriff | Neue Objekte liegen nur in `braincraft`. Geändert werden nur `public.bc_answer` und die eigenen `bc_*`. Objekte anderer Apps werden nicht angefasst. | 005 Z. 33, 43, 85, 202 |
| `stars_daily_limit()` | SECURITY INVOKER, `immutable`, `search_path=''`, ohne Tabellenzugriff. Nach `revoke all on all functions in schema braincraft` hat anon kein EXECUTE (Test A2). Weil sie nur aus `book()` heraus läuft, gibt es kein Risiko. | 005 Z. 33–36, 229 |
| `book()`: Rennen um die Grenze | Die Profilzeile wird mit `for update of p` gesperrt, bevor das Ledger summiert wird. Gleichzeitige Antworten eines Kindes laufen deshalb nacheinander, die 40 lassen sich nicht überbuchen. | 005 Z. 47–49, 56–59 |
| Tagesbeginn verschiebbar? | Nein. `families.timezone` setzt keine öffentliche Funktion (nur Standard `Europe/Berlin`, 001 Z. 142). Live ist nur `Europe/Berlin` gesetzt. | grep über `supabase/00*.sql` |
| Boss-Sperre in `bc_answer` | `v_exam_id` stammt aus derselben Abfrage, die Familie und Kind schon prüft (`e.family_id = f and e.profile_id = p_profile_id`). Fremde Arbeiten oder Geschwister sind ausgeschlossen. | 005 Z. 101–105, 175–179 |
| Umgehung mit `mode='solo'` | Das ist möglich, bringt aber nichts zusätzlich: Solo-Antworten bekommen ohnehin Sterne und zählen zur selben Grenze von 40. Die Sperre setzt die Spielregel durch und ist kein Schutz gegen eine manipulierte App. Das ist so in Ordnung. | 005 Z. 55–59 |
| Teile-Liste | Das Update hat feste Werte und bricht ab, wenn nicht genau 12 Teile getroffen werden. Es ändert keine Rechte. Live gibt es 0 Siege und 0 Inventar, also ist niemand betroffen. | 005 Z. 199–222 |
| Rechte-Schleife | Die Liste der Funktionen nur für `service_role` ist wortgleich mit 003 Z. 113–114 und 004 Z. 237–238. | 005 Z. 227–244 |
| Wachstum der Datenbank | Neue Zeilen entstehen nicht. Die Grenze von 1500 Antworten je Familie in 24 h bleibt (Z. 106–109). Familien lassen sich nur per Einladung anlegen (service_role). | – |

## Entscheidungen

### a) `bc_round_finish` nur mit Solo- und Chill-Antworten: **Ja, in 005 aufnehmen** (empfohlen, keine Bedingung für die Freigabe)

Grund: Gegen eine manipulierte App gewinnt man damit nichts, denn sie kann einfach `solo` senden und bleibt bei 40 gedeckelt. Die Regel aus dem Plan („Rundenbonus für Boss und Gemeinsam bewusst gestrichen“, `docs/plan-boss-gemeinsam.md` Z. 218) erzwingt dann aber der Server und nicht nur die App. Sonst könnte eine spätere Boss-Ansicht, die `roundId` mitsendet, nach dem Sieg doch wieder +3 je Kampf holen und damit „Boss nach dem Sieg ohne Sterne“ unterlaufen. Ein Fehlalarm ist ausgeschlossen: Die App sendet `roundId` heute nur mit `solo`/`chill` (`src/App.tsx` Z. 155–161).

Umsetzung (Daten-Dieter), `bc_round_finish` als `create or replace` in 005, Rumpf wie 001 Z. 1058–1071, nur die Zählung ändert sich:

```sql
  if (select count(*) from braincraft.answers
       where profile_id = p_profile_id and round_id = p_round_id
         and mode in ('solo', 'chill')) < 5 then
    raise exception 'round_too_short';
  end if;
```

Kommentar ergänzen: „Nur Arena-Antworten (solo/chill) zählen; Boss und Gemeinsam ohne Rundenbonus (005)“. Die Signatur bleibt gleich, die Rechte-Schleife deckt die Funktion ab.

Zusätzliche Tests:

- R1: 5 Boss-Antworten mit derselben `round_id` → `round_too_short`
- R2: 5 Gemeinsam-Antworten (mit Token) → `round_too_short`
- R3: 4 Solo- und 1 Boss-Antwort → `round_too_short`
- R4: 3 Solo- und 2 Chill-Antworten → +3
- R5: md5 von `bc_round_finish` stimmt mit der Datei überein; anon hat EXECUTE

### b) Nachweis für `bc_boss_win`: **Nein, nicht nötig**

Ein Nachweis wie „mindestens 5 Boss-Antworten in 2 h“ kostet einen Angreifer nichts. Wer den Familien-Code hat, schickt mit `bc_answer` einfach 5 Antworten mit `mode='boss'`. Sicherer wird es dadurch nicht. Dafür kann der Nachweis ehrliche Kinder treffen, etwa wenn auf einem zweiten Gerät Antworten aus der Offline-Warteschlange erst nach dem Sieg ankommen. Das Risiko bleibt ohnehin klein und begrenzt:

- Der Bonus gibt es einmal je Kind und Arbeit (+10 und ein Teil) (001 Z. 1084, Eintrag in `boss_wins`).
- Arbeiten legen nur Eltern an, `bc_exam_save` braucht das Eltern-Token (001 Z. 750). Die Zahl der möglichen Boni bestimmen also die Eltern.
- Die Freigabe bei 70 % Meisterschaft prüft der Server.

**Hinweis für später (nicht 005, schon in 001 so):** Auch die 70 % lassen sich mit einer manipulierten App fälschen. `answered_at` darf bis zu 30 Tage zurückliegen. Mit aufsteigend rückdatierten richtigen Antworten steigt eine Frage in Sekunden mehrere Stufen auf (`bc_answer` Z. 112, 125–127, 144–145). Das schadet vor allem dem eigenen Lernstand, die Sterne bleiben gedeckelt. Wenn wir das irgendwann schließen wollen: Die Leitner-Stufe steigt nur, wenn auch `received_at` (Server-Zeit) mindestens einen Teil des Intervalls nach der letzten Antwort liegt. Das ist ein eigener Baustein mit Lern-Lotte und keine Bedingung für 005.

## Nicht geprüft

- Kein eigener Probelauf (siehe oben). Die Tests R1–R5 laufen erst, wenn Dieter a) eingebaut hat.
- Die App-Seite (Sofort-Stern über 40, Dieter Hinweis 3) habe ich nicht geprüft, denn sie betrifft nur die Anzeige und nicht die Sicherheit.
