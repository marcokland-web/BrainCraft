// Prüfung der KI-Ausgabe für BrainCraft (eigene Datei, damit Bug-Bodo sie ohne Server testen kann).
// Strenger als braincraft.payload_ok (Lern-Lottes Grenzen): Was hier durchkommt, nimmt die Datenbank immer an.
// Payloads werden nur aus bekannten Feldern neu aufgebaut, damit keine Zusatzfelder in die Datenbank gelangen.

// slide: Index der Lernfolie, aus der die Frage stammt (Spickzettel, Lern-Lotte); optional
export type Q = { type: string; prompt: string; payload: Record<string, unknown>; slide?: number };
export type Slide = { title: string; content: string; keywords: string[] };

// Steuerzeichen (außer Zeilenumbruch) und kaputte Unicode-Folgen lehnt PostgreSQL ab
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
// Keine Links, Mail-Adressen, Telefonnummern oder Fragen nach Zugangsdaten in Kindertexten (Siggi M1).
// Telefonnummern: „+49 …“ oder Vorwahl mit 0 und Ziffer 1–9 („0171 1234567“, „030/123456“),
// aber keine Tausendergruppe wie in „2 050 000“.
// Große Zahlen („1 000 000“, „1000000“), Datumsangaben („01/01/2026“) und Zählreihen („01 02 03“) bleiben erlaubt.
const UNSAFE = /https?:\/\/|www\.|\S+@\S+\.\S+|(?:\+\d{2,}|(?<!\d[\s.])\b0[1-9]\d+)[\s/-]?\d{3,}|\d{8,}|\bpin\b|passwort|password/i;

const str = (x: unknown, max = 300): x is string =>
  typeof x === "string" && x.trim().length > 0 && x.length <= max && x.isWellFormed() && !CONTROL.test(x) && !UNSAFE.test(x);
const strs = (x: unknown, min: number, max: number, len = 200): x is string[] =>
  Array.isArray(x) && x.length >= min && x.length <= max && x.every((s) => str(s, len));
// Gleiche Texte (ohne Groß-/Kleinschreibung und Leerzeichen am Rand) sind didaktisch Doppelungen
const norm = (s: string) => s.trim().toLowerCase();
const distinct = (xs: string[]) => new Set(xs.map(norm)).size === xs.length;

// Gibt den bereinigten Payload zurück oder null, wenn die Frage nicht taugt
function payloadOf(type: string, p: Record<string, any>): Record<string, unknown> | null {
  switch (type) {
    case "multiple_choice": {
      if (!strs(p.options, 4, 4) || !distinct(p.options) || !str(p.explanation, 400)) return null;
      if (!Number.isInteger(p.correct_index) || p.correct_index < 0 || p.correct_index > 3) return null;
      return { options: p.options, correct_index: p.correct_index, explanation: p.explanation };
    }
    case "word_clicker": {
      if (!str(p.sentence_with_gap) || p.sentence_with_gap.split("[GAP]").length !== 2) return null;
      if (!str(p.correct_word, 60) || !strs(p.distractors, 3, 3, 60)) return null;
      if (!distinct([p.correct_word, ...p.distractors])) return null;
      return { sentence_with_gap: p.sentence_with_gap, correct_word: p.correct_word, distractors: p.distractors };
    }
    case "sort_boxes": {
      if (!strs(p.categories, 2, 2, 60) || !distinct(p.categories)) return null;
      if (!Array.isArray(p.items) || p.items.length < 4 || p.items.length > 12) return null;
      if (!p.items.every((i: any) => str(i?.text, 80) && (i.category_index === 0 || i.category_index === 1))) return null;
      if (!distinct(p.items.map((i: any) => i.text))) return null;
      const n0 = p.items.filter((i: any) => i.category_index === 0).length;
      // Jede Kiste bekommt 1 bis 6 Begriffe
      if (n0 < 1 || n0 > 6 || p.items.length - n0 < 1 || p.items.length - n0 > 6) return null;
      return {
        categories: p.categories,
        items: p.items.map((i: any) => ({ text: i.text, category_index: i.category_index })),
      };
    }
    case "detective": {
      if (!Array.isArray(p.statements) || p.statements.length !== 3 || !str(p.reveal_text, 400)) return null;
      if (!p.statements.every((s: any) => str(s?.text, 200) && typeof s.is_impostor === "boolean")) return null;
      if (p.statements.filter((s: any) => s.is_impostor).length !== 1 || !distinct(p.statements.map((s: any) => s.text))) return null;
      return {
        statements: p.statements.map((s: any) => ({ text: s.text, is_impostor: s.is_impostor })),
        reveal_text: p.reveal_text,
      };
    }
    case "bubble_pop": {
      if (!str(p.target_rule, 120) || !Array.isArray(p.bubbles) || p.bubbles.length < 4 || p.bubbles.length > 8) return null;
      if (!p.bubbles.every((b: any) => str(b?.text, 60) && typeof b.is_correct === "boolean")) return null;
      if (!p.bubbles.some((b: any) => b.is_correct) || !p.bubbles.some((b: any) => !b.is_correct)) return null;
      if (!distinct(p.bubbles.map((b: any) => b.text))) return null;
      return { target_rule: p.target_rule, bubbles: p.bubbles.map((b: any) => ({ text: b.text, is_correct: b.is_correct })) };
    }
    case "pair_matching": {
      if (!Array.isArray(p.pairs) || p.pairs.length < 2 || p.pairs.length > 4) return null;
      if (!p.pairs.every((x: any) => str(x?.left, 80) && str(x?.right, 120))) return null;
      if (!distinct(p.pairs.map((x: any) => x.left)) || !distinct(p.pairs.map((x: any) => x.right))) return null;
      return { pairs: p.pairs.map((x: any) => ({ left: x.left, right: x.right })) };
    }
    case "sequencing": {
      if (!strs(p.correct_order, 3, 5, 120) || !distinct(p.correct_order)) return null;
      return { correct_order: p.correct_order };
    }
    default:
      return null;
  }
}

// Bereinigte Frage oder null
export function validQuestion(q: unknown): Q | null {
  if (typeof q !== "object" || q === null) return null;
  const { type, prompt, payload, slide } = q as Record<string, unknown>;
  if (typeof type !== "string" || !str(prompt, 300) || typeof payload !== "object" || payload === null) return null;
  const p = payloadOf(type, payload as Record<string, unknown>);
  if (!p) return null;
  const out: Q = { type, prompt, payload: p };
  if (Number.isInteger(slide) && (slide as number) >= 0 && (slide as number) <= 7) out.slide = slide as number;
  return out;
}

// Grenze der Datenbank für alle Folien einer Einheit: 20.000 Byte, mit Abstand
const SLIDES_MAX_BYTES = 18_000;

export function clean(raw: unknown) {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as { summary_slides?: unknown; questions?: unknown };
  const slides: Slide[] = [];
  // Ursprünglicher Folien-Index -> Index nach dem Aussortieren (sonst zeigt der Spickzettel
  // nach einer verworfenen Folie die falsche, Bodo)
  const slideAt = new Map<number, number>();
  const rawSlides: unknown[] = Array.isArray(r.summary_slides) ? r.summary_slides : [];
  for (const [i, s] of rawSlides.entries() as Iterable<[number, any]>) {
    if (slides.length >= 8) break;
    if (!str(s?.title, 120) || !str(s?.content, 600) || !strs(s?.keywords, 0, 6, 60)) continue;
    const slide = { title: s.title, content: s.content, keywords: s.keywords };
    if (new TextEncoder().encode(JSON.stringify([...slides, slide])).length > SLIDES_MAX_BYTES) break;
    slideAt.set(i, slides.length);
    slides.push(slide);
  }
  const all: unknown[] = Array.isArray(r.questions) ? r.questions : [];
  const seen = new Set<string>();
  const questions: Q[] = [];
  for (const raw of all) {
    if (questions.length >= 80) break;
    const q = validQuestion(raw);
    if (!q) continue;
    // Folienverweis nur, wenn es die Folie wirklich gibt
    if (q.slide !== undefined) {
      const at = slideAt.get(q.slide);
      if (at === undefined) delete q.slide;
      else q.slide = at;
    }
    // Doppelt nur bei gleichem Typ, Text UND Inhalt (allgemeine Fragetexte wie „Setze ein:“ kommen oft vor).
    // Der Payload ist neu aufgebaut, die Schlüsselreihenfolge also fest.
    const key = q.type + "|" + norm(q.prompt) + "|" + JSON.stringify(q.payload);
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(q);
  }
  return { summary_slides: slides, questions, dropped: all.length - questions.length };
}
