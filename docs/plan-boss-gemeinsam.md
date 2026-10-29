# Plan: Boss-Fight + Ausrüstung, Gemeinsam-Abfragen

Plan-Paula, 28.10.2026. Nur Planung, noch kein Code. Grundlage: `docs/spezifikation.md`, `docs/entscheidungen.md`,
`docs/pruefung/lern-lotte.md`, `docs/pruefung/gestaltungs-greta.md`, `supabase/001_braincraft.sql`, `supabase/004_folien.sql`,
`src/App.tsx`, `src/views/{Arena,Start,Parents}.tsx`, `src/lib/{session,store}.ts`.

Wer nutzt es? **Ben (9)** spielt den Boss und schaut seine Ausrüstung an. **Mama oder Papa** halten beim Gemeinsam-Abfragen
das Gerät, Ben antwortet mündlich (Auto, Abendessen, Sofa).

Wo die Spezifikation und die Entscheidungen auseinandergehen, gelten die Entscheidungen: **10 Lebenspunkte** (nicht 15),
**+1 Stern** beim Gemeinsam-Abfragen (nicht +5), keine Herzen, nie Strafe.

---

## 1. Was der Server schon kann (nachgelesen)

| Punkt | Stand im Server | Beleg |
|---|---|---|
| Teile-Liste | `braincraft.items`: 12 feste Teile mit `item_key`, `title_de`, `title_en`, `sort` (Platzhalter) | 001, Z. 339–350 |
| Inventar | `inventory` je Kind, jedes Teil höchstens einmal (`unique (profile_id, item_key)`), `exam_id` bleibt beim Löschen der Arbeit als `null` | 001, Z. 353–362 |
| Boss-Siege | `boss_wins` je Kind und Arbeit höchstens einer (PK), Löschen der Arbeit löscht den Sieg (cascade) | 001, Z. 365–373 |
| `bc_boss_win(p_code, p_profile_id, p_exam_id)` | prüft Kind und Arbeit der Familie; Sieg schon da → `{ok, duplicate}`; **Schwelle 70 % der freigegebenen, aktiven Fragen auf Stufe ≥ 3** (sonst `boss_locked`); **Teil wählt der Server**: das nächste fehlende nach `sort`; ab 12 Teilen `item_key = null`; bucht **+10 Sterne** (Grund `boss`, Bezug Arbeit, ausgenommen von der Tagesgrenze). Kein Eltern-Token nötig. | 001, Z. 1073–1109; `book()` Z. 486–510 |
| `bc_answer` Modus `boss` | Leitner bleibt unverändert (nur Zähler); **1 Stern je richtig im 1. Versuch** (Grund `answer`, zählt zur Tagesgrenze) | 001, Z. 996–1008, 1044–1047 |
| `bc_answer` Modus `eltern` | verlangt gültiges Eltern-Token (`p_token`), sonst `pin_required`; **Leitner ändert sich wie bei Solo** (nicht eingefroren, außer Vorabend); **1 Stern je „richtig“, unabhängig von `first_try`** (Grund `parent_quiz`, zählt zur Tagesgrenze) | 001, Z. 970–971, 996, 1044–1047 |
| Tagesgrenze | technisch **100** Sterne/Tag für `answer`, `round`, `parent_quiz`; gekürzt auf den Rest. Die Spielregel 40 ist **nirgends umgesetzt** (nur Konstante `STARS_DAILY_RULE` in `src/lib/session.ts` Z. 93, ungenutzt) | 001, Z. 497–503 |
| Eltern-Token | 15 Min. gültig, **nicht gleitend**; App hält es 14 Min. nur im Speicher; Cockpit sperrt nach 3 Min. ohne Bedienung oder beim Verlassen | 001, Z. 419–434; `store.ts` Z. 145, 311; `Parents.tsx` Z. 18, 107–133 |
| `bc_pull` | liefert `items`, `inventory`, `boss_wins` (auch in 004) | 001, Z. 676–680; 004, Z. 125–129 |

**Ergebnis: Für A und B ist keine Migration nötig.** Eine Migration 005 braucht es nur, wenn Marco bei Frage 2 (Tagesgrenze 40
auf dem Server) mit Ja antwortet; dann kommen die neuen Teile-Namen gleich mit hinein (siehe 4.).

### Befunde im Client, die die Umsetzung beachten muss

1. **Gemeinsam-Antworten dürfen nicht in die bestehende Warteschlange.** `flush()` sendet kein `p_token` (`store.ts` Z. 254–258).
   Eine `eltern`-Antwort scheitert dort mit `pin_required` und wird als „inhaltlicher Fehler“ still verworfen (Z. 274). Das Token
   darf auch nicht in die gespeicherte Schlange (Siggi N2). → Gemeinsam-Antworten direkt und online senden (wie `redeem`).
2. **Boss-Sterne:** `queueAnswer` zeigt im Modus `boss` keinen Sofort-Stern (`store.ts` Z. 214), der Server bucht aber einen.
   → Anzeige an den Server angleichen.
3. **Rundenbonus:** `bc_round_finish` zählt Antworten jeder Art mit derselben `round_id` (001, Z. 1063). Boss und Gemeinsam
   rufen `bc_round_finish` nicht auf (kein +3), sonst wären es mehr Sterne als beschlossen.
4. **`Pull`-Typ** kennt `items`, `inventory`, `boss_wins` noch nicht (`store.ts` Z. 53–66).
5. Im Eltern-Modus enthält der Stand auch **Entwürfe**. Gemeinsam-Abfragen nur mit freigegebenen Fragen (Server erzwingt es
   ohnehin mit `question_not_found`).

---

## 2. User Stories mit Kriterien für „fertig“

### A1 Ausrüstung ansehen (Tab „Ausrüstung“)

*Als Ben will ich sehen, welche Ausrüstungsteile ich schon habe und welches als Nächstes kommt, damit ich weiß, wofür sich der Boss lohnt.*

Fertig, wenn:
- Der Tab zeigt ein Raster mit allen 12 Teilen in der Reihenfolge `sort` und oben „3 von 12 Teilen“ (Zahl aus `inventory` des aktuellen Kindes).
- Gewonnene Teile: goldenes Linien-Symbol, Name, darunter „aus: <Titel der Arbeit>“ und das Datum („20. Oktober 2026“);
  ist die Arbeit gelöscht: „aus einer früheren Klassenarbeit“.
- Fehlende Teile: Umriss in `--ink-2` ohne Namen; das **nächste** Teil ist als „Nächstes Teil“ hervorgehoben (Name sichtbar, Neugier).
- Leerer Zustand behält den Text `gearEmpty`; die 12 Umrisse sind trotzdem zu sehen.
- Gibt es einen freigeschalteten Boss, steht oben ein Hinweis mit Knopf „Boss wartet: <Arbeit>“, der den Kampf startet (siehe A2).
- Namen kommen aus dem Wörterbuch in `src/lib/i18n.ts` über `item_key` (Server-Titel nur als Ersatz für unbekannte Schlüssel). DE/EN umschaltbar.
- Mehrere Kinder: nur das Inventar des gewählten Kindes. Probemodus: Raster mit Umrissen und Hinweis „Im Probemodus gibt es noch keine Teile“.
- Desktop, iPad, iPhone in Hell und Dunkel ohne seitliches Scrollen; Kacheln mindestens 60 px (Kinder-Regel); Karten nicht aus Glas.

**Gestrichen (Paula):** Teile „anlegen“ am Avatar, Teile selbst aussuchen, Teile tauschen. Dafür gibt es kein Feld auf dem Server;
erst wenn Ben danach fragt.

### A2 Boss freischalten und starten

*Als Ben will ich sehen, wann ich gegen den Boss einer Klassenarbeit kämpfen darf.*

Fertig, wenn:
- Auf „Start“ zeigt jede Arbeit mit `mastery() ≥ 0,7` (gleiche Rechnung wie der Server: freigegebene, aktive Fragen, Stufe ≥ 3,
  `store.ts` Z. 415–420) einen eigenen Knopf „Boss-Kampf“ (mindestens 60 px, getönt; Hauptknopf bleibt höchstens einer je Ansicht).
- Unter 70 % kein gesperrter Knopf und kein Countdown, sondern im Ring-Text ein freundlicher Stand: „Noch 2 Fragen bis zum Boss“
  (Anzahl = fehlende Fragen auf Stufe ≥ 3, aufgerundet). Kein Druck, keine Zeitangabe.
- Arbeit schon besiegt: statt des Knopfes eine kleine Plakette „Boss besiegt“ mit dem gewonnenen Teil. Kein zweiter Kampf (siehe Frage 3).
- Boss geht auch am Vortag und am Tag der Arbeit (Leitner wird ohnehin nicht verändert) und offline.

### A3 Boss-Kampf spielen

*Als Ben will ich in einem Kampf zeigen, was ich kann, ohne Angst vor Fehlern.*

Fertig, wenn:
- Der Boss hat **10 Lebenspunkte**, sichtbar als Balken aus 10 Blöcken (keine Herzen, keine Lebenspunkte für Ben).
- **Schaden nach Lern-Lotte:** richtig im 1. Versuch = 2, richtig nach Hinweis = 1, aufgedeckt = 0. Also mindestens 5 Fragen.
- Fehler kosten nichts: gleiche Klicksperre (1 s), Denkanstoß und Aufdeck-Regeln wie in der Arena (`Arena.tsx` Z. 137–154),
  Spickzettel ebenfalls. Der Boss „greift nie an“ und heilt sich nicht.
- Fragen: aus der gewählten Arbeit (`unlockedQuestions`), zuerst Stufe ≥ 3 gemischt, dann die übrigen; danach von vorn.
  Nie dieselbe Frage zweimal hintereinander (außer die Arbeit hat nur eine). Aufgedeckte Fragen kommen nach zwei anderen wieder.
- Jede Antwort geht mit `mode: 'boss'` und eigener `round_id` in die Warteschlange; Sofort-Stern bei „richtig im 1. Versuch“ wie der Server.
  Kein `bc_round_finish`.
- Schließen ist jederzeit möglich ohne Verlust-Text („Der Boss wartet auf dich.“). Der Kampf beginnt dann beim nächsten Mal neu
  (Lebenspunkte werden nicht gespeichert; bewusst einfach).
- Fortschritt oben: Lebensbalken statt Fragenzähler; Screenreader liest „Boss: 6 von 10 Lebenspunkten“.

### A4 Sieg und Belohnung

*Als Ben will ich nach dem Sieg sofort sehen, was ich gewonnen habe.*

Fertig, wenn:
- Bei 0 Lebenspunkten: Sieg-Ansicht mit „+10 Sterne“ und dem neuen Teil (Symbol groß, Name). Das Teil zeigt die App sofort
  (gleiche Regel wie der Server: nächstes fehlendes nach `sort`); der Server bestätigt beim nächsten Abgleich.
- `bc_boss_win` geht als neuer Eintrag `kind: 'boss'` in die **gespeicherte Warteschlange** hinter die Boss-Antworten
  (offline sicher, doppelt senden harmlos, weil der Server `duplicate` liefert).
- Antwortet der Server `boss_locked` (Eltern haben inzwischen Fragen geändert): kein Fehlertext an Ben, sondern beim nächsten Öffnen
  „Deine Eltern haben neue Fragen dazugetan. Übe sie, dann kommt der Boss wieder.“; das vorab gezeigte Teil verschwindet beim Abgleich.
- Alle 12 Teile schon da (`item_key = null`): „Du hast schon die ganze Ausrüstung! Dafür gibt es +10 Sterne.“
- Lob für Mühe, nicht nur Ergebnis („Du bist drangeblieben, bis der Boss umgefallen ist.“). Kein Konfetti-Dauerfeuer, Ton `chest`.
- Tests (Bug-Bodo): Schwelle genau 70 % (7 von 10 frei, 6 von 10 gesperrt), Arbeit mit 1 Frage, 13. Sieg, Sieg offline und
  später online, zwei Geräte gleichzeitig, Arbeit nach dem Sieg gelöscht.

### B1 Gemeinsam-Abfragen starten

*Als Mama oder Papa will ich Ben ein paar Fragen mündlich stellen, ohne dass er etwas tippen muss.*

Fertig, wenn:
- Im Eltern-Cockpit gibt es den Abschnitt „Gemeinsam abfragen“ (über „Fragen freigeben“): Kind wählen (nur bei mehreren Kindern),
  dann Klassenarbeit oder „Alles, was fällig ist“.
- Die Runde hat höchstens 10 Fragen und nutzt `buildRound` (fällige zuerst); am Vortag/Tag der Arbeit 5 Fragen wie Chill (Stufe 3–5).
- Nur freigegebene Fragen. Gibt es keine: „Für <Name> gibt es gerade nichts abzufragen.“

### B2 Abfragen und bewerten

*Als Elternteil will ich die Frage vorlesen, die Lösung sehen und mit einem Tipp sagen, ob Ben es wusste.*

Fertig, wenn:
- Je Frage: Fragetext groß, darunter je Spielform eine **mündliche Fassung** (Multiple Choice mit den 4 Antworten; Lückensatz mit „…“;
  Sortieren „Was gehört zu <Kasten>?“; Detektiv „Welcher Satz stimmt nicht?“; Blasen „Nenne alles, was <Regel>“; Paare „Was gehört zu <links>?“;
  Reihenfolge „Bring in die richtige Reihenfolge“). Texte prüft Lern-Lotte.
- Die Lösung ist zuerst verdeckt („Lösung zeigen“, damit Ben nicht mitliest) und nutzt die vorhandene Funktion `solution()` aus `Parents.tsx` Z. 77–87.
- Zwei Knöpfe: **„Gewusst (+1 Stern)“** (Hauptknopf) und **„Nochmal üben“** (schlicht, **nicht rot**).
- Vorlesen-Knopf wie in der Arena, falls eine Stimme da ist.
- Antwort geht **direkt** an `bc_answer` mit `p_mode: 'eltern'`, `p_token`, `p_correct` (Gewusst = true), `p_first_try: true`, fester
  `p_answer_id` je Frage. Nicht in die gespeicherte Warteschlange (Befund 1).
- Offline oder Serverfehler: Hinweis „Keine Verbindung. Nochmal tippen.“; erneutes Tippen nutzt dieselbe Antwort-ID (kein Doppelstern).
- `pin_required` (Token abgelaufen): PIN-Tastatur, danach weiter bei derselben Frage. Die 3-Minuten-Sperre und das Sperren beim Verlassen
  der App bleiben unverändert (Sicherheit vor Bequemlichkeit).
- Keine Lösung, kein Token und keine Eltern-Antwort landet in `localStorage`.

### B3 Abschluss

Fertig, wenn:
- Abschluss-Ansicht für beide: „7 gewusst, 3 üben wir nochmal“ und die tatsächlich gebuchten Sterne (Summe von `stars_booked`).
- Bei erreichter Tagesgrenze freundlich: „Für heute sind alle Sterne gesammelt. Das Üben zählt trotzdem.“
- Danach `refresh()`, damit Sterne und Lernstand stimmen. Kein Rundenbonus.

---

## 3. Offene Fragen an Marco (mit Empfehlung)

1. **Soll Gemeinsam-Abfragen den Lernstand (Leitner) ändern?** Heute macht der Server das wie im Solo-Spiel: „Gewusst“ = Stufe hoch
   (wenn fällig), „Nochmal üben“ = 2 Stufen zurück.
   **Empfehlung: Ja, so lassen.** Die Eltern prüfen genauer als jedes Spiel, und „Nochmal üben“ bringt die Frage nur früher wieder,
   Ben sieht davon nichts. Keine Migration nötig. (Alternative „eingefroren wie Boss“ braucht Migration 005.)
2. **Spielregel 40 Sterne am Tag: auf dem Server erzwingen?** Heute gilt nur die technische Grenze 100.
   **Empfehlung: Ja, Migration 005** ändert in `braincraft.book()` die Grenze von 100 auf 40 (gilt für Arena, Rundenbonus, Gemeinsam;
   Boss-Bonus bleibt ausgenommen). Nur dann ist der Wert auf allen Geräten gleich und die Shop-Preise 60/100/300 bleiben stimmig.
   In dieselbe Migration kommen die neuen Teile-Namen (`update braincraft.items set title_de/title_en`), damit Server und App gleich heißen.
3. **Boss nach dem Sieg nochmal spielen?** Der Server gibt dann nichts mehr außer 1 Stern je Antwort.
   **Empfehlung: Nein, vorerst nicht.** Der Boss bleibt ein besonderer Moment je Klassenarbeit; Wiederholen kommt nur, wenn Ben danach fragt
   (dann als „Übungskampf“ ohne Teil, ohne Migration).

---

## 4. Vorschlag Begriffe (für Gestaltungs-Greta zur Entscheidung)

**Vorschlag von Plan-Paula, nicht beschlossen.** Themen-Mix Fliegen / Rennen / Bauen, eigene Begriffe (keine Marken), kindgerecht,
von „einfach“ zu „besonders“. Die Schlüssel (`item_key`) bleiben, damit keine Migration nötig ist; nur die Namen ändern sich.
Jedes Teil bekommt ein goldenes Linien-Symbol (Logo-Luisa).

| sort | item_key (bleibt) | Deutsch | English | Welt | Symbol-Idee |
|---|---|---|---|---|---|
| 1 | helm | Pilotenhelm | Pilot helmet | Fliegen | Helm mit Visier |
| 2 | handschuhe | Rennhandschuhe | Racing gloves | Rennen | Handschuh mit Streifen |
| 3 | stiefel | Turbo-Stiefel | Turbo boots | Rennen | Stiefel mit Flammenstrich |
| 4 | schild | Würfelschild | Cube shield | Bauen | Schild aus Würfelflächen |
| 5 | umhang | Windumhang | Wind cape | Fliegen | Umhang mit Windlinien |
| 6 | guertel | Werkzeuggürtel | Tool belt | Bauen | Gürtel mit Hammer |
| 7 | kompass | Sternenkompass | Star compass | Fliegen | Kompass mit Stern als Nadel |
| 8 | fernglas | Tower-Fernglas | Tower binoculars | Fliegen | Fernglas |
| 9 | abzeichen | Ideallinien-Abzeichen | Racing line badge | Rennen | Abzeichen mit Kurvenlinie |
| 10 | fluegel | Düsenflügel | Jet wings | Fliegen | Flügelpaar mit Düse |
| 11 | pokal | Zielflaggen-Pokal | Finish flag trophy | Rennen | Pokal mit Karo-Fähnchen |
| 12 | krone | Sternenstahl-Krone | Starsteel crown | Bauen | Krone aus Würfelkanten (Bezug Stufe 5 „Sternenstahl“) |

Boss (Vorschlag): **„Blockwächter“ / „Block Guardian“**, ein freundlich-mürrischer Turm aus Bauwürfeln mit Gewitterwölkchen.
Jeder Treffer schlägt Würfel ab, beim Sieg zerfällt er zu Sternen. Nicht gruselig, kein Gesicht mit Zähnen.
Texte (Vorschlag): Treffer „Volltreffer!“ / „Direct hit!“; nach Fehler „Der Blockwächter wartet geduldig. Schau noch einmal hin.“;
Sieg „Blockwächter besiegt, <Name>!“.

Lern-Lotte bitte prüfen: Wortschatz Klasse 3 („Ideallinie“ evtl. zu abstrakt, Ersatz „Rennabzeichen“).

---

## 5. Etappen (jede einzeln lieferbar)

| Etappe | Inhalt | Wer baut / prüft |
|---|---|---|
| **0 Klärung** (kein Code) | Marco beantwortet die 3 Fragen. Greta entscheidet Begriffe und Boss-Figur, Text-Tina prüft Texte DE/EN, Lern-Lotte bestätigt Schaden 2/1/0, Fragenauswahl im Boss und die mündlichen Fassungen je Spielform. Logo-Luisa zeichnet 12 Teile-Symbole + Blockwächter (aus `vorlage.svg`-Stil, Gold-Linie). | Greta, Tina, Lotte, Luisa |
| **1 Ausrüstung ansehen** (A1) | `Pull`-Typ erweitern, Wörterbuch für Teile, Raster im Tab, leerer Zustand, Probemodus. Noch ohne Boss-Hinweis. Klein, macht das Ziel sichtbar. | Design-Doris (3 Geräte × Hell/Dunkel), Text-Tina, Lern-Lotte |
| **2 Boss-Fight** (A2–A4) | Knopf auf „Start“, Boss-Modus (eigene Ansicht, nutzt `Game` und die Fehlerregeln der Arena), Lebensbalken, Warteschlangen-Eintrag `boss`, Sieg-Ansicht, Sofort-Stern angleichen, Boss-Hinweis im Ausrüstungs-Tab. | Bug-Bodo (Logik, Randfälle aus A4), Design-Doris, Lern-Lotte (didaktisch), Sicherheits-Siggi kurz (siehe Hinweis), Rant-Randy (Code) |
| **3 Gemeinsam-Abfragen** (B1–B3) | Abschnitt im Cockpit, Runde, mündliche Fassungen, direkter Versand mit Token, Wiederholen mit gleicher ID, PIN-Rückfall, Abschluss. | Sicherheits-Siggi (Token nur im Speicher, keine Lösungen gespeichert), Bug-Bodo (Doppeltippen, offline, Token läuft ab, Tagesgrenze), Design-Doris, Lern-Lotte, Text-Tina |
| **4 Migration 005** (nur wenn Frage 2 = Ja) | `book()`-Grenze 40, neue Teile-Namen. Kann parallel zu Etappe 1–3 laufen. Probelauf mit erzwungener Rücknahme über die CLI, Marco spielt selbst ein. | Daten-Dieter (Entwurf), Bug-Bodo + Sicherheits-Siggi (Prüfung) |
| **5 Auslieferung** | `/studio-freigabe`, Deploy, Entscheidungen und Doku nachtragen (`docs/entscheidungen.md`). | Qualitäts-Quentin, Deploy-Dennis, Doku-Dörte |

Reihenfolge-Begründung: 1 vor 2, weil der leere Tab heute wie „kaputt“ wirkt und A1 ohne Risiko lieferbar ist. 2 vor 3, weil Ben
den Boss direkt merkt; Gemeinsam-Abfragen hängt nur an Marcos Antwort auf Frage 1 und am Token-Umgang.

**Hinweis für Siggi (keine Migration vorgeschlagen):** `bc_boss_win` prüft nicht, ob wirklich ein Kampf stattfand; wer den
Familien-Code hat, kann den Sieg direkt melden. Bekommt dafür aber nur einmal je Arbeit +10 Sterne und ein Teil, und nur bei 70 %
Meisterschaft. Paula hält das für vertretbar; Siggi entscheidet, ob ein Nachweis (z. B. mindestens 5 Boss-Antworten zur Arbeit in
den letzten 2 Stunden) nötig ist.

## 6. Bewusst gestrichen

Teile am Avatar anlegen, Teile selbst wählen, Boss für „Zufalls-Mix“ oder mehrere Arbeiten, Boss-Wiederholung, Lebenspunkte
über das Schließen hinaus merken, Analytik im Cockpit (`Parents.tsx` Z. 21 „folgt mit dem Boss-Fight“, eigener Baustein danach),
Rundenbonus für Boss und Gemeinsam.
