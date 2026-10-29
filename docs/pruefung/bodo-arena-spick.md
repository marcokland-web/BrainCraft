# Prüfbericht Bug-Bodo: Spickzettel, Vorlesen, Shop-ID (2. Runde, 28./29.10.2026)

Getestet auf dem Stand vom 29.10.2026 um 0:00. Darin enthalten sind Lottes Regel „erst Titel, nach dem Aufdecken der Text“ und der Knopf „Zurück zur Frage“. Boss, Sofort-Stern und BlockGuardian sind ebenfalls im Stand, wurden aber nicht geprüft.

Gearbeitet wurde mit Fake-Server (`context.route`), Service Worker waren blockiert, und keine fremde Anfrage kam durch. Die echte Datenbank wurde nicht angesprochen. Gebaut wurde in einen eigenen Ordner im Scratchpad, die Vorschau lief auf Port 8797 und ist wieder beendet.

**Ergebnis `tests/store.spec.mjs`:** Chromium 365/365, WebKit 348/348.
Die Zahl der Prüfpunkte schwankt, weil die Fragen zufällig gemischt werden.

## Neu im Test (store.spec, Abschnitt 7)

Für den Test gibt es eine eigene Arbeit mit 11 Fragen. Die Sprachausgabe ist per `addInitScript` gefälscht: Jeder Aufruf von `speak` und `cancel` wird mitgeschrieben.

- **Randfälle:**
  - `slide_index` 9, also außerhalb der Folien
  - `unit_id` ohne Einheit, als gesehen markiert
  - `slide_index` null
  - `unit_id` null
  - `slide_index` -1
  - Folie ohne Schlüsselwörter
  - Lückenwort-Frage
  - `[NAME]` in Frage und Folie
- **Knopf „Spickzettel“:** Er fehlt vor dem 1. Fehler und nach richtiger Lösung. Nach dem 1. Fehler und nach dem Aufdecken erscheint er nur, wenn es die Folie gibt. Im Probemodus erscheint er nie.
- **Spielphase:** Das Sheet zeigt nur den Titel und `cheatTitleOnly`, „Vorlesen“ liest nur den Titel.
- **Nach dem Aufdecken:** Das Sheet zeigt den Text mit Namen, die Schlüsselwörter fett (genau die `keywords`) und „Zurück zur Frage“. „Vorlesen“ liest den Titel und alle Sätze.
- **Schließen:** „Weiter knobeln“, „Zurück zur Frage“ und Esc schließen das Sheet und stoppen das Vorlesen. Danach lässt es sich erneut öffnen.
- **Wiederholung und Notbremse:** Die Notbremse (k9) und beide Wiederholungen zeigen den Spickzettel ebenfalls, wenn sie eine Folie haben.
- **Antworten und Sterne unverändert:**
  - Das Öffnen löst keine Anfrage aus.
  - `bc_answer` stimmt genau mit dem Plan überein (correct = nicht aufgedeckt, first_try nur ohne Fehler).
  - Die Truhe zeigt 1 Stern je Erstversuch plus 3 Bonus.
- **Vorlesen „Automatisch“:**
  - Jede neue Frage wird gelesen: die Frage, bei Auswahl die Optionen, beim Lückenwort der Satz mit „…“.
  - Vor jeder neuen Frage kommt `cancel`.
  - Beim Öffnen des Spickzettels und am Rundenende wird gestoppt, danach wird nichts mehr gesprochen.
- **Vorlesen „Auf Tipp“:**
  - Nichts wird automatisch gelesen.
  - Der Lautsprecher ist mindestens 44 × 44 px groß und mit `readQuestion` beschriftet.
  - Antippen startet das Vorlesen, `aria-pressed` wird true und die Beschriftung wechselt zu „Stopp“. Erneutes Antippen stoppt. Nach dem Ende ist der Knopf wieder zurückgesetzt.
  - Beenden mit X stoppt das Vorlesen.
- **„Aus“ und Browser ohne `speechSynthesis`:** Es gibt keinen Lautsprecher und im Spickzettel kein „Vorlesen“.
- **Englisch:** Knopf, Sheet und Lautsprecher-Beschriftung sind englisch.
- **Darstellung:** Spickzettel auf iPhone, iPad und Desktop, jeweils hell und dunkel. Kein seitliches Scrollen, das Sheet bleibt ganz im Bild. Screenshots: `tests/.shots/store/spick-*.png`.
- **Shop:**
  - Gleiche Belohnung bekommt dieselbe ID, auch nach Abbrechen und Neuöffnen und nach einem Tab-Wechsel.
  - Eine andere Belohnung bekommt eine andere ID.
  - Ein Erfolg nutzt die gemerkte ID und bucht genau einmal. Danach gibt es eine neue ID.
  - Die Sternpille zeigt „1.000“ wie der Shop.

## Gefunden und behoben

1. **Vorlesen trennte „z. B.“** (`src/lib/speech.ts`, `KEEP`).
   - Fehler: Aus „Es wird zu Wasserdampf, z. B. über dem Meer.“ wurden zwei Sätze: „… z. B.“ und „über dem Meer.“. Das Komma in „z. B.“ schützte nur den ersten Punkt.
   - Behoben: Zweiteilige Abkürzungen („z. B.“, „d. h.“, „u. a.“) werden jetzt zuerst geschützt, und zwar alle Punkte darin. Das betrifft auch die Lernfolien.
2. **Spickzettel zeigte nach einer verworfenen Folie die falsche Folie** (`supabase/functions/bc-extract/validate.ts`, `clean`).
   - Fehler: Fiel beim Scan eine kaputte Folie heraus, rückten die übrigen nach vorn. Der `slide`-Verweis der Fragen blieb aber unverändert.
   - Behoben: Der Verweis wird jetzt auf den neuen Index umgerechnet. Ein Verweis auf eine verworfene Folie entfällt.
   - Test: `tests/validate.test.ts`, letzter Test. Deno ist hier nicht installiert. Die Logik habe ich deshalb mit Node gegengeprüft; den Deno-Test selbst konnte ich nicht ausführen.
   - Die Edge Function muss neu ausgeliefert werden (Marco bzw. Dennis).
3. **Einlöse-ID je Kind** (`src/views/Shop.tsx`).
   - Bisher war der Schlüssel nur die Belohnung. Bei einer Belohnung „für alle“ hätte ein anderes Kind auf demselben Gerät die hängende ID geerbt.
   - Folge: `bc_redeem` sieht keinen Treffer für dieses Kind, `book` bucht, und das Einfügen in `redemptions` scheitert am Primärschlüssel. Das Kind bekäme dauerhaft einen allgemeinen Fehler, bis es neu lädt.
   - Behoben: Der Schlüssel ist jetzt `profileId:rewardId`.
   - Hinweis: `selectProfile` wird derzeit nirgends aufgerufen. Der Fehler tritt also erst auf, wenn ein Kinderwechsel eingebaut wird.

## Am Test angepasst

- **store.spec:** Der Test „neue Rückfrage = neue ID“ prüft jetzt die neue Regel.
- **store.spec:** Nach einem Fehler wartet der Test jetzt, bis die Sperre wirklich vorbei ist, statt fest 1150 ms zu warten. Bei hoher Rechnerlast schlug das sonst fehl. `waitForFunction` geht nicht, weil die CSP der App `unsafe-eval` verbietet.
- **arena.spec.mjs (alter Probemodus-Test):**
  - Lief überhaupt nicht mehr, weil der Setup-Bildschirm fehlte. Jetzt startet er mit `braincraft:demo`.
  - Veraltete Erwartungen angepasst:
    - Bubble-Pop ist eine Einzelantwort mit dem Lob `praiseMulti`.
    - `yoursKept` erscheint nur bei grünen Teilen.
    - Aufgedeckte Paare stehen jetzt zeilenweise nebeneinander statt in Farben.
    - Die Wackel-Animationen heißen `bc-shake-a` und `bc-shake-b`.
    - Der Lautsprecher bleibt während der Sperre bedienbar.
  - Bester Lauf: Chromium 1146/1156 vor den letzten Anpassungen. Die späteren Läufe brachen bei einer Rechnerlast von 5 bis 9 an zeitgebundenen Prüfungen ab (Aufleuchten 1 s, feste `waitForTimeout(LOCK)`). Grün in beiden Browsern konnte ich **nicht** bestätigen. Für den Spickzettel ist store.spec maßgeblich.

## Hinweise (nicht geändert)

- **In-App-Scan liefert nie `slide`** (`supabase/functions/bc-extract/index.ts:136–163`). Das JSON-Schema der Fragen hat `additionalProperties: false` und kein Feld `slide`, und der Prompt fragt nicht danach. Spickzettel gibt es deshalb nur für Fragen aus dem Skill `braincraft-scan`. Vorschlag: `slide: { type: "integer" }` ins Schema der Fragen aufnehmen und im SYSTEM-Text „Jede Frage nennt mit slide die Folie (ab 0)“ ergänzen. Beim Zusammenführen mehrerer Fotos muss die Umrechnung über `clean` laufen; das passiert bereits.
- **Spickzettel auf dem iPhone** erscheint mittig und nicht als Sheet von unten mit Griff (Screenshot `spick-iphone-dark.png`). Das ist ein Fall für Doris.
- **Vorlesen nutzt immer eine deutsche Stimme** (`speech.ts`, `speak`), auch bei englischen Fächern und bei englischer Oberfläche. Für Englisch-Arbeiten (`wordLang: 'en'`) klingen Fragen und Folien dadurch falsch. Vorschlag: `speak(…, lang)` mit `wordLang`.
- **Großgeschriebene Abkürzungen am Satzanfang** wie „Vgl.“ trennen weiterhin. `KEEP` kennt nur kleingeschriebenes „vgl“; ein `i`-Schalter würde das beheben.
- **Shop:** Bucht der Server, geht die Antwort verloren und storniert ein Elternteil den Gutschein, bevor das Kind wiederholt, dann meldet die Wiederholung mit derselben ID „Erfolg“ und zeigt den Gutschein. Das ist ein sehr seltener Fall. Der Gutschein steht dabei richtig als „Zurückgegeben“ in der Liste.
- **Entscheidungen:** `docs/entscheidungen.md:63` ist mit der neuen Regel (Titel, dann Text) jetzt erfüllt.
