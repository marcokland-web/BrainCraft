# Didaktische Prüfung: Boss-Kampf und Ausrüstung

Lern-Lotte, 29.10.2026. Nur gelesen, kein Code geändert. Zielkind: Ben, 9 Jahre, Klasse 3.
Grundlage: `src/views/Boss.tsx`, `src/views/Gear.tsx`, `src/views/Start.tsx` (Boss-Abschnitt), `src/lib/i18n.ts` (boss*/gear*),
`src/components/BlockGuardian.tsx`, Screenshot `tests/.shots/luisa/kontakt-light.png`, `docs/plan-boss-gemeinsam.md` (A1–A4),
`docs/begriffe-boss.md`, `docs/entscheidungen.md`, `supabase/005_tagesgrenze.sql`, `src/lib/store.ts`, `src/App.tsx`, `src/views/Arena.tsx`.

**Gesamturteil:** Der Kampf ist fair angelegt (kein Verlust, keine Zeit, Boss greift nie an, Lob für Dranbleiben im Sieg).
Vor der Auslieferung müssen aber drei Texte zur sichtbaren Wirkung passen (P1), aufgedeckte Fragen dürfen beim Wiederkommen
keinen vollen Treffer und keinen Stern bringen, und der Spickzettel aus Plan A3 fehlt.

---

## P1 – vor der Auslieferung beheben

### 1. Treffer-Text passt nicht zu dem, was Ben sieht

- `Boss.tsx` Z. 96: richtig im 1. Versuch = 2 Schaden, d. h. **zwei** Blöcke verschwinden (`BlockGuardian.tsx` Z. 164).
  Text `bossHit` (i18n Z. 64) sagt „Da fliegt **ein** Block.“
- Nach Hinweis = 1 Schaden = **ein ganzer** Block. Text `bossHitSmall` (Z. 65) sagt „Ein **Stück** vom Block bröckelt.“
- Ein Kind zählt nach. Wenn Text und Bild nicht übereinstimmen, versteht es die Regel „2 für sofort richtig, 1 nach Hinweis“ nicht,
  und genau diese Regel soll eigenes Denken belohnen.

| Schlüssel | Deutsch | English |
|---|---|---|
| `bossHit` | Volltreffer! Da fliegen zwei Blöcke. | Direct hit! There go two blocks! |
| `bossHitSmall` | Geschafft! Ein Block fliegt raus. Gut drangeblieben. | You did it! One block flies off. Great perseverance. |

Begründung: Mengen stimmen mit dem Bild; beim Treffer nach Hinweis wird die Mühe gelobt, nicht nur das Ergebnis.

### 2. „Nur noch ein Block!“ erscheint auch bei zwei Blöcken

`Boss.tsx` Z. 108: `left <= 2 ? t.bossAlmost`. Bei 2 verbleibenden Blöcken steht „Nur noch ein Block!“, während zwei zu sehen sind.
Vorschlag: zwei Texte.

| Fall | Deutsch | English |
|---|---|---|
| `left === 2` | Fast geschafft! Noch zwei Blöcke. | Almost there! Two blocks to go. |
| `left === 1` (`bossAlmost`) | Nur noch ein Block! Du schaffst das. | Just one block left! You can do it. |

### 3. Aufgedeckte Frage bringt beim Wiederkommen vollen Schaden und einen Stern

- Nach dem Aufdecken kommt die Frage nach zwei anderen wieder (`Boss.tsx` Z. 115). Dann ist `mistakes` wieder 0 (Z. 124), also
  **2 Schaden** und `firstTry = true` → im ersten Kampf **1 Stern** (`App.tsx` Z. 196, Server `005` Z. 175).
- Das widerspricht der verbindlichen Regel „Sterne nur für eigenes Denken“: Ben hat die Lösung zwei Fragen vorher gesehen.
  Die Arena schickt Wiederholungen deshalb gar nicht (`App.tsx` Z. 158, `a.kind !== 'normal'`).
- **Vorschlag:** Den Boss sich merken lassen, welche Fragen in diesem Kampf aufgedeckt wurden. Beim Wiederkommen gilt richtig wie
  „nach Hinweis“: **1 Schaden, `firstTry = false`** (kein Stern). So lohnt sich das Wiederholen weiter (der Block fliegt),
  aber eigenes Denken bleibt mehr wert.
- Gleiche Frage, wenn die Arbeit nur 1–2 Fragen hat: Ben muss dieselbe Frage mehrfach lösen (Z. 117–119) und bekommt jedes Mal
  einen Stern. Vorschlag: Stern je Frage höchstens einmal je Kampf (Schaden bleibt).

### 4. Spickzettel fehlt im Boss: ja, nötig

- Plan A3 verlangt ihn ausdrücklich („Spickzettel ebenfalls“, `plan-boss-gemeinsam.md` Z. 86–87). Der Boss zieht nach den sicheren
  Fragen auch die **unsicheren** (Stufe < 3, `Boss.tsx` Z. 25). Genau dort braucht Ben „erst verstehen, dann üben“.
- Gleiche Regeln wie in der Arena (`Arena.tsx` Z. 296–322, `entscheidungen.md` Z. 70): nach dem 1. Fehler nur Folientitel,
  nach dem Aufdecken der Folientext. Schaden bleibt 1 bzw. 0, es ändert sich also nichts an der Fairness.
- Text in der Boss-Sprechblase, wenn ein Spickzettel da ist (nach dem 1. Fehler):

| Deutsch | English |
|---|---|
| Brauchst du einen Tipp? Schau in deinen Spickzettel. | Need a tip? Have a look at your cheat sheet. |

### 5. „Noch N Fragen bis zum Blockwächter“ weckt eine falsche Erwartung

- `bossToGo` (`store.ts` Z. 439–444) zählt Fragen, die noch **Stufe 3** erreichen müssen. Das geht nur über richtige Antworten an
  mehreren Tagen (Leitner). Ben liest aber „noch 3 Fragen“ als „noch 3 Fragen beantworten“. Spielt er 3 Fragen und die Zahl
  bleibt, erlebt er das als unfair: „Ich habe doch 3 gemacht!“
- Vorschlag (kein Zeitdruck, ehrlich, Wortschatz Klasse 3):

| Fall | Deutsch | English |
|---|---|---|
| 1 | Kannst du noch 1 Frage sicher, wartet der Blockwächter. | Know 1 more question really well, and the Block Guardian is waiting. |
| k | Kannst du noch {k} Fragen sicher, wartet der Blockwächter. | Know {k} more questions really well, and the Block Guardian is waiting. |

- Ergänzend einmalig (z. B. Hilfe oder erster Kontakt): „Sicher heißt: an verschiedenen Tagen richtig.“ /
  "Really well means: right on different days." Das erklärt auch, warum Üben über mehrere Tage sich lohnt.

---

## P2 – sollte vor der Auslieferung rein

### 6. Brummige Stimmung: nicht zu böse am Anfang, aber zu oft

- Auf dem Screenshot (Zeile „brummig“) wirken die nach innen gesenkten, dicken Brauen und der Mund nach unten **eher verärgert**
  als brummig (`BlockGuardian.tsx` Z. 58–61). Als einmalige Begrüßung mit dem freundlichen Starttext ist das für 9 Jahre in Ordnung.
- Problem: `next()` setzt **bei jeder neuen Frage** wieder `brummig` (`Boss.tsx` Z. 127). Ben schaut also beim Nachdenken jedes Mal in
  ein verärgertes Gesicht, auch nach drei Treffern. Das passt nicht zur Figur „wartet geduldig, freut sich mit“ (`begriffe-boss.md` Z. 50–54).
- **Vorschlag:** `brummig` nur bei der ersten Frage. Danach `geduldig` als Grundstimmung beim Nachdenken (sanftes Lächeln),
  `staunend` nach Treffern, `froh` beim Sieg. So wird der Wächter im Lauf des Kampfs sichtbar freundlicher, wie die Wolke.
- An Logo-Luisa: Brauen bei `brummig` flacher (weniger V), Mund gerade statt nach unten. Die Wolke mit Blitz reicht als „Herausforderung“.

### 7. Wiederholung ohne Belohnung wird erst nach dem Sieg erklärt

- Knopf „Nochmal gegen den Blockwächter“ (`Start.tsx` Z. 127–128) sagt nicht, dass es nichts gibt. Im Kampf gibt es dann auch
  keinen Stern je Antwort (`store.ts` Z. 234, Server `005` Z. 176–178). Erst danach: „Diesmal einfach zum Spaß.“ (i18n Z. 72).
  Ein Kind, das Sterne erwartet, fühlt sich überrascht.
- Ehrlich **vorher** sagen, ohne es klein zu reden:

| Ort | Deutsch | English |
|---|---|---|
| Unterzeile des Knopfs (`bossDone`) | Schon geschafft · zum Spaß, ohne Sterne | Done already · just for fun, no stars |
| Startspruch bei Wiederholung (neu) | Schön, dass du wieder da bist, [NAME]! Diesmal spielen wir nur zum Spaß. Zeig mir, was du noch weißt. | Nice to see you again, [NAME]! This time it’s just for fun. Show me what you still know. |
| Sieg bei Wiederholung (`bossReplayWin`) | Wieder geschafft! Du weißt es immer noch – das ist das Beste. | Done again! You still know it – that’s the best part. |

Begründung: Der eigentliche Gewinn der Wiederholung ist „ich weiß es noch“. Das sagen wir laut, statt nur „zum Spaß“.
Der Boss braucht dafür die Information `replay` schon beim Start (heute nur in `onWin`, `App.tsx` Z. 197).

### 8. Vorlesen der Frage fehlt im Boss: ja, nötig

- Die Arena hat den Lautsprecher an der Frage und liest bei „Automatisch“ jede neue Frage vor (`Arena.tsx` Z. 101–120, 270–272).
  Wer das eingestellt hat (langsamer Leser, Legasthenie, müde am Abend), braucht es im Boss genauso, sonst wird der wichtigste
  Moment zum Lesetest. Gleiche Einstellung `speech`, gleicher Knopf `readQuestion`.
- Die Sprechblase des Wächters muss nicht vorgelesen werden (sonst zu viel Ton).

### 9. Fehlertext mit Hinweis ist zu lang und klingt leicht nach „du warst unaufmerksam“

- Heute in der Blase (Z. 90): „Knapp daneben. Ich warte – schau noch mal genau hin. Welche Antwort passt sicher nicht? Denk sie dir weg.“
  Vier Sätze, zwei Aufforderungen, die sich doppeln. „Schau genau hin“ unterstellt Flüchtigkeit.
- Ohne Druck ist er: keine Strafe, Klicksperre nur 1 s, Hinweis zeigt den Weg, nicht das Ergebnis. Gut.

| Schlüssel | Deutsch | English |
|---|---|---|
| `bossMiss` | Knapp daneben. Ich warte gern. | Not quite. I’m happy to wait. |

Dahinter folgt wie bisher der Denkanstoß je Spielform (`hints`). Ergebnis: zwei kurze Teile, der Hinweis ist die eigentliche Hilfe.

### 10. Aufdecken: Mühe loben

`bossShown` (Z. 68) „So ist es richtig. Die Frage kommt gleich noch einmal.“ ist ehrlich (Z. 115 hält das Versprechen, außer der
Kampf endet vorher). Vorschlag, wie die Arena (`pitStop`):

| Deutsch | English |
|---|---|
| Gut, dass du es probiert hast. So ist es richtig – die Frage kommt gleich noch einmal. | Good that you tried. This is how it goes – the question comes back in a moment. |

---

## Beantwortete Fragen in Kürze

- **Schaden 2/1/0 fair und motivierend?** Ja. Mindestens 5 Fragen, mit Hinweisen höchstens etwa 10; Fehler kosten nichts, der Boss heilt
  nicht. Sichere Fragen zuerst (Z. 25) sorgt für einen guten Start. Bedingung: Befund 3 (Wiederkommen nach Aufdecken = 1, kein Stern)
  und Texte aus Befund 1, damit die Regel sichtbar wird.
- **Fehlertext und Hinweise ohne Druck?** Ja, mit Kürzung aus Befund 9.
- **Brummige Stimmung zu böse?** Als Begrüßung knapp in Ordnung, als Dauerzustand bei jeder Frage zu streng (Befund 6).
- **„Noch N Fragen bis zum Blockwächter“ gut?** Freundlich, aber missverständlich; Ersatz in Befund 5.
- **Wiederholung ohne Belohnung verständlich?** Erst hinterher; vorher ansagen (Befund 7).
- **Spickzettel und Vorlesen im Boss?** Beide ja (Befunde 4 und 8). Der Spickzettel steht ohnehin in Plan A3.

## Ausrüstung (Gear.tsx): passt

- Gewonnene Teile mit Herkunft und Datum, „Nächstes Teil“ mit Namen (Neugier statt Druck), kein Schloss, kein Fragezeichen. Gut.
- `gearEmpty`, `gearCount`, `gearDemo` verständlich. Symbole auf dem Screenshot klar unterscheidbar; „erhalten / noch nicht“ gut erkennbar.
- Klein: `bossWaiting` (Z. 75) passt. Kein Änderungsbedarf.

## Nicht geprüft

- Kein Durchspielen im Browser und keine Prüfung auf Desktop, iPad, iPhone (Aufgabe für Design-Doris); nur Code und ein Screenshot (hell).
- Aufdeck-Zustand je Spielform im Boss nicht einzeln durchgespielt; der Boss nutzt dieselbe Komponente `Game` mit `reveal` wie die Arena.
- Ton `chest`/`wrong` nicht angehört.
