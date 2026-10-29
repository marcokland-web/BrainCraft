// Bug-Bodo: Boss-Kampf (Blockwächter) und Ausrüstung mit FAKE-Server (Plan A1–A4, docs/plan-boss-gemeinsam.md).
// Der Fake-Server bildet supabase/001 + 005 nach: Tagesgrenze 40 (answer/round/parent_quiz, Boss-Bonus ausgenommen),
// bc_answer im Modus 'boss' ohne Stern nach dem Sieg, bc_boss_win (Schwelle 70 %, duplicate, nächstes Teil nach sort),
// bc_round_finish nur mit 5 Antworten solo/chill. Die echte Datenbank wird NIE erreicht (alles per context.route,
// Service Worker blockiert, fremde Anfragen werden abgebrochen und gezählt).
// Vorher: npm run build && npx vite preview --port 8797 --strictPort   (oder eigener Ordner/Port, dann BASE=…)
// Aufruf:  node tests/boss.spec.mjs        (BROWSER=webkit für Safari)
// Ergebnis: Exit-Code 0 = alles bestanden, 1 = mindestens ein Fehler.

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PW = process.env.PLAYWRIGHT_DIR ?? join(homedir(), 'Apps/DasTeam/tools/node_modules/playwright')
const pw = createRequire(import.meta.url)(PW)
const BASE = process.env.BASE ?? 'http://localhost:8797/BrainCraft/'
const ORIGIN = new URL(BASE).origin + '/'
const SHOTS = process.env.SHOTS ?? join(ROOT, 'tests/.shots/boss')
mkdirSync(SHOTS, { recursive: true })
const SIZES = { iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }
const BROWSER = process.env.BROWSER ?? 'chromium'

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(cond ? '  ok   ' : '  FEHLER', name, cond ? '' : detail) }
const consoleErrors = []
const foreign = []

// Texte aus src/lib/i18n.ts (einfache Schlüssel: 1. Treffer Deutsch, 2. Englisch)
const I18N = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')
const T = (key, lang = 'de') => {
  const m = [...I18N.matchAll(new RegExp(`^\\s+${key}: (['"])(.*)\\1,?$`, 'gm'))][lang === 'de' ? 0 : 1]
  if (!m) throw new Error(`Text ${key}/${lang} nicht gefunden`)
  return m[2].replace(/\\(.)/g, '$1')
}

// ---------- Fake-Daten ----------
const KID = '11111111-1111-4111-8111-111111111111'
const KID2 = '22222222-2222-4222-8222-222222222222'
const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW'
const later = new Date(Date.now() + 30 * 86400000).toISOString()
// Reihenfolge nach 005 (Greta); absichtlich gemischt geliefert, die App muss nach sort ordnen
const ITEMS = [
  ['krone', 12], ['helm', 1], ['schild', 5], ['handschuhe', 2], ['stiefel', 3], ['guertel', 4],
  ['umhang', 6], ['fernglas', 7], ['kompass', 8], ['abzeichen', 9], ['fluegel', 10], ['pokal', 11],
].map(([item_key, sort]) => ({ item_key, title_de: `Server-${item_key}`, title_en: `server-${item_key}`, sort }))
const ORDER = [...ITEMS].sort((a, b) => a.sort - b.sort).map((i) => i.item_key)

const mc = (id, exam) => ({
  id, exam_id: exam, unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: `Frage ${id}?`,
  payload: { options: [`R-${id}`, `F1-${id}`, `F2-${id}`], correct_index: 0, explanation: 'weil' },
})
const prog = (profile_id, question_id, leitner_box) => ({ profile_id, question_id, leitner_box, next_review_at: later, consecutive_correct: 2 })
const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`)

function baseData({ starsToday = 3, balance = 42, inventory = [] } = {}) {
  const exam = (id, title, profile_id = KID) => ({ id, title, exam_date: null, profile_id, subject_id: 's', is_archived: false })
  const q7 = ids('s', 10), q6 = ids('x', 10)
  return {
    profiles: [
      { id: KID, child_name: 'Lia', avatar_id: 'a', stars_balance: balance, learn_days_week: 4 },
      { id: KID2, child_name: 'Ben', avatar_id: 'b', stars_balance: 7, learn_days_week: 1 },
    ],
    earnedToday: { [KID]: starsToday, [KID2]: 0 },
    subjects: [{ id: 's', name: 'Sachkunde', icon: 'x' }], units: [], rewards: [], redemptions: [],
    exams: [
      exam('e7', 'Sieben-Arbeit'), exam('e6', 'Sechs-Arbeit'), exam('e1', 'Eins-Arbeit'),
      exam('e3', 'Drei-Arbeit'), exam('e2', 'Zwei-Arbeit'), exam('eB', 'Ben-Arbeit', KID2),
    ],
    questions: [
      ...q7.map((id) => mc(id, 'e7')), ...q6.map((id) => mc(id, 'e6')), mc('one', 'e1'),
      ...ids('d', 3).map((id) => mc(id, 'e3')), ...ids('z', 2).map((id) => mc(id, 'e2')), mc('ben', 'eB'),
    ],
    progress: [
      ...q7.slice(0, 7).map((q) => prog(KID, q, 3)), ...q7.slice(7).map((q) => prog(KID, q, 2)),
      ...q6.slice(0, 6).map((q) => prog(KID, q, 4)), ...q6.slice(6).map((q) => prog(KID, q, 2)),
      prog(KID, 'one', 3), ...ids('d', 3).map((q) => prog(KID, q, 3)), ...ids('z', 2).map((q) => prog(KID, q, 5)),
      prog(KID2, 'ben', 4),
    ],
    items: ITEMS,
    inventory: [
      ...inventory.map((k, i) => ({ profile_id: KID, item_key: k, exam_id: null, unlocked_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() })),
      ...['helm', 'handschuhe', 'stiefel'].map((k) => ({ profile_id: KID2, item_key: k, exam_id: 'eB', unlocked_at: '2026-10-20T10:00:00Z' })),
    ],
    boss_wins: [],
    answers: [],
    ledger: [],
  }
}

function makeServer(opts) {
  const srv = { calls: [], down: false, data: baseData(opts), lockBoss: false }
  const d = () => srv.data
  // braincraft.book() nach 005
  srv.book = (profile, delta, reason, ref) => {
    if (ref && d().ledger.some((l) => l.profile === profile && l.reason === reason && l.ref === ref)) return 0
    if (delta > 0 && ['answer', 'round', 'parent_quiz'].includes(reason)) delta = Math.min(delta, 40 - d().earnedToday[profile])
    if (delta <= 0) return 0
    d().ledger.push({ profile, delta, reason, ref })
    if (['answer', 'round', 'parent_quiz'].includes(reason)) d().earnedToday[profile] += delta
    d().profiles.find((p) => p.id === profile).stars_balance += delta
    return delta
  }
  srv.handle = async (route) => {
    const req = route.request()
    const fn = req.url().split('/rpc/')[1]
    let a = {}
    try { a = JSON.parse(req.postData() || '{}') } catch { /* leer */ }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } })
    if (srv.down) return route.abort('internetdisconnected')
    srv.calls.push({ fn, args: a })
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    const fail = (message) => reply({ code: 'P0001', message }, 400)
    if (a.p_code !== CODE) return fail('not_found')
    const D = d()
    const profile = D.profiles.find((p) => p.id === a.p_profile_id)
    switch (fn) {
      case 'bc_pull': {
        const out = structuredClone({ ...D, answers: undefined, ledger: undefined, earnedToday: undefined })
        out.profiles = out.profiles.map((p) => ({ ...p, stars_today: D.earnedToday[p.id] }))
        out.today = new Date().toISOString().slice(0, 10)
        out.parent = false
        return reply(out)
      }
      case 'bc_answer': {
        if (!profile) return fail('profile_not_found')
        if (D.answers.some((x) => x.id === a.p_answer_id)) return reply({ ok: true, duplicate: true })
        const q = D.questions.find((x) => x.id === a.p_question_id && x.status === 'freigegeben')
        const exam = q && D.exams.find((e) => e.id === q.exam_id && e.profile_id === a.p_profile_id)
        if (!exam) return fail('question_not_found')
        D.answers.push({ id: a.p_answer_id, profile: a.p_profile_id, q: q.id, mode: a.p_mode, round: a.p_round_id, correct: a.p_correct, first: a.p_first_try })
        let stars = a.p_correct && (a.p_mode === 'eltern' || a.p_first_try !== false) ? 1 : 0
        if (stars && a.p_mode === 'boss' && D.boss_wins.some((b) => b.profile_id === a.p_profile_id && b.exam_id === exam.id)) stars = 0
        const booked = stars ? srv.book(a.p_profile_id, 1, a.p_mode === 'eltern' ? 'parent_quiz' : 'answer', a.p_answer_id) : 0
        return reply({ ok: true, stars_booked: booked, stars_balance: profile.stars_balance })
      }
      case 'bc_round_finish': {
        if (D.answers.filter((x) => x.round === a.p_round_id && x.profile === a.p_profile_id && ['solo', 'chill'].includes(x.mode)).length < 5) return fail('round_too_short')
        return reply({ ok: true, stars_booked: srv.book(a.p_profile_id, 3, 'round', a.p_round_id) })
      }
      case 'bc_boss_win': {
        if (!profile) return fail('profile_not_found')
        if (!D.exams.some((e) => e.id === a.p_exam_id && e.profile_id === a.p_profile_id)) return fail('exam_not_found')
        if (D.boss_wins.some((b) => b.profile_id === a.p_profile_id && b.exam_id === a.p_exam_id)) return reply({ ok: true, duplicate: true })
        const qs = D.questions.filter((q) => q.exam_id === a.p_exam_id && q.status === 'freigegeben')
        const box = (q) => D.progress.find((g) => g.profile_id === a.p_profile_id && g.question_id === q.id)?.leitner_box ?? 0
        const master = qs.filter((q) => box(q) >= 3).length
        if (srv.lockBoss || !qs.length || master * 10 < qs.length * 7) return fail('boss_locked')
        const have = new Set(D.inventory.filter((i) => i.profile_id === a.p_profile_id).map((i) => i.item_key))
        const item = [...D.items].sort((x, y) => x.sort - y.sort).find((i) => !have.has(i.item_key))?.item_key ?? null
        const now = new Date().toISOString()
        D.boss_wins.push({ profile_id: a.p_profile_id, exam_id: a.p_exam_id, item_key: item, won_at: now })
        if (item) D.inventory.push({ profile_id: a.p_profile_id, item_key: item, exam_id: a.p_exam_id, unlocked_at: now })
        const booked = srv.book(a.p_profile_id, 10, 'boss', a.p_exam_id)
        return reply({ ok: true, item_key: item, stars_booked: booked, stars_balance: profile.stars_balance })
      }
      default: return fail('unknown_fn')
    }
  }
  // Klassenarbeit löschen (cascade wie 001: Fragen, Fortschritt, Boss-Siege; Inventar behält das Teil mit exam_id null)
  srv.deleteExam = (id) => {
    const D = d()
    const qs = new Set(D.questions.filter((q) => q.exam_id === id).map((q) => q.id))
    D.exams = D.exams.filter((e) => e.id !== id)
    D.questions = D.questions.filter((q) => !qs.has(q.id))
    D.progress = D.progress.filter((g) => !qs.has(g.question_id))
    D.boss_wins = D.boss_wins.filter((b) => b.exam_id !== id)
    for (const i of D.inventory) if (i.exam_id === id) i.exam_id = null
  }
  return srv
}

const browser = await pw[BROWSER].launch()
const connected = { 'braincraft:code': CODE, 'braincraft:profile': KID }

async function open({ size = 'iphone', storage = connected, lang = 'de', srv = makeServer(), ctx: given } = {}) {
  const ctx = given ?? await browser.newContext({ viewport: SIZES[size], serviceWorkers: 'block', deviceScaleFactor: 1 })
  if (!given) {
    await ctx.route('**/*', (route) => {
      const u = route.request().url()
      if (u.startsWith(ORIGIN)) return route.continue()
      if (u.includes('.supabase.co/rest/v1/rpc/')) return srv.handle(route)
      foreign.push(u)
      return route.abort()
    })
    const init = { 'studio-lang': lang }
    for (const [k, v] of Object.entries(storage)) init[k] = JSON.stringify(v)
    await ctx.addInitScript((init) => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.clear()
      for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v)
    }, init)
  }
  const page = await ctx.newPage()
  const noise = (t) => (BROWSER === 'webkit' && /^Refused to apply a stylesheet because its hash/.test(t)) ||
    /Failed to load resource: (the server responded with a status of (400|500)|net::ERR_INTERNET_DISCONNECTED)|Load failed|FetchEvent|network connection was lost|Could not connect to the server/.test(t)
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) consoleErrors.push(`${size}/${lang}: ${m.text()}`) })
  page.on('pageerror', (e) => consoleErrors.push(`${size}/${lang} pageerror: ${e.message}`))
  await page.goto(BASE)
  await page.waitForLoadState('load')
  await page.locator('.home').waitFor({ timeout: 8000 })
  await wait(300)
  return { ctx, page, srv }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ls = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), k)
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
// Sternestand der App: im Kampf ist keine Kopfzeile sichtbar, daher aus dem gespeicherten Stand; auf Start zusätzlich die Pille
const pill = async (page) => {
  const local = await page.evaluate(() => {
    const pull = JSON.parse(localStorage.getItem('braincraft:pull') ?? 'null')
    const id = JSON.parse(localStorage.getItem('braincraft:profile') ?? 'null')
    return pull?.profiles.find((p) => p.id === id)?.stars_balance ?? null
  })
  const el = page.locator('.starpill .num')
  if (await el.count()) {
    const shown = Number((await el.innerText()).replace(/\D/g, ''))
    if (shown !== local) return `Pille ${shown} ≠ gespeichert ${local}`
  }
  return local
}
const calls = (srv, fn) => srv.calls.filter((c) => c.fn === fn)
const settle = async (page, srv) => {
  // warten, bis die Schlange leer ist und keine Anfrage mehr läuft
  for (let k = 0; k < 60; k++) {
    const q = await ls(page, 'braincraft:queue')
    if (!q || q.length === 0) break
    await wait(100)
  }
  await wait(400)
  void srv
}
const card = (p) => p.locator('.arena .a-card')
async function unlocked(p) {
  for (let k = 0; k < 100; k++) {
    if (await p.evaluate(() => [...document.querySelectorAll('.arena .a-card .g-btn')].some((b) => !b.disabled))) return
    await wait(50)
  }
}
const hp = async (p) => Number(await p.locator('.boss-hp').getAttribute('aria-valuenow'))
async function qid(p) {
  const texts = (await card(p).locator('.g-btn').allTextContents()).map((s) => s.trim())
  return texts.find((t) => t.startsWith('R-')).slice(2)
}
// Eine Boss-Frage beantworten: right | late (Fehler, dann richtig) | reveal (zweimal falsch). Klickt danach „Weiter“, falls kein Sieg.
async function hit(p, how) {
  const id = await qid(p)
  const before = await hp(p)
  const opts = card(p).locator('.g-btn')
  const tap = (t) => opts.filter({ hasText: new RegExp(`^\\s*${t}-${id}\\s*$`) }).first().click({ force: true })
  let say = ''
  if (how === 'right') await tap('R')
  else {
    await tap('F1')
    await wait(150)
    say = (await p.locator('.boss-say').count()) ? await p.locator('.boss-say').innerText() : ''
    await unlocked(p)
    await tap(how === 'late' ? 'R' : 'F2')
  }
  await p.locator('.a-next, .boss-end').first().waitFor({ timeout: 3000 })
  const won = (await p.locator('.boss-end').count()) > 0
  const after = won ? 0 : await hp(p)
  const msg = won ? '' : ((await p.locator('.boss-say').count()) ? await p.locator('.boss-say').innerText() : '')
  if (!won) { await p.locator('.a-next').click(); await wait(60) }
  return { id, before, after, won, say, msg }
}
async function startBoss(page, title) {
  await page.locator('.boss-btn', { hasText: title }).click()
  await page.locator('.arena.boss .a-card').waitFor()
}
async function winFight(page) {
  const log = []
  for (let i = 0; i < 20; i++) {
    const r = await hit(page, 'right')
    log.push(r)
    if (r.won) break
  }
  return log
}
const endText = (p) => p.locator('.boss-end').innerText()
async function toHome(page) {
  const bar = page.locator('.tabbar button').nth(0)
  await ((await bar.isVisible()) ? bar : page.locator('.toptabs button').nth(0)).click()
  await page.locator('.home').waitFor()
}
async function toGear(page) {
  const bar = page.locator('.tabbar button').nth(2)
  await ((await bar.isVisible()) ? bar : page.locator('.toptabs button').nth(2)).click()
  await page.locator('.gear-grid').waitFor()
}
const gearState = (page) => page.evaluate(() => ({
  count: document.querySelector('.gear-count')?.textContent ?? '',
  won: [...document.querySelectorAll('.gear-slot.won')].map((li) => ({ name: li.querySelector('b')?.textContent, from: li.querySelectorAll('small')[0]?.textContent })),
  next: document.querySelector('.gear-slot.next b')?.textContent ?? null,
  waiting: [...document.querySelectorAll('.gear-boss small')].map((s) => s.textContent),
}))
const DE = Object.fromEntries(ORDER.map((k) => [k, (I18N.match(new RegExp(`${k}: '([^']+)'`)) ?? [])[1]]))

// =========================== 1. Schwelle 70 % ===========================
console.log(`[${BROWSER}] 1. Schwelle 70 % auf Start und in der Ausrüstung`)
{
  const { ctx, page } = await open()
  const rows = await page.locator('.exam-row').evaluateAll((els) => els.map((e) => ({ t: e.querySelector('b').textContent, sm: [...e.querySelectorAll('small')].map((s) => s.textContent) })))
  const r = Object.fromEntries(rows.map((x) => [x.t, x.sm]))
  const bosses = await page.locator('.boss-btn').allInnerTexts()
  ok('7 von 10 auf Stufe ≥ 3: Boss-Knopf da', bosses.some((b) => b.includes('Sieben-Arbeit')), bosses.join(' | '))
  ok('6 von 10: kein Boss-Knopf', !bosses.some((b) => b.includes('Sechs-Arbeit')))
  ok('6 von 10: „Kannst du noch 1 Frage sicher …“', r['Sechs-Arbeit']?.includes('Kannst du noch 1 Frage sicher, wartet der Blockwächter.'), JSON.stringify(r['Sechs-Arbeit']))
  ok('7 von 10: kein „Kannst du noch …“-Text', !r['Sieben-Arbeit']?.some((s) => s.startsWith('Kannst du noch')), JSON.stringify(r['Sieben-Arbeit']))
  ok('Fremde Arbeit (Ben) erscheint nicht als Boss', !bosses.some((b) => b.includes('Ben-Arbeit')))
  ok('Boss-Knopf beschriftet „Gegen den Blockwächter“', bosses.every((b) => b.includes(T('bossButton'))))
  await toGear(page)
  const g = await gearState(page)
  ok('Ausrüstung: 0 von 12, leerer Text', g.count === '0 von 12 Teilen' && (await page.locator('.gear-head').innerText()).includes(T('gearEmpty')), g.count)
  ok('Ausrüstung: nächstes Teil = Pilotenhelm (sort, nicht Lieferreihenfolge)', g.next === DE.helm, g.next)
  // Nur ein Hinweis (erste wartende Arbeit), weitere als „und N weitere Arbeiten“
  ok('Ausrüstung: genau ein Hinweis „Blockwächter wartet“, nicht für 6/10', g.waiting.length === 1 && !g.waiting[0].includes('Sechs-Arbeit') && /weitere Arbeit/.test(g.waiting[0]), g.waiting.join(','))
  await ctx.close()
}

// =========================== 2. Kampf-Regeln ===========================
console.log(`[${BROWSER}] 2. Schaden 2/1/0, Fehlerregeln, Reihenfolge`)
{
  const { ctx, page, srv } = await open()
  await startBoss(page, 'Sieben-Arbeit')
  ok('Start: 10 Blöcke', (await hp(page)) === 10 && (await page.locator('.boss-hp i.on').count()) === 10)
  ok('Screenreader-Text „10 von 10“', (await page.locator('.boss-hp').getAttribute('aria-label')) === 'Blockwächter: 10 von 10 Blöcken')
  const seen = []
  const a = await hit(page, 'right'); seen.push(a.id)
  ok('Richtig im 1. Versuch: −2', a.before - a.after === 2, `${a.before}->${a.after}`)
  ok('Text nach −2: bossHit', a.msg === T('bossHit'), a.msg)
  const b = await hit(page, 'late'); seen.push(b.id)
  ok('Richtig nach Hinweis: −1', b.before - b.after === 1, `${b.before}->${b.after}`)
  ok('Text nach −1: bossHitSmall', b.msg === T('bossHitSmall'), b.msg)
  ok('Nach Fehler: Denkanstoß im Blockwächter-Text', b.say.startsWith(T('bossMiss')), b.say)
  const c = await hit(page, 'reveal'); seen.push(c.id)
  ok('Aufgedeckt: −0', c.before === c.after, `${c.before}->${c.after}`)
  ok('Aufgedeckt: Text mit Namen „kommt gleich noch einmal“', c.msg.startsWith('Gut, dass du es probiert hast, Lia.'), c.msg)
  const n1 = await hit(page, 'right'); const n2 = await hit(page, 'right'); const n3 = await hit(page, 'right')
  seen.push(n1.id, n2.id, n3.id)
  ok('Aufgedeckte Frage kommt nach genau zwei anderen wieder', n1.id !== c.id && n2.id !== c.id && n3.id === c.id, seen.join(','))
  ok('Wiedergekommene aufgedeckte Frage: nur −1 (Lotte)', n3.before - n3.after === 1, `${n3.before}->${n3.after}`)
  ok('Reihenfolge: zuerst Fragen auf Stufe ≥ 3', seen.slice(0, 5).every((id) => Number(id.slice(1)) < 7), seen.join(','))
  await settle(page, srv)
  const ans = calls(srv, 'bc_answer')
  ok('Alle Antworten mode boss mit gleicher round_id (Kampf-ID)', ans.length === 6 && ans.every((x) => x.args.p_mode === 'boss') && new Set(ans.map((x) => x.args.p_round_id)).size === 1 && ans[0].args.p_round_id, JSON.stringify(ans.map((x) => [x.args.p_mode, x.args.p_round_id])))
  ok('Aufgedeckt = correct false; Hinweis = first_try false', ans[1].args.p_correct === true && ans[1].args.p_first_try === false && ans[2].args.p_correct === false)
  // Schließen mitten im Kampf
  await page.locator('.a-top .x').click()
  await page.locator('.home').waitFor()
  await settle(page, srv)
  ok('Schließen: zurück auf Start, kein Fehler- oder Verlusttext', (await page.locator('[role=alert]').count()) === 0)
  ok('Schließen: Antworten bleiben gesendet, kein bc_boss_win, kein bc_round_finish', calls(srv, 'bc_answer').length === 6 && calls(srv, 'bc_boss_win').length === 0 && calls(srv, 'bc_round_finish').length === 0)
  await startBoss(page, 'Sieben-Arbeit')
  ok('Neuer Kampf beginnt mit 10 Blöcken', (await hp(page)) === 10)
  await ctx.close()
}
{
  // Nie dieselbe Frage zweimal hintereinander: Arbeit mit 2 Fragen, erste lösen, zweite aufdecken
  let dupSeen = false, rounds = 0
  const { ctx, page } = await open()
  await startBoss(page, 'Zwei-Arbeit')
  for (let i = 0; i < 4; i++) {
    const a = await hit(page, 'right')
    if (a.won) break
    const b = await hit(page, 'reveal')
    const c = await qid(page)
    rounds++
    if (c === b.id) dupSeen = true
  }
  ok('2 Fragen: aufgedeckte letzte Frage kommt nicht sofort wieder', !dupSeen, `in ${rounds} Durchgängen`)
  await ctx.close()
}
{
  // Arbeit mit nur 1 Frage: dieselbe Frage darf wiederkommen; 5 × richtig = Sieg; Aufdecken hängt nicht
  const { ctx, page, srv } = await open()
  const p0 = await pill(page)
  await startBoss(page, 'Eins-Arbeit')
  const log = await winFight(page)
  ok('1 Frage: Sieg nach 5 richtigen Antworten', log.length === 5 && log.at(-1).won, `${log.length}`)
  const txt = await endText(page)
  ok('Sieg-Ansicht: Lob für Mühe mit Namen', txt.includes('Geschafft, Lia!'), txt)
  ok('Sieg-Ansicht: Pilotenhelm und 10 Sterne', txt.includes(DE.helm) && txt.includes('10 Sterne'), txt)
  ok('Sterne sofort: 1 Stern je Frage und Kampf (+1) +10 Boss', (await pill(page)) === p0 + 11, `${p0} -> ${await pill(page)}`)
  await settle(page, srv)
  const order = srv.calls.map((c) => c.fn).filter((f) => f !== 'bc_pull')
  ok('bc_boss_win nach allen Boss-Antworten, genau einmal', order.at(-1) === 'bc_boss_win' && calls(srv, 'bc_boss_win').length === 1 && calls(srv, 'bc_boss_win')[0].args.p_exam_id === 'e1', order.join(','))
  ok('Server: Pilotenhelm, Sieg e1, Stand = Anzeige', srv.data.inventory.some((i) => i.profile_id === KID && i.item_key === 'helm' && i.exam_id === 'e1') && srv.data.profiles[0].stars_balance === p0 + 11)
  ok('Server: nur die 1. Antwort mit first_try (Stern)', calls(srv, 'bc_answer').map((c) => c.args.p_first_try).join() === 'true,false,false,false,false', calls(srv, 'bc_answer').map((c) => c.args.p_first_try).join())
  ok('Kein Rundenbonus nach dem Boss', calls(srv, 'bc_round_finish').length === 0)
  await page.locator('.boss-end .btn.primary').click()
  await page.locator('.gear-grid').waitFor()
  const g = await gearState(page)
  ok('„Zur Ausrüstung“: 1 von 12, Helm „aus: Eins-Arbeit“, nächstes Rennhandschuhe', g.count === '1 von 12 Teilen' && g.won[0]?.name === DE.helm && g.won[0]?.from === 'aus: Eins-Arbeit' && g.next === DE.handschuhe, JSON.stringify(g))
  ok('Ausrüstung: kein Hinweis mehr für die besiegte Arbeit', !g.waiting.some((w) => w.startsWith('Eins-Arbeit')))
  ok('Pille nach Abgleich = Server', (await pill(page)) === srv.data.profiles[0].stars_balance)

  // Wiederholung ohne Belohnung
  await page.locator('.tabbar button').nth(0).click()
  await page.locator('.home').waitFor()
  const again = await page.locator('.boss-btn', { hasText: 'Eins-Arbeit' }).innerText()
  ok('Start: „Nochmal gegen den Blockwächter“ mit „geschafft“', again.includes(T('bossAgain')) && again.includes(T('bossAgainSub')), again)
  const p1 = await pill(page)
  const bal1 = srv.data.profiles[0].stars_balance
  await startBoss(page, 'Eins-Arbeit')
  await hit(page, 'right')
  ok('Wiederholung: kein Sofort-Stern', (await pill(page)) === p1)
  await winFight(page)
  const t2 = await endText(page)
  ok('Wiederholung: Text „zum Spaß“, kein Teil, keine Sterne', t2.includes(T('bossReplayWin')) && !t2.includes('10 Sterne') && (await page.locator('.boss-prize').count()) === 0, t2)
  await settle(page, srv)
  ok('Wiederholung: kein zweites bc_boss_win, Server bucht 0 Sterne', calls(srv, 'bc_boss_win').length === 1 && srv.data.profiles[0].stars_balance === bal1)
  ok('Wiederholung: Pille = Server', (await pill(page)) === bal1)
  ok('Wiederholung: Inventar unverändert (1 Teil)', srv.data.inventory.filter((i) => i.profile_id === KID).length === 1)

  // Arbeit nach dem Sieg gelöscht
  srv.deleteExam('e1')
  await page.reload()
  await page.locator('.home').waitFor()
  await settle(page, srv)
  ok('Gelöschte Arbeit: kein Boss-Knopf mehr', (await page.locator('.boss-btn', { hasText: 'Eins-Arbeit' }).count()) === 0)
  await toGear(page)
  const g2 = await gearState(page)
  ok('Gelöschte Arbeit: Helm bleibt, „aus einer früheren Klassenarbeit“', g2.count === '1 von 12 Teilen' && g2.won[0]?.from === T('gearFromOld'), JSON.stringify(g2))
  // Nächster Sieg bekommt das nächste Teil, nicht wieder den Helm
  await toHome(page)
  await page.locator('.boss-btn', { hasText: 'Drei-Arbeit' }).click()
  await page.locator('.arena.boss .a-card').waitFor()
  await winFight(page)
  ok('Danach: nächster Sieg = Rennhandschuhe', (await endText(page)).includes(DE.handschuhe))
  await settle(page, srv)
  ok('Server stimmt zu (handschuhe aus e3)', srv.data.inventory.some((i) => i.item_key === 'handschuhe' && i.exam_id === 'e3'))
  await ctx.close()
}

{
  // 1 Frage, zuerst aufgedeckt: kommt wieder (kein Hänger), danach nur noch −1 je Treffer und kein Stern (Lotte)
  const { ctx, page, srv } = await open()
  const p0 = await pill(page)
  await startBoss(page, 'Eins-Arbeit')
  const r0 = await hit(page, 'reveal')
  ok('1 Frage: nach Aufdecken kommt sie wieder (kein Hänger)', (await qid(page)) === r0.id)
  const log = await winFight(page)
  ok('1 Frage aufgedeckt: danach je Treffer nur −1 (10 Treffer)', log.length === 10 && log.every((x) => x.before - x.after === 1), log.map((x) => x.before - x.after).join(','))
  ok('1 Frage aufgedeckt: kein Sofort-Stern, nur +10', (await pill(page)) === p0 + 10, `${p0} -> ${await pill(page)}`)
  await settle(page, srv)
  ok('1 Frage aufgedeckt: Server = Anzeige', srv.data.profiles[0].stars_balance === p0 + 10 && calls(srv, 'bc_answer').every((c) => c.args.p_first_try === false))
  await ctx.close()
}

// =========================== 3. Alle Teile (13. Sieg) ===========================
console.log(`[${BROWSER}] 3. 13. Sieg`)
{
  const srv = makeServer({ inventory: ORDER })
  const { ctx, page } = await open({ srv })
  const p0 = await pill(page)
  await toGear(page)
  const g = await gearState(page)
  ok('12 von 12, kein „Nächstes Teil“', g.count === '12 von 12 Teilen' && g.next === null, JSON.stringify(g))
  await toHome(page)
  await page.locator('.boss-btn', { hasText: 'Eins-Arbeit' }).click()
  await page.locator('.arena.boss .a-card').waitFor()
  await winFight(page)
  const txt = await endText(page)
  ok('13. Sieg: „alle 12 Teile – 10 Sterne“', txt.includes(T('bossAllItems')), txt)
  ok('13. Sieg: kein Teile-Bild', (await page.locator('.boss-prize').count()) === 0)
  await settle(page, srv)
  ok('13. Sieg: Server item null, +10 +1', srv.data.boss_wins[0]?.item_key === null && srv.data.profiles[0].stars_balance === p0 + 11)
  ok('13. Sieg: Pille = Server', (await pill(page)) === srv.data.profiles[0].stars_balance)
  await ctx.close()
}

// =========================== 4. Offline-Sieg ===========================
console.log(`[${BROWSER}] 4. Sieg offline, später online`)
{
  const { ctx, page, srv } = await open()
  const p0 = await pill(page)
  srv.down = true
  await startBoss(page, 'Eins-Arbeit')
  await winFight(page)
  ok('Offline: Sieg-Ansicht mit Helm', (await endText(page)).includes(DE.helm))
  const q = await ls(page, 'braincraft:queue')
  ok('Offline: Schlange = 5 Antworten + boss (gespeichert)', q?.length === 6 && q.at(-1).kind === 'boss' && q.at(-1).examId === 'e1' && q.slice(0, 5).every((x) => x.kind === 'answer' && x.mode === 'boss'), JSON.stringify(q?.map((x) => x.kind)))
  await page.reload()
  await page.locator('.home').waitFor()
  ok('Offline + Neuladen: Pille behält +11', (await pill(page)) === p0 + 11)
  ok('Offline + Neuladen: Boss gilt als geschafft', (await page.locator('.boss-btn', { hasText: 'Eins-Arbeit' }).innerText()).includes(T('bossAgain')))
  await toGear(page)
  ok('Offline + Neuladen: Helm in der Ausrüstung', (await gearState(page)).won[0]?.name === DE.helm)
  srv.down = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await settle(page, srv)
  await wait(500)
  const fns = srv.calls.map((c) => c.fn).filter((f) => f !== 'bc_pull')
  ok('Online: 5 Antworten, dann bc_boss_win', fns.join(',') === 'bc_answer,bc_answer,bc_answer,bc_answer,bc_answer,bc_boss_win', fns.join(','))
  ok('Online: Server = Helm, Stand = Anzeige', srv.data.inventory.some((i) => i.profile_id === KID && i.item_key === 'helm') && (await pill(page)) === srv.data.profiles[0].stars_balance && srv.data.profiles[0].stars_balance === p0 + 11)
  ok('Online: Schlange leer', ((await ls(page, 'braincraft:queue')) ?? []).length === 0)
  await ctx.close()
}

// =========================== 5. Zwei Geräte ===========================
console.log(`[${BROWSER}] 5. Zwei Geräte`)
{
  const srv = makeServer()
  const A = await open({ srv })
  const B = await open({ srv })
  const p0 = srv.data.profiles[0].stars_balance
  srv.down = true
  await startBoss(A.page, 'Eins-Arbeit'); await winFight(A.page)
  await startBoss(B.page, 'Eins-Arbeit'); await winFight(B.page)
  srv.down = false
  for (const o of [A, B]) await o.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await settle(A.page, srv); await settle(B.page, srv); await wait(500)
  ok('2 Geräte gleiche Arbeit: 1 Sieg, 1 Teil, +10 einmal', srv.data.boss_wins.length === 1 && srv.data.inventory.filter((i) => i.profile_id === KID).length === 1 && srv.data.profiles[0].stars_balance === p0 + 1 + 1 + 10, `${srv.data.profiles[0].stars_balance - p0}`)
  ok('2 Geräte: beide zeigen danach den Server-Stand', (await pill(A.page)) === srv.data.profiles[0].stars_balance && (await pill(B.page)) === srv.data.profiles[0].stars_balance)
  await A.ctx.close(); await B.ctx.close()
}
{
  // Gerät B kämpft, während Gerät A dieselbe Arbeit besiegt; B gleicht mitten im Kampf ab
  const { ctx, page, srv } = await open()
  await startBoss(page, 'Eins-Arbeit')
  await hit(page, 'right'); await hit(page, 'right')
  srv.data.boss_wins.push({ profile_id: KID, exam_id: 'e1', item_key: 'helm', won_at: new Date().toISOString() })
  srv.data.inventory.push({ profile_id: KID, item_key: 'helm', exam_id: 'e1', unlocked_at: new Date().toISOString() })
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(600)
  await winFight(page)
  const txt = await endText(page)
  ok('Sieg auf anderem Gerät während des Kampfs: keine falsche „alle 12 Teile“-Meldung', !txt.includes(T('bossAllItems')), txt)
  ok('… sondern Wiederholungs-Text', txt.includes(T('bossReplayWin')), txt)
  await ctx.close()
}

// =========================== 6. Tagesgrenze ===========================
console.log(`[${BROWSER}] 6. Sofort-Stern bei 39/40`)
{
  const srv = makeServer({ starsToday: 39, balance: 50 })
  const { ctx, page } = await open({ srv })
  await startBoss(page, 'Drei-Arbeit')
  await hit(page, 'right')
  ok('39/40: erster richtiger Treffer +1', (await pill(page)) === 51)
  await hit(page, 'right')
  ok('40/40: kein weiterer Sofort-Stern', (await pill(page)) === 51)
  await winFight(page)
  ok('Sieg bei voller Tagesgrenze: +10 trotzdem (Boss ausgenommen)', (await pill(page)) === 61)
  await settle(page, srv)
  ok('Server bucht dasselbe (51 + 10)', srv.data.profiles[0].stars_balance === 61 && (await pill(page)) === 61, `${srv.data.profiles[0].stars_balance}`)
  await ctx.close()
}

// =========================== 7. Mehrere Kinder ===========================
console.log(`[${BROWSER}] 7. Mehrere Kinder`)
{
  const { ctx, page, srv } = await open({ storage: { 'braincraft:code': CODE, 'braincraft:profile': KID2 } })
  await toGear(page)
  const g = await gearState(page)
  ok('Ben: 3 von 12, eigene Teile', g.count === '3 von 12 Teilen' && g.won.map((w) => w.name).join() === [DE.helm, DE.handschuhe, DE.stiefel].join(), JSON.stringify(g))
  await toHome(page)
  await page.locator('.boss-btn', { hasText: 'Ben-Arbeit' }).click()
  await page.locator('.arena.boss .a-card').waitFor()
  await winFight(page)
  ok('Ben: nächster Sieg = Werkzeuggürtel (sort 4)', (await endText(page)).includes(DE.guertel))
  await settle(page, srv)
  ok('Server: Teil bei Ben, nicht bei Lia', srv.data.inventory.some((i) => i.profile_id === KID2 && i.item_key === 'guertel') && !srv.data.inventory.some((i) => i.profile_id === KID))
  ok('bc_boss_win mit Bens profile_id', calls(srv, 'bc_boss_win')[0]?.args.p_profile_id === KID2)
  await ctx.close()
  const L = await open({ srv })
  await toGear(L.page)
  const gl = await gearState(L.page)
  ok('Lia: 0 von 12 (Bens Teile nicht sichtbar)', gl.count === '0 von 12 Teilen' && gl.won.length === 0, JSON.stringify(gl))
  await L.ctx.close()
}

// =========================== 8. boss_locked ===========================
console.log(`[${BROWSER}] 8. Server sagt boss_locked`)
{
  const { ctx, page, srv } = await open()
  srv.lockBoss = true
  await startBoss(page, 'Eins-Arbeit')
  await winFight(page)
  await settle(page, srv)
  await page.locator('.boss-end .btn.plain').click()
  await page.locator('.home').waitFor()
  await wait(300)
  ok('boss_locked: kein Fehlertext an das Kind', (await page.locator('[role=alert]').count()) === 0)
  await toGear(page)
  ok('boss_locked: vorab gezeigtes Teil verschwindet beim Abgleich', (await gearState(page)).count === '0 von 12 Teilen')
  ok('boss_locked: Pille = Server', (await pill(page)) === srv.data.profiles[0].stars_balance)
  await ctx.close()
}

// =========================== 9. Englisch ===========================
console.log(`[${BROWSER}] 9. Englisch`)
{
  const { ctx, page } = await open({ lang: 'en' })
  ok('EN: Boss-Knopf', (await page.locator('.boss-btn').first().innerText()).includes(T('bossButton', 'en')))
  await startBoss(page, 'Eins-Arbeit')
  ok('EN: Lebensbalken-Text', (await page.locator('.boss-hp').getAttribute('aria-label')) === 'Block Guardian: 10 of 10 blocks')
  await winFight(page)
  const txt = await endText(page)
  ok('EN: Sieg mit „Pilot helmet“ und 10 stars', txt.includes('Pilot helmet') && txt.includes('10 stars') && txt.includes(T('bossToGear', 'en')), txt)
  await ctx.close()
}

// =========================== 10. Drei Größen, hell und dunkel ===========================
console.log(`[${BROWSER}] 10. Ansicht in drei Größen`)
for (const size of Object.keys(SIZES)) {
  const { ctx, page } = await open({ size })
  for (const theme of ['light', 'dark']) {
    await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
    await wait(80)
    ok(`Start ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
    if (theme === 'light') await page.screenshot({ path: join(SHOTS, `start-${size}-${BROWSER}.png`), fullPage: true })
  }
  await toGear(page)
  for (const theme of ['light', 'dark']) {
    await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
    await wait(80)
    ok(`Ausrüstung ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
    await page.screenshot({ path: join(SHOTS, `gear-${size}-${theme}-${BROWSER}.png`), fullPage: true })
  }
  await toHome(page)
  await page.locator('.boss-btn', { hasText: 'Eins-Arbeit' }).click()
  await page.locator('.arena.boss .a-card').waitFor()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
    await wait(80)
    ok(`Kampf ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
    await page.screenshot({ path: join(SHOTS, `fight-${size}-${theme}-${BROWSER}.png`), fullPage: true })
  }
  await winFight(page)
  for (const theme of ['light', 'dark']) {
    await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
    await wait(80)
    ok(`Sieg ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
    await page.screenshot({ path: join(SHOTS, `win-${size}-${theme}-${BROWSER}.png`), fullPage: true })
  }
  await ctx.close()
}

// =========================== Abschluss ===========================
ok('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 8).join(' | '))
ok('Keine Anfrage an fremde Adressen (alles abgefangen)', foreign.length === 0, foreign.slice(0, 5).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n[${BROWSER}] ${results.length - failed.length}/${results.length} bestanden`)
for (const f of failed) console.log('FEHLER:', f.name, '|', f.detail)
process.exit(failed.length ? 1 : 0)
