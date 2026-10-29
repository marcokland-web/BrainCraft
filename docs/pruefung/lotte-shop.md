# Lern-Lotte: didaktische Prüfung Sternen-Shop (28.10.2026)

Nur gelesen, kein Code geändert. Geprüft: `src/views/Shop.tsx`, `src/views/ShopManager.tsx`, `src/lib/i18n.ts` (shop*, voucher*, reward*, err*), `supabase/001_braincraft.sql` (bc_redeem Z. 1145–1172, bc_redemption_resolve Z. 1175–1191), `docs/entscheidungen.md`.
Nicht geprüft: Darstellung auf Geräten (Aufgabe von Design-Doris), echtes Durchspielen mit Server.

## Gesamturteil

Die Grundlage stimmt: Kein Kauf, kein Verfall, kein Countdown, keine Rangliste, echte Belohnungen nur über die Eltern, Einlösen mit Rückfrage, Storno gibt die Sterne vollständig zurück (Server bucht `refund`). Freigabe aus Lernsicht **mit kleinen Textänderungen** (Punkte 1–5). Punkte 6–9 sind Empfehlungen für die nächste Runde.

## Befunde und Textvorschläge

### 1. Verwechslung „Einlösen“ und „Eingelöst am …“ (wichtig)
Das Kind tippt „Einlösen“ (`shopRedeem`, Z. 58), der Gutschein steht dann auf „Wartet auf deine Eltern“. Wenn die Eltern abhaken, heißt es wieder „Eingelöst am …“ (`voucherDoneOn`, Z. 68, Datum = `resolved_at`). Für ein 9-jähriges Kind ist unklar, was „eingelöst“ ist: sein Tippen oder das Eis.

- `voucherDoneOn`: DE „Bekommen am ${d}“ · EN „You got it on ${d}“

### 2. Storno-Text beim Kind wirkt wie eine Abfuhr ohne Grund
„Zurückgegeben, die Sterne sind wieder da“ (Z. 69) sagt nicht, wer zurückgegeben hat; „zurückgegeben“ klingt, als hätte das Kind etwas zurückgeben müssen. Das Kind soll wissen: Es hat nichts falsch gemacht, nichts ist verloren.

- `voucherRefunded`: DE „Deine Eltern haben ihn zurückgenommen. Deine Sterne sind wieder da.“ · EN „Your parents took it back. Your stars are back.“

Eltern-Rückfrage (`voucherCancelAsk`, Z. 210) um einen Gesprächsanstoß ergänzen, damit Storno nicht stumm passiert:
- DE „Gutschein „${title}“ stornieren? ${name || 'Das Kind'} bekommt die ${cost} Sterne zurück. Erklärt am besten kurz, warum.“
- EN „Cancel the voucher “${title}”? ${name || 'Your child'} gets the ${cost} stars back. It helps to explain why.“

### 3. Fehlermeldung „Dafür fehlen noch ein paar Sterne.“
Tritt nur auf, wenn der Stand sich zwischen Anzeige und Tippen geändert hat (Knopf ist sonst gesperrt, `Shop.tsx` Z. 105; z. B. zweites Gerät). „Ein paar“ kann falsch sein (es können 200 fehlen) und klingt nach Mangel. Besser die Ursache nennen, ohne Schuld:

- `errStars`: DE „Deine Sterne reichen dafür gerade nicht. Vielleicht hast du schon etwas anderes eingelöst.“ · EN „You don’t have enough stars for this right now. Maybe you already redeemed something else.“

Technisch (an Bug-Bodo): Nach `not_enough_stars` bleibt das Sheet mit aktivem „Ja, einlösen“ offen (Z. 145). Besser Sheet schließen und Stand neu laden, damit das Kind nicht erneut tippt.

### 4. Rückfrage: verständlich, aber zwei Lücken
„„Ein Eis“ für 60 Sterne einlösen? Danach hast du noch 12 Sterne.“ (Z. 60–61) ist kurz, ehrlich und für 9 Jahre gut lesbar. Zwei Ergänzungen:

a) Bei Rest 0 steht „Danach hast du noch 0 Sterne.“ Das klingt nach Verlust. Eigene Fassung für 0:
- DE „„${title}“ für ${cost} Sterne einlösen? Danach sammelst du neue Sterne beim Üben.“
- EN „Redeem “${title}” for ${cost} stars? After that you’ll collect new stars while practising.“

b) Das Kind erwartet sonst das Eis sofort. Erwartung vorab setzen (Satz an beide Fassungen anhängen):
- DE „Deine Eltern bekommen dann einen Gutschein von dir.“ · EN „Your parents will then get a voucher from you.“

Optional, damit ein Vertipper nicht schmerzt (das Kind kann selbst nicht zurücknehmen): Im Gutschein-Sheet ergänzen „Hast du dich vertippt? Dann sag es deinen Eltern, sie können ihn zurücknehmen.“ · EN „Tapped by mistake? Tell your parents, they can take it back.“

### 5. „Du kannst eine Belohnung einlösen!“ drängt zum sofortigen Ausgeben
`shopReadyAll` (Z. 54) erscheint, sobald irgendeine Belohnung reicht, und blendet dann das größere Ziel aus (`Shop.tsx` Z. 75: Ziel nur bei `!anyReady`). Das Ausrufezeichen schiebt zum Ausgeben; Sparen für den Kinoabend wird unsichtbar. Das Kind soll frei wählen.

- `shopReadyAll`: DE „Du kannst schon etwas einlösen – oder weitersparen.“ · EN „You can already redeem something – or keep saving.“
- Vorschlag Logik: Ziel-Zeile auch dann zeigen, wenn schon etwas reicht (darunter oder dahinter).

### 6. Fehlende Sterne statt geschaffter Sterne (Empfehlung)
Ziel-Zeile und Balken sagen „Noch 295 Sterne“ (`shopGoal`, `shopMissing`). Bei 300 Sternen und Tagesgrenze 40 sind das mindestens 8 Lerntage; die große Zahl kann entmutigen. Lob für Mühe heißt: zeigen, was schon geschafft ist.

- `shopMissing` bei großem Abstand (z. B. Fortschritt unter 50 %): DE „Schon ${have} von ${cost}“ · EN „${have} of ${cost} so far“; ab 50 % weiter „Noch ${k} Sterne“ (dann motiviert die kleine Zahl).
- Die Ziel-Zeile ist an sich gut (konkret, ohne Zeitdruck). Später: Das Kind wählt sein Ziel selbst („Darauf spare ich“) statt automatisch die günstigste Belohnung – passt zur Team-Regel, dass das Kind selbst wählt.

### 7. Hinweis an Eltern: Gutscheine zeitnah erfüllen (fehlt)
Das Vertrauen in die Sterne hängt daran, dass ein Gutschein wirklich erfüllt wird. Im Cockpit gibt es nur die Liste (`ShopManager.tsx` Z. 81–107), keinen Hinweis und keinen Zähler.

- Unter „Gutscheine“ (neuer Schlüssel `vouchersHint`): DE „Erfüllt Gutscheine möglichst bald, am besten innerhalb einer Woche. So lernt euer Kind: Mühe lohnt sich.“ · EN „Try to fulfil vouchers soon, ideally within a week. That way your child learns that effort pays off.“
- Bei Gutscheinen älter als 7 Tage in `voucherLine` ergänzen: DE „wartet seit ${days} Tagen“ · EN „waiting for ${days} days“ (sachlich, kein Rot).
- An Plan-Paula: Zahl offener Gutscheine als Plakette am Eltern-Cockpit-Zugang.

### 8. Hinweis an Eltern: fair bleiben bei Preis, Pause, Löschen und Storno (fehlt)
Eltern können den Preis einer Belohnung erhöhen, sie pausieren oder löschen, während das Kind darauf spart; das Ziel verschwindet dann ohne Erklärung. Storno darf keine Strafe sein (Sterne sind für Lernen verdient).

- In der Belohnungs-Form (neuer Schlüssel `rewardFairHint`): DE „Tipp: Ändert den Preis nicht, während euer Kind darauf spart. Sterne sind verdient – nehmt sie nicht als Strafe weg.“ · EN „Tip: Don’t change the price while your child is saving for it. Stars are earned – don’t take them away as a punishment.“
- Gleicher Gedanke gilt für `bc_stars_correct` (negative Korrektur im Server möglich, Z. 1194 ff.), falls dafür später eine Oberfläche kommt: nur für Fehlbuchungen, mit diesem Hinweis.

### 9. Kleinigkeiten
- `errVoucherLimit`: DE „Es warten schon viele Gutscheine auf deine Eltern. Sobald sie welche abgehakt haben, kannst du wieder einlösen.“ · EN „Lots of vouchers are already waiting for your parents. Once they tick some off, you can redeem again.“ (erklärt, wann es weitergeht).
- `shopVoucherText` ist gut; „wenn es so weit ist“ etwas vage. Vorschlag: DE „Zeig deinen Eltern den Gutschein. Sie haken ihn ab, wenn du deine Belohnung bekommen hast.“ · EN „Show your parents the voucher. They tick it off once you’ve got your reward.“
- Vorschläge 60/100/300: passen (bei realistischen 15–25 Sternen am Tag: Eis nach 3–4, Kinoabend nach etwa 2–3 Wochen Üben). Anregung für die Vorschlagsliste: eine gemeinsame Aktivität ohne Bildschirm, z. B. „Ein Spiel mit Mama oder Papa“ (100) · „A game with Mum or Dad“ – Belohnung als Zeit miteinander statt nur Konsum und Bildschirmzeit.
- Barrierefreiheit (an Design-Doris): Fortschrittsbalken haben nur den Titel als `aria-label`; `aria-valuetext` mit „12 von 60 Sternen“ ergänzen.

## Was gut ist und bleiben soll
- Kein Druck durch Zeit, Verfall oder Vergleich; kein Ranking zwischen Geschwistern im Kinder-Shop.
- Rückfrage mit Reststand – ehrlich und lehrt Sparen.
- Gutscheinliste zeigt den Weg transparent; Storno gibt alles zurück.
- Demo-Hinweis ehrlich („Im Probemodus sind das Beispiele.“).
