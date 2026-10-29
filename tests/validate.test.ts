// Bug-Bodo: Tests für clean/validQuestion (supabase/functions/bc-extract/validate.ts)
// und Abgleich mit braincraft.payload_ok aus supabase/001_braincraft.sql (echtes PostgreSQL über PGlite).
//
// Aufruf (nicht im BrainCraft-Ordner, dort stört die package.json):
//   W=<leerer Ordner>; mkdir -p $W/tests $W/supabase/functions/bc-extract
//   cp tests/validate.test.ts $W/tests/; cp supabase/001_braincraft.sql $W/supabase/
//   cp supabase/functions/bc-extract/validate.ts $W/supabase/functions/bc-extract/
//   cd $W && DENO_DIR=<cache> deno test -A tests/validate.test.ts
//
// Regel: Was validate.ts durchlässt, muss die Datenbank annehmen (validate.ts darf strenger sein).
// Stand 2 (23.10.2026): validQuestion gibt die bereinigte Frage oder null zurück.

import { clean, validQuestion, type Q } from "../supabase/functions/bc-extract/validate.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.11";

// ---------- kleine Prüfhilfen ----------
function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: erwartet ${JSON.stringify(b)}, tatsächlich ${JSON.stringify(a)}`);
}
const rep = (s: string, n: number) => s.repeat(n);
const clone = <T>(x: T): T => structuredClone(x);

// ---------- Datenbank: payload_ok und Typ aus der Migration übernehmen ----------
const SQL = await Deno.readTextFile(new URL("../supabase/001_braincraft.sql", import.meta.url));
const typeSql = SQL.match(/create type braincraft\.question_type as enum \([\s\S]*?\);/)![0];
const fnSql = SQL.match(/create or replace function braincraft\.payload_ok[\s\S]*?end \$\$;/)![0];
const db = new PGlite();
await db.exec(`create schema braincraft; ${typeSql} ${fnSql}`);

/** Würde bc_unit_import diese Frage annehmen? (payload_ok + Prompt-Regel + jsonb-Einlesen) */
async function dbAccepts(q: Q): Promise<{ ok: boolean; why: string }> {
  try {
    const r = await db.query<{ ok: boolean; size: number }>(
      `select braincraft.payload_ok(($1::jsonb->>'type')::braincraft.question_type, $1::jsonb->'payload')
              and char_length(btrim(coalesce($1::jsonb->>'prompt',''))) between 1 and 500 as ok,
              pg_column_size($1::jsonb->'payload') as size`,
      [JSON.stringify(q)],
    );
    return { ok: r.rows[0].ok === true, why: `payload ${r.rows[0].size} Byte` };
  } catch (e) {
    return { ok: false, why: "Datenbank-Fehler: " + String((e as Error).message).split("\n")[0] };
  }
}
/** Folien-Prüfung aus bc_unit_import (Zeilen „bad_slides“) */
async function dbSlides(slides: unknown[]): Promise<{ ok: boolean; why: string }> {
  try {
    const r = await db.query<{ ok: boolean; size: number }>(
      `select jsonb_typeof($1::jsonb) = 'array' and jsonb_array_length($1::jsonb) <= 8 and pg_column_size($1::jsonb) <= 20000
          and not exists (select 1 from jsonb_array_elements($1::jsonb) s
                           where jsonb_typeof(s) <> 'object' or length(coalesce(s->>'title','')) = 0
                              or length(coalesce(s->>'content','')) = 0) as ok,
              pg_column_size($1::jsonb) as size`,
      [JSON.stringify(slides)],
    );
    return { ok: r.rows[0].ok === true, why: `Folien ${r.rows[0].size} Byte` };
  } catch (e) {
    return { ok: false, why: "Datenbank-Fehler: " + String((e as Error).message).split("\n")[0] };
  }
}

// ---------- gute Beispiele je Fragetyp ----------
const GOOD: Record<string, Q> = {
  multiple_choice: {
    type: "multiple_choice", prompt: "Wie viele Beine hat eine Spinne?",
    payload: { options: ["6", "8", "4", "10"], correct_index: 1, explanation: "Spinnen haben 8 Beine." },
  },
  word_clicker: {
    type: "word_clicker", prompt: "Welches Wort fehlt?",
    payload: { sentence_with_gap: "Der Igel hält im [GAP] Winterschlaf.", correct_word: "Winter", distractors: ["Sommer", "Herbst", "Frühling"] },
  },
  sort_boxes: {
    type: "sort_boxes", prompt: "Sortiere: Säugetier oder Vogel?",
    payload: {
      categories: ["Säugetier", "Vogel"],
      items: [{ text: "Hund", category_index: 0 }, { text: "Amsel", category_index: 1 }, { text: "Katze", category_index: 0 }, { text: "Meise", category_index: 1 }],
    },
  },
  detective: {
    type: "detective", prompt: "Welcher Satz stimmt nicht?",
    payload: {
      statements: [{ text: "Wale sind Säugetiere.", is_impostor: false }, { text: "Fische atmen mit Kiemen.", is_impostor: false }, { text: "Spinnen sind Insekten.", is_impostor: true }],
      reveal_text: "Spinnen haben 8 Beine und sind keine Insekten.",
    },
  },
  bubble_pop: {
    type: "bubble_pop", prompt: "Platze alle Nomen!",
    payload: { target_rule: "Nomen", bubbles: [{ text: "Haus", is_correct: true }, { text: "laufen", is_correct: false }, { text: "Baum", is_correct: true }, { text: "schön", is_correct: false }] },
  },
  pair_matching: {
    type: "pair_matching", prompt: "Was gehört zusammen?",
    payload: { pairs: [{ left: "Hund", right: "bellt" }, { left: "Katze", right: "miaut" }] },
  },
  sequencing: {
    type: "sequencing", prompt: "Bring in die richtige Reihenfolge.",
    payload: { correct_order: ["Ei", "Raupe", "Puppe", "Schmetterling"] },
  },
};

// Schlechte Fälle: [Name, Typ, Änderung am Payload]
type Mut = [string, string, (p: any, q: any) => void];
const BAD: Mut[] = [
  // multiple_choice
  ["3 Optionen", "multiple_choice", (p) => p.options.pop()],
  ["5 Optionen", "multiple_choice", (p) => p.options.push("12")],
  ["doppelte Option", "multiple_choice", (p) => (p.options[2] = "8")],
  ["leere Option", "multiple_choice", (p) => (p.options[0] = "  ")],
  ["Option ist Zahl", "multiple_choice", (p) => (p.options[0] = 6)],
  ["correct_index 4", "multiple_choice", (p) => (p.correct_index = 4)],
  ["correct_index -1", "multiple_choice", (p) => (p.correct_index = -1)],
  ["correct_index 1.5", "multiple_choice", (p) => (p.correct_index = 1.5)],
  ["correct_index als Text", "multiple_choice", (p) => (p.correct_index = "1")],
  ["correct_index null", "multiple_choice", (p) => (p.correct_index = null)],
  ["ohne explanation", "multiple_choice", (p) => delete p.explanation],
  ["explanation 401 Zeichen", "multiple_choice", (p) => (p.explanation = rep("a", 401))],
  ["options ist Text", "multiple_choice", (p) => (p.options = "6,8,4,10")],
  // word_clicker
  ["ohne [GAP]", "word_clicker", (p) => (p.sentence_with_gap = "Der Igel hält Winterschlaf.")],
  ["zwei [GAP]", "word_clicker", (p) => (p.sentence_with_gap = "Der [GAP] hält [GAP].")],
  ["[gap] klein", "word_clicker", (p) => (p.sentence_with_gap = "Der Igel hält im [gap] Winterschlaf.")],
  ["richtiges Wort unter Ablenkern", "word_clicker", (p) => (p.distractors[0] = "Winter")],
  ["2 Ablenker", "word_clicker", (p) => p.distractors.pop()],
  ["4 Ablenker", "word_clicker", (p) => p.distractors.push("Mai")],
  ["leeres richtiges Wort", "word_clicker", (p) => (p.correct_word = "")],
  ["richtiges Wort 61 Zeichen", "word_clicker", (p) => (p.correct_word = rep("x", 61))],
  ["Satz 301 Zeichen", "word_clicker", (p) => (p.sentence_with_gap = "[GAP]" + rep("a", 296))],
  // sort_boxes
  ["1 Kategorie", "sort_boxes", (p) => p.categories.pop()],
  ["3 Kategorien", "sort_boxes", (p) => p.categories.push("Fisch")],
  ["3 Items", "sort_boxes", (p) => p.items.pop()],
  ["13 Items", "sort_boxes", (p) => { p.items = Array.from({ length: 13 }, (_, i) => ({ text: "T" + i, category_index: i % 2 })); }],
  ["7 in einer Kiste", "sort_boxes", (p) => { p.items = Array.from({ length: 8 }, (_, i) => ({ text: "T" + i, category_index: i < 7 ? 0 : 1 })); }],
  ["category_index 2", "sort_boxes", (p) => (p.items[0].category_index = 2)],
  ["category_index als Text", "sort_boxes", (p) => (p.items[0].category_index = "0")],
  ["Item ohne Text", "sort_boxes", (p) => (p.items[0].text = "")],
  ["Item ist null", "sort_boxes", (p) => (p.items[0] = null)],
  ["Item-Text 81 Zeichen", "sort_boxes", (p) => (p.items[0].text = rep("a", 81))],
  // detective
  ["2 Aussagen", "detective", (p) => p.statements.splice(0, 1)],
  ["4 Aussagen", "detective", (p) => p.statements.push({ text: "Extra", is_impostor: false })],
  ["kein Hochstapler", "detective", (p) => (p.statements[2].is_impostor = false)],
  ["zwei Hochstapler", "detective", (p) => (p.statements[0].is_impostor = true)],
  ["is_impostor als Text", "detective", (p) => (p.statements[2].is_impostor = "true")],
  ["ohne reveal_text", "detective", (p) => delete p.reveal_text],
  ["Aussage leer", "detective", (p) => (p.statements[0].text = " ")],
  // bubble_pop
  ["3 Blasen", "bubble_pop", (p) => p.bubbles.pop()],
  ["9 Blasen", "bubble_pop", (p) => { p.bubbles = Array.from({ length: 9 }, (_, i) => ({ text: "B" + i, is_correct: i % 2 === 0 })); }],
  ["keine Treffer", "bubble_pop", (p) => p.bubbles.forEach((b: any) => (b.is_correct = false))],
  ["keine Nieten", "bubble_pop", (p) => p.bubbles.forEach((b: any) => (b.is_correct = true))],
  ["ohne target_rule", "bubble_pop", (p) => (p.target_rule = "")],
  ["is_correct fehlt", "bubble_pop", (p) => delete p.bubbles[0].is_correct],
  // pair_matching
  ["1 Paar", "pair_matching", (p) => p.pairs.pop()],
  ["5 Paare", "pair_matching", (p) => { p.pairs = Array.from({ length: 5 }, (_, i) => ({ left: "L" + i, right: "R" + i })); }],
  ["rechts leer", "pair_matching", (p) => (p.pairs[0].right = "")],
  ["links Zahl", "pair_matching", (p) => (p.pairs[0].left = 1)],
  // sequencing
  ["2 Schritte", "sequencing", (p) => p.correct_order.splice(0, 2)],
  ["6 Schritte", "sequencing", (p) => p.correct_order.push("a", "b")],
  ["leerer Schritt", "sequencing", (p) => (p.correct_order[0] = "")],
  ["correct_order ist Objekt", "sequencing", (p, q) => (q.payload = { correct_order: { 0: "a", 1: "b", 2: "c" } })],
  // didaktische Doppelungen (seit Stand 2 abgelehnt)
  ["Optionen nur in Groß/klein verschieden", "multiple_choice", (p) => (p.options = ["Acht", "acht", "Sechs", "Vier"])],
  ["Option mit Leerzeichen doppelt", "multiple_choice", (p) => (p.options[2] = " 8 ")],
  ["richtiges Wort mit Leerzeichen unter Ablenkern", "word_clicker", (p) => (p.distractors[0] = "Winter ")],
  ["richtiges Wort groß unter Ablenkern", "word_clicker", (p) => (p.distractors[0] = "WINTER")],
  ["doppelte Ablenker", "word_clicker", (p) => (p.distractors = ["Sommer", "sommer", "Herbst"])],
  ["Kiste 1 leer", "sort_boxes", (p) => p.items.forEach((i: any) => (i.category_index = 0))],
  ["Kiste 0 leer", "sort_boxes", (p) => p.items.forEach((i: any) => (i.category_index = 1))],
  ["gleiche Kategorien", "sort_boxes", (p) => (p.categories = ["Tier", " tier"])],
  ["gleicher Item-Text in beiden Kisten", "sort_boxes", (p) => { p.items[1].text = "hund"; }],
  ["doppelte Detektiv-Sätze", "detective", (p) => (p.statements[1].text = "WALE SIND SÄUGETIERE.")],
  ["doppelte Blasen", "bubble_pop", (p) => { p.bubbles[1].text = "Haus"; }],
  ["doppelte linke Seite", "pair_matching", (p) => (p.pairs[1].left = "hund")],
  ["doppelte rechte Seite", "pair_matching", (p) => (p.pairs[1].right = "Bellt ")],
  ["doppelte Schritte", "sequencing", (p) => (p.correct_order = ["Ei", "ei", "Raupe"])],
  // allgemein
  ["payload null", "sequencing", (_p, q) => (q.payload = null)],
  ["payload ist Array", "sequencing", (_p, q) => (q.payload = ["Ei", "Raupe", "Puppe"])],
  ["prompt leer", "multiple_choice", (_p, q) => (q.prompt = "   ")],
  ["prompt 301 Zeichen", "multiple_choice", (_p, q) => (q.prompt = rep("a", 301))],
  ["prompt ist Zahl", "multiple_choice", (_p, q) => (q.prompt = 42)],
  ["unbekannter Typ", "multiple_choice", (_p, q) => (q.type = "essay")],
  ["Typ in Großbuchstaben", "multiple_choice", (_p, q) => (q.type = "MULTIPLE_CHOICE")],
];

// ---------- Tests ----------
// Schnittstelle: validQuestion(q) gibt die bereinigte Frage zurück oder null.

const accepted = (q: unknown) => { try { return validQuestion(q as any); } catch (e) { return "WIRFT: " + (e as Error).message; } };

Deno.test("gute Fälle: jeder Fragetyp wird angenommen, unverändert zurückgegeben und von der Datenbank angenommen", async () => {
  for (const [t, q] of Object.entries(GOOD)) {
    const r = accepted(q);
    eq(r, q, `validQuestion ${t}`);
    const d = await dbAccepts(r as Q);
    eq(d.ok, true, `Datenbank ${t} (${d.why})`);
  }
});

Deno.test("gute Grenzfälle (an den Grenzen von Lern-Lotte)", async () => {
  const cases: [string, Q][] = [];
  const add = (name: string, t: string, f: (p: any, q: any) => void) => { const q = clone(GOOD[t]); f(q.payload, q); cases.push([name, q]); };
  add("sort_boxes 12 Items, 6/6", "sort_boxes", (p) => { p.items = Array.from({ length: 12 }, (_, i) => ({ text: "T" + i, category_index: i % 2 })); });
  add("sort_boxes 4 Items, 3/1", "sort_boxes", (p) => (p.items[1].category_index = 0));
  add("bubble_pop 8 Blasen", "bubble_pop", (p) => { p.bubbles = Array.from({ length: 8 }, (_, i) => ({ text: "B" + i, is_correct: i < 2 })); });
  add("pair_matching 4 Paare", "pair_matching", (p) => { p.pairs = Array.from({ length: 4 }, (_, i) => ({ left: "L" + i, right: "R" + i })); });
  add("sequencing 3 Schritte", "sequencing", (p) => p.correct_order.pop());
  add("sequencing 5 Schritte", "sequencing", (p) => p.correct_order.push("Falter fliegt"));
  add("prompt 300 Zeichen", "multiple_choice", (_p, q) => (q.prompt = rep("ä", 300)));
  add("[GAP] am Satzanfang", "word_clicker", (p) => (p.sentence_with_gap = "[GAP] ist die Hauptstadt."));
  add("Emojis (Surrogat-Paare) im Text", "multiple_choice", (p) => (p.options = ["🐶", "🐱", "🐭", "🐹"]));
  add("Zeilenumbruch \\n erlaubt", "multiple_choice", (p) => (p.explanation = "Zeile 1\nZeile 2"));
  add("multiple_choice maximal (€)", "multiple_choice", (p) => { p.options = ["a", "b", "c", "d"].map((x) => x + rep("€", 199)); p.explanation = rep("€", 400); });
  add("sort_boxes maximal (€)", "sort_boxes", (p) => { p.categories = [rep("€", 59) + "a", rep("€", 59) + "b"]; p.items = Array.from({ length: 12 }, (_, i) => ({ text: rep("€", 78) + String(i).padStart(2, "0"), category_index: i % 2 })); });
  add("detective maximal (€)", "detective", (p) => { p.statements.forEach((s: any, i: number) => (s.text = rep("€", 199) + i)); p.reveal_text = rep("€", 400); });
  for (const [name, q] of cases) {
    const r = accepted(q);
    eq(r, q, `validQuestion ${name}`);
    const d = await dbAccepts(r as Q);
    eq(d.ok, true, `Datenbank ${name} (${d.why})`);
  }
});

Deno.test("schlechte Fälle werden abgelehnt (null)", () => {
  const wrong: string[] = [];
  for (const [name, t, f] of BAD) {
    const q: any = clone(GOOD[t]);
    f(q.payload, q);
    const r = accepted(q);
    if (r !== null) wrong.push(`${t} / ${name}: ${JSON.stringify(r).slice(0, 80)}`);
  }
  eq(wrong, [], "fälschlich angenommen oder Absturz");
});

Deno.test("Zusatzfelder werden entfernt, Datenbank nimmt an", async () => {
  const leaks: string[] = [];
  for (const [t, g] of Object.entries(GOOD)) {
    const q: any = clone(g);
    q.payload.hint = rep("x", 9000);
    q.extra = "weg";
    // auch in verschachtelten Objekten
    for (const k of ["items", "statements", "bubbles", "pairs"]) if (Array.isArray(q.payload[k])) q.payload[k][0].geheim = rep("y", 9000);
    const r = accepted(q) as any;
    if (!r || typeof r !== "object") { leaks.push(`${t}: abgelehnt statt bereinigt`); continue; }
    eq(r, g, `${t}: bereinigt = Original ohne Zusatzfelder`);
    const d = await dbAccepts(r);
    if (!d.ok) leaks.push(`${t}: Datenbank lehnt ab (${d.why})`);
  }
  eq(leaks, [], "Zusatzfelder");
});

Deno.test("Steuerzeichen und kaputtes Unicode werden abgelehnt", () => {
  const wrong: string[] = [];
  for (const [label, s] of [["U+0000", "Ei\u0000"], ["Tab", "Ei\tRaupe"], ["CR", "Ei\r\nRaupe"], ["U+001F", "Ei\u001f"], ["DEL", "Ei\u007f"],
    ["einzelnes hohes Surrogat", "Ei\uD800"], ["einzelnes tiefes Surrogat", "\uDC00Ei"]] as const) {
    for (const field of ["prompt", "step"]) {
      const q: any = clone(GOOD.sequencing);
      if (field === "prompt") q.prompt = "Frage " + s; else q.payload.correct_order[0] = s;
      if (accepted(q) !== null) wrong.push(`${label} in ${field}`);
    }
  }
  eq(wrong, [], "durchgelassen");
});

// Siggi M1: Links, Mail, Telefon, lange Ziffernfolgen, PIN, Passwort
const UNSAFE_TEXTS = [
  "Schau auf https://example.org nach", "Mehr unter http://x.de", "Besuche www.schule.de", "Schreib an mama@example.de",
  "Ruf an: +49 170 1234567", "Ruf an: 0170 1234567", "Telefon 030/1234567", "Nummer 0171-2345678", "Kundennummer 12345678",
  "Gib deine PIN ein", "Die pin ist geheim", "Dein Passwort", "Your password", "PASSWORT",
];
// Fehlalarme vermeiden: das alles muss erlaubt bleiben
const SAFE_TEXTS = [
  "Rechne 1 000 000 − 1", "Die Zahl 1000000 hat 7 Stellen", "Rechne 250 000 + 750 000", "2 500 000 ist größer als 2 050 000",
  "Teile 100 000 durch 10", "3 + 4 = 7", "0,5 + 0,25 = 0,75", "1/2 + 1/4 = 3/4", "Die Uhr zeigt 07:30 Uhr",
  "Heute ist der 20.10.2026", "Am 01.01.2026 beginnt das Jahr", "20. Oktober 2026", "Kolumbus kam 1492 an", "2026-10-23",
  "Der Pinguin kann nicht fliegen", "Mit dem Pinsel malen", "Die Pinnwand im Flur", "Die Spinne hat 8 Beine", "Pinocchio lügt",
  "Eine E-Mail schreiben", "Das Telefon klingelt", "Zähle: 0, 1, 2, 3", "Plus und Minus: +5 und −3",
  "Die Zahl 12 345 678 hat 8 Stellen", "Zehn Millionen: 10 000 000", "Am 01/01/2026", "Am 05-03-2026",
];

Deno.test("Siggi M1: unsichere Texte werden abgelehnt (prompt, Optionen, Erklärung, Folien)", () => {
  const wrong: string[] = [];
  for (const s of UNSAFE_TEXTS) {
    const a: any = clone(GOOD.multiple_choice); a.prompt = s;
    const b: any = clone(GOOD.multiple_choice); b.payload.explanation = s;
    const c: any = clone(GOOD.multiple_choice); c.payload.options[3] = s;
    const slides = clean({ summary_slides: [{ title: "T", content: s, keywords: [] }] }).summary_slides;
    for (const [w, r] of [["prompt", accepted(a)], ["explanation", accepted(b)], ["option", accepted(c)]] as const) if (r !== null) wrong.push(`${w}: ${s}`);
    if (slides.length) wrong.push(`Folie: ${s}`);
  }
  eq(wrong, [], "durchgelassen");
});

// Bewusst abgelehnt (Regel „Ziffernfolgen ab 8 Stellen“), nur zur Dokumentation
Deno.test("Siggi M1: 8-stellige Zahl ohne Leerzeichen wird bewusst abgelehnt", () => {
  const q: any = clone(GOOD.multiple_choice); q.prompt = "Rechne 10000000 : 10";
  eq(accepted(q), null, "10000000");
});

Deno.test("Siggi M1: keine Fehlalarme (Mathe, Datum, Pinguin, Pinsel …)", async () => {
  const wrong: string[] = [];
  for (const s of SAFE_TEXTS) {
    const q: any = clone(GOOD.multiple_choice); q.prompt = s; q.payload.explanation = s;
    const r = accepted(q);
    if (r === null) { wrong.push(s); continue; }
    const d = await dbAccepts(r as Q);
    if (!d.ok) wrong.push(`${s} (Datenbank: ${d.why})`);
  }
  eq(wrong, [], "fälschlich abgelehnt");
});

Deno.test("null, undefined und falsche Typen: kein Absturz, null", () => {
  for (const q of [null, undefined, 0, "", "text", [], {}, { type: "sequencing" }, { type: "sequencing", prompt: "x" }, true,
    { type: 5, prompt: "x", payload: {} }, { type: "sequencing", prompt: "x", payload: "y" }]) {
    eq(accepted(q), null, `validQuestion(${JSON.stringify(q)})`);
  }
  const out = clean({ questions: [null, 1, "x", GOOD.sequencing, { type: "detective" }], summary_slides: "kaputt" });
  eq(out.questions, [GOOD.sequencing], "clean behält nur die gute Frage");
  eq(out.dropped, 4, "dropped");
  eq(out.summary_slides, [], "Folien als Text -> leer");
});

Deno.test("clean mit null, undefined, Text, Zahl, Array: kein Absturz", () => {
  for (const raw of [null, undefined, "x", 42, [], {}, { questions: "x", summary_slides: {} }]) {
    let r: unknown;
    try { r = clean(raw as any); } catch (e) { r = "WIRFT: " + (e as Error).message; }
    eq(r, { summary_slides: [], questions: [], dropped: 0 }, `clean(${JSON.stringify(raw)})`);
  }
});

Deno.test("doppelte Fragen: gleicher Typ + Text (Groß/klein, Leerzeichen) nur einmal; anderer Typ bleibt", () => {
  const a = clone(GOOD.multiple_choice);
  const b = clone(GOOD.multiple_choice); b.prompt = "  WIE VIELE BEINE HAT EINE SPINNE?  ";
  const c = clone(GOOD.detective); c.prompt = GOOD.multiple_choice.prompt;
  const out = clean({ questions: [a, b, c] });
  eq(out.questions.length, 2, "Anzahl");
  eq(out.questions[0], a, "erste bleibt");
  eq(out.dropped, 1, "dropped");
});

Deno.test("mehr als 80 Fragen: genau 80 bleiben, Rest zählt als dropped", () => {
  const qs = Array.from({ length: 95 }, (_, i) => ({ ...clone(GOOD.sequencing), prompt: `Reihenfolge ${i}` }));
  const out = clean({ questions: qs });
  eq(out.questions.length, 80, "Anzahl");
  eq(out.questions[79].prompt, "Reihenfolge 79", "Reihenfolge erhalten");
  eq(out.dropped, 15, "dropped");
  const mixed = [...Array.from({ length: 10 }, () => ({ type: "x", prompt: "", payload: {} })), ...qs];
  eq(clean({ questions: mixed }).questions.length, 80, "80 gültige trotz 10 ungültiger davor");
});

Deno.test("Folien: kaputte fallen weg, höchstens 8, Datenbank nimmt an", async () => {
  const good = { title: "Insekten", content: "Insekten haben 6 Beine.", keywords: ["Insekt", "Beine"] };
  const slides = [
    good, null, "Text", {}, { title: "", content: "x", keywords: [] }, { title: "T", content: "", keywords: [] },
    { title: "T", content: "C" }, { title: "T", content: "C", keywords: [""] }, { title: "T", content: "C", keywords: "a" },
    { title: rep("a", 121), content: "C", keywords: [] }, { title: "T", content: rep("a", 601), keywords: [] },
    { title: "T", content: "C", keywords: ["1", "2", "3", "4", "5", "6", "7"] }, { title: "T", content: "C", keywords: [rep("k", 61)] },
    { title: "T", content: "C\u0000", keywords: [] }, { ...good, extra: rep("z", 30000) },
    ...Array.from({ length: 10 }, (_, i) => ({ ...good, title: "Folie " + i })),
  ];
  const out = clean({ summary_slides: slides });
  eq(out.summary_slides.length, 8, "höchstens 8");
  eq(out.summary_slides[0], good, "erste gute Folie zuerst");
  eq(Object.keys(out.summary_slides[1]).sort(), ["content", "keywords", "title"], "Zusatzfeld der Folie entfernt");
  const d = await dbSlides(out.summary_slides);
  eq(d.ok, true, `Datenbank Folien (${d.why})`);
});

Deno.test("Folien in Höchstlänge: Budget 18.000 Byte, Datenbank-Grenze 20.000 Byte", async () => {
  const mk = (ch: string) => Array.from({ length: 8 }, (_, i) => ({
    // Länge zählt in UTF-16-Einheiten: ein Emoji zählt doppelt
    title: rep(ch, Math.floor(119 / ch.length)) + i, content: rep(ch, Math.floor(600 / ch.length)),
    keywords: Array.from({ length: 6 }, (_, k) => rep(ch, Math.floor(59 / ch.length)) + k),
  }));
  const res: string[] = [];
  for (const [label, ch, min] of [["ASCII", "a", 8], ["Umlaut ä", "ä", 8], ["Anführung „", "„", 5], ["Emoji", "😀", 1]] as const) {
    const out = clean({ summary_slides: mk(ch) });
    const bytes = new TextEncoder().encode(JSON.stringify(out.summary_slides)).length;
    const d = await dbSlides(out.summary_slides);
    console.log(`${label}: ${out.summary_slides.length} Folien, JSON ${bytes} Byte, ${d.why}`);
    if (!d.ok) res.push(`${label}: Datenbank lehnt ab (${d.why})`);
    if (bytes > 18000) res.push(`${label}: über Budget (${bytes})`);
    if (out.summary_slides.length < min) res.push(`${label}: nur ${out.summary_slides.length} Folien, erwartet ≥ ${min}`);
  }
  eq(res, [], "Folien");
});

Deno.test("Folien-Zufallstest: Ergebnis von clean passt immer in die Datenbank", async () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const chars = ["a", "ä", "„", "€", "😀", "\n", '"', "\\", " ", "Z", "ß"];
  const text = (max: number) => { let s = "x"; const n = Math.floor(rnd() * max); for (let i = 1; i < n; i++) s += chars[Math.floor(rnd() * chars.length)]; return s; };
  const bad: string[] = [];
  for (let i = 0; i < 300; i++) {
    const slides = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => ({
      title: text(120), content: text(600), keywords: Array.from({ length: Math.floor(rnd() * 7) }, () => text(60)).filter((k) => k.length <= 60),
    }));
    const out = clean({ summary_slides: slides });
    const d = await dbSlides(out.summary_slides);
    if (!d.ok && bad.length < 3) bad.push(d.why);
  }
  eq(bad, [], "Datenbank lehnt Folien ab");
});

Deno.test("Abgleich mit 3000 Zufallsmutationen: bereinigte Frage ⇒ Datenbank nimmt an, erneute Prüfung stabil", async () => {
  let seed = 4711;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const values = () => pick<unknown>(["", " ", "a", "€", "😀", rep("ö", 70), rep("x", 201), "Pinguin", "1 000 000", "www.x.de", "Ei\t", "Ei\uD800",
    0, 1, 2, 3, 4, -1, 1.5, "1", true, false, null, [], {}, ["a"], { geheim: rep("g", 9000) }]);
  function mutate(x: any): any {
    if (Array.isArray(x)) {
      const a = x.map((e) => (rnd() < 0.3 ? mutate(e) : e));
      if (rnd() < 0.2) a.pop();
      if (rnd() < 0.2) a.push(rnd() < 0.5 ? clone(a[0] ?? "neu") : (typeof a[0] === "string" ? a[0] + " neu" + a.length : a[0] && typeof a[0] === "object" ? Object.fromEntries(Object.entries(a[0]).map(([k, v]) => [k, typeof v === "string" ? v + " neu" + a.length : v])) : "neu"));
      return a;
    }
    if (x && typeof x === "object") {
      const o: any = {};
      for (const [k, v] of Object.entries(x)) if (rnd() > 0.05) o[k] = rnd() < 0.3 ? mutate(v) : v;
      if (rnd() < 0.1) o["zusatz"] = rep("z", 9000);
      return o;
    }
    return rnd() < 0.5 ? values() : x;
  }
  const leaks: string[] = [];
  let passed = 0;
  for (let i = 0; i < 3000; i++) {
    const r = accepted(mutate(clone(pick(Object.values(GOOD)))));
    if (typeof r === "string") { leaks.push(r); continue; }
    if (!r) continue;
    passed++;
    if (JSON.stringify(accepted(r)) !== JSON.stringify(r) && leaks.length < 5) leaks.push("nicht stabil: " + JSON.stringify(r).slice(0, 150));
    const d = await dbAccepts(r);
    if (!d.ok && leaks.length < 5) leaks.push(`${d.why}: ${JSON.stringify(r).slice(0, 200)}`);
  }
  console.log(`durchgelassene Mutationen: ${passed} von 3000`);
  eq(passed > 100, true, `genug durchgelassene Mutationen (${passed})`);
  eq(leaks, [], "von validate.ts angenommen, von der Datenbank abgelehnt");
});

Deno.test("Folienverweis zeigt nach verworfenen Folien auf dieselbe Folie (Spickzettel)", () => {
  const f = (t: string) => ({ title: t, content: "Inhalt " + t, keywords: [] });
  const q = (slide: unknown) => ({ ...clone(GOOD.multiple_choice), prompt: "Frage " + String(slide) + "?", slide });
  // Folie 1 ist kaputt und fällt weg: aus 2 wird 1, aus 3 wird 2; Verweis auf die kaputte Folie entfällt
  const out = clean({ summary_slides: [f("A"), { title: "" }, f("C"), f("D")], questions: [q(0), q(1), q(2), q(3), q(4), q(-1), q(1.5), q("2")] });
  eq(out.summary_slides.map((s) => s.title), ["A", "C", "D"], "kaputte Folie verworfen");
  eq(out.questions.map((x) => x.slide), [0, undefined, 1, 2, undefined, undefined, undefined, undefined], "Verweise umgerechnet");
  for (const x of out.questions) if (x.slide !== undefined) eq(out.summary_slides[x.slide].title, ["A", "B", "C", "D"][Number(x.prompt.match(/\d/)![0])], "gleiche Folie wie vorher");
});
