// BrainCraft am Mac: Klassenarbeit aus Heftfotos über Claude Code (ohne KI-Kosten pro Seite)
//
//   node tools/braincraft.ts pruefen <ordner>     ergebnis.json prüfen → geprueft.json (macht Claude)
//   node tools/braincraft.ts einspielen <ordner>  geprueft.json als Entwurf einspielen (Marco im Terminal, mit PIN)
//   node tools/braincraft.ts abmelden             gespeicherte Google-Sitzung am Mac löschen
//
// Anmeldung wie in der App mit Google (Migration 007): Beim ersten Mal öffnet sich der Browser, Google leitet
// zurück auf http://localhost:5179/braincraft-cli (in Supabase als Redirect-URL eintragen). Gespeichert wird nur
// das Erneuerungs-Token in ~/.config/braincraft/sitzung (nur für dich lesbar). Die PIN wird nur eingetippt und
// nie gespeichert. Eine neue Familie legt man in der App an (nach der Google-Anmeldung).
// Läuft mit Node 24 direkt als TypeScript.

import { createInterface } from 'node:readline/promises'
import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { clean } from '../supabase/functions/bc-extract/validate.ts'

const SUPABASE_URL = 'https://asfwbuptsfcrgmmgdgim.supabase.co'
// Öffentlicher Schlüssel (publishable), wie in der App; die Rechte liegen in den bc_*-Funktionen
const PUBLISHABLE_KEY = 'sb_publishable_uXsPWezRtId6Eh3Dme7BcQ_mQzAx6Se'
const CONFIG_DIR = join(homedir(), '.config', 'braincraft')
const SESSION_FILE = join(CONFIG_DIR, 'sitzung')
const OLD_CODE_FILE = join(CONFIG_DIR, 'familie')
const CLI_PORT = 5179
const CLI_REDIRECT = `http://localhost:${CLI_PORT}/braincraft-cli`

interface Meta {
  fach?: string
  arbeit?: string
  datum?: string | null
  kind?: string
}

const fail = (text: string): never => {
  console.error(`\n✗ ${text}`)
  process.exit(1)
}

let accessToken: string | null = null

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`)
  return data as T
}

// ---------- Eingabe ----------

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

// Verdeckte Eingabe (PIN): Zeichen werden nicht angezeigt
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    if (!stdin.isTTY) fail('Bitte im Terminal-Fenster starten (nicht über Claude Code), damit die PIN verdeckt bleibt.')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (ch === '\u0003') {
        process.exit(130)
      } else if (ch === '\u007f') {
        value = value.slice(0, -1)
      } else {
        value += ch
      }
    }
    stdin.on('data', onData)
  })
}

// ---------- Anmeldung mit Google (PKCE, Rückleitung auf localhost) ----------

const b64url = (b: Buffer) => b.toString('base64url')

interface Tokens { access_token: string; refresh_token: string }

async function token(grant: 'pkce' | 'refresh_token', body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token || !data?.refresh_token) throw new Error(data?.error_description ?? data?.msg ?? `HTTP ${res.status}`)
  return data as Tokens
}

function saveSession(t: Tokens) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(SESSION_FILE, JSON.stringify({ refresh_token: t.refresh_token }) + '\n')
  chmodSync(SESSION_FILE, 0o600)
}

async function googleLogin(): Promise<Tokens> {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(CLI_REDIRECT)}` +
    `&code_challenge=${challenge}&code_challenge_method=s256`
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('Zeit abgelaufen')) }, 5 * 60_000)
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', CLI_REDIRECT)
      if (u.pathname !== '/braincraft-cli') { res.writeHead(404).end(); return }
      const c = u.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>BrainCraft</title><p style="font:17px -apple-system,sans-serif;margin:40px">` +
        (c ? 'Angemeldet. Du kannst dieses Fenster schließen und im Terminal weitermachen.' : 'Anmeldung abgebrochen.') + '</p>')
      clearTimeout(timer)
      server.close()
      if (c) resolve(c)
      else reject(new Error(u.searchParams.get('error_description') ?? 'abgebrochen'))
    })
    server.on('error', () => reject(new Error(`Port ${CLI_PORT} ist belegt`)))
    server.listen(CLI_PORT, '127.0.0.1', () => {
      console.log('Im Browser mit Google anmelden (dasselbe Konto wie in der App) …')
      execFile('open', [url], (e) => { if (e) console.log(`Bitte diese Adresse im Browser öffnen:\n${url}`) })
    })
  })
  return token('pkce', { auth_code: code, code_verifier: verifier })
}

async function signIn() {
  if (existsSync(OLD_CODE_FILE)) rmSync(OLD_CODE_FILE)   // Familien-Code gibt es nicht mehr
  let t: Tokens | null = null
  if (existsSync(SESSION_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { refresh_token?: string }
      if (saved.refresh_token) t = await token('refresh_token', { refresh_token: saved.refresh_token })
    } catch {
      t = null   // abgelaufen oder widerrufen: neu anmelden
    }
  }
  if (!t) t = await googleLogin().catch((e) => fail(`Anmeldung mit Google fehlgeschlagen (${(e as Error).message}).`))
  saveSession(t)
  accessToken = t.access_token
  const s = await rpc<{ family_id: string | null }>('bc_session', {}).catch((e) => fail(`Anmeldung nicht bestätigt (${(e as Error).message}).`))
  if (!s.family_id) fail('Dieses Google-Konto gehört noch zu keiner Familie. Bitte zuerst in der App anmelden und die Familie anlegen.')
}

async function unlock(): Promise<string> {
  const pin = await askHidden('Eltern-PIN (4 Ziffern): ')
  const r = await rpc<{ ok: boolean; token?: string; error?: string; locked_until?: string }>('bc_parent_unlock', {
    p_pin: pin,
  }).catch((e) => fail(`Entsperren fehlgeschlagen (${(e as Error).message}).`))
  if (r.ok && r.token) return r.token
  if (r.error === 'pin_locked') fail(`PIN gesperrt bis ${new Date(r.locked_until!).toLocaleTimeString('de-DE')}.`)
  return fail('PIN falsch.')
}

// ---------- Befehle ----------

function pruefen(dir: string) {
  const file = join(dir, 'ergebnis.json')
  if (!existsSync(file)) fail(`${file} fehlt.`)
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const out = clean(raw)
  const meta: Meta = raw.meta ?? {}
  writeFileSync(join(dir, 'geprueft.json'), JSON.stringify({ meta, ...out }, null, 2) + '\n')
  const perType: Record<string, number> = {}
  for (const q of out.questions) perType[q.type] = (perType[q.type] ?? 0) + 1
  console.log(`Folien: ${out.summary_slides.length}`)
  console.log(`Fragen: ${out.questions.length} (aussortiert: ${out.dropped})`)
  for (const [t, n] of Object.entries(perType)) console.log(`  ${t}: ${n}`)
  if (!out.questions.length) fail('Keine gültige Frage übrig.')
  for (const w of warnings(out)) console.log(`  ! ${w}`)
}

// Didaktische Hinweise (Lern-Lotte): kein Abbruch, nur Warnungen
function warnings(out: ReturnType<typeof clean>): string[] {
  const w: string[] = []
  const slides = out.summary_slides
  if (slides.length < 3 || slides.length > 5) w.push(`${slides.length} Folien (empfohlen 3–5)`)
  slides.forEach((s, i) => {
    const sentences = s.content.split(/(?<=[.!?])\s+/).filter(Boolean)
    if (sentences.length > 3) w.push(`Folie ${i + 1}: ${sentences.length} Sätze (höchstens 3)`)
    const long = sentences.find((x) => x.split(/\s+/).length > 15)
    if (long) w.push(`Folie ${i + 1}: Satz mit mehr als 15 Wörtern`)
    if (s.keywords.length > 4) w.push(`Folie ${i + 1}: ${s.keywords.length} Schlüsselwörter (höchstens 4)`)
  })
  const noSlide = out.questions.filter((q) => q.slide === undefined).length
  if (noSlide) w.push(`${noSlide} Fragen ohne Folienverweis (slide)`)
  const used = new Set(out.questions.map((q) => q.slide))
  slides.forEach((_, i) => { if (!used.has(i)) w.push(`Folie ${i + 1} hat keine Frage`) })
  return w
}

interface Pull {
  profiles: { id: string; child_name: string }[]
  subjects: { id: string; name: string }[]
  exams: { id: string; title: string; subject_id: string; profile_id: string; exam_date: string | null }[]
}

async function einspielen(dir: string) {
  const file = join(dir, 'geprueft.json')
  if (!existsSync(file)) fail(`${file} fehlt. Erst „pruefen“ laufen lassen.`)
  const data = JSON.parse(readFileSync(file, 'utf8')) as { meta: Meta } & ReturnType<typeof clean>
  const meta = data.meta ?? {}
  if (!meta.fach || !meta.arbeit) fail('In geprueft.json fehlen meta.fach oder meta.arbeit.')
  console.log(`Klassenarbeit: ${meta.fach} – ${meta.arbeit}${meta.datum ? ` (${meta.datum})` : ''}`)
  console.log(`${data.summary_slides.length} Folien, ${data.questions.length} Fragen\n`)

  await signIn()
  const token = await unlock()
  try {
    const pull = await rpc<Pull>('bc_pull', { p_token: token })
    const kids = meta.kind ? pull.profiles.filter((p) => p.child_name === meta.kind) : pull.profiles
    if (kids.length !== 1) fail('Kind nicht eindeutig. Bitte meta.kind in ergebnis.json setzen.')
    const kid = kids[0]

    const subject = pull.subjects.find((s) => s.name.toLowerCase() === meta.fach!.toLowerCase())
    const subjectId =
      subject?.id ??
      (await rpc<string>('bc_subject_save', {
        p_token: token, p_id: null, p_name: meta.fach, p_icon: 'book', p_color_theme: 'brand',
      }))
    const exam = pull.exams.find(
      (e) => e.subject_id === subjectId && e.profile_id === kid.id && e.title.toLowerCase() === meta.arbeit!.toLowerCase(),
    )
    const examId =
      exam?.id ??
      (await rpc<string>('bc_exam_save', {
        p_token: token, p_id: null, p_profile_id: kid.id, p_subject_id: subjectId,
        p_title: meta.arbeit, p_exam_date: meta.datum ?? null, p_is_archived: false,
      }))

    const r = await rpc<{ unit_id: string | null; inserted: number }>('bc_unit_import', {
      p_token: token, p_exam_id: examId, p_scan_job_id: null,
      p_slides: data.summary_slides, p_questions: data.questions,
    })
    console.log(`✓ ${r.inserted} neue Fragen als Entwurf eingespielt${exam ? '' : ' (Klassenarbeit neu angelegt)'}.`)
    console.log('  Freigeben kannst du sie im Eltern-Cockpit der App.')
  } catch (e) {
    fail(`Einspielen fehlgeschlagen (${(e as Error).message}).`)
  } finally {
    await rpc('bc_parent_lock', { p_token: token }).catch(() => undefined)
  }
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'pruefen' && arg) pruefen(arg)
else if (cmd === 'einspielen' && arg) await einspielen(arg)
else if (cmd === 'abmelden') {
  if (existsSync(SESSION_FILE)) rmSync(SESSION_FILE)
  console.log('✓ Google-Sitzung am Mac gelöscht.')
} else fail('Aufruf: node tools/braincraft.ts pruefen|einspielen <ordner> oder abmelden')
