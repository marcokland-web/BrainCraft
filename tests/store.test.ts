// Bug-Bodo: Unit-Tests für src/lib/store.ts und src/lib/api.ts (Warteschlange, flush, refresh, Eltern-Token,
// abgeleitete Werte). fetch ist gemockt: Es geht KEINE Anfrage an die echte Datenbank.
// Aufruf (Node 24, TypeScript direkt):
//   cd /Users/marcokland/Apps/BrainCraft && TZ=Europe/Berlin node --test tests/store.test.ts
// Ergebnis: Exit-Code 0 = alles bestanden.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})

// ---------- Attrappen für Browser-Umgebung ----------
const g = globalThis as any
const mem = new Map<string, string>()
g.localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}
g.document = { documentElement: { lang: '', setAttribute() {}, removeAttribute() {} }, querySelectorAll: () => [], querySelector: () => null }
g.matchMedia = () => ({ matches: false, addEventListener() {} })
const winListeners: Record<string, (() => void)[]> = {}
g.window = { addEventListener: (t: string, f: () => void) => (winListeners[t] ??= []).push(f) }

// ---------- Gemocktes fetch ----------
type Call = { fn: string; args: any }
let calls: Call[] = []
type Handler = (fn: string, args: any) => Promise<Response> | Response
let handler: Handler = () => json(null)
let netDown = false
const realFetch = g.fetch
g.fetch = async (url: string, init: any) => {
  assert.ok(String(url).includes('/rest/v1/rpc/'), 'nur RPC erwartet: ' + url)
  const fn = String(url).split('/rpc/')[1]
  const args = JSON.parse(init.body)
  if (netDown) throw new TypeError('Failed to fetch')
  calls.push({ fn, args })
  return handler(fn, args)
}
void realFetch
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
const err = (message: string, status = 400) => json({ code: 'P0001', message }, status)
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

const KID = '11111111-1111-1111-1111-111111111111'
const KID2 = '22222222-2222-2222-2222-222222222222'
const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW'
function fakePull(over: any = {}) {
  return {
    today: '2026-10-24', parent: false,
    profiles: [
      { id: KID, child_name: 'Lia', avatar_id: 'a', stars_balance: 10, stars_today: 2, learn_days_week: 3 },
      { id: KID2, child_name: 'Ben', avatar_id: 'b', stars_balance: 4, stars_today: 0, learn_days_week: 1 },
    ],
    subjects: [], units: [], rewards: [], redemptions: [],
    exams: [
      { id: 'e1', title: 'Wasser', exam_date: null, profile_id: KID, subject_id: 's', is_archived: false },
      { id: 'e2', title: 'Alt', exam_date: null, profile_id: KID, subject_id: 's', is_archived: true },
      { id: 'e3', title: 'Ben', exam_date: null, profile_id: KID2, subject_id: 's', is_archived: false },
    ],
    questions: [
      { id: 'q1', exam_id: 'e1', unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: 'x', payload: {} },
      { id: 'q2', exam_id: 'e1', unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: 'x', payload: {} },
      { id: 'q3', exam_id: 'e1', unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: 'x', payload: {} },
      { id: 'q4', exam_id: 'e1', unit_id: null, status: 'entwurf', type: 'multiple_choice', prompt: 'x', payload: {} },
      { id: 'q5', exam_id: 'e2', unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: 'x', payload: {} },
      { id: 'q6', exam_id: 'e3', unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: 'x', payload: {} },
    ],
    progress: [
      { profile_id: KID, question_id: 'q1', leitner_box: 3, next_review_at: '2026-10-30T00:00:00Z', consecutive_correct: 2 },
      { profile_id: KID, question_id: 'q2', leitner_box: 2, next_review_at: '2026-10-30T00:00:00Z', consecutive_correct: 1 },
      { profile_id: KID2, question_id: 'q3', leitner_box: 5, next_review_at: '2026-10-30T00:00:00Z', consecutive_correct: 5 },
    ],
    ...over,
  }
}

// Jede Prüfung bekommt ein frisches store-Modul (eigener Zustand) über einen Query-Parameter.
let n = 0
async function freshStore(storage: Record<string, unknown> = {}) {
  mem.clear()
  for (const [k, v] of Object.entries(storage)) mem.set(k, JSON.stringify(v))
  calls = []
  netDown = false
  for (const k of Object.keys(winListeners)) delete winListeners[k]
  const mod = await import(`../src/lib/store.ts?n=${++n}`)
  return mod as typeof import('../src/lib/store.ts')
}
const defaultHandler: Handler = (fn) => {
  if (fn === 'bc_pull') return json(fakePull())
  if (fn === 'bc_answer') return json({ ok: true })
  if (fn === 'bc_round_finish') return json({ ok: true })
  return json(null)
}
const queueLS = () => JSON.parse(mem.get('braincraft:queue') ?? '[]')
const answers = () => calls.filter((c) => c.fn === 'bc_answer')

// ---------- api.ts ----------
test('api: Fehlercodes werden durchgereicht, sonst server_error/offline', async () => {
  const { rpc, ApiError } = await import('../src/lib/api.ts')
  handler = () => err('not_found')
  await assert.rejects(rpc('bc_pull', {}), (e: any) => e instanceof ApiError && e.code === 'not_found')
  handler = () => err('bad_question 3')
  await assert.rejects(rpc('x', {}), (e: any) => e.code === 'bad_question 3')
  handler = () => json({ message: 'Could not find the function public.bc_x' }, 404)
  await assert.rejects(rpc('x', {}), (e: any) => e.code === 'server_error')
  handler = () => new Response('<html>', { status: 502 })
  await assert.rejects(rpc('x', {}), (e: any) => e.code === 'server_error')
  netDown = true
  await assert.rejects(rpc('x', {}), (e: any) => e.code === 'offline')
  netDown = false
})

// ---------- Warteschlange ----------
test('queueAnswer: richtige Parameter an bc_answer, Eintrag danach aus der Schlange', async () => {
  handler = defaultHandler
  const s = await freshStore({ 'braincraft:code': CODE, 'braincraft:profile': KID, 'braincraft:pull': fakePull() })
  await tick(5) // Start-refresh abwarten
  calls = []
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r1' })
  await tick(5)
  const a = answers()
  assert.equal(a.length, 1, 'genau eine bc_answer-Anfrage nach queueAnswer (tatsächlich ' + a.length + ')')
  const p = a[0].args
  assert.equal(p.p_code, CODE)
  assert.equal(p.p_profile_id, KID)
  assert.equal(p.p_question_id, 'q1')
  assert.equal(p.p_correct, true)
  assert.equal(p.p_first_try, true)
  assert.equal(p.p_mode, 'solo')
  assert.equal(p.p_round_id, 'r1')
  assert.match(p.p_answer_id, /^[0-9a-f-]{36}$/)
  assert.ok(!Number.isNaN(Date.parse(p.p_answered_at)))
  assert.deepEqual(queueLS(), [])
})

test('flush nach leerer Schlange bleibt nicht hängen (zweite Antwort wird auch gesendet)', async () => {
  handler = defaultHandler
  const s = await freshStore({ 'braincraft:code': CODE, 'braincraft:profile': KID, 'braincraft:pull': fakePull() })
  await s.flush() // leere Schlange
  calls = []
  s.queueAnswer({ questionId: 'q2', correct: false, firstTry: false, mode: 'chill', roundId: 'r1' })
  await tick(5)
  assert.equal(answers().length, 1, 'Antwort nach flush() mit leerer Schlange gesendet? tatsächlich ' + answers().length + ', Schlange: ' + queueLS().length)
})

test('Ablauf ohne Start-refresh: Runde mit 5 Antworten, Rundenende, dann nächste Runde', async () => {
  handler = defaultHandler
  // Frisch verbunden (wie nach Setup): kein Code beim Laden, daher kein Start-refresh
  const s = await freshStore()
  await s.connect(CODE)
  calls = []
  for (let i = 0; i < 5; i++) s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r1' })
  await tick(10)
  s.queueRoundFinish('r1')
  await tick(10)
  assert.equal(answers().length, 5)
  assert.equal(calls.filter((c) => c.fn === 'bc_round_finish').length, 1)
  calls = []
  s.queueAnswer({ questionId: 'q2', correct: true, firstTry: true, mode: 'solo', roundId: 'r2' })
  await tick(10)
  assert.equal(answers().length, 1, 'Antwort der 2. Runde gesendet? tatsächlich ' + answers().length + ', Schlange: ' + queueLS().length)
})

test('offline: Antworten bleiben in localStorage und gehen nach online-Ereignis raus, Reihenfolge bleibt', async () => {
  handler = defaultHandler
  const s = await freshStore()
  await s.connect(CODE)
  netDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r1' })
  s.queueAnswer({ questionId: 'q2', correct: false, firstTry: false, mode: 'solo', roundId: 'r1' })
  s.queueAnswer({ questionId: 'q3', correct: true, firstTry: false, mode: 'solo', roundId: 'r1' })
  await tick(10)
  assert.equal(queueLS().length, 3, 'drei Einträge in localStorage')
  assert.deepEqual(queueLS().map((q: any) => q.questionId), ['q1', 'q2', 'q3'])
  netDown = false
  calls = []
  for (const f of winListeners.online ?? []) f()
  await tick(20)
  assert.deepEqual(answers().map((c) => c.args.p_question_id), ['q1', 'q2', 'q3'], 'Reihenfolge nach online')
  assert.equal(queueLS().length, 0)
})

test('offline beim Laden: Schlange aus localStorage wird beim Start-refresh gesendet', async () => {
  handler = defaultHandler
  const q = [
    { kind: 'answer', id: 'a1', profileId: KID, questionId: 'q1', correct: true, firstTry: true, mode: 'solo', at: '2026-10-24T07:00:00Z', roundId: 'r' },
    { kind: 'answer', id: 'a2', profileId: KID, questionId: 'q2', correct: false, firstTry: false, mode: 'solo', at: '2026-10-24T07:00:01Z', roundId: 'r' },
  ]
  await freshStore({ 'braincraft:code': CODE, 'braincraft:profile': KID, 'braincraft:pull': fakePull(), 'braincraft:queue': q })
  await tick(20)
  assert.deepEqual(answers().map((c) => c.args.p_answer_id), ['a1', 'a2'])
  assert.equal(calls.at(-1)!.fn, 'bc_pull', 'erst senden, dann bc_pull')
})

test('inhaltlicher Fehler verwirft genau einen Eintrag', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  let first = true
  handler = (fn, args) => {
    if (fn === 'bc_answer' && args.p_question_id === 'q1' && first) { first = false; return err('question_not_found') }
    return defaultHandler(fn, args)
  }
  netDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
  s.queueAnswer({ questionId: 'q2', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
  await tick(5)
  netDown = false
  calls = []
  await s.flush()
  assert.deepEqual(answers().map((c) => c.args.p_question_id), ['q1', 'q2'])
  assert.equal(queueLS().length, 0)
})

test('server_error und retry halten die Schlange an (nichts verworfen, nichts übersprungen)', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  for (const code of ['server_error', 'retry']) {
    handler = (fn, args) => (fn === 'bc_answer' ? (code === 'server_error' ? json({ message: 'Internal Server Error' }, 500) : err('retry')) : defaultHandler(fn, args))
    netDown = true
    s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
    s.queueAnswer({ questionId: 'q2', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
    await tick(5)
    netDown = false
    calls = []
    await s.flush()
    assert.equal(answers().length, 1, code + ': nach dem Fehler nicht weitersenden')
    assert.equal(queueLS().length, 2, code + ': beide bleiben')
    handler = defaultHandler
    await s.flush()
    assert.equal(queueLS().length, 0)
  }
})

test('HTTP 5xx mit einwortiger Meldung wird nicht als inhaltlicher Fehler verworfen', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  netDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
  await tick(5)
  netDown = false
  handler = (fn, args) => (fn === 'bc_answer' ? json({ message: 'unavailable' }, 503) : defaultHandler(fn, args))
  await s.flush()
  assert.equal(queueLS().length, 1, 'Eintrag nach 503 noch in der Schlange')
  handler = defaultHandler
})

test('paralleles flush: kein Doppelsenden', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  netDown = true
  for (let i = 0; i < 4; i++) s.queueAnswer({ questionId: 'q' + i, correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
  await tick(5)
  netDown = false
  calls = []
  handler = async (fn, args) => { await tick(3); return defaultHandler(fn, args) }
  await Promise.all([s.flush(), s.flush(), s.flush(), s.refresh()])
  const ids = answers().map((c) => c.args.p_answer_id)
  assert.equal(ids.length, 4)
  assert.equal(new Set(ids).size, 4)
  handler = defaultHandler
})

test('queueRoundFinish sendet bc_round_finish mit Runde und Kind, danach bc_pull', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  calls = []
  netDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r9' })
  await tick(5)
  netDown = false
  s.queueRoundFinish('r9')
  await tick(20)
  const fns = calls.map((c) => c.fn)
  assert.deepEqual(fns.slice(0, 2), ['bc_answer', 'bc_round_finish'])
  const rf = calls.find((c) => c.fn === 'bc_round_finish')!.args
  assert.deepEqual(rf, { p_code: CODE, p_round_id: 'r9', p_profile_id: KID })
  assert.ok(fns.includes('bc_pull'))
})

// Regel (24.10.): Vorab-Stern auch in der Chill-Runde, wie der Server bucht
test('Sofort-Stern für solo und chill bei richtig + 1. Versuch', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  netDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: false, mode: 'solo', roundId: 'r' })
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'chill', roundId: 'r' })
  s.queueAnswer({ questionId: 'q1', correct: false, firstTry: false, mode: 'solo', roundId: 'r' })
  await tick(5)
  const pull = JSON.parse(mem.get('braincraft:pull')!)
  assert.equal(pull.profiles[0].stars_balance, 12)
  assert.equal(pull.profiles[0].stars_today, 4)
  netDown = false
})

// ---------- Verbinden, Trennen ----------
test('connect: falscher Code -> ApiError not_found, nichts gespeichert', async () => {
  const s = await freshStore()
  handler = () => err('not_found')
  await assert.rejects(s.connect('XXXX-XXXX-XXXX-XXXX-XXXX'), (e: any) => e.code === 'not_found')
  assert.equal(mem.get('braincraft:code'), undefined)
})

test('createFamily: sendet Einladung, Code-Format, verbindet noch nicht', async () => {
  const s = await freshStore()
  handler = (fn) => (fn === 'bc_create' ? json({ family_id: 'f', profile_id: KID }) : defaultHandler(fn, {}))
  const code = await s.createFamily('INV1-INV2-INV3-INV4', 'Lia', '1234')
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){4}$/)
  const c = calls.find((x) => x.fn === 'bc_create')!.args
  assert.deepEqual(c, { p_invite: 'INV1-INV2-INV3-INV4', p_code: code, p_child_name: 'Lia', p_pin: '1234' })
  assert.equal(mem.get('braincraft:code'), undefined, 'noch nicht verbunden')
  assert.equal(calls.filter((x) => x.fn === 'bc_pull').length, 0)
})

test('disconnect löscht code, profil, pull, queue und Namen', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  netDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: 'r' })
  await tick(5)
  netDown = false
  assert.equal(mem.get('braincraft:name'), 'Lia')
  s.disconnect()
  for (const k of ['braincraft:code', 'braincraft:profile', 'braincraft:pull']) assert.equal(mem.get(k), undefined, k)
  assert.ok(!mem.get('braincraft:queue') || mem.get('braincraft:queue') === '[]', 'Schlange leer')
  assert.ok(!mem.get('braincraft:name'), 'Name leer')
})

test('disconnect während laufendem bc_pull: alte Daten kommen nicht zurück', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  let release!: () => void
  handler = async (fn, args) => {
    if (fn === 'bc_pull') await new Promise<void>((r) => (release = r))
    return defaultHandler(fn, args)
  }
  const p = s.refresh().catch(() => undefined)
  await tick(5)
  s.disconnect()
  release()
  await p
  await tick(5)
  assert.equal(mem.get('braincraft:pull'), undefined, 'pull nach Trennen wieder in localStorage: ' + (mem.get('braincraft:pull') ?? '').slice(0, 40))
  assert.ok(!mem.get('braincraft:name'), 'Name nach Trennen wieder gesetzt: ' + mem.get('braincraft:name'))
  handler = defaultHandler
})

// ---------- Eltern ----------
test('parentUnlock: Token nur im Speicher, bc_pull mit Token, Sperre, parentLock', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  const TOK = 'a'.repeat(64)
  handler = (fn, args) => {
    if (fn === 'bc_parent_unlock') return json(args.p_pin === '4711' ? { ok: true, token: TOK, expires_at: 'x' } : { ok: false, error: 'pin_locked', locked_until: '2026-10-24T08:15:00Z' })
    if (fn === 'bc_pull') return json(fakePull({ parent: args.p_token === TOK }))
    return defaultHandler(fn, args)
  }
  const bad = await s.parentUnlock('0000')
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'pin_locked')
  assert.equal(s.parentActive(), false)
  calls = []
  const good = await s.parentUnlock('4711')
  assert.equal(good.ok, true)
  assert.equal(s.parentActive(), true)
  assert.equal(calls.find((c) => c.fn === 'bc_pull')!.args.p_token, TOK)
  assert.ok(![...mem.values()].some((v) => v.includes(TOK)), 'Token nicht in localStorage')
  calls = []
  await s.setQuestionStatus(['q4'], 'freigegeben')
  assert.deepEqual(calls[0], { fn: 'bc_question_set_status', args: { p_code: CODE, p_token: TOK, p_ids: ['q4'], p_status: 'freigegeben' } })
  calls = []
  await s.setQuestionActive('q4', false)
  assert.deepEqual(calls[0], { fn: 'bc_question_set_active', args: { p_code: CODE, p_token: TOK, p_id: 'q4', p_active: false } })
  calls = []
  s.parentLock()
  await tick(10)
  assert.equal(s.parentActive(), false)
  assert.deepEqual(calls.find((c) => c.fn === 'bc_parent_lock')!.args, { p_code: CODE, p_token: TOK })
  assert.equal(calls.find((c) => c.fn === 'bc_pull')!.args.p_token, null)
  await assert.rejects(s.setQuestionStatus(['q4'], 'freigegeben'), (e: any) => e.code === 'pin_required')
})

// ---------- Abgeleitete Werte ----------
test('playableQuestions / mastery / profileProgress', async () => {
  const s = await freshStore()
  handler = defaultHandler
  await s.connect(CODE)
  const st = { code: CODE, profileId: KID, pull: fakePull(), queue: [], syncing: false, offline: false, parent: null } as any
  assert.deepEqual(s.playableQuestions(st).map((q) => q.id), ['q1', 'q2', 'q3'], 'ohne Entwurf, archiviert, anderes Kind')
  assert.deepEqual(s.playableQuestions(st, 'e2').map((q) => q.id), [])
  assert.equal(s.mastery(st, 'e1'), 1 / 3)
  assert.equal(s.mastery(st, 'e3'), 0, 'anderes Kind')
  assert.deepEqual(s.profileProgress(st).map((p) => p.question_id), ['q1', 'q2'])
  assert.equal(s.mastery({ ...st, profileId: KID2 }, 'e3'), 0, 'q6 ohne Lernstand')
})

test('applyPull: gewähltes Kind bleibt, unbekanntes -> erstes Kind', async () => {
  const s = await freshStore({ 'braincraft:profile': KID2 })
  handler = defaultHandler
  await s.connect(CODE)
  assert.equal(JSON.parse(mem.get('braincraft:profile')!), KID2)
  assert.equal(mem.get('braincraft:name'), 'Ben')
  const s2 = await freshStore({ 'braincraft:profile': 'weg' })
  await s2.connect(CODE)
  assert.equal(JSON.parse(mem.get('braincraft:profile')!), KID)
})

// ---------- Zurücksetzen (Migration 006, Siggi N2) ----------
async function parentStore(storage: Record<string, unknown> = {}) {
  const s = await freshStore(storage)
  const TOK = 'b'.repeat(64)
  handler = (fn, args) => (fn === 'bc_parent_unlock' ? json({ ok: true, token: TOK, expires_at: 'x' }) : defaultHandler(fn, args))
  await s.connect(CODE)
  await s.parentUnlock('4711')
  calls = []
  return { s, TOK }
}
const qa = (id: string, profileId: string) => ({ kind: 'answer', id, profileId, questionId: 'q1', correct: true, firstTry: true, mode: 'solo', at: '2026-10-24T08:00:00Z', roundId: null })

test('resetProgress: wartende Antworten gehen VOR dem Zurücksetzen raus, Antwort in der Leitung überholt es nicht', async () => {
  const { s } = await parentStore()
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let gated = false
  handler = async (fn, args) => {
    order.push(fn + (fn === 'bc_answer' ? ':' + args.p_answer_id : ''))
    if (fn === 'bc_answer' && !gated) { gated = true; await gate }
    if (fn === 'bc_progress_reset') return json({ ok: true, profiles: 1, reset_at: 'x' })
    if (fn === 'bc_pull') return json(fakePull({ profiles: fakePull().profiles.map((p: any) => (p.id === KID ? { ...p, stars_balance: 0, stars_today: 0 } : p)) }))
    return json({ ok: true })
  }
  // A (Lia) ist gerade unterwegs, B (Ben) wartet
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: null })
  await tick(5)
  assert.equal(order.length, 1, 'A ist unterwegs')
  const p = s.resetProgress('1234', KID)
  await tick(20)
  assert.ok(!order.includes('bc_progress_reset'), 'Zurücksetzen wartet, bis A beantwortet ist: ' + order.join(','))
  release()
  const r = await p
  assert.equal(r.ok, true)
  const iReset = order.indexOf('bc_progress_reset')
  assert.ok(iReset > 0, 'bc_progress_reset gesendet')
  assert.ok(!order.slice(iReset).some((x) => x.startsWith('bc_answer')), 'keine Antwort nach dem Zurücksetzen: ' + order.join(','))
  assert.equal(order[order.length - 1], 'bc_pull', 'danach frischer Stand')
  assert.deepEqual(queueLS(), [])
  const saved = JSON.parse(mem.get('braincraft:pull')!)
  assert.equal(saved.profiles.find((p: any) => p.id === KID).stars_balance, 0, 'Stand aus bc_pull übernommen (0), kein Zusammenführen mit lokal +1')
})

test('resetProgress: Schlange hängt (server_error) -> nur Einträge der betroffenen Kinder fallen weg', async () => {
  const { s } = await parentStore({ 'braincraft:queue': [] })
  let answerDown = true
  handler = (fn, args) => {
    if (fn === 'bc_answer') return answerDown ? json({ message: 'boom' }, 500) : json({ ok: true })
    if (fn === 'bc_progress_reset') return json({ ok: true, profiles: args.p_profile_id ? 1 : 2, reset_at: 'x' })
    return defaultHandler(fn, args)
  }
  // drei hängende Einträge über die öffentliche API: Lia, Ben, Lia
  s.selectProfile(KID); s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: null })
  s.selectProfile(KID2); s.queueAnswer({ questionId: 'q6', correct: true, firstTry: true, mode: 'solo', roundId: null })
  s.selectProfile(KID); s.markUnitSeen('u1')
  await tick(10)
  assert.equal(queueLS().length, 3)
  const r = await s.resetProgress('1234', KID)
  assert.equal(r.ok, true)
  assert.deepEqual(queueLS().map((q: any) => q.profileId), [KID2], 'nur Bens Eintrag bleibt')
  answerDown = false
  calls = []
  await s.flush()
  assert.deepEqual(answers().map((c) => c.args.p_profile_id), [KID2], 'Ben wird genau einmal nachgesendet')
  // alle Kinder: Schlange ganz leer
  answerDown = true
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: null })
  await tick(5)
  await s.resetProgress('1234', null)
  assert.deepEqual(queueLS(), [])
})

test('resetProgress: falsche PIN / Sperre / Bremse / fehlende Funktion lassen die Schlange stehen', async () => {
  const { s } = await parentStore()
  handler = (fn, args) => {
    if (fn === 'bc_answer') return json({ message: 'boom' }, 500)
    if (fn === 'bc_progress_reset') {
      if (args.p_pin === '0000') return json({ ok: false, error: 'pin_wrong', locked_until: null })
      if (args.p_pin === '1111') return json({ ok: false, error: 'pin_locked', locked_until: '2026-10-24T08:15:00Z' })
      if (args.p_pin === '5555') return err('limit_reached')
      if (args.p_pin === '6666') return err('profile_not_found')
      return json({ code: 'PGRST202', message: 'Could not find the function' }, 404)
    }
    return defaultHandler(fn, args)
  }
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: null })
  await tick(5)
  assert.equal((await s.resetProgress('0000', KID)).error, 'pin_wrong')
  assert.equal((await s.resetProgress('1111', KID)).error, 'pin_locked')
  await assert.rejects(s.resetProgress('5555', KID), (e: any) => e.code === 'limit_reached')
  await assert.rejects(s.resetProgress('6666', KID), (e: any) => e.code === 'profile_not_found')
  await assert.rejects(s.resetProgress('9999', KID), (e: any) => e.code === 'missing_function')
  assert.equal(queueLS().length, 1, 'Antwort bleibt in der Schlange')
})

test('resetProgress: Erfolg, aber Nachladen scheitert -> trotzdem ok (keine falsche Fehlermeldung)', async () => {
  const { s } = await parentStore()
  handler = (fn) => {
    if (fn === 'bc_progress_reset') return json({ ok: true, profiles: 1, reset_at: 'x' })
    if (fn === 'bc_pull') return err('not_found')
    return json({ ok: true })
  }
  const r = await s.resetProgress('1234', KID)
  assert.equal(r.ok, true)
})

test('flush: Schlange wird während einer Sendung ersetzt -> der neue Eintrag geht nicht verloren (slice(1)-Falle)', async () => {
  handler = defaultHandler
  const s = await freshStore({ 'braincraft:code': CODE, 'braincraft:profile': KID, 'braincraft:pull': fakePull() })
  await tick(5)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let first = true
  handler = async (fn, args) => {
    if (fn === 'bc_answer' && first) { first = false; await gate }
    return defaultHandler(fn, args)
  }
  calls = []
  s.queueAnswer({ questionId: 'q1', correct: true, firstTry: true, mode: 'solo', roundId: null }) // A, hängt
  await tick(5)
  // Während A unterwegs ist: abmelden, neu verbinden, neue Antwort C
  s.disconnect()
  await s.connect(CODE)
  s.selectProfile(KID)
  s.queueAnswer({ questionId: 'q2', correct: true, firstTry: true, mode: 'solo', roundId: null }) // C
  await tick(5)
  release()
  await tick(20)
  await s.flush()
  assert.ok(answers().some((c) => c.args.p_question_id === 'q2'), 'C wurde gesendet')
  assert.deepEqual(queueLS(), [])
})
