# Design-Doris: Sternen-Shop und Shop-Verwaltung (28.10.2026)

Geprüft: 1440×900, 820×1180, 390×844, jeweils hell und dunkel. Das Thema habe ich über den Schalter gesetzt, die Systemeinstellung stand jeweils auf dem Gegenteil. Für die Daten lief ein Fake-Server über `context.route`: 8 Belohnungen (davon ein langer Titel, eine pausierte, je eine nur für Lia bzw. Ben) und 4 Gutscheine (offen, erledigt, storniert, offen bei Ben), 2 Kinder. Fremde Anfragen: 0, Konsolenfehler: 0.
Screenshots: `tests/.shots/shop/` (kind-shop, kind-frage, kind-gutschein, kind-nachher, kind-leer, kind-probe, eltern, eltern-leer, eltern-bearbeiten, eltern-loeschen, eltern-storno, eltern-neu, eltern-vorschlag, symbole, symbol-fahrrad-neu). Jede Ansicht gibt es in `-<gerät>-<thema>`.

## Behoben

1. **Bearbeiten-Sheet, Auswahl „Für“:** Die Regel `.field input` (mit `all:unset`, min-height 50 px, Fläche `--fill`) hat die Radio-Knöpfe der Segment-Steuerung zu einem sichtbaren, 50 px hohen leeren Kasten über den Segmenten gemacht. Betroffen waren alle Geräte. Behoben mit `.parents .reward-form .field .seg input{position:absolute;…}`. Beim Symbolraster habe ich zusätzlich `min-height:0` gesetzt, weil dieselbe Regel dort ebenfalls hineinwirkte.
2. **Kopf im Bearbeiten-Sheet:** Der Titel „Belohnung bearbeiten“ war wegen der Aufteilung 1fr|auto|1fr nicht zentriert und stieß am iPhone direkt an „Abbrechen“. Jetzt steht der Titel links und „Abbrechen“ rechts, mit 12 px Abstand.
3. **iPhone: Bearbeiten-Sheet als Bottom-Sheet:** Nach dem Designsystem gehört eine Eingabe am iPhone in ein Sheet von unten. Die Regel gilt nur für `.parents dialog.confirm:has(.reward-form)` bis 600 px Breite. Kurze Rückfragen bleiben zentrierte Dialoge.
4. **Symbolraster:** 8 Symbole wurden je nach Breite als 5+3 oder 6+2 umbrochen. Jetzt stehen sie in 4 Spalten und zwei gleichen Reihen.
5. **Fahrrad-Symbol (`src/components/Icons.tsx`, REWARD_PATHS `bike`):** Die Räder waren als „Kreis durch einen Punkt“ gezeichnet. Dadurch lagen sie versetzt, das Vorderrad wurde am Rand abgeschnitten und das Symbol las sich wie „ổc“. Jetzt sind es echte Kreise, mit Kettenstrebe, Unterrohr und Sattelstütze. Vorher und nachher: `symbole.png` und `symbol-fahrrad-neu.png`. Die anderen 7 Symbole sind gut erkennbar und sauber, auch bei 24 px.
6. **Kind-Shop, Raster auf iPad und Desktop:** Bei einem langen Titel saß der Knopf „Einlösen“ tiefer als in den Nachbarkarten. Jetzt `grid-template-rows:auto auto 1fr`, und der Knopf steht mit `align-self:end` unten, alle Knöpfe einer Reihe auf einer Linie.
7. **„Deine Gutscheine“:** Die Trennlinie begann bei 70 px, obwohl die Zeilen kein Symbol haben. Jetzt beginnt sie wie im Designsystem am Textanfang (16 px).
8. **Begrenzung der Klassen** (nach der Lektion „Klassen auf den Bereich begrenzen“):
   - `dialog.confirm .btn{min-height:60px}` galt für alle Rückfragen der App. Jetzt gilt es nur für `.shop dialog.confirm`.
   - `.row .ic svg path{fill:none}` galt für alle Listen. Jetzt gilt es nur für `.parents .rewards .ic`.
   - `.hub-new.paused`, `.reward-form`, `.reward-costs`, `.reward-icons`, `.btn.danger-text`, `.shop-voucher` und `.shop-ask-ic` stehen jetzt unter `.parents` bzw. `.shop`.

Geänderte Dateien: `src/styles/base.css` (nur die beiden Shop-Abschnitte) und `src/components/Icons.tsx` (ein Pfad).

## Ohne Befund (gemessen)

- Kein seitliches Scrollen, nichts abgeschnitten, nichts unter der Tab-Leiste, auf allen 6 Kombinationen.
- Kontraste: alle Texte mindestens 4,5:1 (große Texte 3:1), gemessen gegen den tatsächlichen Hintergrund einschließlich Glas und Deckkraft. Ausgenommen sind deaktivierte „Einlösen“-Knöpfe, die zulässig blass sind. Ihr Zustand steht zusätzlich als Text da („Noch 158 Sterne“).
- Tippflächen: Im Kinderbereich sind „Einlösen“, „Ja, einlösen“, „Abbrechen“ und „Super!“ jeweils 60 px hoch, im Elternbereich ist alles mindestens 44 px. Die Segmente „Für“ und „Sichtbar/Pausiert“ sind 40 px hoch innerhalb einer 44-px-Leiste, das ist nach der Designsystem-Regel für Segmente zulässig.
- Pro Ansicht gibt es höchstens einen gefüllten Hauptknopf. „Einlösen“ ist getönt und deckend, nicht aus Glas (Lektion „Glas auf Karte“). Löschen und Stornieren haben einen roten Knopf in der Rückfrage, „Belohnung löschen“ ist roter Text.
- Leerer Zustand, Probemodus (Hinweis und Beispiele, Knöpfe gesperrt) und Vorschläge bei leerer Liste sehen sauber aus. Gold wird nur für Sterne und Schmuck verwendet, Text in Gold ist `--gold-ink`.

## Offen (nicht selbst geändert)

1. **Tausenderpunkt fehlt:** Es steht „Noch 2358 Sterne“, aber „2.500 Sterne“. Ursache: `shopMissing`, `shopGoal` und der Rest-Wert in `shopAsk` (`src/lib/i18n.ts`) setzen die Zahl ungeformt ein. Vorschlag: In beiden Sprachen `k.toLocaleString('de-DE' | 'en-GB')` verwenden. Ich habe es nicht geändert, weil `i18n.ts` während meiner Prüfung parallel bearbeitet wurde.
2. **Seg „Sichtbar | Pausiert“** hat keine sichtbare Überschrift, nur `aria-label`. Vorschlag: eine Zeile „Im Shop“ darüber, wie bei „Für“. Text-Tina sollte entscheiden.
3. **Bottom-Sheet ohne Griff:** Das neue Bottom-Sheet am iPhone hat keinen Griff (`.st-grab`), weil `Sheet.tsx` keinen rendert. Vorschlag: ihn im Sheet-Baustein ergänzen; das betrifft alle Sheets.
4. **Ungeprüft:** „Transparenz reduzieren“, weil Chromium das nicht emuliert, sowie echtes Safari bzw. WebKit.
