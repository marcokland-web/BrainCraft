// BrainCraft am Mac: Klassenarbeit aus Heftfotos über Claude Code (ohne KI-Kosten pro Seite)
//
//   node tools/braincraft.ts pruefen <ordner>     ergebnis.json prüfen → geprueft.json (macht Claude)
//   node tools/braincraft.ts einrichten           Familie mit Einladungscode anlegen (einmalig, Marco im Terminal)
//   node tools/braincraft.ts einspielen <ordner>  geprueft.json als Entwurf einspielen (Marco im Terminal, mit PIN)
//
// Die PIN wird nur eingetippt und nie gespeichert. Der Familien-Code liegt nach „einrichten“
// in ~/.config/braincraft/familie (nur für dich lesbar), sonst wird er abgefragt.
// Läuft mit Node 24 direkt als TypeScript.

import { createInterface } from 'node:readline/promises'
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { clean } from '../supabase/functions/bc-extract/validate.ts'

const SUPABASE_URL = 'https://asfwbuptsfcrgmmgdgim.supabase.co'
// Öffentlicher Schlüssel (publishable), wie in der App; die Rechte liegen in den bc_*-Funktionen
const PUBLISHABLE_KEY = 'sb_publishable_uXsPWezRtId6Eh3Dme7BcQ_mQzAx6Se'
const CODE_FILE = join(homedir(), '.config', 'braincraft', 'familie')

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

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
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

async function familyCode(): Promise<string> {
  if (existsSync(CODE_FILE)) return readFileSync(CODE_FILE, 'utf8').trim()
  return ask('Familien-Code: ')
}

async function unlock(code: string): Promise<string> {
  const pin = await askHidden('Eltern-PIN (4 Ziffern): ')
  const r = await rpc<{ ok: boolean; token?: string; error?: string; locked_until?: string }>('bc_parent_unlock', {
    p_code: code,
    p_pin: pin,
  }).catch(() => fail('Familien-Code nicht gefunden.'))
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

async function einrichten() {
  const invite = await ask('Einladungscode: ')
  const child = await ask('Vorname des Kindes: ')
  if (!child || child.length > 30) fail('Bitte einen Vornamen mit höchstens 30 Zeichen.')
  const pin = await askHidden('Neue Eltern-PIN (4 Ziffern): ')
  if (!/^[0-9]{4}$/.test(pin)) fail('Die PIN muss aus 4 Ziffern bestehen.')
  if ((await askHidden('PIN wiederholen: ')) !== pin) fail('Die PINs stimmen nicht überein.')
  // 20 Zeichen ohne verwechselbare Zeichen (kein 0/O, 1/I/L)
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const raw = Array.from({ length: 20 }, () => abc[randomInt(abc.length)]).join('')
  const code = raw.match(/.{4}/g)!.join('-')
  await rpc('bc_create', { p_invite: invite, p_code: code, p_child_name: child, p_pin: pin }).catch((e) =>
    fail(e.message === 'invite_invalid' ? 'Einladungscode ungültig oder abgelaufen.' : `Anlegen fehlgeschlagen (${e.message}).`),
  )
  mkdirSync(join(homedir(), '.config', 'braincraft'), { recursive: true })
  writeFileSync(CODE_FILE, code + '\n')
  chmodSync(CODE_FILE, 0o600)
  console.log(`\n✓ Familie angelegt. Familien-Code: ${code}`)
  console.log('  Bitte sicher notieren: Damit verbindest du später die App auf euren Geräten.')
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

  const code = await familyCode()
  const token = await unlock(code)
  try {
    const pull = await rpc<Pull>('bc_pull', { p_code: code, p_token: token })
    const kids = meta.kind ? pull.profiles.filter((p) => p.child_name === meta.kind) : pull.profiles
    if (kids.length !== 1) fail('Kind nicht eindeutig. Bitte meta.kind in ergebnis.json setzen.')
    const kid = kids[0]

    const subject = pull.subjects.find((s) => s.name.toLowerCase() === meta.fach!.toLowerCase())
    const subjectId =
      subject?.id ??
      (await rpc<string>('bc_subject_save', {
        p_code: code, p_token: token, p_id: null, p_name: meta.fach, p_icon: 'book', p_color_theme: 'brand',
      }))
    const exam = pull.exams.find(
      (e) => e.subject_id === subjectId && e.profile_id === kid.id && e.title.toLowerCase() === meta.arbeit!.toLowerCase(),
    )
    const examId =
      exam?.id ??
      (await rpc<string>('bc_exam_save', {
        p_code: code, p_token: token, p_id: null, p_profile_id: kid.id, p_subject_id: subjectId,
        p_title: meta.arbeit, p_exam_date: meta.datum ?? null, p_is_archived: false,
      }))

    const r = await rpc<{ unit_id: string | null; inserted: number }>('bc_unit_import', {
      p_code: code, p_token: token, p_exam_id: examId, p_scan_job_id: null,
      p_slides: data.summary_slides, p_questions: data.questions,
    })
    console.log(`✓ ${r.inserted} neue Fragen als Entwurf eingespielt${exam ? '' : ' (Klassenarbeit neu angelegt)'}.`)
    console.log('  Freigeben kannst du sie im Eltern-Cockpit der App.')
  } catch (e) {
    fail(`Einspielen fehlgeschlagen (${(e as Error).message}).`)
  } finally {
    await rpc('bc_parent_lock', { p_code: code, p_token: token }).catch(() => undefined)
  }
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'pruefen' && arg) pruefen(arg)
else if (cmd === 'einrichten') await einrichten()
else if (cmd === 'einspielen' && arg) await einspielen(arg)
else fail('Aufruf: node tools/braincraft.ts pruefen|einspielen <ordner> oder einrichten')
