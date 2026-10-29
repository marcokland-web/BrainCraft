# Prüfung Design-Doris: Blockwächter (Boss) und Ausrüstung

Stand 29.10.2026, dritte Runde. Geprüft wurde ein lokaler Build (eigener Port 8812, danach beendet) mit Fake-Server, ohne echte Datenbank: 0 fremde Anfragen, keine Konsolenfehler. Größen 1440×900, 820×1180 und 390×844, jeweils hell und dunkel. Das Thema wurde über den Schalter gesetzt, das System stand auf dem Gegenteil.
Skript: `scratchpad/boss-check.mjs`. Bilder: `tests/.shots/boss/` (vorher), `boss-v3/` (alle Größen, nachher), `boss-v4/` (iPhone, letzte Fassung).

Geprüfte Zustände:
- Start mit Boss bereit, schon geschafft und „Kannst du noch N Fragen …“
- Kampf: brummig, geduldig mit Denkanstoß, aufgedeckte Lösung, staunend, „Nur noch ein Block“
- Spickzettel im Kampf
- Sieg mit Teil, Wiederholung, „alle Teile“
- Ausrüstung nach dem Sieg, mit wartendem Blockwächter, mit allen 12 Teilen und im Probemodus
- Spickzettel in der Arena

## Behoben (nur CSS)

1. **Ausrüstung kaputt, ein schwerer Fehler.** Die Ansicht heißt `section.bc-view.gear`. Sie bekam dadurch die Regeln des Zahnrad-Knopfs (`.gear{all:unset;width:44px;height:44px;border-radius:50%}` und Glas). Die ganze Ansicht schrumpfte auf 46×46 px, das Raster lief in zwei 89-px-Spalten über die Seite und unter die Tab-Leiste.
   - Lösung: Die Zahnrad-Regeln gelten jetzt nur für `button.gear`, in `base.css` Zeilen 56–59 und `glass.css` Zeilen 33, 43, 74 und 78.
   - Nachher: Die Ansicht ist 358, 788 bzw. 1000 px breit, das Raster hat 2, 4 bzw. 6 Spalten und nichts liegt mehr unter der Tab-Leiste.
2. **Boss-Knöpfe waren Glas statt deckend getönt.** Das betraf „Gegen den Blockwächter“ auf Start und „Der Blockwächter wartet auf dich“ in der Ausrüstung. `.btn.tinted` aus `glass.css` überschrieb `.home .boss-btn` (gleiche Spezifität, Datei später geladen).
   - Lösung: `.home .btn.boss-btn` und `.gear .btn.gear-boss` (`base.css` 349 und 352).
   - Nachher: Hintergrund `--tint` (#F3E3E8 bzw. #3A1C26).
3. **Die Sprechblase hatte keinen Pfeil.** Für `.bubble::before` gibt es nur Farben und kein `content`.
   - Lösung: Ein eigener Pfeil zur Figur mit `.boss .boss-say::before` (`game.css` 176–179), in Glas wie die Blase und deckend bei „Transparenz reduzieren“.
   - Nachher: Er sitzt 7 px links der Blase und ist senkrecht mittig, auf allen drei Größen.
4. **Die Wolke verschwand im Dunkelmodus** (Luisas Punkt). Ihre Grundfläche ist `var(--surface)`, im Dunkeln also fast Schwarz, und mit jedem Treffer wurde sie dunkler.
   - Lösung: Ein neues Token `--bc-cloud` (hell #FFFFFF, dunkel #E4DADD) in `base.css` Zeilen 10, 17 und 22. Die Zuordnung `.bg-cloud{--surface:var(--bc-cloud)}` steht in `game.css` 181. Es gibt keinen eigenen Dunkel-Selektor.
   - Nachher: Die Wolke wird im Dunkeln mit jedem Treffer heller (Bild `boss-v3/boss-5fast-iphone-dark.png`).
5. **Der Spickzettel erschien am iPhone mittig** (aus Bodos Bericht).
   - Lösung: Am iPhone ist er jetzt ein Sheet von unten mit Griff, gültig bis 600 px (`base.css` ab 356).
   - Nachher, gemessen in Arena und Kampf: 390 px breit, 0 px Abstand zum unteren Rand, Ecken 20/20/0/0, Griff sichtbar. iPad und Desktop zeigen weiter einen mittigen Dialog mit 400 px.
6. **Beim Sieg stand der Stern weit links vom Preistext**, weil der Text zweizeilig umbrach.
   - Lösung: Der Stern steht jetzt in der Zeile vor dem Text, mittig (`game.css` 183–184).

## In Ordnung

- **Lebensleiste:** 10 Blöcke, 14 px hoch, 302 px breit (iPhone) bzw. 704 px (iPad, Desktop).
- **Figur:** 96 px (iPhone) bzw. 150 px breit, die Blase steht 14 px daneben.
- **Stimmungen:** Die Stimmung passt zu jedem Zustand. Die flacheren Brauen von Luisa sind hell und dunkel gut erkennbar.
- **Tippflächen:** Lautsprecher 52×52, Spickzettel 60 px hoch, „Weiter“ 60 px. Es wurde keine Tippfläche unter 44 px gemessen.
- **Kontrast:** Es wurde kein Kontrast unter 4,5:1 gemessen.
- **Kein seitliches Scrollen.**
- **Siegansicht:** Teil-Symbol 60 px, „Zur Ausrüstung“ als einziger Hauptknopf. Die Texte für Wiederholung und „alle Teile“ werden richtig angezeigt.
- **Start:** Die längere Zeile „Kannst du noch 2 Fragen sicher, wartet der Blockwächter.“ bricht am iPhone sauber auf zwei Zeilen um. Der Untertitel „Zum Spaß, ohne Sterne“ passt.
- **Ausrüstung:** Gewonnene Teile sind golden und zeigen Herkunft und Datum. Fehlt die Arbeit, steht „aus einer früheren Klassenarbeit“ da. Das nächste Teil hat einen goldenen Rahmen und die Plakette „Nächstes Teil“. Der Probemodus zeigt 12 Schild-Umrisse und einen Hinweis.

## Offen (nicht CSS bzw. nicht mein Bereich)

- **TSX-Vorschlag (Gear.tsx Zeile 30):** Die Ansicht sollte `bc-view gear-view` heißen statt `gear` und die CSS-Regeln entsprechend `.gear-view …`. Der Name `.gear` ist doppelt vergeben. Die CSS-Begrenzung auf `button.gear` behebt das, aber der Doppelname bleibt eine Falle.
- **Logo-Luisa, Gürtel bei 32 px:** Das Symbol ist weiterhin dicht. Vorschlag: den Punkt `M18.5 10h.01` und die Schnallenlinie `M12 10h2.5` weglassen (`Icons.tsx`, `guertel`). Mit CSS lässt sich das nicht lösen, weil die Symbole keine eigene Klasse haben.
- **Logo-Luisa, Wolke:** Im Dunkeln ist der Unterschied zwischen 10 und 1 Block jetzt eher klein (Grau-Rosa nach Hellrosa). Wer ihn stärker will, kann `fillOpacity` in `BlockGuardian.tsx` im Dunkeln steiler laufen lassen.
- **Altlast aus Rechenstern:** Die Knöpfe der Navigationspille `.toptabs` sind am iPad und am Desktop nur 38 px hoch (`base.css` Zeile 48, min 44). Das gehört nicht zu dieser Runde, sollte aber vor der Freigabe behoben werden: `min-height:44px`.
- **Nicht prüfbar:** „Transparenz reduzieren“ lässt sich in Chromium nicht emulieren. Die Regeln dafür stehen im CSS.
