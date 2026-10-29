// BrainCraft – Heftfotos werden zu Lernfolien und Fragen (Schritt 2)
//
// Ablauf (immer mit Familien-Code + Eltern-Token, geprüft über die bc_*-Funktionen):
//   start   { exam_id, count }        → Scan-Auftrag anlegen, signierte Upload-Adressen je Foto
//   analyze { ticket, index }         → ein Foto an Claude, geprüfte Folien und Fragen zurück
//   merge   { ticket, pages }         → Ergebnisse aller Seiten zusammenführen, Doppeltes entfernen
//   finish  { ticket, ok }            → Fotos löschen, Auftrag abschließen (Ticket reicht; „fertig“ nur mit Token)
//   cleanup (Header x-cron-secret)    → liegengebliebene und verwaiste Fotos löschen (pg_cron „braincraft-fotos“)
// Jeder Aufruf an Claude wird vorher über bc_scan_tick gezählt und begrenzt (Kosten, Siggi H4).
// Übernommen werden die Fragen erst über bc_unit_import (Status „entwurf“, Freigabe durch Eltern).
// Geheimnisse: ANTHROPIC_API_KEY als Edge-Secret, das Cron-Secret im Supabase Vault (bc_cron_secret).

import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { clean } from "./validate.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic({ timeout: 140_000, maxRetries: 1 });
// Modell und Denktiefe als Konfiguration (Marco entscheidet), Standard: aktuelles Opus
const MODEL = Deno.env.get("BC_MODEL") ?? "claude-opus-5-5";
const EFFORT = (Deno.env.get("BC_EFFORT") ?? "medium") as "low" | "medium" | "high";
const BUCKET = "bc-scans";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("BC_ORIGIN") ?? "https://marcokland-web.github.io",
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class Fail extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

// ---------- Ticket: bindet Auftrag und Familie, damit spätere Aufrufe den Foto-Ordner kennen ----------

const enc = new TextEncoder();
const keyPromise = crypto.subtle.importKey(
  "raw",
  enc.encode("bc-ticket:" + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

interface Ticket {
  job: string;
  fam: string;
  n: number;
  exp: number;
}

async function makeTicket(t: Ticket) {
  const body = b64url(enc.encode(JSON.stringify(t)));
  const sig = await crypto.subtle.sign("HMAC", await keyPromise, enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function readTicket(s: unknown): Promise<Ticket> {
  let t: Ticket;
  try {
    if (typeof s !== "string" || s.length > 600) throw 0;
    const [body, sig, rest] = s.split(".");
    if (!body || !sig || rest !== undefined) throw 0;
    if (!(await crypto.subtle.verify("HMAC", await keyPromise, unb64url(sig), enc.encode(body)))) throw 0;
    t = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (typeof t.job !== "string" || typeof t.fam !== "string" || !Number.isInteger(t.n) || typeof t.exp !== "number") throw 0;
  } catch {
    throw new Fail("bad_ticket");
  }
  if (t.exp < Date.now()) throw new Fail("ticket_expired");
  return t;
}

// ---------- Datenbank ----------

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    // Eigene Fehlercodes der bc_*-Funktionen durchreichen, sonst nichts verraten
    const code = /^[a-z_]{3,40}$/.test(error.message) ? error.message : "server_error";
    throw new Fail(code, code === "server_error" ? 500 : 400);
  }
  return data as T;
}

interface JobCheck {
  found: boolean;
  parent: boolean;
  status: string;
  images_deleted: boolean;
}

// Prüft, dass der Auftrag zur Familie des Codes gehört; mit needParent auch das Eltern-Token
async function checkJob(code: string, token: string, t: Ticket, needParent = true) {
  const c = await rpc<JobCheck>("bc_scan_check", { p_code: code, p_token: token || null, p_job_id: t.job });
  if (!c.found) throw new Fail("scan_not_found");
  if (needParent && !c.parent) throw new Fail("pin_required", 401);
  return c;
}

const isOpen = (c: JobCheck) => !c.images_deleted && c.status !== "fertig" && c.status !== "fehler";

const prefix = (t: Ticket) => `${t.fam}/${t.job}/`;

async function removePaths(paths: string[]) {
  if (!paths.length) return;
  const { error } = await db.storage.from(BUCKET).remove(paths);
  if (error) throw new Fail("delete_failed", 500);
}

async function removeImages(pfx: string) {
  const { data } = await db.storage.from(BUCKET).list(pfx.slice(0, -1), { limit: 100 });
  await removePaths((data ?? []).map((o) => pfx + o.name));
}

// ---------- Claude ----------

// JSON-Schema für Structured Outputs: Folien + Fragen als Vereinigung der 7 Formate
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});
const S = { type: "string" };
const SA = { type: "array", items: S };
const question = (type: string, payload: Record<string, unknown>) =>
  obj({ type: { type: "string", enum: [type] }, prompt: S, payload: obj(payload) });

const SCHEMA = obj({
  summary_slides: { type: "array", items: obj({ title: S, content: S, keywords: SA }) },
  questions: {
    type: "array",
    items: {
      anyOf: [
        question("multiple_choice", { options: SA, correct_index: { type: "integer" }, explanation: S }),
        question("word_clicker", { sentence_with_gap: S, correct_word: S, distractors: SA }),
        question("sort_boxes", {
          categories: SA,
          items: { type: "array", items: obj({ text: S, category_index: { type: "integer" } }) },
        }),
        question("detective", {
          statements: { type: "array", items: obj({ text: S, is_impostor: { type: "boolean" } }) },
          reveal_text: S,
        }),
        question("bubble_pop", {
          target_rule: S,
          bubbles: { type: "array", items: obj({ text: S, is_correct: { type: "boolean" } }) },
        }),
        question("pair_matching", { pairs: { type: "array", items: obj({ left: S, right: S }) } }),
        question("sequencing", { correct_order: SA }),
      ],
    },
  },
});

const SYSTEM = `Du bist der didaktische Kern von BrainCraft, einer Lern-App für ein Kind der 3. oder 4. Klasse (9 Jahre).
Du bekommst Fotos aus Heften oder Schulbüchern und machst daraus Lernfolien und Übungsfragen.

Regeln:
1. Vollständigkeit: Erfasse jeden Lernfakt, jede Definition und jeden Ablauf auf dem Foto. Erfinde nichts dazu, was nicht auf dem Foto steht oder für die 3./4. Klasse selbstverständlich ist.
2. Deduplizierung: Wiederholt sich ein Inhalt, wird er zu einem klaren Lernfakt.
3. Kindgerecht: kurze Sätze, einfache Wörter, Ansprache mit „du“. Wo der Name des Kindes passt, schreibe genau [NAME]; die App setzt den Namen ein.
4. Nur Antworten per Tippen, Ziehen oder Sortieren, nie Tippen auf einer Tastatur.
5. Ignoriere persönliche Angaben auf dem Foto (Namen, Schule, Noten, Lehrerkommentare); sie kommen nirgends vor.
6. Ist auf dem Foto kein Lernstoff zu erkennen, gib leere Listen zurück.

Folien: 3 bis 5 Folien, je Titel, höchstens 3 Sätze Inhalt und bis zu 4 Schlüsselwörter.

Fragen (lückenloser Katalog, gemischte Formate, etwa 2 Fragen je Lernfakt):
- multiple_choice: genau 4 verschiedene Optionen, correct_index 0 bis 3, kurze explanation.
- word_clicker: sentence_with_gap mit genau einem [GAP], correct_word, genau 3 distractors (alle verschieden vom richtigen Wort).
- sort_boxes: genau 2 categories, 4 bis 12 items, höchstens 6 je Kiste, category_index 0 oder 1.
- detective: genau 3 statements, genau eine davon is_impostor = true (eine falsche Aussage, keine Verneinung als Trick), reveal_text erklärt, was richtig ist. prompt: „Welcher Satz stimmt nicht?“
- bubble_pop: target_rule, 4 bis 8 bubbles, mindestens ein Treffer und eine Niete.
- pair_matching: 2 bis 4 pairs.
- sequencing: 3 bis 5 Schritte in correct_order.`;

const MERGE = `Du bekommst die Ergebnisse mehrerer Fotos derselben Klassenarbeit als JSON.
Führe sie zu einem Ergebnis zusammen: 3 bis 5 Folien für den ganzen Stoff und ein lückenloser Fragenkatalog ohne inhaltliche Doppelungen.
Behalte alle Lernfakten. Halte dich an dieselben Formatregeln wie in den Eingaben. Erfinde nichts dazu.`;

async function ask(system: string, content: Anthropic.Beta.Messages.BetaContentBlockParam[]) {
  const stream = anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
    // Lehnt das Modell ab, übernimmt serverseitig ein passendes Ersatzmodell
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Fail("ai_refused", 422);
  if (msg.stop_reason === "max_tokens") throw new Fail("ai_too_long", 422);
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Fail("ai_empty", 502);
  return clean(JSON.parse(text.text));
}

// ---------- Aktionen ----------

async function start(code: string, token: string, b: Record<string, unknown>) {
  const count = Number(b.count);
  const r = await rpc<{ job_id: string; family_id: string; prefix: string }>("bc_scan_start", {
    p_code: code,
    p_token: token,
    p_exam_id: b.exam_id,
    p_image_count: count,
  });
  const t: Ticket = { job: r.job_id, fam: r.family_id, n: count, exp: Date.now() + 2 * 3600_000 };
  const uploads = [];
  for (let i = 0; i < count; i++) {
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(`${r.prefix}${i}.jpg`);
    if (error || !data) throw new Fail("upload_url_failed", 500);
    uploads.push({ index: i, url: data.signedUrl });
  }
  return { ticket: await makeTicket(t), job_id: r.job_id, uploads };
}

async function analyze(code: string, token: string, b: Record<string, unknown>) {
  const t = await readTicket(b.ticket);
  const index = Number(b.index);
  if (!Number.isInteger(index) || index < 0 || index >= t.n) throw new Fail("bad_index");
  if (!isOpen(await checkJob(code, token, t))) throw new Fail("scan_closed");
  const { data, error } = await db.storage.from(BUCKET).download(`${prefix(t)}${index}.jpg`);
  if (error || !data) throw new Fail("image_missing");
  if (data.size > 1_048_576) throw new Fail("image_too_large");
  const bytes = new Uint8Array(await data.arrayBuffer());
  // Nur echte JPEGs (Kennung FF D8 FF), der MIME-Typ beim Hochladen ist nicht verlässlich
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Fail("bad_image");
  // Zählt und begrenzt den Aufruf an Claude (je Auftrag, Familie und gesamt)
  await rpc("bc_scan_tick", { p_job_id: t.job, p_kind: "analyze" });
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return await ask(SYSTEM, [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: btoa(bin) } },
    { type: "text", text: `Foto ${index + 1} von ${t.n}. Erstelle Folien und Fragen zu diesem Foto.` },
  ]);
}

async function merge(code: string, token: string, b: Record<string, unknown>) {
  const t = await readTicket(b.ticket);
  if (!isOpen(await checkJob(code, token, t))) throw new Fail("scan_closed");
  if (!Array.isArray(b.pages) || b.pages.length < 1 || b.pages.length > t.n) throw new Fail("bad_pages");
  if (!b.pages.every((p) => typeof p === "object" && p !== null)) throw new Fail("bad_pages");
  // Nur geprüfte Inhalte weitergeben, Größe begrenzen
  const pages = b.pages.map((p) => clean(p as Record<string, unknown>)).map(({ summary_slides, questions }) => ({ summary_slides, questions }));
  const input = JSON.stringify(pages);
  if (input.length > 400_000) throw new Fail("pages_too_large");
  if (pages.length === 1) return { ...pages[0], dropped: 0 };
  await rpc("bc_scan_tick", { p_job_id: t.job, p_kind: "merge" });
  return await ask(SYSTEM + "\n\n" + MERGE, [{ type: "text", text: input }]);
}

async function finish(code: string, token: string, b: Record<string, unknown>) {
  const t = await readTicket(b.ticket);
  // Fotos des eigenen Auftrags löschen darf jeder mit gültigem Ticket und Code (Eltern-Token kann abgelaufen sein)
  const c = await checkJob(code, token, t, false);
  await removeImages(prefix(t));
  if (c.images_deleted) return { ok: true };
  const ok = b.ok === true && c.parent;
  await rpc("bc_scan_update", {
    p_job_id: t.job,
    p_status: ok ? "fertig" : "fehler",
    p_images_deleted: true,
    p_error: ok ? null : String(b.error ?? "abgebrochen").slice(0, 200),
  });
  return { ok: true };
}

async function cleanup() {
  let cleaned = 0, failed = 0;
  const stale = await rpc<{ job_id: string; prefix: string }[]>("bc_scan_stale", {});
  for (const s of stale) {
    try {
      await removeImages(s.prefix);
      await rpc("bc_scan_update", { p_job_id: s.job_id, p_status: "fehler", p_images_deleted: true, p_error: "abgelaufen" });
      cleaned++;
    } catch {
      failed++;
    }
  }
  // Fotos ohne offenen Auftrag (gelöschte Klassenarbeit/Familie, späte Uploads)
  let orphans = 0;
  try {
    const list = await rpc<{ name: string }[]>("bc_scan_orphans", {});
    orphans = list.length;
    await removePaths(list.map((o) => o.name));
  } catch {
    failed++;
  }
  return { cleaned, orphans, failed };
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const cron = req.headers.get("x-cron-secret");
    if (cron !== null) {
      // Das Vault-Secret hat 64 Hex-Zeichen; alles andere ohne Datenbankabfrage abweisen
      if (!/^[0-9a-f]{64}$/.test(cron)) return json({ error: "forbidden" }, 403);
      const secret = await rpc<string | null>("bc_cron_secret", {});
      if (!secret || !safeEqual(cron, secret)) return json({ error: "forbidden" }, 403);
      return json(await cleanup());
    }
    const raw = await req.text();
    if (raw.length > 600_000) return json({ error: "too_large" }, 413);
    const b = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof b !== "object" || b === null || Array.isArray(b)) return json({ error: "bad_json" }, 400);
    const code = typeof b.code === "string" ? b.code : "";
    const token = typeof b.token === "string" ? b.token : "";
    if (!code) return json({ error: "not_found" }, 400);
    // Nur „finish“ geht ohne Eltern-Token (Fotos löschen, Siggi H2)
    if (!token && b.action !== "finish") return json({ error: "pin_required" }, 401);
    switch (b.action) {
      case "start":
        return json(await start(code, token, b));
      case "analyze":
        return json(await analyze(code, token, b));
      case "merge":
        return json(await merge(code, token, b));
      case "finish":
        return json(await finish(code, token, b));
      default:
        return json({ error: "bad_action" }, 400);
    }
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "ai_busy" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "ai_error" }, 502);
    if (e instanceof SyntaxError) return json({ error: "bad_json" }, 400);
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
