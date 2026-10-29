# Begriffe: Ausrüstung und Boss

Gestaltungs-Greta, 28.10.2026. **Beschlossen** (ersetzt den Vorschlag in `docs/plan-boss-gemeinsam.md`, Abschnitt 4).
Einbezogen: Lern-Lotte (Verständlichkeit Klasse 3), Text-Tina (Wortwahl DE/EN). Grundlage: `supabase/001_braincraft.sql`
Z. 336–350 (Platzhalter-Namen), `src/lib/types.ts` Z. 53 (Stufen Holz … Sternenstahl).

## Leitregeln

- **Ein Wort für die Bausteine: „Block“ / "block"** (nicht „Würfel“: Kinder denken dabei an den Spielwürfel; „Block“ passt zu
  BrainCraft und Blockwächter). Gilt in Teilen, Sprüchen und Bildern.
- **Kein „besiegen“, kein „töten“.** Sieg heißt „geschafft“; der Boss verbeugt sich und zerfällt zu Sternen.
- Namen höchstens 18 Zeichen, höchstens zwei Wortteile, keine Marken; deutsche Texte ohne Apostroph („gibt es“ statt „gibt's“).
- Reihenfolge: greifbare Kleidung zuerst, dann Werkzeuge, dann „besondere“ Dinge, die Krone zuletzt. Die drei Welten
  (Fliegen, Rennen, Bauen) wechseln sich ab.

## 1. Die 12 Ausrüstungsteile

| sort | item_key (bleibt) | title_de | title_en | Welt | Zeichen DE/EN |
|---|---|---|---|---|---|
| 1 | helm | Pilotenhelm | Pilot helmet | Fliegen | 11 / 12 |
| 2 | handschuhe | Rennhandschuhe | Racing gloves | Rennen | 14 / 13 |
| 3 | stiefel | Turbo-Stiefel | Turbo boots | Rennen | 13 / 11 |
| 4 | guertel | Werkzeuggürtel | Tool belt | Bauen | 14 / 9 |
| 5 | schild | Blockschild | Block shield | Bauen | 11 / 12 |
| 6 | umhang | Windumhang | Wind cape | Fliegen | 10 / 9 |
| 7 | fernglas | Adler-Fernglas | Eagle binoculars | Fliegen | 14 / 16 |
| 8 | kompass | Sternenkompass | Star compass | Fliegen | 14 / 12 |
| 9 | abzeichen | Rennabzeichen | Racing badge | Rennen | 13 / 12 |
| 10 | fluegel | Düsenflügel | Jet wings | Fliegen | 11 / 9 |
| 11 | pokal | Siegerpokal | Winner's trophy | Rennen | 11 / 15 |
| 12 | krone | Sternenkrone | Star crown | Bauen | 12 / 10 |

Abweichungen von Paulas Vorschlag und warum:

- Werkzeuggürtel vor Blockschild/Umhang (Platz 4): greifbar, ein Kind kennt ihn aus dem Alltag.
- **Blockschild** statt Würfelschild: einheitlich „Block“ (Lotte, Tina).
- **Adler-Fernglas** statt Tower-Fernglas: unter „Turm/Tower“ kann sich ein Kind nichts vorstellen, unter Adleraugen schon (Lotte).
- **Rennabzeichen** statt Ideallinien-Abzeichen: „Ideallinie“ zu abstrakt, zu lang (21 Zeichen).
- **Siegerpokal** statt Zielflaggen-Pokal: kein Zungenbrecher beim Vorlesen (Lotte); die Zielflagge bleibt im Symbol.
- **Sternenkrone** statt Sternenstahl-Krone: Dreifach-Wort ist für Klasse 3 zu schwer (Lotte). Der Bezug zu Stufe 5 bleibt im
  Symbol (Sternspitzen wie das Stufe-5-Zeichen).

**Hinweis für Daten-Dieter (Migration 005):** `001` fügt die Teile mit `on conflict do nothing` ein; die neuen Namen brauchen
ein `update braincraft.items set title_de=…, title_en=…, sort=… where item_key=…`. Weil `sort` `unique` ist (Z. 343) und sich
Plätze 4–6 verschieben, erst alle `sort` auf `sort + 100` setzen, dann die Endwerte. Teile, die ein Kind schon besitzt,
behalten ihren Schlüssel; nur Name und Platz ändern sich.

## 2. Der Boss

**Blockwächter / Block Guardian.** Ein freundlich-brummiger Turm aus Baublöcken, etwas größer als das Kind, mit runden Augen,
dicken Augenbrauen und einem kleinen Mund (keine Zähne, keine Krallen, keine Waffe). Über ihm schwebt eine kleine
Gewitterwolke, die im Lauf des Kampfs heller wird und beim Sieg zur Sonne wird: Er freut sich mit dem Kind.
Er „bewacht“ das Wissen der Klassenarbeit und will sehen, ob das Kind drangeblieben ist. Er ist nie schadenfroh und wartet
geduldig. Jeder Treffer lässt einen Block herausfliegen; beim Sieg verbeugt er sich und zerfällt zu goldenen Sternen.

### Sprüche (Platzhalter `[NAME]` = Name des Kindes, `[TEIL]`/`[ITEM]` = Name des Teils)

| Anlass | Deutsch | English |
|---|---|---|
| Start | Hallo [NAME]! Ich bin der Blockwächter. Lust auf ein paar Knobelfragen? | Hi [NAME]! I'm the Block Guardian. Ready for some brain teasers? |
| Treffer | Volltreffer! Da fliegt ein Block. | Direct hit! There goes a block! |
| Fehler (ohne Strafe) | Knapp daneben. Ich warte – schau noch mal genau hin. | Not quite! I'll wait – take another look. |
| Fast geschafft | Nur noch ein Block! Du schaffst das. | Just one block left! You can do it. |
| Sieg | Geschafft, [NAME]! Du bist drangeblieben. Der Blockwächter verbeugt sich vor dir. | You did it, [NAME]! You kept going. The Block Guardian bows to you. |
| Belohnung | Für dich: [TEIL] und 10 Sterne! | Your prize: [ITEM] and 10 stars! |
| Alle 12 Teile schon da | Du hast schon alle 12 Teile – diesmal gibt es 10 Sterne! | You already have all 12 pieces – this time you get 10 stars! |

Leerer Zustand im Ausrüstungs-Tab (ersetzt `src/lib/i18n.ts` Z. 48 und Z. 303, „Besiege einen Boss …“), in Etappe 1 umsetzen:

- DE: „Noch leer. Spiel gegen den Blockwächter, dann bekommst du dein erstes Ausrüstungsteil.“
- EN: "Still empty. Take on the Block Guardian to earn your first piece of gear."

## 3. Gestaltungshinweis für Logo-Luisa

**Teile-Symbole (12 Stück)**

- Linien-Symbole im Stil von `~/Apps/DasTeam/studio/brand/vorlage.svg`: ein Motiv je Symbol, runde Linienenden und -ecken,
  gleichmäßige Strichstärke (Richtwert 2 px bei 24 px Raster, mitskalierend), keine Füllflächen außer kleinen Akzenten,
  keine Schrift.
- Zwei Fassungen: **erhalten** = Gold-Verlauf `#F0D08A` → `#C8963E` auf Bordeaux-Kachel (`#8C2545` → `#5A1028`, Radius 14 px);
  **noch nicht erhalten** = nur Umriss in `--ink-2` mit 40 % Deckkraft auf `--fill`, kein Schloss, kein Fragezeichen.
  In der App die Farbe über `currentColor`/`--accent` steuerbar halten (eine SVG-Datei je Teil).
- Lesbar ab 32 px, Vorschau in 32/64/96 px, Hell und Dunkel.
- Motive: Helm mit Visier · Handschuh mit zwei Rennstreifen · Stiefel mit Tempolinien (keine Flammen) · Gürtel mit Hammer ·
  Schild aus 2×2 Blöcken · Umhang mit Windlinien · Fernglas mit kleinem Adlerflügel · Kompass mit Stern als Nadel ·
  runde Plakette mit Kurvenlinie · Flügelpaar mit Düse · Pokal mit kleiner Zielflagge · Krone mit Sternspitzen
  (Bezug Stufe 5 „Sternenstahl“).
- Alle 12 nebeneinander müssen wie eine Familie wirken: gleiche optische Größe, gleiche Strichstärke.

**Boss-Figur Blockwächter**

- Gleiche Linien-Sprache, aber größer (Richtwert 160–200 px), Turm aus 3×4 Blöcken mit runden Ecken. Gold-Linien auf
  Bordeaux bzw. `--accent` auf Glas; einzelne Blöcke einzeln adressierbar (eigene `<g id>`), damit je Treffer ein Block
  herausfliegen kann (10 Lebenspunkte → 10 abnehmbare Blöcke).
- Gesicht: zwei runde Augen, buschige Brauen, kleiner Mund; Zustände **brummig** (Start), **staunend** (Treffer),
  **geduldig** (Fehler), **lächelnd mit Verbeugung** (Sieg). Keine Zähne, keine roten Augen, keine Schatten von unten.
- Wolke über dem Kopf: Start grau-lila Linie mit kleinem Blitz, wird mit jedem Treffer heller, beim Sieg goldene Sonne.
- Bewegungen sanft und kurz; bei `prefers-reduced-motion` nur Zustandswechsel ohne Fliegen.
- Abgabe als SVG unter `public/` (Ort legt Design-Doris mit Luisa fest), danach Prüfung durch Design-Doris auf drei Geräten
  in Hell und Dunkel.
