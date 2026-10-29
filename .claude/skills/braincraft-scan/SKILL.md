---
name: braincraft-scan
description: Klassenarbeit für BrainCraft aus Heftfotos erstellen. Einsetzen, wenn Marco sagt „Scanne die Klassenarbeit“, Fotos in BrainCraft/scans/<ordner>/ liegen oder Lernfolien und Fragen für BrainCraft erstellt werden sollen.
---

# Klassenarbeit scannen (BrainCraft)

Heftfotos werden hier in Claude Code zu Lernfolien und Fragen, ohne KI-Kosten pro Seite. Zielgruppe: ein Kind der 3./4. Klasse.

## Ablauf

1. Ordner `scans/<arbeit>/` mit den Fotos (JPEG, PNG oder HEIC) ansehen. Fehlt etwas, Marco nach **Fach**, **Titel der Klassenarbeit** und **Datum** (optional) fragen.
2. Jedes Foto mit dem Read-Werkzeug lesen. Persönliche Angaben (Namen, Schule, Noten, Lehrerkommentare) ignorieren, sie kommen nirgends vor.
3. `scans/<arbeit>/ergebnis.json` schreiben (Format unten).
4. `node tools/braincraft.ts pruefen scans/<arbeit>` ausführen. Warnungen beheben, bis keine mehr kommen.
5. Marco bitten, im **Terminal** einzuspielen (PIN wird verdeckt abgefragt, nicht über Claude Code):
   `cd ~/Apps/BrainCraft && node tools/braincraft.ts einspielen scans/<arbeit>`
6. Danach gibt Marco die Fragen im Eltern-Cockpit frei. Fotos auf Wunsch löschen (mit Rückfrage).

## Regeln für den Inhalt (Lern-Lotte)

- **Vollständig:** jeder Lernfakt, jede Definition, jeder Ablauf von den Fotos. Nichts erfinden, was nicht dort steht oder für die Klassenstufe selbstverständlich ist. Wiederholungen zu einem Fakt zusammenführen.
- **Folien:** 3–5 je Scan, je Titel, höchstens 3 kurze Sätze (höchstens 15 Wörter je Satz), bis zu 4 Schlüsselwörter, die wörtlich im Text vorkommen. Ansprache „du“. Für den Namen genau `[NAME]` schreiben.
- **Englisch:** Wortpaare statt Fließtext, Satzanfang groß („Rot heißt red.“), deutscher Titel mit englischem Wort in Klammern („Farben (Colours)“). Schlüsselwörter sind die englischen Wörter (werden mit englischer Stimme vorgelesen).
- **Fragen:** etwa 2 je Lernfakt, Formate gemischt, nur Tippen/Sortieren (nie Tastatur). Jede Frage nennt mit `slide` die Folie (ab 0), aus der sie stammt. Jede Folie bekommt mindestens eine Frage.
- **Jede Frage braucht einen eigenen Fragetext** (nicht fünfmal „Setze ein:“), z. B. „Wohin kam Josef? Setze ein:“.
- Keine Links, Telefonnummern, E-Mail-Adressen, „PIN“ oder „Passwort“ in Texten (werden aussortiert).

## Formate (Grenzen werden geprüft)

- `multiple_choice`: `options` genau 4 verschiedene, `correct_index` 0–3, `explanation` 1 Satz.
- `word_clicker`: `sentence_with_gap` mit genau einem `[GAP]`, `correct_word`, `distractors` genau 3 (alle verschieden).
- `sort_boxes`: `categories` genau 2, `items` 4–12 mit `category_index` 0/1, jede Kiste 1–6 Begriffe.
- `detective`: `statements` genau 3, genau eine mit `is_impostor: true` (falsche Aussage, keine Verneinung als Trick), `reveal_text` erklärt das Richtige. Fragetext: „Welcher Satz stimmt nicht?“
- `bubble_pop`: `target_rule` als Frage („Ist das …?“), `bubbles` 4–8, mindestens ein Treffer und eine Niete.
- `pair_matching`: `pairs` 2–4, linke und rechte Seiten jeweils verschieden.
- `sequencing`: `correct_order` 3–5 verschiedene Schritte.

## Format von ergebnis.json

```json
{
  "meta": { "fach": "Sachunterricht", "arbeit": "Der Wasserkreislauf", "datum": "2026-11-05" },
  "summary_slides": [ { "title": "…", "content": "…", "keywords": ["…"] } ],
  "questions": [ { "type": "multiple_choice", "prompt": "…", "slide": 0, "payload": { "options": ["…","…","…","…"], "correct_index": 0, "explanation": "…" } } ]
}
```

Bei mehreren Kindern in der Familie zusätzlich `"kind": "<Vorname>"` in `meta`.
