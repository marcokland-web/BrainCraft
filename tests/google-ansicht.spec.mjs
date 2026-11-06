// Bug-Bodo 04.11.2026: Ansicht der Google-Anmeldung in 3 Größen × hell/dunkel × DE/EN (Helfer aus store.spec.mjs).
// Bug-Bodo: Ablauf-Test der Datenanbindung (Anmeldung mit Google, Setup, Start, Warteschlange, Eltern-Cockpit)
// mit FAKE-Server. Alle Anfragen an Supabase (RPC und Auth) werden per context.route abgefangen, Google wird
// über tests/fake-auth.mjs nachgestellt; Service Worker ist blockiert.
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
import { authRoute, bearerOk, FAMILY, signedIn, USER } from './fake-auth.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PW = process.env.PLAYWRIGHT_DIR ?? join(homedir(), 'Apps/DasTeam/tools/node_modules/playwright')
const pw = createRequire(import.meta.url)(PW)
const BASE = process.env.BASE ?? 'http://localhost:8797/BrainCraft/'
const SHOTS = process.env.SHOTS ?? join(ROOT, 'tests/.shots/google-ansicht')
mkdirSync(SHOTS, { recursive: true })
const SIZES = { iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(cond ? '  ok   ' : '  FEHLER', name, cond ? '' : detail) }
const consoleErrors = []
const befunde = []
const befund = (name, cond, detail = '') => { befunde.push({ name, fixed: !!cond }); console.log(cond ? '  BEHOBEN (auf ok umstellen)' : '  BEFUND', name, cond ? '' : detail) }
const foreign = []

// ---------- Fake-Daten ----------
const KID = '11111111-1111-4111-8111-111111111111'
const KID2 = '22222222-2222-4222-8222-222222222222'
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
    family_id: FAMILY, today: day(0), parent: false,
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
  // family: Familie des angemeldeten Kontos (null = Konto ohne Familie); auth: Optionen für fake-auth (deny, log)
  const srv = { calls: [], down: false, data: basePull(), pullDelay: 0, family: FAMILY, auth: { log: [] }, invites: [], myInvites: [],
    devices: new Map(), pairCodes: new Map(), legacyCodes: new Set(['ABCD-EFGH-JKMN-PQRS-TUVW']) }
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
    // Kinder-Gerät: Token im Header x-bc-device, ohne Google-Sitzung (Migration 007)
    const devTok = req.headers()['x-bc-device']
    const dev = devTok ? srv.devices.get(devTok) : null
    const newToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (fn === 'bc_pair_redeem') {
      const c = String(args.p_pair_code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const name = srv.pairCodes.get(c)
      if (!name) return reply({ ok: false, error: 'pair_invalid' })
      srv.pairCodes.delete(c)
      const tok = newToken()
      srv.devices.set(tok, { family: srv.pairFamily ?? FAMILY, name, revoked: false })
      return reply({ ok: true, device_token: tok, device_id: `dev-${srv.devices.size}`, family_id: srv.pairFamily ?? FAMILY, name })
    }
    if (fn === 'bc_device_from_code') {
      if (srv.legacyGone) return reply({ code: 'PGRST202', message: 'Could not find the function' }, 404)
      if (!srv.legacyCodes.has(args.p_code)) return reply({ ok: false, error: 'pair_invalid' })
      const tok = newToken()
      srv.devices.set(tok, { family: FAMILY, name: 'Altes Gerät', revoked: false })
      return reply({ ok: true, device_token: tok, device_id: 'dev-alt', family_id: FAMILY })
    }
    if (devTok) {
      if (!dev) return fail('device_unknown')
      if (dev.revoked) return fail('device_revoked')
      if (route.request().headers().authorization) return fail('device_with_google')
      if (/^bc_(session|my_invites|invite_|family_create|parents|parent_invite|parent_remove|pair_create|devices|device_revoke)/.test(fn)) return reply({ code: '42501', message: `permission denied for function ${fn}` }, 401)
      if (fn === 'bc_device_hello') return reply({ family_id: dev.family, name: dev.name })
      if (fn === 'bc_device_leave') { dev.revoked = true; return reply(true) }
    } else if (!bearerOk(route)) return reply({ code: '42501', message: `permission denied for function ${fn}` }, 401)
    if ('p_code' in args) return fail('p_code_not_expected')
    if (fn === 'bc_pair_create') {
      if (args.p_token !== TOKEN) return fail('pin_required')
      const code = 'ABCDE' + String(10000 + srv.pairCodes.size).slice(-5).replace(/[01]/g, 'X')
      srv.pairCodes.set(code, args.p_name)
      return reply({ code: `${code.slice(0, 5)}-${code.slice(5)}`, expires_at: new Date(Date.now() + 600000).toISOString() })
    }
    if (fn === 'bc_devices') {
      if (args.p_token !== TOKEN) return fail('pin_required')
      return reply([...srv.devices.entries()].map(([tok, d], i) => ({ id: `dev-${i}`, tok, name: d.name, created_at: later, last_seen_at: later, revoked_at: d.revoked ? later : null })))
    }
    if (fn === 'bc_device_revoke') {
      if (args.p_token !== TOKEN) return fail('pin_required')
      const e = [...srv.devices.values()][Number(String(args.p_device_id).split('-')[1])]
      if (!e) return fail('not_found')
      e.revoked = true
      return reply(true)
    }
    if (fn === 'bc_session') return reply({ family_id: srv.family })
    if (fn === 'bc_my_invites') return reply(srv.family ? [] : srv.myInvites)
    if (fn === 'bc_invite_accept') {
      if (!srv.myInvites.some((i) => i.family_id === args.p_family_id)) return fail('invite_not_found')
      srv.family = args.p_family_id
      srv.myInvites = []
      return reply({ family_id: srv.family })
    }
    if (fn === 'bc_invite_decline') {
      srv.myInvites = srv.myInvites.filter((i) => i.family_id !== args.p_family_id)
      return reply(true)
    }
    if (fn === 'bc_family_create') {
      if (!/^[0-9]{4}$/.test(args.p_pin ?? '')) return fail('bad_pin')
      if (srv.family) return fail('has_family')
      srv.family = FAMILY
      return reply({ family_id: FAMILY, profile_id: KID })
    }
    const known = !!srv.family
    if (!known) return fail('no_family')
    switch (fn) {
      case 'bc_pull': {
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
      case 'bc_parents':
        if (args.p_token !== TOKEN) return fail('pin_required')
        return reply({ parents: [{ user_id: USER.id, email: USER.email, is_me: true, added_at: later }], invites: srv.invites })
      case 'bc_parent_invite':
        if (args.p_token !== TOKEN) return fail('pin_required')
        if (args.p_email === USER.email) return fail('already_parent')
        srv.invites.push({ email: args.p_email.toLowerCase(), created_at: later, expires_at: later })
        return reply({ ok: true, email: args.p_email })
      case 'bc_parent_invite_delete':
        if (args.p_token !== TOKEN) return fail('pin_required')
        srv.invites = srv.invites.filter((i) => i.email !== args.p_email)
        return reply(true)
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
    if (u.includes('.supabase.co/auth/v1/')) { if (srv.authHook) { const h = srv.authHook(route); if (h) return h } return srv.down ? route.abort('internetdisconnected') : authRoute(route, srv.auth) }
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
  // networkidle kann unter Last ausbleiben; die Prüfungen warten danach selbst auf ihre Elemente
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
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
const connected = signedIn({ 'braincraft:profile': KID })
const googleBtn = (page, lang = 'de') => page.getByRole('button', { name: lang === 'en' ? 'Sign in with Google' : 'Mit Google anmelden' })
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

// Messungen je Bildschirm
async function measure(page, label) {
  const m = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const top = document.querySelector('dialog[open]') ?? document
    const small = [...top.querySelectorAll('button, a[href], input:not([type=hidden]), [role=radio]')].filter(vis).filter((e) => !e.closest('.seg')).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } }).filter((x) => x.w < 44 || x.h < 44)
    const clipped = [...document.querySelectorAll('body *')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1 && ['hidden', 'clip'].includes(getComputedStyle(e).overflowX) && e.children.length === 0).map((e) => e.textContent.trim().slice(0, 30))
    const off = [...document.querySelectorAll('button, p, b, small, h1, h2, input')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1 }).map((e) => e.textContent.trim().slice(0, 30))
    const d = document.querySelector('dialog[open]')
    const dr = d?.getBoundingClientRect()
    return { hs: document.documentElement.scrollWidth > innerWidth + 1, small, clipped, off, primaries: [...document.querySelectorAll('.btn.primary')].filter(vis).length, dialog: dr ? { w: Math.round(dr.width), bottom: Math.round(innerHeight - dr.bottom) } : null, lang: document.documentElement.lang }
  })
  return { label, ...m }
}
const report = []
const SHOT = process.env.SHOTDIR ?? SHOTS
async function sweep(page, name, { fullPage = true } = {}) {
  for (const size of Object.keys(SIZES)) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(SIZES[size])
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), theme)
      await page.emulateMedia({ colorScheme: theme })
      await wait(150)
      const lang = await page.evaluate(() => document.documentElement.lang)
      const m = await measure(page, `${name} ${size} ${theme} ${lang}`)
      report.push(m)
            // lange Adressen brechen jetzt um (Bodo C5, behoben 05.11.2026)
      ok(`${m.label}: kein seitliches Scrollen, nichts außerhalb`, !m.hs && m.off.length === 0, `Seite ${m.hs ? 'zu breit' : 'ok'}, außerhalb: ${m.off.slice(0, 4).join(' | ')}`)
      ok(`${m.label}: Tippflächen ≥ 44 px`, m.small.length === 0, JSON.stringify(m.small))
      ok(`${m.label}: nichts abgeschnitten`, m.clipped.length === 0, JSON.stringify(m.clipped))
      ok(`${m.label}: höchstens ein Hauptknopf`, m.primaries <= 1, String(m.primaries))
      if (m.dialog && size !== 'iphone') ok(`${m.label}: Dialog ≤ 440 px`, m.dialog.w <= 440, JSON.stringify(m.dialog))
      // Screenshots sind Belege, keine Prüfung: unter Last notfalls ohne fullPage wiederholen
      const shotPath = join(SHOT, `${name}-${size}-${theme}-${lang}.png`)
      await page.screenshot({ path: shotPath, fullPage: fullPage && !m.dialog, timeout: 15000, animations: 'disabled' })
        .catch(() => page.screenshot({ path: shotPath, timeout: 30000, animations: 'disabled' }))
        .catch((e) => console.log('  (Screenshot übersprungen:', shotPath, e.message.split('\n')[0], ')'))
    }
  }
  await page.setViewportSize(SIZES.iphone)
}
async function openCockpit(page, lang) {
  await page.locator('header .gear').click()
  await page.locator('dialog.settings[open]').getByText(lang === 'en' ? 'Parent cockpit' : 'Eltern-Cockpit').first().click()
  await page.locator('.pin').waitFor()
}
async function pin(page, digits) {
  for (const d of digits) await page.locator('.pin-keys .key', { hasText: new RegExp(`^${d}$`) }).click()
  await wait(400)
}
const later2 = new Date(Date.now() + 14 * 86400000).toISOString()
for (const lang of ['de', 'en']) {
  // 1 Anmeldung, 2 „Google wird geöffnet …“, 3 Fehler
  {
    const srv = makeServer(); srv.family = null
    const { ctx, page } = await open({ srv, lang })
    await sweep(page, 'anmeldung')
    await ctx.close()
  }
  {
    const srv = makeServer(); srv.family = null
    srv.authHook = (route) => route.request().url().includes('grant_type=pkce') ? route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"code":500,"error_code":"unexpected_failure","msg":"x"}' }) : null
    const { ctx, page } = await open({ srv, lang })
    await googleBtn(page, lang).click({ noWaitAfter: true })
    await wait(1500)
    const a = await page.locator('[role=alert]').first().innerText().catch(() => '')
    ok(`Anmeldung Fehler 500 beim Code-Tausch ${lang}: Studio-Text`, a === (lang === 'en' ? "Sign-in didn't work. Please try again." : 'Anmelden hat nicht geklappt. Versuch es noch einmal.'), `„${a}“`)
    await sweep(page, 'anmeldung-fehler')
    await ctx.close()
  }
  // 4 Familie anlegen
  {
    const srv = makeServer(); srv.family = null
    const { ctx, page } = await open({ srv, lang })
    await googleBtn(page, lang).click({ noWaitAfter: true })
    await page.locator('form.setup-form').waitFor({ timeout: 5000 })
    await sweep(page, 'familie-anlegen')
    await ctx.close()
  }
  // 5 Einladung + Ablehnen-Rückfrage
  {
    const srv = makeServer(); srv.family = null
    srv.myInvites = [{ family_id: FAMILY, invited_by: 'grossmutter.mit.langem.namen@googlemail.com', created_at: later, expires_at: later }]
    const { ctx, page } = await open({ srv, lang })
    await googleBtn(page, lang).click({ noWaitAfter: true })
    await page.locator('.setup-invite').waitFor({ timeout: 5000 })
    await sweep(page, 'einladung')
    await page.locator('.setup-invite').getByRole('button', { name: lang === 'en' ? 'Decline' : 'Ablehnen' }).click()
    await page.locator('dialog.confirm[open]').waitFor()
    await sweep(page, 'einladung-ablehnen')
    await ctx.close()
  }
  // 6 Cockpit: Konto, Familie, Rückfragen
  {
    const srv = makeServer()
    srv.invites = [{ email: 'zweiteltern@gmail.com', created_at: later, expires_at: later2 }]
    const orig = srv.handle
    srv.handle = (route) => {
      if (route.request().url().endsWith('/bc_parents')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ parents: [{ user_id: USER.id, email: USER.email, is_me: true, added_at: later }, { user_id: 'u2', email: 'ein.sehr.langer.elternname.zum.testen@googlemail.com', is_me: false, added_at: later }], invites: srv.invites }) })
      return orig(route)
    }
    const { ctx, page } = await open({ srv, lang, storage: { ...connected, 'braincraft:queue': [{ kind: 'answer', id: 'aaaaaaaa-0000-4000-8000-000000000001', profileId: KID, questionId: 'n1', correct: true, firstTry: true, mode: 'solo', at: new Date().toISOString(), roundId: null }] } })
    srv.down = true
    await wait(300)
    srv.down = false
    // Fiel die Familienabfrage in die Netzlücke, fragt die App nach spätestens 5 s erneut
    await page.locator('.home').waitFor({ timeout: 8000 }).catch(() => {})
    await openCockpit(page, lang)
    await pin(page, '2468')
    await page.locator('.family .fam-parents li').first().waitFor({ timeout: 4000 })
    await sweep(page, 'cockpit')
    // Familie-Bereich einzeln
    for (const size of Object.keys(SIZES)) { await page.setViewportSize(SIZES[size]); await wait(100); await page.locator('.family').screenshot({ path: join(SHOT, `cockpit-familie-${size}-${lang}.png`) }); await page.locator('.parents .acc-row').screenshot({ path: join(SHOT, `cockpit-konto-${size}-${lang}.png`) }) }
    await page.setViewportSize(SIZES.iphone)
    await page.locator('.family li', { hasText: 'ein.sehr.langer' }).getByRole('button').click()
    await page.locator('dialog.confirm[open]').waitFor()
    await sweep(page, 'cockpit-entfernen')
    await page.keyboard.press('Escape')
    await wait(300)
    ok(`Cockpit ${lang}: Esc schließt nur die Rückfrage`, (await page.locator('dialog[open]').count()) === 0 && (await page.locator('.parents .family').count()) === 1)
    await page.getByRole('button', { name: lang === 'en' ? 'Sign out device' : 'Gerät abmelden', exact: true }).click()
    await page.locator('dialog.confirm[open]').waitFor()
    await sweep(page, 'cockpit-abmelden')
    const btns = await page.locator('dialog.confirm[open] .btn').evaluateAll((els) => els.map((e) => ({ t: e.textContent.trim(), bg: getComputedStyle(e).backgroundColor, h: e.getBoundingClientRect().height })))
    ok(`Abmelden ${lang}: roter Knopf zuerst, alle ≥ 44 px`, /rgb\(179, 38, 30\)|rgb\(255, 138, 128\)/.test(btns[0]?.bg) && btns.every((b) => b.h >= 44), JSON.stringify(btns))
    await page.keyboard.press('Escape')
    await wait(300)
    ok(`Abmelden ${lang}: Esc schließt nur die Rückfrage`, (await page.locator('dialog[open]').count()) === 0 && (await page.locator('.parents').count()) === 1)
    await ctx.close()
  }
  // 7 Gerät abgemeldet, Kind kommt zurück
  {
    const srv = makeServer()
    const { ctx, page } = await open({ srv, lang, storage: { 'braincraft:family': FAMILY, 'braincraft:profile': KID, 'braincraft:pull': basePull() } })
    await page.locator('.setup').waitFor()
    await sweep(page, 'abgemeldet-kind')
    await ctx.close()
  }
}
import { writeFileSync } from 'node:fs'
writeFileSync(join(SHOT, 'messungen.json'), JSON.stringify(report, null, 1))
ok('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 8).join(' | '))
ok('Keine Anfrage an fremde Adressen (alles abgefangen)', foreign.length === 0, foreign.slice(0, 5).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} bestanden, ${befunde.filter((b) => !b.fixed).length} bekannte Befunde offen`)
for (const f of failed) console.log('FEHLER:', f.name, '|', f.detail)
process.exit(failed.length ? 1 : 0)
