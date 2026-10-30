// Bug-Bodo: Ablauf-Test der Datenanbindung (Setup, Start, Warteschlange, Eltern-Cockpit) mit FAKE-Server.
// Alle Anfragen an Supabase werden per context.route abgefangen; Service Worker ist blockiert.
// Jede andere fremde Anfrage wird abgebrochen und als Fehler gezählt. Die echte Datenbank wird NIE erreicht.
// Vorher: cd /Users/marcokland/Apps/BrainCraft && npm run build && npx vite preview --port 8797 --strictPort
// Aufruf:  node tests/store.spec.mjs        (BASE=… überschreibt die Adresse, BROWSER=webkit für Safari)
// Absichtlich provozierte 400-/500-Antworten und Netzabbrüche des Fake-Servers zählen nicht als Konsolenfehler.
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
const SHOTS = process.env.SHOTS ?? join(ROOT, 'tests/.shots/store')
mkdirSync(SHOTS, { recursive: true })
const SIZES = { iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(cond ? '  ok   ' : '  FEHLER', name, cond ? '' : detail) }
const consoleErrors = []
const foreign = []

// ---------- Fake-Daten ----------
const KID = '11111111-1111-4111-8111-111111111111'
const KID2 = '22222222-2222-4222-8222-222222222222'
const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW'
const TOKEN = 'f'.repeat(64)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
const later = new Date(Date.now() + 30 * 86400000).toISOString()

const mc = (id, exam, status = 'freigegeben') => ({
  id, exam_id: exam, unit_id: null, status, type: 'multiple_choice', prompt: `Frage ${id}?`,
  payload: { options: [`R-${id}`, `F1-${id}`, `F2-${id}`], correct_index: 0, explanation: 'weil' },
})
function basePull() {
  return {
    today: day(0), parent: false,
    profiles: [
      { id: KID, child_name: 'Lia', avatar_id: 'a', stars_balance: 42, stars_today: 3, learn_days_week: 4 },
      { id: KID2, child_name: 'Ben', avatar_id: 'b', stars_balance: 7, stars_today: 0, learn_days_week: 1 },
    ],
    subjects: [{ id: 's', name: 'Sachkunde', icon: 'x' }], units: [], rewards: [], redemptions: [],
    exams: [
      { id: 'eN', title: 'Normal-Arbeit', exam_date: day(12), profile_id: KID, subject_id: 's', is_archived: false },
      { id: 'eE', title: 'Vorabend-Arbeit', exam_date: day(1), profile_id: KID, subject_id: 's', is_archived: false },
      { id: 'eT', title: 'Heute-Arbeit', exam_date: day(0), profile_id: KID, subject_id: 's', is_archived: false },
      { id: 'eS', title: 'Kurz-Arbeit', exam_date: null, profile_id: KID, subject_id: 's', is_archived: false },
      { id: 'eD', title: 'Entwurf-Arbeit', exam_date: null, profile_id: KID, subject_id: 's', is_archived: false },
      { id: 'eA', title: 'Archiv-Arbeit', exam_date: null, profile_id: KID, subject_id: 's', is_archived: true },
      { id: 'eB', title: 'Ben-Arbeit', exam_date: null, profile_id: KID2, subject_id: 's', is_archived: false },
    ],
    questions: [
      ...['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'].map((id) => mc(id, 'eN')),
      ...['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => mc(id, 'eE')),
      mc('t1', 'eT'),
      ...['s1', 's2', 's3', 's4'].map((id) => mc(id, 'eS')),
      mc('d1', 'eD', 'entwurf'), mc('d2', 'eD', 'entwurf'), mc('d3', 'eN', 'entwurf'),
      mc('a1', 'eA'), mc('b1', 'eB'),
    ],
    progress: [
      { profile_id: KID, question_id: 'n1', leitner_box: 3, next_review_at: later, consecutive_correct: 2 },
      { profile_id: KID, question_id: 'n2', leitner_box: 4, next_review_at: later, consecutive_correct: 3 },
      { profile_id: KID, question_id: 'n3', leitner_box: 2, next_review_at: later, consecutive_correct: 1 },
      ...['c1', 'c2', 'c3', 'c4', 'c5', 't1'].map((q) => ({ profile_id: KID, question_id: q, leitner_box: 3, next_review_at: later, consecutive_correct: 2 })),
      { profile_id: KID2, question_id: 'b1', leitner_box: 5, next_review_at: later, consecutive_correct: 5 },
    ],
  }
}

// ---------- Fake-Server ----------
function makeServer() {
  const srv = { calls: [], down: false, data: basePull(), pullDelay: 0, codes: new Set([CODE]) }
  srv.handle = async (route) => {
    const req = route.request()
    const url = req.url()
    const fn = url.split('/rpc/')[1]
    let args = {}
    try { args = JSON.parse(req.postData() || '{}') } catch { /* leer */ }
    if (srv.down) return route.abort('internetdisconnected')
    srv.calls.push({ fn, args })
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    const fail = (message) => reply({ code: 'P0001', message }, 400)
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } })
    const known = srv.codes.has(args.p_code)
    switch (fn) {
      case 'bc_pull': {
        if (!known) return fail('not_found')
        if (srv.pullDelay) await new Promise((r) => setTimeout(r, srv.pullDelay))
        const parent = args.p_token === TOKEN
        const d = structuredClone(srv.data)
        d.parent = parent
        if (!parent) d.questions = d.questions.filter((q) => q.status === 'freigegeben')
        if (!parent) d.rewards = d.rewards.filter((r) => r.is_active)
        return reply(d)
      }
      // ---- Sternen-Shop (Verhalten wie supabase/001_braincraft.sql ab Zeile ~1111) ----
      case 'bc_redeem': {
        if (!known) return fail('not_found')
        if (srv.redeemDelay) await new Promise((r) => setTimeout(r, srv.redeemDelay))
        if (srv.redeemFail === 500) return reply({ message: 'boom' }, 500)
        if (srv.redeemFail) return fail(srv.redeemFail)
        const prof = srv.data.profiles.find((p) => p.id === args.p_profile_id)
        if (!prof) return fail('profile_not_found')
        if (!/^[0-9a-f-]{36}$/.test(args.p_redemption_id ?? '')) return fail('bad_redemption')
        const dup = srv.data.redemptions.some((d) => d.id === args.p_redemption_id)
        if (!dup) {
          const r = srv.data.rewards.find((x) => x.id === args.p_reward_id && x.is_active && (!x.profile_id || x.profile_id === args.p_profile_id))
          if (!r) return fail('reward_not_found')
          if (prof.stars_balance < r.cost_stars) return fail('not_enough_stars')
          prof.stars_balance -= r.cost_stars
          srv.data.redemptions.unshift({ id: args.p_redemption_id, profile_id: prof.id, reward_title: r.title, cost_stars: r.cost_stars, status: 'offen', redeemed_at: new Date().toISOString(), resolved_at: null })
          srv.bookings = (srv.bookings ?? 0) + 1
        }
        // Server hat gebucht, Antwort geht aber im Netz verloren
        if (srv.dropRedeemReply) { srv.dropRedeemReply = false; return route.abort('internetdisconnected') }
        return reply({ ok: true, duplicate: dup, stars_balance: prof.stars_balance })
      }
      case 'bc_reward_save': {
        if (args.p_token !== TOKEN || srv.tokenExpired) return fail('pin_required')
        const title = String(args.p_title ?? '').replace(/^ +| +$/g, '')
        const valid = [...title].length >= 1 && [...title].length <= 60 && Number.isInteger(args.p_cost_stars) && args.p_cost_stars >= 1 && args.p_cost_stars <= 100000 && /^[a-z0-9-]{1,40}$/.test(args.p_icon ?? 'gift')
        if (!valid) { srv.invalid = (srv.invalid ?? 0) + 1; return fail('invalid_input') }
        if (args.p_profile_id && !srv.data.profiles.some((p) => p.id === args.p_profile_id)) return fail('profile_not_found')
        const row = { profile_id: args.p_profile_id, title, icon: args.p_icon, cost_stars: args.p_cost_stars, is_active: args.p_is_active ?? true }
        const old = srv.data.rewards.find((r) => r.id === args.p_id)
        if (old) { Object.assign(old, row); return reply(old.id) }
        if (srv.data.rewards.length >= (srv.rewardLimit ?? 50)) return fail('limit_reached')
        const id = args.p_id ?? `r-neu-${srv.data.rewards.length}`
        srv.data.rewards.push({ id, ...row })
        srv.data.rewards.sort((a, b) => a.cost_stars - b.cost_stars)
        return reply(id)
      }
      case 'bc_reward_delete':
        if (args.p_token !== TOKEN || srv.tokenExpired) return fail('pin_required')
        srv.data.rewards = srv.data.rewards.filter((r) => r.id !== args.p_id)
        return reply(true)
      case 'bc_redemption_resolve': {
        if (args.p_token !== TOKEN || srv.tokenExpired) return fail('pin_required')
        if (!['erledigt', 'storniert'].includes(args.p_status)) return fail('bad_status')
        const d = srv.data.redemptions.find((x) => x.id === args.p_id)
        if (!d) return fail('not_found')
        if (d.status !== 'offen') return reply({ ok: true, status: d.status })
        d.status = args.p_status
        d.resolved_at = new Date().toISOString()
        if (args.p_status === 'storniert') srv.data.profiles.find((p) => p.id === d.profile_id).stars_balance += d.cost_stars
        return reply({ ok: true, status: d.status })
      }
      case 'bc_create':
        if (args.p_invite !== 'GOOD-INVI-TECO-DE23') return fail('invite_invalid')
        srv.codes.add(args.p_code)
        return reply({ family_id: 'f', profile_id: KID })
      case 'bc_answer':
        if (srv.answerDown) { srv.calls.pop(); return route.abort('internetdisconnected') }
        return known ? reply({ ok: true }) : fail('not_found')
      case 'bc_round_finish': return known ? reply({ ok: true }) : fail('not_found')
      case 'bc_parent_unlock':
        if (args.p_pin === '2468') return reply({ ok: true, token: TOKEN, expires_at: later })
        if (args.p_pin === '1111') return reply({ ok: false, error: 'pin_locked', locked_until: '2026-10-24T07:15:00Z' })
        return reply({ ok: false, error: 'pin_wrong', locked_until: null })
      case 'bc_parent_lock': return reply(true)
      case 'bc_question_set_status':
        if (args.p_token !== TOKEN) return fail('pin_required')
        for (const q of srv.data.questions) if (args.p_ids.includes(q.id)) q.status = args.p_status
        return reply(args.p_ids.length)
      case 'bc_question_set_active':
        if (args.p_token !== TOKEN) return fail('pin_required')
        if (!args.p_active) srv.data.questions = srv.data.questions.filter((q) => q.id !== args.p_id)
        return reply(true)
      default: return fail('unknown_fn')
    }
  }
  return srv
}

const browserType = pw[process.env.BROWSER ?? 'chromium']
const browser = await browserType.launch()

async function open({ size = 'iphone', storage = {}, raw = {}, lang = 'de', theme, srv = makeServer(), tts } = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[size], serviceWorkers: 'block', deviceScaleFactor: 1, colorScheme: theme === 'dark' ? 'dark' : 'light' })
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (u.startsWith(new URL(BASE).origin + '/')) return route.continue()
    if (u.includes('.supabase.co/rest/v1/rpc/')) return srv.handle(route)
    foreign.push(u)
    return route.abort()
  })
  const init = { 'studio-lang': lang, ...(theme ? { 'studio-theme': theme } : {}) }
  for (const [k, v] of Object.entries(storage)) init[k] = JSON.stringify(v)
  Object.assign(init, raw)
  // Sprachausgabe: 'fake' schreibt alle Aufrufe in window.__tts mit, 'none' entfernt sie ganz
  if (tts) await ctx.addInitScript(fakeSpeech, tts)
  await ctx.addInitScript((init) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    localStorage.clear()
    for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v)
  }, init)
  const page = await ctx.newPage()
  // WebKit meldet bei page.screenshot eine CSP-Meldung zu Stylesheets: Das ist Playwright, kein App-Fehler (Gegenprobe ohne Screenshot)
  const shotNoise = (t) => process.env.BROWSER === 'webkit' && /^Refused to apply a stylesheet because its hash/.test(t)
  page.on('console', (m) => { if (m.type() === 'error' && !shotNoise(m.text()) && !/Failed to load resource: (the server responded with a status of (400|500)|net::ERR_INTERNET_DISCONNECTED)/.test(m.text())) consoleErrors.push(`${size}/${lang}: ${m.text()}`) })
  page.on('pageerror', (e) => consoleErrors.push(`${size}/${lang} pageerror: ${e.message}`))
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  return { ctx, page, srv }
}
// Gefälschte Web Speech API (läuft in der Seite). __ttsDrain() beendet die laufenden Sätze nacheinander.
function fakeSpeech(mode) {
  if (mode === 'none') {
    try { delete window.speechSynthesis } catch { /* egal */ }
    try { delete Window.prototype.speechSynthesis } catch { /* egal */ }
    return
  }
  const tts = { log: [], cur: null }
  window.__tts = tts
  const synth = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    speak(u) { tts.log.push({ t: 'speak', text: u.text, lang: u.lang }); tts.cur = u },
    cancel() { tts.log.push({ t: 'cancel' }); tts.cur = null },
    getVoices() { return [] }, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t } }
  window.__ttsDrain = () => {
    for (let i = 0; i < 50 && tts.cur; i++) { const u = tts.cur; tts.cur = null; u.onstart?.(); u.onend?.() }
  }
}
const ls = (page, k) => page.evaluate((k) => localStorage.getItem(k), k)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const connected = { 'braincraft:code': CODE, 'braincraft:profile': KID }
const answersOf = (srv) => srv.calls.filter((c) => c.fn === 'bc_answer')

// Sperre nach Fehler abwarten (statt fester Zeit; bei hoher Rechnerlast feuert der 1-s-Timer später)
// (Schleife mit evaluate: waitForFunction scheitert an der CSP der App, kein 'unsafe-eval')
async function unlocked(p) {
  for (let k = 0; k < 100; k++) {
    if (await p.evaluate(() => [...document.querySelectorAll('.arena .a-card .g-btn')].some((b) => !b.disabled))) return
    await wait(50)
  }
}
// Multiple-Choice: richtig / falsch antworten, dann Weiter
const card = (p) => p.locator('.arena .a-card')
async function answer(p, how) {
  const qid = (await card(p).locator('.g-btn').first().textContent()).trim().replace(/^(R|F1|F2)-/, '')
  const opts = card(p).locator('.g-btn')
  const texts = (await opts.allTextContents()).map((s) => s.trim())
  const right = texts.find((t) => t.startsWith('R-'))
  const id = right.slice(2)
  const wrong = texts.filter((t) => t.startsWith('F'))
  const tap = (t) => opts.filter({ hasText: new RegExp(`^\\s*${t}\\s*$`) }).first().click({ force: true })
  if (how === 'right') await tap(right)
  else if (how === 'late') { await tap(wrong[0]); await wait(300); await unlocked(p); await tap(right) }
  else if (how === 'reveal') { await tap(wrong[0]); await wait(300); await unlocked(p); await tap(wrong[1]) }
  await p.locator('.a-next').waitFor({ timeout: 3000 })
  const kind = (await p.locator('.a-note').count()) ? (await p.locator('.a-note').first().innerText()) : ''
  await p.locator('.a-next').click()
  await wait(80)
  void qid
  return { id, note: kind }
}
// =========================== 1. Setup ===========================
console.log('1. Setup')
{
  const { ctx, page, srv } = await open()
  await page.getByText('Ich habe einen Familien-Code').click()
  await page.locator('input[placeholder^="XXXX"]').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')
  await page.getByRole('button', { name: 'Verbinden' }).click()
  await page.locator('[role=alert]').waitFor()
  ok('Setup: falscher Code -> Meldung errCode', (await page.locator('[role=alert]').innerText()).includes('Diesen Familien-Code gibt es nicht'))
  ok('Setup: falscher Code -> bc_pull mit p_code', srv.calls.at(-1)?.fn === 'bc_pull' && srv.calls.at(-1).args.p_code === 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')
  ok('Setup: falscher Code -> nichts gespeichert', (await ls(page, 'braincraft:code')) === null)
  srv.down = true
  await page.getByRole('button', { name: 'Verbinden' }).click()
  await wait(300)
  ok('Setup: offline -> errOffline', (await page.locator('[role=alert]').innerText()).includes('Keine Verbindung'))
  srv.down = false
  ok('Setup iPhone: kein seitliches Scrollen', await noHScroll(page))
  await page.screenshot({ path: join(SHOTS, 'setup-code-iphone.png') })
  await page.getByRole('button', { name: 'Abbrechen' }).click()

  // Neue Familie
  await page.getByText('Neu einrichten').click()
  const f = page.locator('form input')
  await f.nth(0).fill('FALS-CHER-CODE-XXXX')
  await f.nth(1).fill('Lia')
  await f.nth(2).fill('12')
  await f.nth(3).fill('12')
  await page.getByRole('button', { name: 'Familie anlegen' }).click()
  ok('Neu: PIN-Format -> errPinFormat', (await page.locator('[role=alert]').innerText()).includes('4 Ziffern'))
  ok('Neu: PIN-Format -> kein bc_create', !srv.calls.some((c) => c.fn === 'bc_create'))
  await f.nth(2).fill('12ab34')
  ok('Neu: PIN-Feld filtert Nicht-Ziffern', (await f.nth(2).inputValue()) === '1234')
  await f.nth(3).fill('4321')
  await page.getByRole('button', { name: 'Familie anlegen' }).click()
  ok('Neu: PINs ungleich -> errPinMatch', (await page.locator('[role=alert]').innerText()).includes('stimmen nicht'))
  await f.nth(3).fill('1234')
  await f.nth(1).fill('   ')
  await page.getByRole('button', { name: 'Familie anlegen' }).click()
  ok('Neu: leerer Name -> errName', (await page.locator('[role=alert]').innerText()).includes('Vornamen'))
  await f.nth(1).fill('Lia')
  await page.getByRole('button', { name: 'Familie anlegen' }).click()
  await wait(300)
  ok('Neu: falsche Einladung -> errInvite', (await page.locator('[role=alert]').innerText()).includes('Einladungscode ist ungültig'))
  await f.nth(0).fill('GOOD-INVI-TECO-DE23')
  srv.calls.length = 0
  await page.getByRole('button', { name: 'Familie anlegen' }).click()
  await page.locator('.setup-code').waitFor()
  const shown = (await page.locator('.setup-code').innerText()).trim()
  const create = srv.calls.find((c) => c.fn === 'bc_create')
  ok('Neu: bc_create mit Einladung, Name, PIN', create && create.args.p_invite === 'GOOD-INVI-TECO-DE23' && create.args.p_child_name === 'Lia' && create.args.p_pin === '1234', JSON.stringify(create?.args))
  ok('Neu: angezeigter Code = gesendeter Code', create && create.args.p_code === shown, `${shown} / ${create?.args.p_code}`)
  ok('Neu: vor „Notiert“ kein bc_pull und kein Code gespeichert', !srv.calls.some((c) => c.fn === 'bc_pull') && (await ls(page, 'braincraft:code')) === null)
  ok('Neu: Code-Anzeige ohne seitliches Scrollen', await noHScroll(page))
  await page.screenshot({ path: join(SHOTS, 'setup-show-iphone.png') })
  await page.getByRole('button', { name: 'Notiert, weiter' }).click()
  await page.locator('.home').waitFor({ timeout: 3000 }).catch(() => {})
  ok('Neu: nach „Notiert“ bc_pull mit dem Code', srv.calls.some((c) => c.fn === 'bc_pull' && c.args.p_code === shown))
  ok('Neu: nach „Notiert“ verbunden (Start sichtbar, Code gespeichert)', (await page.locator('.home').count()) === 1 && JSON.parse(await ls(page, 'braincraft:code')) === shown)
  await ctx.close()
}
{
  // Probemodus: keine Anfragen beim Spielen
  const { ctx, page, srv } = await open()
  await page.getByText('Erst ausprobieren').click()
  ok('Probe: Banner sichtbar', (await page.locator('.demo-banner').count()) === 1)
  await page.locator('.quickbtn').first().click()
  await page.locator('.arena .a-card').waitFor()
  await card(page).locator('.g-btn').first().click({ force: true })
  await wait(1300)
  await card(page).locator('.g-btn').nth(1).click({ force: true }).catch(() => {})
  await wait(300)
  ok('Probe: keine einzige RPC-Anfrage', srv.calls.length === 0, JSON.stringify(srv.calls.map((c) => c.fn)))
  ok('Probe: localStorage braincraft:demo = 1, keine Schlange', (await ls(page, 'braincraft:demo')) === '1' && (await ls(page, 'braincraft:queue')) === null)
  await ctx.close()
}

// =========================== 2. Start ===========================
console.log('2. Start mit Fake-Daten')
{
  const { ctx, page, srv } = await open({ storage: connected })
  await page.locator('.exam-row').first().waitFor()
  const rows = await page.locator('.exam-row').evaluateAll((els) => els.map((e) => ({ t: e.querySelector('b').textContent, s: e.querySelector('small').textContent, dis: e.disabled, ring: e.querySelector('.ring .num').textContent })))
  const titles = rows.map((r) => r.t)
  ok('Start: Arbeiten des Kindes, archivierte und fremde ausgeblendet', !titles.includes('Archiv-Arbeit') && !titles.includes('Ben-Arbeit') && titles.includes('Normal-Arbeit') && titles.length === 5, titles.join(', '))
  const r = Object.fromEntries(rows.map((x) => [x.t, x]))
  ok('Start: Meister-Ring Normal = 2/7 = 29 %', r['Normal-Arbeit']?.ring === '29', r['Normal-Arbeit']?.ring)
  ok('Start: Meister-Ring Vorabend = 100 %', r['Vorabend-Arbeit']?.ring === '100')
  const dExp = new Date(); dExp.setDate(dExp.getDate() + 12)
  ok('Start: Datumszeile „Arbeit am …“', r['Normal-Arbeit']?.s === `Arbeit am ${dExp.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}`, r['Normal-Arbeit']?.s)
  ok('Start: Vorabend „Morgen ist die Arbeit“', r['Vorabend-Arbeit']?.s === 'Morgen ist die Arbeit', r['Vorabend-Arbeit']?.s)
  ok('Start: Tag selbst „Heute ist die Arbeit“', r['Heute-Arbeit']?.s === 'Heute ist die Arbeit', r['Heute-Arbeit']?.s)
  ok('Start: ohne Datum Ring-Text', r['Kurz-Arbeit']?.s === '0 % sicher', r['Kurz-Arbeit']?.s)
  ok('Start: nur Entwürfe -> gesperrt + „Noch keine freigegebenen Fragen“', r['Entwurf-Arbeit']?.dis === true && r['Entwurf-Arbeit']?.s === 'Noch keine freigegebenen Fragen', JSON.stringify(r['Entwurf-Arbeit']))
  ok('Start: Sterne-Pille 42', (await page.locator('.starpill .num').innerText()).trim() === '42')
  ok('Start: Begrüßung mit Namen', (await page.locator('.hello').innerText()).includes('Lia'))
  ok('Start: 4 Lerntage markiert', (await page.locator('.week i.on').count()) === 4)
  ok('Start: Start-refresh = genau 1× bc_pull', srv.calls.filter((c) => c.fn === 'bc_pull').length === 1)
  await page.locator('.exam-row', { hasText: 'Entwurf-Arbeit' }).click({ force: true, timeout: 300 }).catch(() => {})
  ok('Start: gesperrte Zeile startet keine Runde', (await page.locator('.arena').count()) === 0)
  for (const [size] of Object.entries(SIZES)) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(SIZES[size])
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      await wait(100)
      ok(`Start ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
      await page.screenshot({ path: join(SHOTS, `start-${size}-${theme}.png`), fullPage: true })
    }
  }
  await ctx.close()
}

// =========================== 3. Warteschlange ===========================
console.log('3. Warteschlange (Ablauf wie nach dem Neuladen: Start-refresh mit leerer Schlange)')
{
  const { ctx, page, srv } = await open({ storage: connected })
  await page.locator('.exam-row').first().waitFor()
  await wait(300)
  srv.calls.length = 0
  await page.locator('.exam-row', { hasText: 'Normal-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  await answer(page, 'right')
  await wait(500)
  ok('Neuladen: 1. Antwort wird an bc_answer gesendet', answersOf(srv).length === 1, `bc_answer: ${answersOf(srv).length}, Schlange: ${JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]').length}`)
  await ctx.close()
}
console.log('3b. Warteschlange (frisch verbunden über Setup, dann ganze Runde)')
async function connectViaSetup(opts = {}) {
  const o = await open(opts)
  await o.page.getByText(opts.lang === 'en' ? 'I have a family code' : 'Ich habe einen Familien-Code').click()
  await o.page.locator('input[placeholder^="XXXX"]').fill(CODE)
  await o.page.locator('button[type=submit]').click()
  await o.page.locator('.home').waitFor()
  return o
}
// Eigene Runde mit Plan (Notizen erkennen Wiederholung/Notbremse)
async function playRound(page, plan) {
  const seen = []
  let normal = 0
  for (let i = 0; i < 30; i++) {
    if (await page.locator('.a-end').count()) break
    const note = (await page.locator('.a-note').count()) ? (await page.locator('.a-note').first().innerText()) : ''
    const special = /Wiederholung|noch einmal|Nochmal|sichere|leichte|Zum Durchatmen|Pause/i.test(note) && !/Heute nur Fragen/.test(note)
    const how = special ? 'right' : (plan[normal++] ?? 'right')
    const r = await answer(page, how)
    seen.push({ ...r, how, special, note })
  }
  return seen
}
{
  const { ctx, page, srv } = await connectViaSetup()
  srv.calls.length = 0
  await page.locator('.exam-row', { hasText: 'Normal-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  const seen = await playRound(page, ['right', 'late', 'reveal', 'reveal', 'right', 'right', 'right'])
  await page.locator('.a-end').waitFor({ timeout: 3000 }).catch(() => {})
  await wait(800)
  const a = answersOf(srv)
  const normals = seen.filter((s) => !s.special)
  ok('Runde: 7 normale Fragen gespielt, Sonderfragen erkannt', normals.length === 7, JSON.stringify(seen.map((s) => [s.id, s.how, s.special, s.note.slice(0, 30)])))
  ok('Runde: genau 7 bc_answer (keine Wiederholung/Notbremse)', a.length === 7, `${a.length}: ${a.map((x) => x.args.p_question_id).join(',')}`)
  const exp = normals.map((s) => ({ q: s.id, c: s.how !== 'reveal', f: s.how === 'right' }))
  const got = a.map((x) => ({ q: x.args.p_question_id, c: x.args.p_correct, f: x.args.p_first_try }))
  ok('Runde: Reihenfolge und correct = !revealed, first_try', JSON.stringify(exp) === JSON.stringify(got), `erwartet ${JSON.stringify(exp)} / tatsächlich ${JSON.stringify(got)}`)
  ok('Runde: mode solo, gleiche round_id, Kind, Code', a.every((x) => x.args.p_mode === 'solo' && x.args.p_round_id === a[0].args.p_round_id && x.args.p_profile_id === KID && x.args.p_code === CODE), JSON.stringify(a[0]?.args))
  ok('Runde: answer_id eindeutig', new Set(a.map((x) => x.args.p_answer_id)).size === a.length)
  const rf = srv.calls.filter((c) => c.fn === 'bc_round_finish')
  ok('Runde: genau 1× bc_round_finish mit round_id', rf.length === 1 && rf[0].args.p_round_id === a[0]?.args.p_round_id && rf[0].args.p_profile_id === KID, JSON.stringify(rf))
  ok('Runde: bc_round_finish nach allen bc_answer', srv.calls.findIndex((c) => c.fn === 'bc_round_finish') > srv.calls.findLastIndex((c) => c.fn === 'bc_answer'))
  ok('Runde: Schlange leer', JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]').length === 0)

  // Zweite Runde nach dem Rundenende: werden Antworten noch gesendet?
  await page.getByRole('button', { name: 'Nochmal' }).or(page.locator('.a-acts .btn.primary')).first().click()
  await page.locator('.arena .a-card').waitFor()
  srv.calls.length = 0
  await answer(page, 'right')
  await wait(600)
  ok('2. Runde: Antwort nach Rundenende wird gesendet', answersOf(srv).length === 1, `bc_answer: ${answersOf(srv).length}, Schlange: ${JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]').length}`)
  await ctx.close()
}
{
  // Kurze Runde (4 Fragen): kein bc_round_finish
  const { ctx, page, srv } = await connectViaSetup()
  srv.calls.length = 0
  await page.locator('.exam-row', { hasText: 'Kurz-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  await playRound(page, ['right', 'right', 'right', 'right'])
  await wait(600)
  ok('Kurz: 4 bc_answer', answersOf(srv).length === 4, String(answersOf(srv).length))
  ok('Kurz: kein bc_round_finish bei 4 normalen Antworten', !srv.calls.some((c) => c.fn === 'bc_round_finish'))
  await ctx.close()
}
{
  // Vorabend: mode chill
  const { ctx, page, srv } = await connectViaSetup()
  srv.calls.length = 0
  await page.locator('.exam-row', { hasText: 'Vorabend-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  ok('Vorabend: Chill-Hinweis sichtbar', (await page.locator('.a-note').first().innerText().catch(() => '')).includes('Heute nur Fragen'))
  await playRound(page, ['right', 'right', 'right', 'right', 'right'])
  await wait(600)
  const a = answersOf(srv)
  ok('Vorabend: 5 bc_answer mit mode chill', a.length === 5 && a.every((x) => x.args.p_mode === 'chill'), a.map((x) => x.args.p_mode).join(','))
  ok('Vorabend: bc_round_finish (5 normale Antworten, Regel)', srv.calls.some((c) => c.fn === 'bc_round_finish'), 'App.tsx schließt chill-Runden vom Bonus aus')
  await ctx.close()
}
{
  // Offline: Schlange in localStorage, nach online gesendet, Reihenfolge
  const { ctx, page, srv } = await connectViaSetup()
  srv.calls.length = 0
  srv.down = true
  await page.locator('.exam-row', { hasText: 'Kurz-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  const seen = await playRound(page, ['right', 'reveal', 'late', 'right'])
  await wait(300)
  const q = JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]')
  ok('Offline: 4 Antworten in localStorage', q.filter((x) => x.kind === 'answer').length === 4, String(q.length))
  await page.locator('.a-acts .btn.plain, .a-end .btn').last().click()
  await page.locator('.home').waitFor()
  ok('Offline: Start zeigt „4 Antworten warten auf Verbindung“', (await page.locator('.hero').innerText()).includes('4 Antworten warten'))
  srv.down = false
  srv.calls.length = 0
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(800)
  const a = answersOf(srv)
  const normals = seen.filter((s) => !s.special).map((s) => s.id)
  ok('Offline: nach online alle 4 gesendet, Reihenfolge erhalten', JSON.stringify(a.map((x) => x.args.p_question_id)) === JSON.stringify(normals), `${a.map((x) => x.args.p_question_id)} / ${normals}`)
  ok('Offline: Schlange danach leer', JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]').length === 0)
  ok('Offline: erst senden, dann bc_pull', srv.calls.at(-1)?.fn === 'bc_pull')
  await ctx.close()
}

// =========================== 4. Eltern ===========================
console.log('4. Eltern-Cockpit')
async function openCockpit(page) {
  await page.locator('header .gear').click()
  await page.locator('dialog.settings[open]').getByText('Eltern-Cockpit').first().click()
  await page.locator('.pin').waitFor()
}
async function pin(page, digits) {
  for (const d of digits) await page.locator('.pin-keys .key', { hasText: new RegExp(`^${d}$`) }).click()
  await wait(400)
}
{
  const { ctx, page, srv } = await connectViaSetup()
  await openCockpit(page)
  const cols = await page.locator('.pin-keys').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  ok('PIN: Ziffernblock 3 Spalten', cols === 3, String(cols))
  const keys = await page.locator('.pin-keys .key').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height] }))
  ok('PIN: Tasten mind. 44×44', keys.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(keys))
  await pin(page, '1357')
  ok('PIN: falsche PIN -> „PIN falsch“', (await page.locator('.pin [role=alert]').innerText()).includes('PIN falsch'))
  ok('PIN: Punkte zurückgesetzt', (await page.locator('.pin-dots i.on').count()) === 0)
  await pin(page, '1111')
  const lockedMsg = await page.locator('.pin [role=alert]').innerText()
  const expT = new Date('2026-10-24T07:15:00Z').toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  ok('PIN: Sperre mit Uhrzeit', lockedMsg.includes(`Gesperrt bis ${expT} Uhr`), lockedMsg)
  for (const [size] of Object.entries(SIZES)) {
    await page.setViewportSize(SIZES[size])
    ok(`PIN ${size}: kein seitliches Scrollen`, await noHScroll(page))
    await page.screenshot({ path: join(SHOTS, `pin-${size}.png`) })
  }
  await page.setViewportSize(SIZES.iphone)
  srv.calls.length = 0
  await pin(page, '2468')
  await page.locator('.approve, .bc-empty').first().waitFor({ timeout: 3000 }).catch(() => {})
  ok('PIN: richtige PIN -> Cockpit offen', (await page.locator('.approve').count()) === 1)
  ok('PIN: bc_pull mit Token nach Entsperren', srv.calls.some((c) => c.fn === 'bc_pull' && c.args.p_token === TOKEN))
  ok('PIN: Token nicht in localStorage', !(await page.evaluate((t) => Object.values(localStorage).some((v) => v.includes(t)), TOKEN)))
  const groups = await page.locator('.approve-exam h2').allInnerTexts()
  ok('Cockpit: Entwürfe nach Arbeit gruppiert', JSON.stringify(groups.sort()) === JSON.stringify(['Entwurf-Arbeit', 'Normal-Arbeit']), groups.join(','))
  ok('Cockpit: Lösung angezeigt', (await page.locator('.approve-q', { hasText: 'Frage d1?' }).innerText()).includes('R-d1'))
  for (const [size] of Object.entries(SIZES)) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(SIZES[size])
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      ok(`Cockpit ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
      await page.screenshot({ path: join(SHOTS, `cockpit-${size}-${theme}.png`), fullPage: true })
    }
  }
  await page.setViewportSize(SIZES.iphone)
  // einzeln freigeben
  srv.calls.length = 0
  await page.locator('.approve-exam', { hasText: 'Normal-Arbeit' }).getByRole('button', { name: 'Freigeben', exact: true }).click()
  await wait(500)
  const st = srv.calls.find((c) => c.fn === 'bc_question_set_status')
  ok('Freigeben einzeln: p_ids [d3], freigegeben, Token', st && JSON.stringify(st.args.p_ids) === '["d3"]' && st.args.p_status === 'freigegeben' && st.args.p_token === TOKEN, JSON.stringify(st?.args))
  ok('Freigeben einzeln: danach bc_pull, Gruppe weg', srv.calls.at(-1)?.fn === 'bc_pull' && (await page.locator('.approve-exam', { hasText: 'Normal-Arbeit' }).count()) === 0)
  // ausblenden d2
  srv.calls.length = 0
  await page.locator('.approve-list li', { hasText: 'Frage d2?' }).getByRole('button', { name: 'Ausblenden', exact: true }).click()
  await wait(500)
  const sa = srv.calls.find((c) => c.fn === 'bc_question_set_active')
  ok('Ausblenden: bc_question_set_active(d2, false)', sa && sa.args.p_id === 'd2' && sa.args.p_active === false && sa.args.p_token === TOKEN, JSON.stringify(sa?.args))
  ok('Ausblenden: d2 verschwindet', (await page.locator('.approve-list li', { hasText: 'Frage d2?' }).count()) === 0)
  // alle freigeben (nur noch d1)
  srv.data.questions.push(mc('d4', 'eD', 'entwurf'))
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(500)
  srv.calls.length = 0
  const allBtn = page.locator('.approve-exam', { hasText: 'Entwurf-Arbeit' }).locator('.approve-head .btn')
  ok('Alle freigeben: Beschriftung „Alle 2 freigeben“', (await allBtn.innerText()).trim() === 'Alle 2 freigeben', await allBtn.innerText())
  await allBtn.click()
  await wait(500)
  const all = srv.calls.find((c) => c.fn === 'bc_question_set_status')
  ok('Alle freigeben: p_ids [d1,d4]', all && JSON.stringify([...all.args.p_ids].sort()) === '["d1","d4"]', JSON.stringify(all?.args))
  ok('Alle freigeben: leerer Zustand', (await page.locator('.bc-empty', { hasText: 'Keine neuen Fragen' }).count()) === 1 && (await page.locator('.approve').count()) === 0)
  // Familien-Code anzeigen
  await page.getByRole('button', { name: 'Familien-Code anzeigen' }).click()
  ok('Cockpit: Code anzeigen', (await page.locator('.parents').innerText()).includes(CODE))
  // Sperren
  srv.calls.length = 0
  await page.getByRole('button', { name: 'Sperren', exact: true }).click()
  await wait(500)
  ok('Sperren: bc_parent_lock mit Token', srv.calls.some((c) => c.fn === 'bc_parent_lock' && c.args.p_token === TOKEN))
  ok('Sperren: bc_pull ohne Token', srv.calls.some((c) => c.fn === 'bc_pull' && c.args.p_token === null))
  ok('Sperren: zurück zur Startseite', (await page.locator('.home').count()) === 1)
  await openCockpit(page)
  ok('Sperren: erneut PIN nötig', (await page.locator('.pin').count()) === 1)
  // Gerät trennen
  await pin(page, '2468')
  await page.locator('.approve, .bc-empty').first().waitFor({ timeout: 3000 })
  // Schlange füllen (offline), damit „queue“ geprüft werden kann
  await page.evaluate(() => localStorage.setItem('braincraft:queue', JSON.stringify([{ kind: 'round', roundId: 'x', profileId: 'y' }])))
  await page.getByText('Gerät trennen').click()
  ok('Trennen: Rückfrage-Dialog offen', (await page.locator('dialog.confirm[open]').count()) === 1)
  const danger = page.locator('dialog.confirm[open] .btn.danger')
  const bg = await danger.evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('Trennen: roter Knopf', /rgb\(179, 38, 30\)|rgb\(255, 138, 128\)/.test(bg), bg)
  await page.locator('dialog.confirm[open]').getByRole('button', { name: 'Abbrechen' }).click()
  ok('Trennen: Abbrechen lässt verbunden', (await ls(page, 'braincraft:code')) !== null)
  await page.getByText('Gerät trennen').click()
  await danger.click()
  await wait(600)
  const keys2 = ['braincraft:code', 'braincraft:profile', 'braincraft:pull', 'braincraft:name']
  const vals = {}
  for (const k of keys2) vals[k] = await ls(page, k)
  vals['braincraft:queue'] = await ls(page, 'braincraft:queue')
  ok('Trennen: code, profile, pull, Name gelöscht', keys2.every((k) => !vals[k]), JSON.stringify(vals).slice(0, 300))
  ok('Trennen: Schlange leer', !vals['braincraft:queue'] || vals['braincraft:queue'] === '[]', vals['braincraft:queue'])
  ok('Trennen: Setup sichtbar', (await page.locator('.setup').count()) === 1)
  await ctx.close()
}
{
  // Trennen, während ein bc_pull noch läuft (langsames Netz)
  const { ctx, page, srv } = await connectViaSetup()
  await openCockpit(page)
  await pin(page, '2468')
  await page.locator('.approve, .bc-empty').first().waitFor({ timeout: 3000 })
  srv.pullDelay = 1500
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(100)
  await page.getByText('Gerät trennen').click()
  await page.locator('dialog.confirm[open] .btn.danger').click()
  await wait(2200)
  const pull = await ls(page, 'braincraft:pull')
  const name = await ls(page, 'braincraft:name')
  ok('Trennen bei laufendem bc_pull: pull bleibt gelöscht', !pull, (pull ?? '').slice(0, 60))
  ok('Trennen bei laufendem bc_pull: Name bleibt gelöscht', !name, String(name))
  await ctx.close()
}

// =========================== 5. Englisch ===========================
console.log('5. Englisch')
const GERMAN = ['Arbeit', 'Morgen', 'Heute', 'Noch keine', 'sicher', 'Familien', 'Verbinden', 'Abbrechen', 'PIN falsch', 'Gesperrt', 'Freigeben', 'Ausblenden', 'Sperren', 'Gerät', 'Lösung', 'Antwort', 'Einladung', 'Ziffern']
const germanIn = (txt) => GERMAN.filter((w) => txt.includes(w) && !/(Normal|Vorabend|Heute|Kurz|Entwurf)-Arbeit|Frage [a-z0-9]+\?/.test(w))
const stripData = (s) => s.replace(/(Normal|Vorabend|Heute|Kurz|Entwurf|Archiv|Ben)-Arbeit/g, '').replace(/Frage [a-z0-9]+\?/g, '')
{
  const { ctx, page, srv } = await open({ lang: 'en' })
  ok('EN Setup: html lang en', (await page.evaluate(() => document.documentElement.lang)) === 'en')
  ok('EN Setup: keine deutschen Wörter', germanIn(await page.innerText('body')).length === 0, germanIn(await page.innerText('body')).join(','))
  await page.getByText('I have a family code').click()
  await page.locator('input[placeholder^="XXXX"]').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')
  await page.locator('button[type=submit]').click()
  await page.locator('[role=alert]').waitFor()
  ok('EN Setup: Fehlermeldung englisch', (await page.locator('[role=alert]').innerText()).includes('does not exist'))
  await page.locator('button.plain').click()
  await page.getByText(/^Set up/).first().click().catch(() => {})
  await page.locator('form').waitFor({ timeout: 2000 }).catch(() => {})
  if (await page.locator('form').count()) {
    const f = page.locator('form input')
    await f.nth(0).fill('FALS-CHER-CODE-XXXX'); await f.nth(1).fill('Lia'); await f.nth(2).fill('12'); await f.nth(3).fill('12')
    await page.locator('button[type=submit]').click()
    ok('EN Neu: PIN-Fehler englisch', (await page.locator('[role=alert]').innerText()).includes('4 digits'))
    ok('EN Neu: keine deutschen Wörter', germanIn(await page.innerText('body')).length === 0, germanIn(await page.innerText('body')).join(','))
  } else ok('EN Neu: Formular gefunden', false, 'Knopf „Set up…“ nicht gefunden')
  await ctx.close()
  void srv
}
{
  const o = await connectViaSetup({ lang: 'en' })
  const { ctx, page } = o
  await page.locator('.exam-row').first().waitFor()
  const body = stripData(await page.innerText('body'))
  ok('EN Start: keine deutschen Wörter', germanIn(body).length === 0, germanIn(body).join(','))
  const dExp = new Date(); dExp.setDate(dExp.getDate() + 12)
  ok('EN Start: Datum en-GB', body.includes(`Test on ${dExp.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`), body.match(/Test on [^\n]*/)?.[0])
  ok('EN Start: „No approved questions yet“', body.includes('No approved questions yet'))
  await page.locator('header .gear').click()
  await page.locator('dialog.settings[open]').getByText('Parent cockpit').first().click()
  await page.locator('.pin').waitFor()
  await pin(page, '1357')
  ok('EN PIN: falsch englisch', (await page.locator('.pin [role=alert]').innerText()).includes('Wrong PIN'))
  await pin(page, '1111')
  const lm = await page.locator('.pin [role=alert]').innerText()
  ok('EN PIN: Sperre englisch mit Uhrzeit', lm.includes('Locked until') && !lm.includes('Uhr'), lm)
  await pin(page, '2468')
  await page.locator('.approve').waitFor({ timeout: 3000 })
  const cb = stripData(await page.innerText('body'))
  ok('EN Cockpit: keine deutschen Wörter', germanIn(cb).length === 0, germanIn(cb).join(','))
  await page.getByText('Disconnect device').click()
  const db = await page.locator('dialog.confirm[open]').innerText()
  ok('EN Trennen: Rückfrage englisch', germanIn(db).length === 0 && db.includes('Really disconnect'), db)
  await ctx.close()
}

// =========================== 6. Sternen-Shop ===========================
console.log('6. Sternen-Shop (Kind)')
// Erwartete Texte direkt aus src/lib/i18n.ts (einfache Schlüssel: 1. Treffer Deutsch, 2. Englisch), damit Textänderungen nicht stören
const I18N = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')
const T = (key, lang = 'de') => {
  const m = [...I18N.matchAll(new RegExp(`^\\s+${key}: (['"])(.*)\\1,?$`, 'gm'))][lang === 'de' ? 0 : 1]
  if (!m) throw new Error(`Text ${key}/${lang} nicht gefunden`)
  return m[2].replace(/\\(.)/g, '$1')
}
const RW = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`
const VC = (n) => `bbbbbbbb-0000-4000-8000-00000000000${n}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function shopServer({ balance = 100, kids = 2, rewards = true } = {}) {
  const srv = makeServer()
  const d = srv.data
  d.profiles[0].stars_balance = balance
  if (kids === 1) d.profiles = [d.profiles[0]]
  d.rewards = rewards ? [
    { id: RW(5), profile_id: null, title: 'Pausiert-Pizza', icon: 'pizza', cost_stars: 5, is_active: false },
    { id: RW(4), profile_id: KID2, title: 'Ben-Lego', icon: 'gift', cost_stars: 10, is_active: true },
    { id: RW(1), profile_id: null, title: 'Ein Eis', icon: 'ice-cream', cost_stars: 30, is_active: true },
    { id: RW(3), profile_id: KID, title: 'Lia-Buch', icon: 'book', cost_stars: 40, is_active: true },
    { id: RW(2), profile_id: null, title: 'Kinoabend', icon: 'film', cost_stars: 300, is_active: true },
  ] : []
  const iso = (n) => new Date(Date.now() - n * 86400000).toISOString()
  d.redemptions = [
    { id: VC(1), profile_id: KID, reward_title: 'Alter Gutschein', cost_stars: 20, status: 'offen', redeemed_at: iso(1), resolved_at: null },
    { id: VC(4), profile_id: KID2, reward_title: 'Ben-Gutschein', cost_stars: 7, status: 'offen', redeemed_at: iso(2), resolved_at: null },
    { id: VC(2), profile_id: KID, reward_title: 'Erledigt-Kakao', cost_stars: 15, status: 'erledigt', redeemed_at: iso(5), resolved_at: '2026-10-20T10:00:00Z' },
    { id: VC(3), profile_id: KID, reward_title: 'Storno-Spiel', cost_stars: 25, status: 'storniert', redeemed_at: iso(6), resolved_at: iso(4) },
  ]
  if (kids === 1) {
    d.rewards = d.rewards.filter((r) => r.profile_id !== KID2)
    d.redemptions = d.redemptions.filter((r) => r.profile_id !== KID2)
  }
  return srv
}
const lsPull = async (page) => JSON.parse((await ls(page, 'braincraft:pull')) ?? 'null')
async function toShop(page) {
  await page.locator('nav.tabbar button', { hasText: 'Shop' }).click()
  await page.locator('.shop').waitFor()
  await wait(150)
}
const item = (p, title) => p.locator('.shop-item', { hasText: title })
const askSheet = (p) => p.locator('dialog.confirm[open]')
const redeemsOf = (srv) => srv.calls.filter((c) => c.fn === 'bc_redeem')
async function tryRedeem(page, title) {
  await item(page, title).getByRole('button', { name: 'Einlösen' }).click()
  await askSheet(page).waitFor({ timeout: 2000 })
  await askSheet(page).getByRole('button', { name: 'Ja, einlösen' }).click()
}
{
  const srv = shopServer({ balance: 100 })
  // Eine offene Antwort, die beim Start nicht gesendet werden kann (bc_answer bricht ab)
  const queued = [{ kind: 'answer', id: 'cccccccc-0000-4000-8000-000000000001', profileId: KID, questionId: 'n4', correct: true, firstTry: true, mode: 'solo', at: new Date().toISOString(), roundId: null }]
  srv.answerDown = true
  const { ctx, page } = await open({ storage: { ...connected, 'braincraft:queue': queued }, srv })
  await page.locator('.home').waitFor()
  await toShop(page)
  ok('Shop: Antwort hängt noch in der Schlange (Vorbedingung)', JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]').length === 1)
  const titles = (await page.locator('.shop-item b').allInnerTexts()).map((x) => x.trim())
  ok('Shop: nur aktive Belohnungen für alle oder für Lia, nach Preis', JSON.stringify(titles) === JSON.stringify(['Ein Eis', 'Lia-Buch', 'Kinoabend']), titles.join(','))
  ok('Shop: Ben-Belohnung und pausierte unsichtbar', !(await page.locator('.shop').innerText()).match(/Ben-Lego|Pausiert-Pizza/))
  ok('Shop: Sternestand 100', (await page.locator('.shop-bal b').innerText()).trim() === '100')
  const kinoBtn = item(page, 'Kinoabend').getByRole('button', { name: 'Einlösen' })
  ok('Shop: Einlösen bei zu wenig Sternen gesperrt', await kinoBtn.isDisabled())
  ok('Shop: Einlösen bei genug Sternen frei', await item(page, 'Ein Eis').getByRole('button', { name: 'Einlösen' }).isEnabled())
  ok('Shop: unter halbem Preis „Schon 100 von 300 Sternen“ (shopSoFar)', (await item(page, 'Kinoabend').innerText()).includes('Schon 100 von 300 Sternen'), await item(page, 'Kinoabend').innerText())
  ok('Shop: Balken mit aria-valuetext', (await item(page, 'Kinoabend').locator('[role=progressbar]').getAttribute('aria-valuetext')) === 'Schon 100 von 300 Sternen')
  ok('Shop: „Bereit zum Einlösen“ bei Eis', (await item(page, 'Ein Eis').innerText()).includes('Bereit zum Einlösen'))
  const bar = await item(page, 'Kinoabend').locator('.bar i').evaluate((e) => [e.getBoundingClientRect().width, e.parentElement.getBoundingClientRect().width])
  ok('Shop: Fortschrittsbalken Kino ≈ 1/3 (CSP lässt Breite zu)', Math.abs(bar[0] / bar[1] - 1 / 3) < 0.02, JSON.stringify(bar))
  const goals = (await page.locator('.shop-goal').allInnerTexts()).map((x) => x.trim())
  ok('Shop: shopReadyAll und Sparziel Kinoabend gleichzeitig', goals.length === 2 && goals[0] === T('shopReadyAll') && /200 Sterne bis „Kinoabend“/.test(goals[1]), goals.join(' | '))
  await kinoBtn.click({ force: true, timeout: 300 }).catch(() => {})
  ok('Shop: gesperrter Knopf öffnet keine Rückfrage', (await askSheet(page).count()) === 0)
  const vouchers = await page.locator('.shop .list .row').allInnerTexts()
  ok('Gutscheine: 3 eigene, keiner von Ben', vouchers.length === 3 && !vouchers.join().includes('Ben'), vouchers.join(' | '))
  ok('Gutscheine: offen „Wartet auf deine Eltern“', vouchers[0]?.includes(T('voucherOpen')) && vouchers[0]?.includes('20 Sterne'), vouchers[0])
  ok('Gutscheine: erledigt mit Datum', vouchers[1]?.includes(`${new Date('2026-10-20T10:00:00Z').toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}`), vouchers[1])
  ok('Gutscheine: storniert voucherRefunded', vouchers[2]?.includes(T('voucherRefunded')), vouchers[2])
  const btnH = await page.locator('.shop-btn').first().evaluate((e) => e.getBoundingClientRect().height)
  ok('Shop: Einlösen-Knopf mind. 60 px hoch (Kinder-App)', btnH >= 60, String(btnH))

  // Einlösen: erst offene Antwort, dann bc_redeem, dann bc_pull
  srv.answerDown = false
  srv.calls.length = 0
  await item(page, 'Ein Eis').getByRole('button', { name: 'Einlösen' }).click()
  await askSheet(page).waitFor()
  const askTxt = await askSheet(page).innerText()
  ok('Rückfrage: Text mit Titel, Preis und Rest', askTxt.includes('„Ein Eis“') && askTxt.includes('30 Sterne') && askTxt.includes('70 Sterne'), askTxt)
  await page.screenshot({ path: join(SHOTS, 'shop-frage-iphone.png') })
  await askSheet(page).getByRole('button', { name: 'Ja, einlösen' }).click()
  await page.locator('.shop-voucher').waitFor({ timeout: 3000 }).catch(() => {})
  await wait(300)
  const order = srv.calls.map((c) => c.fn)
  ok('Einlösen: bc_answer vor bc_redeem, danach bc_pull', order.indexOf('bc_answer') > -1 && order.indexOf('bc_answer') < order.indexOf('bc_redeem') && order.lastIndexOf('bc_pull') > order.indexOf('bc_redeem'), order.join(','))
  const rd = redeemsOf(srv)[0]?.args ?? {}
  ok('Einlösen: RPC-Argumente p_code, p_redemption_id (UUID), p_profile_id, p_reward_id', JSON.stringify(Object.keys(rd).sort()) === JSON.stringify(['p_code', 'p_profile_id', 'p_redemption_id', 'p_reward_id']) && rd.p_code === CODE && rd.p_profile_id === KID && rd.p_reward_id === RW(1) && UUID.test(rd.p_redemption_id), JSON.stringify(rd))
  ok('Einlösen: Gutschein-Sheet mit Titel', (await page.locator('.shop-voucher b').innerText().catch(() => '')).trim() === 'Ein Eis')
  await page.screenshot({ path: join(SHOTS, 'shop-gutschein-iphone.png') })
  await page.getByRole('button', { name: 'Super!' }).click()
  await wait(200)
  ok('Einlösen: Stand danach 70, neuer Gutschein oben', (await page.locator('.shop-bal b').innerText()).trim() === '70' && (await page.locator('.shop .list .row').first().innerText()).includes('Ein Eis'))

  // Offene Antwort kann nicht gesendet werden: kein bc_redeem mit veraltetem Stand
  await page.evaluate((q) => localStorage.setItem('braincraft:queue', JSON.stringify(q)), [{ ...queued[0], id: 'cccccccc-0000-4000-8000-000000000002' }])
  srv.answerDown = true
  await page.reload()
  await page.locator('.home').waitFor()
  await toShop(page)
  srv.calls.length = 0
  await tryRedeem(page, 'Lia-Buch')
  await askSheet(page).locator('[role=alert]').waitFor({ timeout: 3000 }).catch(() => {})
  ok('Schlange hängt: kein bc_redeem gesendet', redeemsOf(srv).length === 0, srv.calls.map((c) => c.fn).join(','))
  ok('Schlange hängt: Meldung „Keine Verbindung“', (await askSheet(page).locator('[role=alert]').innerText().catch(() => '')).includes(T('errOffline')))

  // Antwort geht verloren, nachdem der Server gebucht hat: Wiederholung mit gleicher ID bucht nicht doppelt
  srv.answerDown = false
  srv.dropRedeemReply = true
  srv.bookings = 0
  await askSheet(page).getByRole('button', { name: 'Ja, einlösen' }).click()
  await wait(500)
  ok('Netzabbruch nach Buchung: Meldung „Keine Verbindung“', (await askSheet(page).locator('[role=alert]').innerText().catch(() => '')).includes(T('errOffline')))
  await askSheet(page).getByRole('button', { name: 'Ja, einlösen' }).click()
  await page.locator('.shop-voucher').waitFor({ timeout: 3000 }).catch(() => {})
  const ids = redeemsOf(srv).map((c) => c.args.p_redemption_id)
  ok('Wiederholung: gleiche redemptionId', ids.length === 2 && ids[0] === ids[1], JSON.stringify(ids))
  ok('Wiederholung: nur 1 Buchung, Stand 30', srv.bookings === 1 && srv.data.profiles[0].stars_balance === 30, `${srv.bookings} / ${srv.data.profiles[0].stars_balance}`)
  ok('Wiederholung: Gutschein-Sheet erscheint', (await page.locator('.shop-voucher').isVisible()))
  await page.getByRole('button', { name: 'Super!' }).click()
  await wait(200)

  // Doppel-Tipp bei langsamem Netz
  srv.calls.length = 0
  srv.bookings = 0
  srv.redeemDelay = 600
  await item(page, 'Ein Eis').getByRole('button', { name: 'Einlösen' }).click()
  await askSheet(page).waitFor()
  const yes = askSheet(page).getByRole('button', { name: 'Ja, einlösen' })
  await yes.click()
  await yes.click({ force: true, timeout: 300 }).catch(() => {})
  await page.locator('.shop-voucher').waitFor({ timeout: 3000 }).catch(() => {})
  const dIds = redeemsOf(srv).map((c) => c.args.p_redemption_id)
  ok('Doppel-Tipp: höchstens gleiche ID, genau 1 Buchung', dIds.length >= 1 && new Set(dIds).size === 1 && srv.bookings === 1, `${JSON.stringify(dIds)} / ${srv.bookings}`)
  await page.getByRole('button', { name: 'Super!' }).click()
  await wait(200)
  srv.redeemDelay = 0
  ok('Nach 3 Einlösungen: Stand 0, alle Knöpfe gesperrt', (await page.locator('.shop-bal b').innerText()).trim() === '0' && (await page.locator('.shop-btn:not([disabled])').count()) === 0)
  ok('Nächstes Ziel: 30 Sterne bis „Ein Eis“', (await page.locator('.shop-goal').count()) === 1 && /30 Sterne bis „Ein Eis“/.test(await page.locator('.shop-goal').innerText()), (await page.locator('.shop-goal').allInnerTexts()).join(' | '))

  // Einlöse-ID je Belohnung bis zum Erfolg (Shop.tsx pendingIds): gleiche Belohnung -> gleiche ID,
  // auch nach Abbrechen, Neuöffnen und Tab-Wechsel; andere Belohnung -> andere ID; nach Erfolg neue ID
  srv.data.profiles[0].stars_balance = 1000
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(400)
  ok('Sternpille: Tausenderpunkt „1.000“ wie im Shop', (await page.locator('.starpill .num').innerText().catch(() => '')).trim() === '1.000' && (await page.locator('.shop-bal b').innerText()).trim() === '1.000', await page.locator('.starpill .num').innerText().catch(() => '(keine Pille)'))
  srv.calls.length = 0
  srv.redeemFail = 'limit_reached'
  const idNow = () => redeemsOf(srv).at(-1)?.args.p_redemption_id
  await tryRedeem(page, 'Ein Eis')
  await wait(300)
  const id1 = idNow()
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  await tryRedeem(page, 'Ein Eis')
  await wait(300)
  const id2 = idNow()
  ok('Gleiche Belohnung nach Abbrechen und Neuöffnen: gleiche redemptionId', id1 && id1 === id2, `${id1} / ${id2}`)
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  await page.locator('nav.tabbar button').first().click()
  await wait(150)
  await toShop(page)
  await tryRedeem(page, 'Ein Eis')
  await wait(300)
  const id3 = idNow()
  ok('Gleiche Belohnung nach Tab-Wechsel: gleiche redemptionId', id3 === id1, `${id1} / ${id3}`)
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  await tryRedeem(page, 'Lia-Buch')
  await wait(300)
  const idB = idNow()
  ok('Andere Belohnung: andere redemptionId', idB && idB !== id1 && UUID.test(idB), `${id1} / ${idB}`)
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  srv.redeemFail = null
  srv.bookings = 0
  await tryRedeem(page, 'Ein Eis')
  await page.locator('.shop-voucher').waitFor({ timeout: 3000 }).catch(() => {})
  const idOk = idNow()
  ok('Erfolg nutzt die gemerkte ID, genau 1 Buchung', idOk === id1 && srv.bookings === 1, `${idOk} / ${srv.bookings}`)
  await page.getByRole('button', { name: 'Super!' }).click()
  await wait(200)
  srv.redeemFail = 'limit_reached'
  await tryRedeem(page, 'Ein Eis')
  await wait(300)
  const idNew = idNow()
  ok('Nach Erfolg: neue redemptionId für dieselbe Belohnung', idNew && idNew !== id1 && idNew !== idB, `${id1} / ${idNew}`)
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  srv.redeemFail = null

  // Fehlermeldungen je Fehlercode
  const cases = [
    ['not_enough_stars', T('errStars')],
    ['reward_not_found', T('errReward')],
    ['limit_reached', T('errVoucherLimit')],
    [500, T('errGeneric')],
    ['offline', T('errOffline')],
  ]
  for (const [code, text] of cases) {
    srv.redeemFail = code === 'offline' ? null : code
    srv.down = code === 'offline'
    srv.calls.length = 0
    await tryRedeem(page, 'Lia-Buch')
    await wait(500)
    if (code === 'not_enough_stars' || code === 'reward_not_found') {
      // Stand hat sich geändert: Sheet zu, Hinweis in der Ansicht, neu laden
      const msg = await page.locator('.shop > [role=alert]').innerText().catch(() => '')
      ok(`Fehler ${code}: Hinweis in der Ansicht „${text.slice(0, 40)}…“`, msg.trim() === text, msg)
      ok(`Fehler ${code}: Sheet zu, kein Gutschein, danach bc_pull`, (await askSheet(page).count()) === 0 && (await page.locator('.shop-voucher').count()) === 0 && srv.calls.at(-1)?.fn === 'bc_pull', srv.calls.map((c) => c.fn).join(','))
    } else {
      const msg = await askSheet(page).locator('[role=alert]').innerText().catch(() => '')
      ok(`Fehler ${code}: „${text.slice(0, 40)}…“ im Sheet`, msg.trim() === text, msg)
      ok(`Fehler ${code}: Rückfrage bleibt offen, kein Gutschein`, (await askSheet(page).count()) === 1 && (await page.locator('.shop-voucher').count()) === 0)
      srv.down = false
      await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
    }
    srv.down = false
  }
  // Hinweis aus der Ansicht wird beim nächsten Öffnen entfernt
  srv.redeemFail = 'not_enough_stars'
  await tryRedeem(page, 'Lia-Buch')
  await wait(400)
  await item(page, 'Ein Eis').getByRole('button', { name: 'Einlösen' }).click()
  ok('Hinweis: beim nächsten „Einlösen“ ausgeblendet', (await page.locator('.shop > [role=alert]').count()) === 0)
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  srv.redeemFail = null

  // Esc während des Einlösens: Fehler darf nicht im geschlossenen Sheet verschwinden
  srv.redeemDelay = 700
  srv.redeemFail = 'limit_reached'
  await tryRedeem(page, 'Lia-Buch')
  await wait(100)
  await page.keyboard.press('Escape')
  await wait(1100)
  ok('Esc beim Senden: Rückfrage mit Fehler bleibt sichtbar', (await askSheet(page).locator('[role=alert]').isVisible().catch(() => false)))
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click().catch(() => {})
  await wait(150)
  await item(page, 'Ein Eis').getByRole('button', { name: 'Einlösen' }).click()
  ok('Esc beim Senden: danach öffnet „Einlösen“ wieder die Rückfrage', await askSheet(page).isVisible().catch(() => false))
  await askSheet(page).getByRole('button', { name: 'Abbrechen' }).click().catch(() => {})
  srv.redeemDelay = 0
  srv.redeemFail = null

  ok('Shop: pausierte Belohnung nicht im localStorage', !(await lsPull(page)).rewards.some((r) => !r.is_active))
  for (const [size] of Object.entries(SIZES)) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(SIZES[size])
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      await wait(100)
      ok(`Shop ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
      await page.screenshot({ path: join(SHOTS, `shop-${size}-${theme}.png`), fullPage: true })
    }
  }
  await ctx.close()
}
{
  // Probemodus: drei Beispiele, nicht einlösbar, keine Anfrage
  const { ctx, page, srv } = await open()
  await page.getByText('Erst ausprobieren').click()
  await toShop(page)
  ok('Shop Probe: 3 Beispiele', (await page.locator('.shop-item').count()) === 3)
  ok('Shop Probe: alle Einlösen gesperrt', (await page.locator('.shop-btn:not([disabled])').count()) === 0)
  ok('Shop Probe: Hinweis sichtbar', (await page.locator('.shop-note').innerText()).includes('Probemodus'))
  ok('Shop Probe: keine RPC-Anfrage', srv.calls.length === 0, srv.calls.map((c) => c.fn).join(','))
  await ctx.close()
}

console.log('6b. Sternen-Shop (Eltern)')
const mgr = (p) => p.locator('.parents')
const formSheet = (p) => p.locator('dialog.confirm[open]')
const callsOf = (srv, fn) => srv.calls.filter((c) => c.fn === fn)
async function unlock(page) {
  await openCockpit(page)
  await pin(page, '2468')
  await page.locator('.parents .vouchers, .parents .bc-empty').first().waitFor({ timeout: 3000 })
}
{
  const srv = shopServer({ balance: 100 })
  const { ctx, page } = await open({ storage: connected, srv })
  await page.locator('.home').waitFor()
  await unlock(page)
  ok('Eltern: localStorage ohne pausierte Belohnung, auch entsperrt', !(await lsPull(page)).rewards.some((r) => !r.is_active))
  const open1 = await page.locator('.parents .vouchers li').allInnerTexts()
  ok('Eltern: 2 offene Gutscheine mit Kindername', open1.length === 2 && open1.some((x) => x.includes('Ben ·')) && open1.some((x) => x.includes('Lia ·')), open1.join(' | '))
  const rows = await page.locator('.parents .list.rewards .row:not(.add-row)').allInnerTexts()
  ok('Eltern: alle 5 Belohnungen, pausierte markiert', rows.length === 5 && rows.find((x) => x.includes('Pausiert-Pizza'))?.includes('Pausiert'), rows.join(' | '))
  ok('Eltern: „Alle Kinder“ bzw. Kindername je Belohnung', rows.find((x) => x.includes('Ben-Lego'))?.includes('Ben') && rows.find((x) => x.includes('Ein Eis'))?.includes('Alle Kinder'), rows.join(' | '))

  // Erledigt
  srv.calls.length = 0
  await page.locator('.parents .vouchers li', { hasText: 'Alter Gutschein' }).getByRole('button', { name: 'Erledigt' }).click()
  await wait(400)
  const rs = callsOf(srv, 'bc_redemption_resolve')[0]?.args ?? {}
  ok('Erledigt: bc_redemption_resolve(p_code, p_token, p_id, erledigt)', JSON.stringify(Object.keys(rs).sort()) === '["p_code","p_id","p_status","p_token"]' && rs.p_id === VC(1) && rs.p_status === 'erledigt' && rs.p_token === TOKEN && rs.p_code === CODE, JSON.stringify(rs))
  ok('Erledigt: danach bc_pull, Gutschein weg', srv.calls.at(-1)?.fn === 'bc_pull' && (await page.locator('.parents .vouchers li', { hasText: 'Alter Gutschein' }).count()) === 0)

  // Stornieren mit roter Rückfrage
  srv.calls.length = 0
  await page.locator('.parents .vouchers li', { hasText: 'Ben-Gutschein' }).getByRole('button', { name: 'Stornieren' }).click()
  await formSheet(page).waitFor()
  const stTxt = await formSheet(page).innerText()
  ok('Storno: Rückfrage nennt Gutschein, Kind und Sterne', stTxt.includes('Ben-Gutschein') && stTxt.includes('Ben') && /\b7 Sterne/.test(stTxt), stTxt)
  const sbg = await formSheet(page).locator('.btn.danger').evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('Storno: roter Knopf', /rgb\(179, 38, 30\)|rgb\(255, 138, 128\)/.test(sbg), sbg)
  await page.screenshot({ path: join(SHOTS, 'eltern-storno-iphone.png') })
  await formSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  ok('Storno: Abbrechen sendet nichts', callsOf(srv, 'bc_redemption_resolve').length === 0)
  await page.locator('.parents .vouchers li', { hasText: 'Ben-Gutschein' }).getByRole('button', { name: 'Stornieren' }).click()
  await formSheet(page).locator('.btn.danger').click()
  await wait(400)
  const sc = callsOf(srv, 'bc_redemption_resolve')[0]?.args
  ok('Storno: p_status storniert, p_id', sc?.p_status === 'storniert' && sc?.p_id === VC(4), JSON.stringify(sc))
  ok('Storno: Liste leer (vouchersEmpty)', (await mgr(page).innerText()).includes(T('vouchersEmpty')))

  // Neue Belohnung: Validierung
  srv.calls.length = 0
  await page.getByRole('button', { name: 'Belohnung hinzufügen' }).click()
  await formSheet(page).waitFor()
  const inputs = formSheet(page).locator('label.field input')
  const name = inputs.nth(0)
  const cost = inputs.nth(1)
  const save = formSheet(page).getByRole('button', { name: 'Speichern' })
  const alertTxt = async () => (await formSheet(page).locator('[role=alert]').innerText().catch(() => '')).trim()
  await name.fill('   ')
  await save.click()
  ok('Neu: nur Leerzeichen -> Namensfehler', (await alertTxt()) === T('errRewardTitle'), await alertTxt())
  await name.fill('x'.repeat(61))
  ok('Neu: Name höchstens 60 Zeichen', (await name.inputValue()).length === 60)
  await name.fill('  Zoo-Besuch  ')
  await cost.fill('abc')
  ok('Neu: Sterne-Feld nimmt keine Buchstaben (leer)', (await cost.inputValue()) === '', await cost.inputValue())
  await save.click()
  ok('Neu: leere Sterne -> Sterne-Fehler', (await alertTxt()) === T('errRewardCost'), await alertTxt())
  await cost.fill('0')
  await save.click()
  ok('Neu: 0 Sterne -> Sterne-Fehler', (await alertTxt()) === T('errRewardCost'))
  await cost.fill('100001')
  await save.click()
  ok('Neu: 100001 Sterne -> Sterne-Fehler', (await alertTxt()) === T('errRewardCost'))
  await cost.fill('-5')
  ok('Neu: Minus wird entfernt', (await cost.inputValue()) === '5', await cost.inputValue())
  await cost.fill('12a3')
  ok('Neu: nur Ziffern bleiben (12a3 -> 123)', (await cost.inputValue()) === '123', await cost.inputValue())
  ok('Neu: bis hier kein bc_reward_save', callsOf(srv, 'bc_reward_save').length === 0)
  await formSheet(page).locator('.reward-costs button', { hasText: '300' }).click()
  ok('Neu: Vorschlag 300 übernimmt Wert', (await cost.inputValue()) === '300' && (await formSheet(page).locator('.reward-costs button[aria-pressed=true]').innerText()).trim() === '300')
  await formSheet(page).locator('.reward-icons input[value=film]').check({ force: true })
  ok('Neu: „Für“-Auswahl bei 2 Kindern', (await formSheet(page).locator('#reward-for-l').count()) === 1)
  await formSheet(page).locator('.seg label', { hasText: 'Ben' }).click()
  await page.screenshot({ path: join(SHOTS, 'eltern-neu-iphone.png') })
  ok('Neu iPhone: Sheet ohne seitliches Scrollen', await noHScroll(page))
  await save.click()
  await wait(400)
  const sv = callsOf(srv, 'bc_reward_save')[0]?.args ?? {}
  ok('Neu: bc_reward_save mit allen 8 Argumenten', JSON.stringify(Object.keys(sv).sort()) === '["p_code","p_cost_stars","p_icon","p_id","p_is_active","p_profile_id","p_title","p_token"]', JSON.stringify(sv))
  ok('Neu: Werte (id null, Ben, getrimmt, film, 300 als Zahl, aktiv)', sv.p_id === null && sv.p_profile_id === KID2 && sv.p_title === 'Zoo-Besuch' && sv.p_icon === 'film' && sv.p_cost_stars === 300 && sv.p_is_active === true && sv.p_token === TOKEN, JSON.stringify(sv))
  ok('Neu: Sheet zu, Zeile da', (await formSheet(page).count()) === 0 && (await page.locator('.parents .list.rewards .row', { hasText: 'Zoo-Besuch' }).count()) === 1)

  // Bearbeiten: pausieren
  srv.calls.length = 0
  await page.getByRole('button', { name: 'Belohnung bearbeiten: Ein Eis' }).click()
  await formSheet(page).waitFor()
  ok('Bearbeiten: Werte vorbelegt', (await formSheet(page).locator('label.field input').nth(0).inputValue()) === 'Ein Eis' && (await formSheet(page).locator('label.field input').nth(1).inputValue()) === '30')
  await formSheet(page).locator('.seg label', { hasText: 'Pausiert' }).click()
  await formSheet(page).getByRole('button', { name: 'Speichern' }).click()
  await wait(400)
  const ed = callsOf(srv, 'bc_reward_save')[0]?.args ?? {}
  ok('Pausieren: p_id Eis, p_is_active false, „Alle Kinder“ bleibt null', ed.p_id === RW(1) && ed.p_is_active === false && ed.p_profile_id === null && ed.p_cost_stars === 30, JSON.stringify(ed))
  ok('Pausieren: localStorage ohne Eis (pausiert)', !(await lsPull(page)).rewards.some((r) => r.id === RW(1) || !r.is_active))

  // Löschen mit roter Rückfrage
  srv.calls.length = 0
  await page.getByRole('button', { name: 'Belohnung bearbeiten: Lia-Buch' }).click()
  await formSheet(page).getByRole('button', { name: 'Belohnung löschen' }).click()
  await wait(150)
  ok('Löschen: Rückfrage mit Titel', (await formSheet(page).innerText()).includes('„Lia-Buch“'))
  const dbg = await formSheet(page).locator('.btn.danger').evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('Löschen: roter Knopf', /rgb\(179, 38, 30\)|rgb\(255, 138, 128\)/.test(dbg), dbg)
  await formSheet(page).getByRole('button', { name: 'Abbrechen' }).click()
  await wait(150)
  ok('Löschen: Abbrechen sendet nichts, Formular wieder da', callsOf(srv, 'bc_reward_delete').length === 0 && (await formSheet(page).locator('form.reward-form').count()) === 1)
  await formSheet(page).getByRole('button', { name: 'Belohnung löschen' }).click()
  await formSheet(page).getByRole('button', { name: 'Löschen', exact: true }).click()
  await wait(400)
  const dl = callsOf(srv, 'bc_reward_delete')[0]?.args ?? {}
  ok('Löschen: bc_reward_delete(p_code, p_token, p_id)', JSON.stringify(Object.keys(dl).sort()) === '["p_code","p_id","p_token"]' && dl.p_id === RW(3) && dl.p_token === TOKEN, JSON.stringify(dl))
  ok('Löschen: Zeile weg, Sheets zu', (await page.locator('.parents .list.rewards .row', { hasText: 'Lia-Buch' }).count()) === 0 && (await formSheet(page).count()) === 0)

  // Höchstzahl
  srv.rewardLimit = srv.data.rewards.length
  await page.getByRole('button', { name: 'Belohnung hinzufügen' }).click()
  await formSheet(page).locator('label.field input').nth(0).fill('Noch eine')
  await formSheet(page).getByRole('button', { name: 'Speichern' }).click()
  await wait(400)
  ok('Höchstzahl: Meldung errLimit', (await alertTxt()) === T('errLimit'), await alertTxt())
  ok('Server: nie ungültige Werte erhalten', !srv.invalid, String(srv.invalid))

  // Freischaltung abgelaufen: zurück zur PIN
  srv.tokenExpired = true
  srv.calls.length = 0
  await formSheet(page).getByRole('button', { name: 'Speichern' }).click()
  await page.locator('.pin').waitFor({ timeout: 2000 }).catch(() => {})
  ok('pin_required: zurück zur PIN-Tastatur', (await page.locator('.pin').count()) === 1 && (await formSheet(page).count()) === 0)
  ok('pin_required: danach bc_pull ohne Token', srv.calls.some((c) => c.fn === 'bc_pull' && c.args.p_token === null))
  await wait(300)
  ok('Nach Sperre: keine pausierten Belohnungen im localStorage', !(await lsPull(page)).rewards.some((r) => !r.is_active) && (await lsPull(page)).parent === false)
  srv.tokenExpired = false

  // Sperren-Knopf
  await pin(page, '2468')
  await page.locator('.parents .list.rewards').waitFor({ timeout: 3000 })
  for (const [size] of Object.entries(SIZES)) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(SIZES[size])
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      await wait(100)
      ok(`Eltern-Shop ${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
      await page.locator('.parents .list.rewards').screenshot({ path: join(SHOTS, `eltern-shop-${size}-${theme}.png`) })
    }
  }
  await page.setViewportSize(SIZES.iphone)
  await page.getByRole('button', { name: 'Sperren', exact: true }).click()
  await wait(500)
  ok('Sperren: keine pausierten Belohnungen im localStorage', !(await lsPull(page)).rewards.some((r) => !r.is_active))
  await ctx.close()
}
{
  // Ein Kind, keine Belohnungen: Vorschläge, keine „Für“-Auswahl
  const srv = shopServer({ kids: 1, rewards: false })
  const { ctx, page } = await open({ storage: connected, srv })
  await page.locator('.home').waitFor()
  await unlock(page)
  ok('Leer: 3 Vorschläge', (await page.locator('.parents .reward-suggest button').count()) === 3)
  ok('Ein Kind: Gutschein ohne Kindername', !(await page.locator('.parents .vouchers li').first().innerText()).includes('Lia ·'))
  await page.locator('.parents .reward-suggest button', { hasText: 'Kinoabend' }).click()
  await formSheet(page).waitFor()
  ok('Vorschlag: Formular vorbelegt (Kinoabend, 300)', (await formSheet(page).locator('label.field input').nth(0).inputValue()) === 'Kinoabend' && (await formSheet(page).locator('label.field input').nth(1).inputValue()) === '300')
  ok('Ein Kind: keine „Für“-Auswahl', (await formSheet(page).locator('#reward-for-l').count()) === 0)
  ok('Neu: kein Pausieren-Schalter', (await formSheet(page).locator('input[name=reward-active]').count()) === 0)
  srv.calls.length = 0
  await formSheet(page).getByRole('button', { name: 'Speichern' }).click()
  await wait(400)
  const a = callsOf(srv, 'bc_reward_save')[0]?.args ?? {}
  ok('Vorschlag speichern: für alle, film, 300', a.p_profile_id === null && a.p_icon === 'film' && a.p_cost_stars === 300 && a.p_title === 'Kinoabend', JSON.stringify(a))
  await ctx.close()
}
{
  // Englisch: Shop und Eltern-Shop
  const srv = shopServer({ balance: 100 })
  const { ctx, page } = await open({ storage: connected, srv, lang: 'en' })
  await page.locator('.home').waitFor()
  await toShop(page)
  const GER = ['Sterne', 'Einlösen', 'Belohnung', 'Gutschein', 'Wartet', 'Eltern', 'Zurückgegeben', 'Noch ']
  const body = (await page.locator('.shop').innerText()).replace(/Ein Eis|Lia-Buch|Kinoabend|Alter Gutschein|Erledigt-Kakao|Storno-Spiel/g, '')
  ok('EN Shop: keine deutschen Wörter', GER.every((w) => !body.includes(w)), GER.filter((w) => body.includes(w)).join(','))
  ok('EN Shop: Datum en-GB', body.includes(`${new Date('2026-10-20T10:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`))
  srv.redeemFail = 'not_enough_stars'
  await item(page, 'Ein Eis').getByRole('button', { name: 'Redeem' }).click()
  await askSheet(page).getByRole('button', { name: 'Yes, redeem' }).click()
  await wait(300)
  ok('EN Shop: Fehlermeldung englisch', (await page.locator('.shop > [role=alert]').innerText()).trim() === T('errStars', 'en'))
  await page.locator('header .gear').click()
  await page.locator('dialog.settings[open]').getByText('Parent cockpit').first().click()
  await pin(page, '2468')
  await page.locator('.parents .vouchers').waitFor({ timeout: 3000 })
  const pb = (await page.locator('.parents').innerText()).replace(/Ein Eis|Lia-Buch|Kinoabend|Alter Gutschein|Ben-Gutschein|Ben-Lego|Pausiert-Pizza|Normal-Arbeit|Entwurf-Arbeit|Frage [a-z0-9]+\?/g, '')
  const GER2 = ['Gutschein', 'Belohnung', 'Erledigt', 'Stornieren', 'Alle Kinder', 'Pausiert', 'Sterne']
  ok('EN Eltern-Shop: keine deutschen Wörter', GER2.every((w) => !pb.includes(w)), GER2.filter((w) => pb.includes(w)).join(','))
  await ctx.close()
}

// =========================== 7. Arena: Spickzettel und Vorlesen ===========================
console.log('7. Arena: Spickzettel und Vorlesen')
const SLIDES = [
  { title: 'Verdunsten', content: 'Die Sonne erwärmt das Wasser. Es wird zu Wasserdampf, z. B. über dem Meer.', keywords: ['Sonne', 'Wasserdampf'] },
  { title: 'Kondensieren', content: 'Der Dampf kühlt ab, [NAME]. Es entstehen Wolken!', keywords: ['Wolken'] },
  { title: 'Ohne Schlüsselwörter', content: 'Nur Text.', keywords: [] },
]
// Frage-ID -> [unit_id, slide_index]; Spickzettel nur, wenn es die Folie wirklich gibt
const SPICK = {
  k0: ['u1', 0], k1: ['u1', 1], k2: ['u1', 9], k3: ['u-fehlt', 0], k4: ['u1', null], k5: [null, 0],
  k6: ['u1', -1], k7: ['u1', 2], k8: ['u1', 0], k10: ['u1', 0], k9: ['u1', 1],
}
const hasSlide = (id) => { const [u, i] = SPICK[id]; return u === 'u1' && Number.isInteger(i) && i >= 0 && i < SLIDES.length }
function spickServer() {
  const srv = makeServer()
  const d = srv.data
  d.exams.push({ id: 'eK', title: 'Spick-Arbeit', exam_date: day(20), profile_id: KID, subject_id: 's', is_archived: false })
  d.units = [{ id: 'u1', exam_id: 'eK', summary_slides: SLIDES }]
  // u-fehlt gilt als gesehen, existiert aber nicht (z. B. gelöscht): Frage spielbar, aber ohne Folie
  d.unit_views = ['u1', 'u-fehlt'].map((u) => ({ profile_id: KID, unit_id: u, seen_at: new Date().toISOString() }))
  for (const [id, [u, i]] of Object.entries(SPICK)) {
    const q = id === 'k8'
      ? { id, exam_id: 'eK', status: 'freigegeben', type: 'word_clicker', prompt: `Frage ${id}?`, payload: { sentence_with_gap: 'Das Wasser [GAP] im Meer.', correct_word: `R-${id}`, distractors: [`F1-${id}`, `F2-${id}`] } }
      : { ...mc(id, 'eK'), prompt: id === 'k1' ? `Frage ${id}? Weißt du es, [NAME]?` : `Frage ${id}?` }
    q.unit_id = u
    q.slide_index = i
    d.questions.push(q)
  }
  // k9 ist bekannt (Stufe 3, nicht fällig): nicht in der Runde, aber Kandidat für die Notbremse
  d.progress.push({ profile_id: KID, question_id: 'k9', leitner_box: 3, next_review_at: later, consecutive_correct: 2 })
  return srv
}
const tts = (p) => p.evaluate(() => window.__tts.log.slice())
const ttsMark = (p) => p.evaluate(() => window.__tts.log.length)
const ttsSince = async (p, n) => (await tts(p)).slice(n)
const spoken = (log) => log.filter((x) => x.t === 'speak').map((x) => x.text)
const drain = (p) => p.evaluate(() => window.__ttsDrain())
const cheatBtn = (p) => p.locator('.a-cheat')
const cheatSheet = (p) => p.locator('dialog.confirm[open] .a-cheatsheet')
const opts = (p) => card(p).locator('.g-btn')
const tapOpt = (p, t) => opts(p).filter({ hasText: new RegExp(`^\\s*${t}\\s*$`) }).first().click({ force: true })
async function qInfo(p) {
  const texts = (await opts(p).allTextContents()).map((x) => x.trim())
  const right = texts.find((x) => x.startsWith('R-'))
  return { id: right.slice(2), right, wrong: texts.filter((x) => x.startsWith('F')) }
}
async function startSpick(o = {}) {
  const srv = spickServer()
  const r = await open({ storage: connected, srv, ...o })
  await r.page.locator('.exam-row', { hasText: 'Spick-Arbeit' }).click()
  await r.page.locator('.arena .a-card').waitFor()
  await wait(100)
  return r
}
{
  const { ctx, page, srv } = await startSpick({ raw: { 'braincraft:speech': 'auto' }, tts: 'fake' })
  const played = []
  let normalPos = 0
  let lastNext = 0
  for (let i = 0; i < 30; i++) {
    if (await page.locator('.a-end').count()) break
    const note = (await page.locator('.a-note').count()) ? (await page.locator('.a-note').first().innerText()).trim() : ''
    const kind = note === T('repeatIntro') ? 'repeat' : note === T('rescueIntro') ? 'rescue' : 'normal'
    const { id, right, wrong } = await qInfo(page)
    const how = kind !== 'normal' ? 'late' : normalPos < 2 ? 'reveal' : (id === 'k7' || id === 'k10') ? 'right' : 'late'
    if (kind === 'normal') normalPos++
    const tag = `${kind} ${id}`

    // Vorlesen „Automatisch“: neue Frage wird gelesen (vorher Stopp der alten)
    const said = await ttsSince(page, lastNext)
    const q = srv.data.questions.find((x) => x.id === id)
    await drain(page)
    const full = spoken(await ttsSince(page, lastNext))
    const expSay = q.type === 'word_clicker' ? [q.prompt, 'Das Wasser … im Meer.'] : [...q.prompt.replace('[NAME]', 'Lia').split(/(?<=\?)\s+/), ...q.payload.options]
    ok(`Auto-Vorlesen ${tag}: Frage${q.type === 'word_clicker' ? ' + Lückensatz mit …' : ' + Optionen'}`, JSON.stringify(full) === JSON.stringify(expSay), JSON.stringify(full))
    if (i > 0) ok(`Auto-Vorlesen ${tag}: vorher gestoppt (cancel vor dem 1. Satz)`, said[0]?.t === 'cancel', JSON.stringify(said.slice(0, 2)))

    ok(`Spick ${tag}: vor dem 1. Fehler kein Knopf`, (await cheatBtn(page).count()) === 0)
    const callsBefore = srv.calls.length
    if (how === 'right') {
      await tapOpt(page, right)
    } else {
      await tapOpt(page, wrong[0])
      await wait(100)
      ok(`Spick ${tag}: nach 1. Fehler Knopf ${hasSlide(id) ? 'da' : 'nicht da'}`, (await cheatBtn(page).count()) === (hasSlide(id) ? 1 : 0))
      if (hasSlide(id)) {
        const sl = SLIDES[SPICK[id][1]]
        ok(`Spick ${tag}: Knopf-Beschriftung aus i18n`, (await cheatBtn(page).innerText()).trim() === T('cheat'))
        const m = await ttsMark(page)
        await cheatBtn(page).click()
        await cheatSheet(page).waitFor({ timeout: 2000 })
        ok(`Spick ${tag}: Öffnen stoppt Vorlesen`, (await ttsSince(page, m)).some((x) => x.t === 'cancel'))
        const txt = await cheatSheet(page).innerText()
        ok(`Spick ${tag}: Spielphase nur Titel + cheatTitleOnly`, (await cheatSheet(page).locator('h2').innerText()).trim() === sl.title && txt.includes(T('cheatTitleOnly')) && !txt.includes(sl.content.slice(0, 12).replace('[NAME]', 'Lia')), txt)
        const m2 = await ttsMark(page)
        await cheatSheet(page).getByRole('button', { name: T('readAloud') }).click()
        await drain(page)
        ok(`Spick ${tag}: Vorlesen liest nur den Titel`, JSON.stringify(spoken(await ttsSince(page, m2))) === JSON.stringify([`${sl.title}.`]), JSON.stringify(spoken(await ttsSince(page, m2))))
        const m3 = await ttsMark(page)
        await cheatSheet(page).getByRole('button', { name: T('cheatBack'), exact: true }).click()
        await wait(150)
        ok(`Spick ${tag}: „Weiter knobeln“ schließt und stoppt`, (await cheatSheet(page).count()) === 0 && (await ttsSince(page, m3)).some((x) => x.t === 'cancel'))
      }
      await unlocked(page)
      if (how === 'late') await tapOpt(page, right)
      else {
        await tapOpt(page, wrong[1])
        await wait(100)
        ok(`Spick ${tag}: nach Aufdecken Knopf ${hasSlide(id) ? 'da' : 'nicht da'}`, (await cheatBtn(page).count()) === (hasSlide(id) ? 1 : 0))
        if (hasSlide(id)) {
          const sl = SLIDES[SPICK[id][1]]
          await cheatBtn(page).click()
          await cheatSheet(page).waitFor({ timeout: 2000 })
          const txt = await cheatSheet(page).innerText()
          const content = sl.content.replace('[NAME]', 'Lia')
          ok(`Spick ${tag}: aufgedeckt Folientext mit Namen`, txt.includes(content) && !txt.includes(T('cheatTitleOnly')), txt)
          const bold = (await cheatSheet(page).locator('b').allInnerTexts()).map((x) => x.trim())
          ok(`Spick ${tag}: Schlüsselwörter fett`, JSON.stringify(bold) === JSON.stringify(sl.keywords), JSON.stringify(bold))
          const m2 = await ttsMark(page)
          await cheatSheet(page).getByRole('button', { name: T('readAloud') }).click()
          await drain(page)
          const exp = id === 'k0' || id === 'k10' || id === 'k8' ? ['Verdunsten.', 'Die Sonne erwärmt das Wasser.', 'Es wird zu Wasserdampf, z. B. über dem Meer.']
            : id === 'k1' || id === 'k9' ? ['Kondensieren.', 'Der Dampf kühlt ab, Lia.', 'Es entstehen Wolken!'] : ['Ohne Schlüsselwörter.', 'Nur Text.']
          ok(`Spick ${tag}: Vorlesen liest Titel + ganzen Text`, JSON.stringify(spoken(await ttsSince(page, m2))) === JSON.stringify(exp), JSON.stringify(spoken(await ttsSince(page, m2))))
          if (normalPos === 1) {
            for (const [size] of Object.entries(SIZES)) {
              for (const theme of ['light', 'dark']) {
                await page.setViewportSize(SIZES[size])
                await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
                await wait(120)
                const box = await cheatSheet(page).evaluate((e) => { const r = e.closest('dialog').getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom] })
                const vp = SIZES[size]
                ok(`Spickzettel ${size} ${theme}: kein seitliches Scrollen, Sheet im Bild`, (await noHScroll(page)) && box[0] >= 0 && box[1] <= vp.width + 0.5 && box[2] >= 0 && box[3] <= vp.height + 0.5, JSON.stringify(box))
                await page.screenshot({ path: join(SHOTS, `spick-${size}-${theme}.png`) })
              }
            }
            await page.setViewportSize(SIZES.iphone)
            await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
          }
          const m3 = await ttsMark(page)
          await page.keyboard.press('Escape')
          await wait(150)
          ok(`Spick ${tag}: Esc schließt und stoppt`, (await cheatSheet(page).count()) === 0 && (await ttsSince(page, m3)).some((x) => x.t === 'cancel'))
          // Erneut öffnen und wieder schließen geht
          await cheatBtn(page).click()
          ok(`Spick ${tag}: lässt sich erneut öffnen`, await cheatSheet(page).isVisible().catch(() => false))
          ok(`Spick ${tag}: aufgedeckt heißt der Knopf cheatBackRevealed`, (await cheatSheet(page).getByRole('button', { name: T('cheatBackRevealed'), exact: true }).count()) === 1 && (await cheatSheet(page).getByRole('button', { name: T('cheatBack'), exact: true }).count()) === 0)
          await cheatSheet(page).getByRole('button', { name: T('cheatBackRevealed'), exact: true }).click()
          await wait(100)
        }
      }
    }
    await page.locator('.a-next').waitFor({ timeout: 3000 })
    ok(`Spick ${tag}: nach ${how === 'reveal' ? 'Aufdecken' : 'Lösen'} Knopf ${how === 'reveal' && hasSlide(id) ? 'da' : 'weg'}`, (await cheatBtn(page).count()) === (how === 'reveal' && hasSlide(id) ? 1 : 0))
    ok(`Spick ${tag}: Spickzettel löst keine Anfrage aus`, srv.calls.slice(callsBefore).every((c) => c.fn === 'bc_answer'), srv.calls.slice(callsBefore).map((c) => c.fn).join(','))
    played.push({ id, kind, how })
    lastNext = await ttsMark(page)
    await page.locator('.a-next').click()
    await wait(120)
  }
  await page.locator('.a-end').waitFor({ timeout: 3000 }).catch(() => {})
  await wait(600)
  const normal = played.filter((x) => x.kind === 'normal')
  ok('Spick-Runde: 10 normale, Notbremse k9 und 2 Wiederholungen', normal.length === 10 && played.some((x) => x.kind === 'rescue' && x.id === 'k9') && played.filter((x) => x.kind === 'repeat').length === 2, JSON.stringify(played))
  ok('Spick-Runde: Wiederholung/Notbremse mit Folie zeigen den Spickzettel (oben je Frage geprüft)', played.some((x) => x.kind !== 'normal' && hasSlide(x.id)))
  const exp = normal.map((x) => ({ q: x.id, c: x.how !== 'reveal', f: x.how === 'right' }))
  const got = answersOf(srv).map((x) => ({ q: x.args.p_question_id, c: x.args.p_correct, f: x.args.p_first_try }))
  ok('Spick-Runde: bc_answer unverändert (correct = nicht aufgedeckt, first_try nur ohne Fehler)', JSON.stringify(exp) === JSON.stringify(got), `${JSON.stringify(exp)} / ${JSON.stringify(got)}`)
  const stars = normal.filter((x) => x.how === 'right').length + 3
  ok(`Spick-Runde: Truhe +${stars} Sterne (1 je Erstversuch + 3 Bonus)`, (await page.locator('.a-stars .num').innerText().catch(() => '')).trim() === `+${stars}`, await page.locator('.a-stars').innerText().catch(() => ''))
  const tail = await ttsSince(page, lastNext)
  ok('Rundenende: Vorlesen gestoppt, nichts Neues gesprochen', tail.length > 0 && tail.every((x) => x.t === 'cancel'), JSON.stringify(tail))
  await ctx.close()
}
{
  // „Auf Tipp“: kein automatisches Vorlesen, Lautsprecher startet und stoppt; Beenden stoppt
  const { ctx, page } = await startSpick({ raw: { 'braincraft:speech': 'tap' }, tts: 'fake' })
  ok('Auf Tipp: nichts automatisch gesprochen', spoken(await tts(page)).length === 0)
  const say = page.locator('.a-say')
  ok('Auf Tipp: Lautsprecher-Knopf mit Beschriftung readQuestion', (await say.count()) === 1 && (await say.getAttribute('aria-label')) === T('readQuestion'))
  const sz = await say.evaluate((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height])
  ok('Auf Tipp: Lautsprecher mind. 44 × 44 px', sz[0] >= 44 && sz[1] >= 44, JSON.stringify(sz))
  await say.click()
  ok('Auf Tipp: Tipp liest vor, Knopf zeigt Stopp', spoken(await tts(page)).length === 1 && (await say.getAttribute('aria-pressed')) === 'true' && (await say.getAttribute('aria-label')) === T('pause'))
  const m = await ttsMark(page)
  await say.click()
  ok('Auf Tipp: 2. Tipp stoppt', (await ttsSince(page, m)).some((x) => x.t === 'cancel') && (await say.getAttribute('aria-pressed')) === 'false')
  await say.click()
  await drain(page)
  ok('Auf Tipp: nach Ende Knopf wieder „Frage vorlesen“', (await say.getAttribute('aria-pressed')) === 'false')
  await say.click()
  const m2 = await ttsMark(page)
  await page.locator('.a-top .x').click()
  await wait(200)
  ok('Beenden (X): Vorlesen gestoppt', (await ttsSince(page, m2)).some((x) => x.t === 'cancel') && (await page.locator('.arena').count()) === 0)
  await ctx.close()
}
for (const mode of ['off', 'none']) {
  // „Aus“ bzw. Browser ohne Sprachausgabe: kein Lautsprecher, Spickzettel ohne „Vorlesen“
  const { ctx, page, srv } = await startSpick(mode === 'off' ? { raw: { 'braincraft:speech': 'auto' === 'x' ? '' : 'off' }, tts: 'fake' } : { raw: { 'braincraft:speech': 'auto' }, tts: 'none' })
  const tag = mode === 'off' ? 'Einstellung Aus' : 'ohne speechSynthesis'
  if (mode === 'none') ok(`${tag}: Vorbedingung speechSynthesis fehlt`, !(await page.evaluate(() => 'speechSynthesis' in window)))
  ok(`${tag}: kein Lautsprecher-Knopf`, (await page.locator('.a-say').count()) === 0)
  if (mode === 'off') ok(`${tag}: nichts gesprochen`, spoken(await tts(page)).length === 0)
  // Frage mit Folie suchen (höchstens 10 Fragen weiter)
  for (let i = 0; i < 12; i++) {
    const { id, right, wrong } = await qInfo(page)
    if (hasSlide(id)) {
      await tapOpt(page, wrong[0])
      await cheatBtn(page).click()
      await cheatSheet(page).waitFor({ timeout: 2000 })
      ok(`${tag}: Spickzettel ohne „Vorlesen“`, (await cheatSheet(page).getByRole('button', { name: T('readAloud') }).count()) === 0 && (await cheatSheet(page).getByRole('button', { name: T('cheatBack') }).count()) === 1)
      await cheatSheet(page).getByRole('button', { name: T('cheatBack') }).click()
      break
    }
    await tapOpt(page, right)
    await page.locator('.a-next').click()
    await wait(100)
  }
  void srv
  await ctx.close()
}
{
  // Probemodus: kein Spickzettel
  const { ctx, page } = await open({ tts: 'fake' })
  await page.getByText('Erst ausprobieren').click()
  await page.locator('.quickbtn').first().click()
  await page.locator('.arena .a-card').waitFor()
  let seen = 0
  for (let i = 0; i < 4; i++) {
    const b = card(page).locator('.g-btn')
    if (!(await b.count())) break
    await b.first().click({ force: true }).catch(() => {})
    await wait(150)
    seen += await cheatBtn(page).count()
    await page.locator('.a-top .x').count()
  }
  ok('Probemodus: nie ein Spickzettel-Knopf', seen === 0)
  await ctx.close()
}
{
  // Englisch: Spickzettel-Texte
  const { ctx, page } = await startSpick({ lang: 'en', raw: { 'braincraft:speech': 'tap' }, tts: 'fake' })
  for (let i = 0; i < 12; i++) {
    const { id, right, wrong } = await qInfo(page)
    if (hasSlide(id)) {
      await tapOpt(page, wrong[0])
      ok('EN Spick: Knopf englisch', (await cheatBtn(page).innerText()).trim() === T('cheat', 'en'))
      await cheatBtn(page).click()
      await cheatSheet(page).waitFor({ timeout: 2000 })
      const txt = await cheatSheet(page).innerText()
      ok('EN Spick: Sheet englisch', txt.toLowerCase().includes(T('cheatTitle', 'en').toLowerCase()) && txt.includes(T('cheatTitleOnly', 'en')) && txt.includes(T('cheatBack', 'en')) && txt.includes(T('readAloud', 'en')), txt)
      ok('EN Spick: Lautsprecher-Beschriftung englisch', (await page.locator('.a-say').getAttribute('aria-label')) === T('readQuestion', 'en'))
      break
    }
    await tapOpt(page, right)
    await page.locator('.a-next').click()
    await wait(100)
  }
  await ctx.close()
}

// =========================== Abschluss ===========================
ok('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 8).join(' | '))
ok('Keine Anfrage an fremde Adressen (alles abgefangen)', foreign.length === 0, foreign.slice(0, 5).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} bestanden`)
for (const f of failed) console.log('FEHLER:', f.name, '|', f.detail)
process.exit(failed.length ? 1 : 0)
