// Bug-Bodo: Ablauf-Test „Sterne und Fortschritt zurücksetzen“ (Migration 006, Eltern-Cockpit → Verwalten)
// mit FAKE-Server. Alle Supabase-Anfragen werden per context.route abgefangen, Service Worker blockiert,
// jede andere fremde Anfrage wird abgebrochen und gezählt. Die echte Datenbank wird NIE erreicht.
// Vorher: npx vite build --outDir <ordner> && npx vite preview --outDir <ordner> --port 8798 --strictPort
// Aufruf:  BASE=http://localhost:8798/BrainCraft/ node tests/reset.spec.mjs   (BROWSER=webkit für Safari)
// Ergebnis: Exit-Code 0 = alles bestanden, 1 = mindestens ein Fehler.

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PW = process.env.PLAYWRIGHT_DIR ?? join(homedir(), 'Apps/DasTeam/tools/node_modules/playwright')
const pw = createRequire(import.meta.url)(PW)
const BASE = process.env.BASE ?? 'http://localhost:8798/BrainCraft/'
const SHOTS = process.env.SHOTS ?? join(ROOT, 'tests/.shots/reset')
mkdirSync(SHOTS, { recursive: true })
const SIZES = { iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log(cond ? '  ok   ' : '  FEHLER', name, cond ? '' : detail) }
const consoleErrors = []
const foreign = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Erwartete Texte aus src/lib/i18n.ts (nicht fest eintragen; Text-Tina ändert sie)
const I18N = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')
const T = (key, lang = 'de') => {
  const m = [...I18N.matchAll(new RegExp(`^\\s+${key}: (['"])(.*)\\1,?$`, 'gm'))]
  if (m.length !== 2) throw new Error(`Text ${key}: ${m.length} statt 2 Treffer (doppelter Schlüssel?)`)
  return m[lang === 'de' ? 0 : 1][2].replace(/\\(.)/g, '$1')
}

// ---------- Fake-Daten und Fake-Server (Verhalten wie supabase/006_zuruecksetzen.sql) ----------
const KID = '11111111-1111-4111-8111-111111111111'
const KID2 = '22222222-2222-4222-8222-222222222222'
const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW'
const TOKEN = 'f'.repeat(64)
const later = new Date(Date.now() + 30 * 86400000).toISOString()
const today = new Date().toISOString().slice(0, 10)
function basePull() {
  return {
    today, parent: false,
    profiles: [
      { id: KID, child_name: 'Lia', avatar_id: 'a', stars_balance: 42, stars_today: 40, learn_days_week: 4 },
      { id: KID2, child_name: 'Ben', avatar_id: 'b', stars_balance: 7, stars_today: 3, learn_days_week: 1 },
    ],
    subjects: [{ id: 's', name: 'Sachkunde', icon: 'x' }], units: [],
    exams: [{ id: 'eN', title: 'Wasser', exam_date: null, profile_id: KID, subject_id: 's', is_archived: false }],
    questions: [{ id: 'n1', exam_id: 'eN', unit_id: null, status: 'freigegeben', type: 'multiple_choice', prompt: 'Frage?', payload: { options: ['a', 'b', 'c'], correct_index: 0 } }],
    progress: [
      { profile_id: KID, question_id: 'n1', leitner_box: 3, next_review_at: later, consecutive_correct: 2 },
      { profile_id: KID2, question_id: 'n1', leitner_box: 5, next_review_at: later, consecutive_correct: 5 },
    ],
    rewards: [{ id: 'r1', profile_id: null, title: 'Eis', icon: 'gift', cost_stars: 5, is_active: true }],
    redemptions: [{ id: 'd1', profile_id: KID, reward_title: 'Eis', cost_stars: 5, status: 'offen', redeemed_at: later, resolved_at: null }],
    items: [{ item_key: 'helm', title_de: 'Pilotenhelm', title_en: 'Pilot helmet', sort: 1 }],
    inventory: [{ profile_id: KID, item_key: 'helm', exam_id: 'eN', unlocked_at: later }],
    boss_wins: [{ profile_id: KID, exam_id: 'eN', item_key: 'helm', won_at: later }],
    unit_views: [],
  }
}
function makeServer() {
  const srv = { calls: [], data: basePull(), resets: 0, fails: 0, lockedUntil: null, answerFail: false, resetDelay: 0, mode: null }
  srv.handle = async (route) => {
    const req = route.request()
    const fn = req.url().split('/rpc/')[1]
    let args = {}
    try { args = JSON.parse(req.postData() || '{}') } catch { /* leer */ }
    srv.calls.push({ fn, args })
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
    const fail = (message) => reply({ code: 'P0001', message }, 400)
    if (args.p_code !== CODE) return fail('not_found')
    switch (fn) {
      case 'bc_pull': { const d = structuredClone(srv.data); d.parent = args.p_token === TOKEN; return reply(d) }
      case 'bc_parent_unlock': return args.p_pin === '2468' ? reply({ ok: true, token: TOKEN, expires_at: later }) : reply({ ok: false, error: 'pin_wrong', locked_until: null })
      case 'bc_parent_lock': return reply(true)
      case 'bc_answer': return srv.answerFail ? reply({ message: 'boom' }, 500) : reply({ ok: true })
      case 'bc_progress_reset': {
        if (srv.resetDelay) await wait(srv.resetDelay)
        if (srv.mode === 'missing') return reply({ code: 'PGRST202', message: 'Could not find the function public.bc_progress_reset' }, 404)
        if (srv.mode === 'expired' || args.p_token !== TOKEN) return fail('pin_required')
        const ids = args.p_profile_id ? [args.p_profile_id] : srv.data.profiles.map((p) => p.id)
        if (args.p_profile_id && !srv.data.profiles.some((p) => p.id === args.p_profile_id)) return fail('profile_not_found')
        if (srv.resets >= 5) return fail('limit_reached')
        if (srv.lockedUntil) return reply({ ok: false, error: 'pin_locked', locked_until: srv.lockedUntil })
        if (args.p_pin !== '2468') {
          srv.fails++
          if (srv.fails >= 3) srv.lockedUntil = '2026-10-29T21:45:00Z'
          return reply({ ok: false, error: 'pin_wrong', locked_until: srv.lockedUntil })
        }
        srv.fails = 0
        srv.resets++
        const d = srv.data
        for (const p of d.profiles) if (ids.includes(p.id)) Object.assign(p, { stars_balance: 0, stars_today: 0, learn_days_week: 0 })
        for (const k of ['progress', 'redemptions', 'inventory', 'boss_wins', 'unit_views']) d[k] = d[k].filter((x) => !ids.includes(x.profile_id))
        return reply({ ok: true, profiles: ids.length, reset_at: new Date().toISOString() })
      }
      default: return reply(null)
    }
  }
  return srv
}

const browser = await pw[process.env.BROWSER ?? 'chromium'].launch()
async function open({ size = 'iphone', lang = 'de', theme = 'light', srv = makeServer(), queue = [] } = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[size], serviceWorkers: 'block', colorScheme: theme })
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (u.startsWith(new URL(BASE).origin + '/')) return route.continue()
    if (u.includes('.supabase.co/rest/v1/rpc/')) return srv.handle(route)
    foreign.push(u)
    return route.abort()
  })
  const init = { 'studio-lang': lang, 'studio-theme': theme, 'braincraft:code': JSON.stringify(CODE), 'braincraft:profile': JSON.stringify(KID), 'braincraft:queue': JSON.stringify(queue) }
  await ctx.addInitScript((init) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    localStorage.clear()
    for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v)
  }, init)
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (400|404|500)/.test(m.text()) && !(process.env.BROWSER === 'webkit' && /^Refused to apply a stylesheet/.test(m.text()))) consoleErrors.push(`${size}/${lang}: ${m.text()}`) })
  page.on('pageerror', (e) => consoleErrors.push(`${size}/${lang} pageerror: ${e.message}`))
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  return { ctx, page, srv }
}
async function cockpit(page, lang = 'de') {
  await page.locator('header .gear').click()
  await page.locator('dialog.settings[open]').getByText(lang === 'de' ? 'Eltern-Cockpit' : 'Parent cockpit').first().click()
  await page.locator('.pin').waitFor()
  for (const d of '2468') await page.locator('.pin-keys .key', { hasText: new RegExp(`^${d}$`) }).click()
  await resetRow(page).waitFor({ timeout: 4000 })
}
const resetRow = (page) => page.locator('.danger-row', { hasText: T('resetRow') }).or(page.locator('.danger-row', { hasText: T('resetRow', 'en') }))
const sheet = (page) => page.locator('dialog[open] form.manage-reset')
async function openSheet(page) {
  await resetRow(page).click()
  await sheet(page).waitFor({ timeout: 2000 })
}
async function typePin(page, pin) { await sheet(page).locator('input[type=password]').fill(pin) }
const submit = (page) => sheet(page).locator('button[type=submit]')
const alertText = async (page) => ((await sheet(page).locator('[role=alert]').count()) ? (await sheet(page).locator('[role=alert]').innerText()) : '')
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const lsJSON = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), k)
const resetCalls = (srv) => srv.calls.filter((c) => c.fn === 'bc_progress_reset')

// =========================== 1. Aussehen in drei Größen, hell und dunkel ===========================
console.log('1. Rückfrage: Aussehen')
for (const size of Object.keys(SIZES)) {
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open({ size, theme })
    await cockpit(page)
    ok(`${size} ${theme}: Zeile „${T('resetRow')}“`, (await resetRow(page).innerText()).includes(T('resetRow')))
    await openSheet(page)
    const f = sheet(page)
    const txt = await f.innerText()
    ok(`${size} ${theme}: Rückfrage-Text vollständig (inkl. Tipp)`, txt.includes(T('resetAsk')), txt.slice(0, 120))
    const seg = f.locator('.seg')
    const segTexts = (await seg.locator('label').allTextContents()).map((x) => x.trim())
    const segVal = await seg.locator('input:checked').getAttribute('value')
    ok(`${size} ${theme}: Auswahl Alle/Lia/Ben, Standard „${T('resetAll')}“`,
      JSON.stringify(segTexts) === JSON.stringify([T('resetAll'), 'Lia', 'Ben']) && segVal === 'all', JSON.stringify(segTexts) + ' ' + segVal)
    const segFits = await seg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    ok(`${size} ${theme}: Auswahl passt in die Breite`, segFits)
    const segRow = await seg.locator('label').evaluateAll((ls) => new Set(ls.map((l) => Math.round(l.getBoundingClientRect().top))).size === 1)
    ok(`${size} ${theme}: Auswahl in einer Reihe`, segRow)
    // Layout, nicht nur Klickbarkeit: Segment 36-52 px hoch, Beschriftungen innerhalb, gewählter Teil mind. 36 px
    const geo = await seg.evaluate((el) => {
      const b = el.getBoundingClientRect()
      const spans = [...el.querySelectorAll('span')].map((x) => x.getBoundingClientRect())
      const sel = el.querySelector('input:checked + span').getBoundingClientRect()
      return { h: Math.round(b.height), inside: spans.every((r) => r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5), sel: Math.round(sel.height) }
    })
    ok(`${size} ${theme}: Segment-Steuerung nicht zerschossen (Höhe, Beschriftung innen, Auswahl ≥ 36 px)`, geo.h >= 36 && geo.h <= 52 && geo.inside && geo.sel >= 36, JSON.stringify(geo))
    const box = await f.evaluate((el) => { const d = el.closest('dialog').getBoundingClientRect(); return { l: d.left, r: d.right, b: d.bottom, w: d.width } })
    ok(`${size} ${theme}: Sheet ganz sichtbar`, box.l >= 0 && box.r <= SIZES[size].width + 1 && box.b <= SIZES[size].height + 1, JSON.stringify(box))
    if (size !== 'iphone') ok(`${size} ${theme}: Dialog höchstens 440 px breit`, box.w <= 441, String(box.w))
    const btns = await f.locator('button').evaluateAll((bs) => bs.map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]))
    ok(`${size} ${theme}: Knöpfe mind. 44 px hoch`, btns.every(([, h]) => h >= 44), JSON.stringify(btns))
    ok(`${size} ${theme}: Knopf „${T('resetYes')}“ ohne PIN gesperrt`, await submit(page).isDisabled())
    // Farbe gegen das Rot des Themas vergleichen (CSS-Variable --bad = Studio --danger: hell #B3261E, dunkel #FF8A80)
    const [red, danger] = await submit(page).evaluate((b) => {
      const probe = document.createElement('i'); probe.style.color = 'var(--bad)'; document.body.append(probe)
      const d = getComputedStyle(probe).color; probe.remove()
      return [getComputedStyle(b).backgroundColor, d]
    })
    ok(`${size} ${theme}: Bestätigen-Knopf rot (--bad)`, red === danger, red + ' vs ' + danger)
    ok(`${size} ${theme}: kein seitliches Scrollen`, await noHScroll(page))
    await page.screenshot({ path: join(SHOTS, `reset-${size}-${theme}.png`) })
    await ctx.close()
  }
}

// =========================== 2. PIN falsch, Sperre ===========================
console.log('2. PIN falsch / Sperre')
{
  const { ctx, page, srv } = await open()
  await cockpit(page)
  await openSheet(page)
  await sheet(page).locator('input[type=password]').fill('12ab')
  ok('PIN-Feld nimmt nur Ziffern', (await sheet(page).locator('input[type=password]').inputValue()) === '12')
  ok('3 Ziffern: Knopf gesperrt', (await typePin(page, '123'), await submit(page).isDisabled()))
  await typePin(page, '0000'); await submit(page).click(); await wait(300)
  ok(`falsche PIN -> „${T('pinWrong')}“`, (await alertText(page)) === T('pinWrong'), await alertText(page))
  ok('falsche PIN: Feld geleert, Sheet bleibt offen', (await sheet(page).locator('input[type=password]').inputValue()) === '' && (await sheet(page).count()) === 1)
  await typePin(page, '0000'); await submit(page).click(); await wait(300)
  await typePin(page, '0000'); await submit(page).click(); await wait(300)
  const expT = new Date('2026-10-29T21:45:00Z').toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  ok('3. falsche PIN -> Sperre mit Uhrzeit', (await alertText(page)).includes(expT), await alertText(page))
  await typePin(page, '2468'); await submit(page).click(); await wait(300)
  ok('gesperrt: auch richtige PIN -> Sperre, nichts zurückgesetzt', (await alertText(page)).includes(expT) && srv.resets === 0)
  ok('Daten unverändert (Lia 42 Sterne)', (await lsJSON(page, 'braincraft:pull')).profiles[0].stars_balance === 42)
  await ctx.close()
}

// =========================== 3. Ein Kind zurücksetzen, Warteschlange ===========================
console.log('3. Ein Kind (Ben), Warteschlange')
{
  const q = (id, profileId) => ({ kind: 'answer', id, profileId, questionId: 'n1', correct: true, firstTry: true, mode: 'solo', at: new Date().toISOString(), roundId: null })
  const srv = makeServer()
  srv.answerFail = true // Antworten hängen (Serverfehler) -> bleiben in der Schlange
  const { ctx, page } = await open({ srv, queue: [q('aaaaaaaa-0000-4000-8000-000000000001', KID), q('aaaaaaaa-0000-4000-8000-000000000002', KID2)] })
  await cockpit(page)
  await openSheet(page)
  await sheet(page).locator('.seg label', { hasText: 'Ben' }).click()
  srv.calls.length = 0
  await typePin(page, '2468'); await submit(page).click()
  await page.locator('.manage-notice').waitFor({ timeout: 3000 }).catch(() => {})
  const rc = resetCalls(srv)
  ok('bc_progress_reset genau einmal, für Ben, mit Token und PIN', rc.length === 1 && rc[0].args.p_profile_id === KID2 && rc[0].args.p_token === TOKEN && rc[0].args.p_pin === '2468', JSON.stringify(rc.map((c) => c.args)))
  const iR = srv.calls.findIndex((c) => c.fn === 'bc_progress_reset')
  ok('vorher Sendeversuch der Schlange (flush), danach frischer Stand', srv.calls.slice(0, iR).some((c) => c.fn === 'bc_answer') && srv.calls.slice(iR).some((c) => c.fn === 'bc_pull'), srv.calls.map((c) => c.fn).join(','))
  ok(`Hinweis „${T('resetDone')}“, Sheet zu`, (await page.locator('.manage-notice').innerText()) === T('resetDone') && (await sheet(page).count()) === 0)
  const queue = await lsJSON(page, 'braincraft:queue')
  ok('Warteschlange: Bens Antwort verworfen, Lias bleibt', queue.length === 1 && queue[0].profileId === KID, JSON.stringify(queue.map((x) => x.profileId)))
  const pull = await lsJSON(page, 'braincraft:pull')
  ok('Stand übernommen: Ben 0, Lia 42 (kein Zusammenführen)', pull.profiles.find((p) => p.id === KID2).stars_balance === 0 && pull.profiles.find((p) => p.id === KID).stars_balance === 42)
  ok('Bens Lernstand weg, Lias bleibt', pull.progress.length === 1 && pull.progress[0].profile_id === KID)
  // Wieder öffnen: Auswahl springt auf „Alle Kinder“ zurück, PIN leer
  await openSheet(page)
  ok('erneut geöffnet: Auswahl wieder „Alle Kinder“, PIN leer', (await sheet(page).locator('.seg input:checked').getAttribute('value')) === 'all' && (await sheet(page).locator('input[type=password]').inputValue()) === '')
  // Esc während laufender Anfrage: Sheet bleibt
  srv.resetDelay = 800
  await typePin(page, '2468'); await submit(page).click()
  await wait(100)
  await page.keyboard.press('Escape')
  await wait(100)
  ok('Esc während des Zurücksetzens: Sheet bleibt offen, Knöpfe gesperrt', (await sheet(page).count()) === 1 && (await submit(page).isDisabled()))
  await page.locator('.manage-notice').waitFor({ timeout: 3000 }).catch(() => {})
  await wait(300)
  const pull2 = await lsJSON(page, 'braincraft:pull')
  ok('alle Kinder: beide 0, Gutscheine/Teile/Siege leer, Schlange leer',
    pull2.profiles.every((p) => p.stars_balance === 0 && p.stars_today === 0) && !pull2.redemptions.length && !pull2.inventory.length && !pull2.boss_wins.length && (await lsJSON(page, 'braincraft:queue')).length === 0)
  ok('alle Kinder: p_profile_id null', resetCalls(srv).at(-1).args.p_profile_id === null)
  await ctx.close()
}

// =========================== 4. Fehlercodes ===========================
console.log('4. Fehlercodes')
{
  const srv = makeServer()
  srv.resets = 5
  const { ctx, page } = await open({ srv })
  await cockpit(page)
  await openSheet(page)
  await typePin(page, '2468'); await submit(page).click(); await wait(300)
  ok(`limit_reached -> „${T('resetLimit')}“ (nicht errLimit)`, (await alertText(page)) === T('resetLimit'), await alertText(page))
  srv.resets = 0; srv.mode = 'missing'
  await typePin(page, '2468'); await submit(page).click(); await wait(300)
  ok(`missing_function -> „${T('errNotReady')}“`, (await alertText(page)) === T('errNotReady'), await alertText(page))
  srv.mode = null
  srv.data.profiles = srv.data.profiles.filter((p) => p.id !== KID2) // Ben auf anderem Gerät gelöscht
  await sheet(page).locator('.seg label', { hasText: 'Ben' }).click()
  srv.calls.length = 0
  await typePin(page, '2468'); await submit(page).click(); await wait(500)
  ok(`profile_not_found -> „${T('errGeneric')}“ und Stand neu geladen`, (await alertText(page)) === T('errGeneric') && srv.calls.some((c) => c.fn === 'bc_pull'), await alertText(page))
  srv.mode = 'expired'
  await page.locator('dialog[open] form.manage-reset').count() && (await typePin(page, '2468'), await submit(page).click())
  await wait(500)
  ok('pin_required (Eltern-Zeit abgelaufen) -> Cockpit gesperrt (PIN-Feld)', (await page.locator('.pin').count()) === 1)
  await ctx.close()
}

// =========================== 5. Englisch ===========================
console.log('5. Englisch')
{
  const { ctx, page } = await open({ lang: 'en' })
  await cockpit(page, 'en')
  ok('EN: Zeile', (await resetRow(page).innerText()).includes(T('resetRow', 'en')))
  await openSheet(page)
  const txt = await sheet(page).innerText()
  ok('EN: Rückfrage, Auswahl, PIN, Knöpfe', txt.includes(T('resetAsk', 'en')) && txt.includes(T('resetAll', 'en')) && txt.includes(T('resetPin', 'en')) && txt.includes(T('resetYes', 'en')) && txt.includes(T('cancel', 'en')), txt)
  await typePin(page, '0000'); await submit(page).click(); await wait(300)
  ok('EN: falsche PIN', (await alertText(page)) === T('pinWrong', 'en'))
  await typePin(page, '2468'); await submit(page).click(); await page.locator('.manage-notice').waitFor({ timeout: 3000 }).catch(() => {})
  ok('EN: Erfolg', (await page.locator('.manage-notice').innerText()) === T('resetDone', 'en'))
  await ctx.close()
}
{
  const srv = makeServer()
  srv.resets = 5
  const { ctx, page } = await open({ lang: 'en', srv })
  await cockpit(page, 'en')
  await openSheet(page)
  await typePin(page, '2468'); await submit(page).click(); await wait(300)
  ok('EN: Bremse', (await alertText(page)) === T('resetLimit', 'en'), await alertText(page))
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
