# Design-Doris: Arena mit Vorlesen und Spickzettel, Shop 2. Runde (28.10.2026)

Geprüft auf 1440×900, 820×1180 und 390×844, jeweils hell und dunkel. Das Thema habe ich über den Schalter gesetzt, die Systemeinstellung stand jeweils auf dem Gegenteil. Die Daten kamen von einem Fake-Server über `context.route` auf Port 8799 (eigener Build). Er lieferte 8 Fragen mit `unit_id` und `slide_index`, eine Einheit mit 2 Folien, 12.345 Sterne, Belohnungen bis 25.000 Sterne und einen Gutschein, der seit 12 Tagen offen ist. Ein zweiter Lauf hatte nur lange Fragen (`LONG=1`).
Fremde Anfragen: 0. Konsolenfehler: 0. Der Server ist beendet.
Skript: `/private/tmp/claude-502/-Users-marcokland-Apps-BrainCraft/c320fd2a-dd20-4278-af79-91eb3953cf77/scratchpad/arena-spick-check.mjs`
Screenshots: `tests/.shots/arena-spick/` und `tests/.shots/arena-spick-lang/`. Dort liegen arena-start, arena-fehler1, spick (nur Titel), arena-loesung, spick-loesung (mit Folientext), arena-say-on, kind-shop, kind-zuwenig, eltern, eltern-form und eltern-form-unten, jeweils als `-<gerät>-<thema>`.

## Behoben (nur CSS)

1. **Lautsprecher-Knopf saß zu tief:** Er schloss oben mit der Frage ab. Dadurch lag seine Mitte 10 px unter der Mitte der ersten Textzeile, und bei einzeiligen Fragen wirkte er verrutscht. Jetzt steht er mittig zur ersten Zeile: `.arena .a-ask .a-say{margin-top:calc((26px * 1.25 - 52px) / 2)}` in `src/styles/game.css`.
2. **„wartet seit 12 Tagen“ wurde getrennt:** Am iPhone stand „12“ am Zeilenende und „Tagen“ in der nächsten Zeile. Jetzt hat `.parents .voucher-late` die Regel `white-space:nowrap`, steht in `src/styles/base.css` und bricht als Ganzes um.
3. **Fairness-Tipp im Formular war 4 px eingerückt:** Die Regel `dialog.confirm p` rückte ihn gegenüber den Feldbeschriftungen ein. Jetzt gilt `.parents .reward-form > p{margin:0}`, das betrifft auch die Fehlerzeile im Formular. Die Abstände kommen vom Raster (`gap:14px`).

## Ohne Befund (gemessen bzw. im Bild geprüft)

- **Lautsprecher:** 52×52 px, mit `::after` −4 px Tippfläche 60 px (per `elementFromPoint` gemessen). Er hat 12 px Abstand zur Frage, Fläche `--tint` und Symbol in `--accent`. Im Zustand „an“ ist er gefüllt `--accent`, und der Kontrast stimmt in beiden Themen.
- **Knopf „Spickzettel“:** Er ist 60 px hoch, deckend `--tint` und nicht aus Glas, so dass er auf dem Hintergrund klar als Knopf erkennbar ist. Er erscheint nach dem 1. Fehler unter der Meldung und bleibt auch nach dem Aufdecken über „Weiter“ sichtbar. „Weiter“ endet am iPhone bei 757 von 844 px, also ohne Scrollen.
- **Spickzettel nach dem 1. Fehler:** Er zeigt nur den Folientitel und die graue Zeile, ist sauber gesetzt und hat einen Kontrast von mindestens 4,5:1. Er ist auf allen Geräten ein mittiger Dialog (iPhone 358 px, iPad und Desktop 400 px, also höchstens 440 px) und scrollt nicht.
- **Spickzettel nach dem Aufdecken:** Er zeigt den Folientext mit fetten Schlüsselwörtern in `--accent`, die im Dunkeln `#E57A98` auf Glas gut lesbar sind. Am iPhone ist er 554 px hoch und scrollt nicht. „Vorlesen“ und „Weiter knobeln“ sind je 60 px hoch, und es gibt nur einen Hauptknopf.
- **Shop (Kind):** Die Zeilen „Du kannst schon etwas einlösen – oder weitersparen.“ und das Sparziel stehen sauber untereinander in `--gold-ink`. „Schon 12.345 von 25.000 Sternen“ ist korrekt formatiert, auch die Sternpille zeigt „12.345“. Der Hinweis nach `not_enough_stars` erscheint zwischen Kopf und Liste, rot, aber mit freundlichem Text. Am iPhone, iPad und Desktop gibt es kein seitliches Scrollen.
- **Cockpit:** Die Hinweiszeile über den Gutscheinen ist bündig mit der Überschrift. Die Überschrift „Im Shop“ über „Sichtbar | Pausiert“ ist vorhanden. Der Griff am Bottom-Sheet erscheint nur am iPhone (36 px, 9 px vom oberen Rand); auf iPad und Desktop ist er ausgeblendet. Alle Zahlen haben Tausenderpunkte.
- Die Segmente „Für“ und „Im Shop“ sind 40 px hoch in einer 44-px-Leiste. Das ist nach der Designsystem-Regel für Segmente zulässig.

## Offen (Vorschläge, nicht selbst geändert)

1. **Lange Fragen am iPhone:** Ein Satz mit 100 Zeichen braucht neben dem Knopf 8 Zeilen (260 px), weil der Knopf über die ganze Höhe 64 px Breite belegt (`arena-start-iphone-light.png` in `-lang`). Vorschlag für die TSX: Den Lautsprecher am iPhone in die Zeile „Frage 1 von 8“ setzen, dann bekommt die Frage die volle Breite. Allein mit CSS geht das nur mit Überlappung, deshalb habe ich es nicht geändert.
2. **„Weiter knobeln“ nach dem Aufdecken:** Nach dem Aufdecken gibt es nichts mehr zu knobeln, die Lösung steht schon da. Vorschlag: In diesem Zustand „Zurück zur Frage“ oder „Schließen“ verwenden. Darüber sollte Text-Tina entscheiden.
3. **„Vorlesen“ im Spickzettel:** Der Knopf ist ein getönter Glasknopf auf Glas. Im Dunkeln wirkt er wie ein umrandeter leerer Kasten, bleibt aber als Knopf erkennbar. Ich habe ihn nach dem Designsystem gelassen (Glas auf Pop-ups).
4. **Ungeprüft:** „Transparenz reduzieren“ (Chromium emuliert das nicht), echtes Safari bzw. WebKit und die tatsächliche Sprachausgabe (nur das Erscheinen des Knopfs und der Zustand „an“ wurden geprüft).
