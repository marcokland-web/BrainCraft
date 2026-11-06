// Bug-Bodo 04.11.2026: Randfälle der Google-Anmeldung (Kopf und Helfer aus store.spec.mjs übernommen).
// Stand 05.11.2026: alle Befunde behoben und auf ok umgestellt; angepasst an die Gerätekopplung
// (Kinder-Geräte ohne Google, Altgeräte tauschen den Familien-Code gegen ein Geräte-Token).
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
const SHOTS = process.env.SHOTS ?? join(ROOT, 'tests/.shots/google-randfaelle')
mkdirSync(SHOTS, { recursive: true })
const SIZES = { iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(cond ? '  ok   ' : '  FEHLER', name, cond ? '' : detail) }
const consoleErrors = []
// Bekannte Befunde (Bericht 04.11.2026): zählen nicht als Fehler, melden sich aber, sobald sie behoben sind
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
    if (u.includes('.supabase.co/auth/v1/')) { srv.authLog = srv.authLog ?? []; srv.authLog.push(u); if (srv.authHook) { const h = srv.authHook(route); if (h) return h } return (srv.down || srv.authDown) ? route.abort('internetdisconnected') : authRoute(route, srv.auth) }
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
  page.on('console', (m) => { if (m.type() === 'error' && !shotNoise(m.text()) && !/Failed to load resource: (the server responded with a status of (400|401|403|404|500)|net::ERR_INTERNET_DISCONNECTED)/.test(m.text())) consoleErrors.push(`${size}/${lang}: ${m.text()}`) })
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

import { session } from './fake-auth.mjs'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
const authJson = (route, body, status) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
const isPkce = (route) => route.request().url().includes('/token?grant_type=pkce')
const isRefresh = (route) => route.request().url().includes('grant_type=refresh_token')
const alertText = (page) => page.locator('[role=alert]').first().innerText({ timeout: 3000 }).catch(() => '')
const queueOf = async (page) => JSON.parse((await ls(page, 'braincraft:queue')) ?? '[]')
// Sitzung im Speicher abgelaufen setzen (wie nach langer Pause oder widerrufenem Token)
const expire = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('braincraft-auth'))
  s.expires_at = Math.floor(Date.now() / 1000) - 60
  localStorage.setItem('braincraft-auth', JSON.stringify(s))
})
const queued = [1, 2, 3].map((i) => ({ kind: 'answer', id: `aaaaaaaa-0000-4000-8000-00000000000${i}`, profileId: KID, questionId: `n${i}`, correct: true, firstTry: true, mode: 'solo', at: new Date().toISOString(), roundId: null }))

// =========================== R1. Rückkehr von Google ===========================
console.log('R1. Rückkehr von Google')
const EXPIRED = 'Die Anmeldung ist abgelaufen. Versuch es noch einmal.'
const FAILED = 'Anmelden hat nicht geklappt. Versuch es noch einmal.'
for (const [name, body, want] of [
  ['abgelaufener Code (flow_state_expired, 403)', { code: 403, error_code: 'flow_state_expired', msg: 'invalid flow state, flow state has expired' }, EXPIRED],
  ['falscher Verifier (bad_code_verifier, 403, z. B. zweiter Tab)', { code: 403, error_code: 'bad_code_verifier', msg: 'code challenge does not match previously saved code verifier' }, EXPIRED],
  ['Code schon eingelöst (flow_state_not_found, 404)', { code: 404, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' }, FAILED],
  ['Hook lehnt ab (403, Kein Zugang)', { code: 403, error_code: 'unknown', msg: 'Kein Zugang – bitte von der Familie freischalten lassen.' }, 'Kein Zugang – bitte von der Familie freischalten lassen. Dieses Konto ist noch nicht freigeschaltet. Ein Elternteil der Familie kann dich im Eltern-Cockpit einladen.'],
]) {
  const srv = makeServer()
  srv.family = null
  srv.authHook = (route) => (isPkce(route) ? authJson(route, body, body.code) : null)
  const { ctx, page } = await open({ srv })
  await googleBtn(page).click({ noWaitAfter: true })
  await wait(1500)
  const a = await alertText(page)
  ok(`R1 ${name}: passende Meldung (403 allein ist nicht „Kein Zugang“)`, a === want, `Meldung: „${a}“`)
  ok(`R1 ${name}: Google-Knopf wieder bedienbar, Adresse sauber`, (await googleBtn(page).isEnabled()) && !page.url().includes('code='), page.url())
  await ctx.close()
}
{
  // Rückkehr, aber Code-Tausch scheitert am Netz (WLAN weg nach Google)
  const srv = makeServer()
  srv.family = null
  srv.authHook = (route) => (isPkce(route) ? route.abort('internetdisconnected') : null)
  const { ctx, page } = await open({ srv })
  await googleBtn(page).click({ noWaitAfter: true })
  await wait(1500)
  const a = await alertText(page)
  ok('R1 Rückkehr offline: Hinweis sichtbar (nicht still zurück zum Anfang)', a.includes('Keine Verbindung'), `Meldung: „${a}“`)
  ok('R1 Rückkehr offline: Google-Knopf bedienbar', await googleBtn(page).isEnabled())
  await ctx.close()
}
{
  // Nach erfolgreicher Anmeldung neu laden und alte Adresse mit ?code= öffnen
  const srv = makeServer()
  const { ctx, page } = await open({ srv })
  await googleBtn(page).click({ noWaitAfter: true })
  await page.locator('.home').waitFor({ timeout: 5000 }).catch(() => {})
  await page.reload()
  await page.locator('.home').waitFor({ timeout: 5000 }).catch(() => {})
  ok('R1 Neuladen nach Rückkehr: weiter im Spiel', (await page.locator('.home').count()) === 1)
  srv.authLog.length = 0
  await page.goto(BASE + '?code=alter-code')
  await page.locator('.home').waitFor({ timeout: 5000 }).catch(() => {})
  ok('R1 alter ?code= bei gültiger Sitzung: im Spiel, keine Meldung, kein Tausch', (await page.locator('.home').count()) === 1 && (await page.locator('[role=alert]').count()) === 0 && !srv.authLog.some((u) => u.includes('grant_type=pkce')), srv.authLog.join(' | '))
  ok('R1 alter ?code=: aus der Adresse entfernt', !page.url().includes('code='), page.url())
  // Zurück-Taste von Google (bfcache): Knopf darf nicht „Google wird geöffnet …“ hängen bleiben
  await ctx.close()
}

// =========================== R2. Sitzung läuft ab, während das Kind spielt ===========================
console.log('R2. Sitzung während des Spiels')
{
  // Widerrufenes Refresh-Token (z. B. Konto entfernt, Sitzung beendet): Kind darf nicht aus der Runde fliegen
  const srv = makeServer()
  const { ctx, page } = await open({ srv, storage: connected })
  await page.locator('.exam-row', { hasText: 'Normal-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  await answer(page, 'right')
  await wait(400)
  srv.authHook = (route) => (isRefresh(route) ? authJson(route, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400) : null)
  await expire(page)
  srv.calls.length = 0
  await answer(page, 'right').catch(() => null)
  await wait(1200)
  const inArena = (await page.locator('.arena').count()) === 1
  const setupShown = (await page.locator('.setup').count()) === 1
  await page.screenshot({ path: join(SHOTS, 'r2-widerrufen-iphone.png') })
  ok('R2 Token widerrufen mitten in der Runde: Kind bleibt in der Runde (keine Anmeldung)', inArena && !setupShown, `Arena ${inArena}, Setup ${setupShown}`)
  const q = await queueOf(page)
  ok('R2 Token widerrufen: Antwort bleibt in der Schlange (nicht verloren)', q.filter((x) => x.kind === 'answer').length >= 1 || answersOf(srv).length >= 1, `Schlange ${q.length}, gesendet ${answersOf(srv).length}`)
  await ctx.close()
}
{
  // Abgelaufenes Token und kein Netz: weiterspielen, Antworten warten; danach Netz zurück: alles gesendet
  const srv = makeServer()
  const { ctx, page } = await open({ srv, storage: connected })
  await page.locator('.exam-row', { hasText: 'Kurz-Arbeit' }).click()
  await page.locator('.arena .a-card').waitFor()
  await expire(page)
  srv.down = true
  await answer(page, 'right')
  await answer(page, 'right')
  await wait(400)
  ok('R2 abgelaufen + offline: Kind spielt weiter', (await page.locator('.arena').count()) === 1 && (await page.locator('.setup').count()) === 0)
  ok('R2 abgelaufen + offline: 2 Antworten in der Schlange', (await queueOf(page)).filter((x) => x.kind === 'answer').length === 2)
  srv.down = false
  srv.calls.length = 0
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(1500)
  ok('R2 Netz zurück: Token erneuert, beide Antworten mit Token gesendet', answersOf(srv).length >= 2 && srv.authLog.some((u) => u.includes('grant_type=refresh_token')), `bc_answer ${answersOf(srv).length}`)
  await ctx.close()
}

// =========================== R3. Altgerät mit Familien-Code ===========================
console.log('R3. Altgerät mit Familien-Code und wartenden Antworten')
{
  // Tausch Familien-Code → Geräte-Token (vor 008): ohne Google, Antworten gehen mit Geräte-Token raus
  const srv = makeServer()
  const { ctx, page } = await open({ srv, storage: { 'braincraft:code': 'ABCD-EFGH-JKMN-PQRS-TUVW', 'braincraft:profile': KID, 'braincraft:pull': basePull(), 'braincraft:queue': queued } })
  await page.locator('.home').waitFor({ timeout: 5000 }).catch(() => {})
  await wait(800)
  const a = answersOf(srv)
  ok('R3 Altgerät: ohne Anmeldung weiter im Spiel (Code getauscht)', (await page.locator('.home').count()) === 1 && (await page.locator('.setup').count()) === 0)
  ok('R3 Altgerät: alle 3 Antworten gesendet, ohne p_code', a.length === 3 && a.every((x) => !('p_code' in x.args)), `bc_answer ${a.length}`)
  ok('R3 Altgerät: Schlange leer', (await queueOf(page)).length === 0)
  await ctx.close()
}
{
  // Nach 008 (kein Tausch): anderes Google-Konto ohne Familie meldet sich an
  const srv = makeServer()
  srv.family = null
  srv.legacyGone = true
  const { ctx, page } = await open({ srv, storage: { 'braincraft:code': 'ABCD-EFGH-JKMN-PQRS-TUVW', 'braincraft:profile': KID, 'braincraft:pull': basePull(), 'braincraft:queue': queued } })
  await page.locator('.reconnect').waitFor({ timeout: 4000 }).catch(() => {})
  ok('R3 Altgerät ohne Tausch: Kind sieht „Gleich geht’s weiter“, keine Anmeldung', (await page.locator('.reconnect').innerText().catch(() => '')).includes("Gleich geht’s weiter") && (await googleBtn(page).count()) === 0)
  await page.getByRole('button', { name: 'Ich bin Mama oder Papa' }).click()
  await googleBtn(page).click({ noWaitAfter: true })
  await page.locator('.reconnect .acc-row').waitFor({ timeout: 5000 }).catch(() => {})
  const txt = await page.locator('.reconnect').innerText().catch(() => '')
  ok('R3 Altgerät + fremdes Konto: Hinweis, dass hier schon Lernstand liegt (falsches Konto?)', /Lernstand/.test(txt) && /falsche Konto/.test(txt), txt.slice(0, 300).replace(/\n/g, ' / '))
  ok('R3 Altgerät + fremdes Konto: kein „Familie anlegen“ ohne Rückfrage', (await page.locator('form.setup-form input[type=password]').count()) === 0)
  ok('R3 Altgerät + fremdes Konto: wartende Antworten nicht verworfen und nicht gesendet', (await queueOf(page)).length === 3 && answersOf(srv).length === 0, `Schlange ${(await queueOf(page)).length}, bc_answer ${answersOf(srv).length}`)
  await ctx.close()
}

// =========================== R4. Konto verliert die Familie ===========================
console.log('R4. Elternteil wurde aus der Familie entfernt (Kinder-iPad mit diesem Konto)')
{
  const srv = makeServer()
  srv.family = null
  const { ctx, page } = await open({ srv, storage: { ...connected, 'braincraft:pull': basePull(), 'braincraft:queue': queued } })
  await wait(1500)
  const txt = await page.locator('body').innerText()
  await page.screenshot({ path: join(SHOTS, 'r4-familie-weg-iphone.png'), fullPage: true })
  ok('R4 Konto ohne Familie: Kind sieht nicht „Familie anlegen“ mit PIN-Feldern', (await page.locator('form.setup-form').count()) === 0 && txt.includes("Gleich geht’s weiter"), txt.slice(0, 200).replace(/\n/g, ' / '))
  ok('R4 Konto ohne Familie: 3 wartende Antworten nicht ohne Rückfrage gelöscht', (await queueOf(page)).length === 3, `Schlange ${(await queueOf(page)).length}`)
  await ctx.close()
}

// =========================== R5. Konto wechseln nach „Nur abmelden“ ===========================
console.log('R5. Kontowechsel')
{
  const srv = makeServer()
  const F2 = 'f0000000-0000-4000-8000-000000000002'
  // Gerät A: abgemeldet mit behaltenem Stand + Schlange; jetzt meldet Konto B (andere Familie) an
  srv.family = F2
  srv.data.family_id = F2
  srv.authHook = (route) => (isPkce(route) ? authJson(route, { ...session(), user: { ...session().user, id: 'u0000000-0000-4000-8000-00000000000b', email: 'b@example.org' } }, 200) : null)
  const { ctx, page } = await open({ srv, storage: { 'braincraft:family': FAMILY, 'braincraft:profile': KID, 'braincraft:pull': basePull(), 'braincraft:queue': queued } })
  await page.getByRole('button', { name: 'Ich bin Mama oder Papa' }).click()
  await googleBtn(page).click({ noWaitAfter: true })
  await page.locator('.conflict').waitFor({ timeout: 5000 }).catch(() => {})
  ok('R5 Konto B: Rückfrage statt still löschen, Familie A bleibt bis dahin', (await page.locator('.conflict .btn.danger').count()) === 1 && JSON.parse(await ls(page, 'braincraft:family')) === FAMILY && (await queueOf(page)).length === 3)
  ok('R5 Konto B: keine Antwort von Familie A an B gesendet', answersOf(srv).length === 0, `bc_answer ${answersOf(srv).length}`)
  await page.locator('.conflict .btn.danger').click()
  await page.locator('.home').waitFor({ timeout: 5000 }).catch(() => {})
  await wait(500)
  ok('R5 Konto B: nach Bestätigung Familie B übernommen, alter Stand gelöscht, nichts von A gesendet', JSON.parse(await ls(page, 'braincraft:family')) === F2 && answersOf(srv).length === 0 && (await queueOf(page)).length === 0)
  await ctx.close()
}

// =========================== R6. Abmelden offline mit abgelaufenem Token ===========================
console.log('R6. Abmelden offline, Token abgelaufen')
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
  const srv = makeServer()
  const { ctx, page } = await open({ srv, storage: connected })
  await openCockpit(page)
  await pin(page, '2468')
  await page.locator('.approve, .bc-empty').first().waitFor({ timeout: 3000 })
  await expire(page)
  srv.down = true
  await page.getByRole('button', { name: 'Gerät abmelden', exact: true }).click()
  // Zeit vom Tipp bis die Sitzung vom Gerät entfernt ist (offline: sofort lokal, sonst höchstens 3 s)
  const t0 = Date.now()
  await page.locator('dialog.confirm[open]').getByRole('button', { name: 'Nur abmelden' }).click()
  for (let k = 0; k < 100 && (await ls(page, 'braincraft-auth')); k++) await wait(100)
  await page.locator('.setup').waitFor({ timeout: 4000 }).catch(() => {})
  const dauer = (Date.now() - t0) / 1000
  await page.screenshot({ path: join(SHOTS, 'r6-abgemeldet-iphone.png') })
  ok('R6 offline + abgelaufen: Abmelden dauert höchstens 5 s', dauer <= 5, `${dauer.toFixed(1)} s`)
  ok('R6 offline + abgelaufen: Sitzung entfernt, Anmeldung sichtbar', !(await ls(page, 'braincraft-auth')) && (await page.locator('.setup').count()) === 1)
  srv.down = false
  await page.reload()
  await wait(1000)
  ok('R6 nach Neuladen weiter abgemeldet (alte Sitzung nicht zurückgeschrieben)', !(await ls(page, 'braincraft-auth')) && (await page.locator('.setup').count()) === 1)
  await ctx.close()
}

// =========================== R7. Einladung: Fehler im Formular ===========================
console.log('R7. Einladung + Familie anlegen')
{
  const srv = makeServer()
  srv.family = null
  srv.myInvites = [
    { family_id: FAMILY, invited_by: 'oma@example.org', created_at: later, expires_at: later },
    { family_id: 'f0000000-0000-4000-8000-000000000003', invited_by: 'opa@example.org', created_at: later, expires_at: later },
  ]
  const { ctx, page } = await open({ srv })
  await googleBtn(page).click({ noWaitAfter: true })
  await page.locator('.setup-invite').first().waitFor({ timeout: 5000 }).catch(() => {})
  await page.getByRole('button', { name: 'Familie anlegen' }).click()
  await wait(300)
  const inForm = await page.locator('form.setup-form [role=alert]').count()
  const inCards = await page.locator('.setup-invite [role=alert]').count()
  ok('R7 Fehler beim Anlegen erscheint im Formular, nicht in den Einladungskarten', inForm === 1 && inCards === 0, `im Formular ${inForm}, in Einladungen ${inCards}`)
  // Ablehnen ohne Netz: Fehler im Sheet, Sheet bleibt, Einladung bleibt
  srv.down = true
  await page.locator('.setup-invite').first().getByRole('button', { name: 'Ablehnen' }).click()
  await page.locator('dialog.confirm[open] .btn.danger').click()
  await wait(500)
  ok('R7 Ablehnen offline: Meldung im Sheet, Einladung bleibt', (await page.locator('dialog.confirm[open] [role=alert]').count()) === 1 && (await page.locator('.setup-invite').count()) === 2)
  srv.down = false
  await ctx.close()
}

// =========================== Abschluss ===========================
ok('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 8).join(' | '))
ok('Keine Anfrage an fremde Adressen (alles abgefangen)', foreign.length === 0, foreign.slice(0, 5).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} bestanden, ${befunde.filter((b) => !b.fixed).length} bekannte Befunde offen`)
for (const f of failed) console.log('FEHLER:', f.name, '|', f.detail)
process.exit(failed.length ? 1 : 0)
