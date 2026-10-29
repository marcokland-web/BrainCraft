# Bug-Bodo: Boss-Kampf und Ausrüstung (3. Prüfrunde)

29.10.2026. Geprüft wurde der Stand nach Lern-Lottes Änderungen (lotte-boss.md), Luisas Brauen und Doris' Umbenennung `gear-view`.
Grundlage: Plan A1–A4 (`docs/plan-boss-gemeinsam.md`), Entscheidung 28.10. (Wiederholung ohne Belohnung), Migration 005.

## Ergebnis

**Bestanden, nachdem zwei Fehler behoben waren.** Eine Lücke aus A4 ist noch offen (siehe unten).

| Test | Chromium | WebKit |
|---|---|---|
| `tests/boss.spec.mjs` (neu) | 110/110 | 110/110 |
| `tests/store.spec.mjs` (u. a. Spickzettel/Vorlesen, Abschnitt 7) | 365/365 | 348/348 |
| `tests/arena.spec.mjs` (Arena mit dem gemeinsamen `Assist.tsx`) | 1152/1152 | 1154/1154 |

Gebaut wurde in einen eigenen Ordner mit eigener Vorschau (Port 8823). Der Fake-Server bildet 001 + 005 nach: Tagesgrenze 40
(Boss-Bonus ausgenommen), kein Boss-Stern nach dem Sieg, `bc_boss_win` mit Schwelle `master*10 < total*7`, `duplicate` und
dem nächsten Teil nach `sort` (Lieferung absichtlich gemischt), Rundenbonus nur für solo/chill. Anfragen an fremde Adressen: 0.
Konsolenfehler: 0.

Ein Lauf in Chromium blieb einmal beim Klick auf „Weiter“ nach dem Aufdecken hängen (Zeitüberschreitung, 1 von 6 Läufen).
Nachstellen ließ es sich nicht, und die fünf Läufe danach waren grün. Ich behalte es im Auge.

## Behobene Fehler

1. **Aufgedeckte Frage kam sofort wieder** (`src/views/Boss.tsx`, `next()`). Waren hinter der aufgedeckten Frage weniger als
   zwei Fragen übrig, kam sie direkt noch einmal dran.
   Nachstellen: Arbeit mit 2 Fragen, die erste lösen, die zweite aufdecken. Danach kam die zweite noch einmal.
   Fix: Die Schlange wird vorher mit einer frischen Reihenfolge aufgefüllt (ohne die aufgedeckte Frage). Danach steht sie
   an Platz 3. Bei einer Arbeit mit nur 1 Frage darf sie wiederkommen, wie im Plan vorgesehen.
2. **Falsche Meldung „alle 12 Teile“** (`src/App.tsx`, `onWin`). `queueBossWin` gibt `null` zurück, wenn der Boss schon
   besiegt ist. Das wurde als „kein Teil mehr übrig“ gelesen.
   Nachstellen: Gerät A besiegt die Arbeit. Gerät B kämpft gerade gegen denselben Boss und gleicht mitten im Kampf ab
   (online oder App wieder geöffnet). Beim Sieg stand auf B „Du hast schon alle 12 Teile – diesmal gibt es 10 Sterne!“, gebucht wurde aber nichts.
   Fix: `null` gilt jetzt als Wiederholung (Text „zum Spaß“).

Beide Fälle haben jetzt einen eigenen Prüfpunkt in `tests/boss.spec.mjs`.

## Randfälle aus A4

| Fall | Ergebnis |
|---|---|
| Schwelle: 7 von 10 frei, 6 von 10 nicht | ok; bei 6/10 steht „Kannst du noch 1 Frage sicher, wartet der Blockwächter.“ `Math.ceil(n*0.7)` stimmt für n = 1…500 mit der Server-Formel überein (nachgerechnet). |
| Arbeit mit 1 Frage | ok: 5 Treffer, nur der erste bringt einen Stern (+1 +10). Nach dem Aufdecken kommt die Frage wieder. Danach bringt jeder Treffer nur 1 Block und keinen Stern, also 10 Treffer und +10. |
| Schaden 2/1/0 und Texte | ok: bossHit, bossHitSmall, bossShown mit Namen; eine aufgedeckte Frage, die wiederkommt, bringt −1; die Reihenfolge beginnt mit Fragen auf Stufe ≥ 3 |
| 13. Sieg | ok: Text „alle 12 Teile“, kein Teile-Bild, Server `item_key null`, +10 |
| Sieg offline, später online | ok: Schlange = 5 Antworten + `boss`, übersteht das Neuladen; das Teil und +11 bleiben sichtbar; online in der Reihenfolge Antworten → `bc_boss_win`; die Anzeige stimmt mit dem Server überein |
| Zwei Geräte, gleiche Arbeit offline | ok: 1 Sieg, 1 Teil, +10 nur einmal (dazu je Gerät 1 Antwort-Stern) |
| Arbeit nach dem Sieg gelöscht | ok: Teil bleibt, „aus einer früheren Klassenarbeit“; der nächste Sieg bringt Rennhandschuhe, nicht noch einmal den Helm |
| Wiederholung | ok: Knopf „Nochmal … · Zum Spaß, ohne Sterne“, kein Sofort-Stern, kein zweites `bc_boss_win`, Server bucht 0 |
| Schließen mitten im Kampf | ok: kein Fehler- oder Verlusttext, Antworten bleiben gesendet, kein `bc_round_finish`; der nächste Kampf beginnt mit 10 Blöcken |
| Sofort-Stern bei 39/40 | ok: +1 bis 40, danach keiner mehr; der Sieg bringt trotzdem +10; App und Server zeigen 61 |
| Mehrere Kinder | ok: Ben sieht seine 3 Teile und bekommt als nächstes den Werkzeuggürtel (sort 4); Lia sieht 0 Teile |
| Englisch | ok: „Take on the Block Guardian“, „Pilot helmet … 10 stars“, Lebensbalken-Text auf Englisch |
| 3 Größen × Hell/Dunkel | Start, Ausrüstung, Kampf und Sieg ohne seitliches Scrollen (Screenshots im Scratchpad, Aussehen prüft Doris) |

## Offen (nicht selbst behoben, braucht Text und Zustand)

- **A4 `boss_locked` ohne Hinweis.** Lehnt der Server den Sieg ab, verwirft `flush()` den Eintrag still
  (`src/lib/store.ts`, `catch` „inhaltlicher Fehler“). Beim Abgleich verschwinden dann Teil und +10 ohne Erklärung. Der
  geplante Satz „Deine Eltern haben neue Fragen dazugetan …“ fehlt (`grep boss_locked src` findet nichts).
  Vorschlag: In `flush()` bei `item.kind === 'boss'` und dem Code `boss_locked` eine Marke merken (z. B. `braincraft:bossLocked`
  mit examId). Start bzw. Ausrüstung zeigen den Satz einmal an und löschen die Marke danach. Der Text kommt von Text-Tina.
  Der Test (Abschnitt 8) prüft heute nur, dass kein Fehlertext erscheint und das Teil verschwindet.
- **Hinweis für Doris:** Wenn mehrere Bosse warten, stehen in der Ausrüstung 4 getönte Hinweise untereinander, und das Raster
  rutscht auf dem iPhone unter den Bildrand (Screenshot `gear-iphone-light-webkit.png`). Vorschlag: höchstens einen
  Hinweis zeigen, dazu „und N weitere“.
- Zwei Geräte, **verschiedene** Arbeiten offline: Beide zeigen vorab dasselbe nächste Teil. Beim Abgleich bekommt das zweite
  Gerät vom Server das übernächste, die Anzeige wechselt also. So vorgesehen (der Server wählt), nur zur Kenntnis.

## Teständerungen

- Neu `tests/boss.spec.mjs` (Fake-Server mit 005-Verhalten, `BASE=…`, `BROWSER=webkit`).
- `tests/store.spec.mjs`: Der Routenfilter nutzt jetzt den Ursprung aus `BASE` statt des festen Ports 8797, damit der Test auch in einer eigenen Vorschau läuft.
