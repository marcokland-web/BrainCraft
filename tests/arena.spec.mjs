// Bug-Bodo: Ablauf-Test der Game Arena (Schritt 3, Beispielstoff aus src/lib/demo.ts).
// Vorher: cd /Users/marcokland/Apps/BrainCraft && npm run build && npx vite preview --port 8794 --strictPort
// Aufruf:  node tests/arena.spec.mjs            (BASE=… überschreibt die Adresse, BROWSER=webkit für Safari)
// Screenshots: $SHOTS (Standard: tests/.shots)
// Ergebnis: Exit-Code 0 = alles bestanden, 1 = mindestens ein Fehler.
//
// Regeln (Stand 24.10.2026, nach Lern-Lotte):
// - Einzelantwort: 1. Fehler Hinweis + Sperre 1 s, 2. Fehler Lösung.
// - Mehrschritt (sort_boxes, pair_matching, sequencing, bubble_pop): Lösung nach dem 3. Fehler
//   oder dem 2. Fehler am selben Teil; falscher Teil leuchtet 1 s (flash).
// - Aufgedeckte normale Fragen kommen am Ende als „repeat“ (kein Stern, nicht erneut angehängt).
// - Notbremse: 2 aufgedeckte normale Fragen in Folge → einmal je Runde „rescue“ (kein Stern).
// - Sterne: 1 je normale Frage im 1. Versuch, +3 ab 5 normalen Antworten.

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PW = process.env.PLAYWRIGHT_DIR ?? join(homedir(), 'Apps/DasTeam/tools/node_modules/playwright')
const pw = createRequire(import.meta.url)(PW)
const BASE = process.env.BASE ?? 'http://localhost:8794/BrainCraft/'
const SHOTS = process.env.SHOTS ?? join(ROOT, 'tests/.shots')
mkdirSync(SHOTS, { recursive: true })

const SIZES = { iphone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }
const LOCK = 1150

// ---------- Ergebnis-Sammlung ----------
const results = []
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); if (!cond) console.log('  FEHLER', name, detail) }
const consoleErrors = []

// ---------- Beispielstoff (Spiegel von src/lib/demo.ts) ----------
const Q = {
  d1: { type: 'mc', right: 'Die Sonne', wrong: ['Der Mond', 'Die Fische'] },
  d8: { type: 'mc', right: 'Grundwasser', wrong: ['Meerwasser', 'Regenwasser'] },
  d2: { type: 'wc', right: 'kondensiert', wrong: ['schmilzt', 'versickert'] },
  d9: { type: 'wc', right: 'Niederschlag', wrong: ['Wasserdampf', 'Nebel'] },
  d4: { type: 'det', right: 'Beim Wasserkreislauf', wrong: ['Wolken bestehen', 'Regen kann'] },
  d3: { type: 'sort', box: { Regen: 'Niederschlag', Schnee: 'Niederschlag', Hagel: 'Niederschlag', Wind: 'Kein Niederschlag', Sonnenschein: 'Kein Niederschlag', Grundwasser: 'Kein Niederschlag' } },
  d5: { type: 'bub', right: ['Eis', 'Wasserdampf', 'Regen', 'Schnee'], wrong: ['Sand', 'Holz'] },
  d6: { type: 'pair', pairs: [['fest', 'Eis'], ['flüssig', 'Wasser'], ['gasförmig', 'Wasserdampf']] },
  d10: { type: 'pair', pairs: [['Meer', 'Wasser verdunstet'], ['Wolke', 'Tröpfchen sammeln sich'], ['Boden', 'Wasser versickert']] },
  d7: { type: 'seq', order: ['Wasser verdunstet', 'Wolken entstehen', 'Es regnet', 'Wasser fließt ins Meer'] },
}
const PROMPT = {
  'Was lässt das Wasser im Meer verdunsten?': 'd1', 'Wie heißt Wasser, das im Boden versickert ist?': 'd8',
  'Sortiere: Was ist Niederschlag, was nicht?': 'd3', 'Welcher Satz stimmt nicht?': 'd4',
  'Lass alle Formen von Wasser platzen!': 'd5', 'Verbinde die passenden Paare!': 'd6',
  'Bringe den Wasserkreislauf in die richtige Reihenfolge:': 'd7', 'Was passiert wo? Verbinde!': 'd10',
}
const MULTI = new Set(['sort', 'pair', 'seq']) // bubble_pop seit Lottes Änderung Einzelantwort
const HINT_DE = {
  mc: 'Welche Antwort passt sicher nicht?', wc: 'Lies den Satz mit jedem Wort', sort: 'Gehört er zu „Niederschlag“?',
  det: 'Lies jeden Satz einzeln.', bub: 'Prüfe jede Blase einzeln', pair: 'Fang mit dem Paar an', seq: 'Was passiert ganz am Anfang?',
}
const PRAISE_DE = ['Gut überlegt', 'Genau hingeschaut', 'Das hast du dir gemerkt', 'Stark erinnert', 'Landung geglückt']

// ---------- Hilfen in der Seite ----------
const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
const card = (p) => p.locator('.arena .a-card')
const btn = (p, sel, text) => card(p).locator(sel).filter({ hasText: exact(text) })
const click = (l) => l.first().click({ force: true })

async function currentId(p) {
  const prompt = (await p.locator('.a-prompt').textContent()).trim()
  if (PROMPT[prompt]) return PROMPT[prompt]
  const s = await p.locator('.g-sentence').textContent()
  return s.includes('Oben in der Luft') ? 'd2' : 'd9'
}
async function counter(p) {
  const [i, n] = (await p.locator('.a-count').textContent()).split('/').map(Number)
  return { i, n }
}
const msg = async (p) => (await p.locator('.a-msg').count()) ? (await p.locator('.a-msg').innerText()).replace(/\s+/g, ' ') : ''
const phaseSolved = async (p) => (await p.locator('.a-next').count()) > 0

// Ein richtiger Teilschritt bzw. die ganze Antwort (Einzelantwort)
async function stepRight(p, id) {
  const d = Q[id]
  switch (d.type) {
    case 'mc': return click(btn(p, '.g-btn', d.right))
    case 'wc': return click(btn(p, '.g-btn', d.right))
    case 'det': return click(card(p).locator('.g-btn').filter({ hasText: d.right }))
    case 'sort': {
      const t = (await card(p).locator('.g-chips .g-btn').first().textContent()).trim()
      await click(btn(p, '.g-chips .g-btn', t))
      return click(card(p).locator('.g-box').filter({ has: p.locator('b', { hasText: exact(d.box[t]) }) }))
    }
    case 'pair': {
      const left = card(p).locator('.g-col').nth(0).locator('.g-btn:not([disabled])').first()
      const t = (await left.textContent()).trim()
      await click(left)
      return click(card(p).locator('.g-col').nth(1).locator('.g-btn').filter({ hasText: exact(d.pairs.find((x) => x[0] === t)[1]) }))
    }
    case 'seq': {
      const n = await card(p).locator('.g-order li.ok').count()
      return click(btn(p, '.g-chips .g-btn', d.order[n]))
    }
    case 'bub': {
      for (const t of d.right) {
        const b = btn(p, '.g-bubble', t)
        if (!(await b.first().isDisabled())) return click(b)
      }
    }
  }
}
async function placeSpecific(p, id, which) {
  const d = Q[id]
  if (d.type === 'sort') { await click(btn(p, '.g-chips .g-btn', which)); return click(card(p).locator('.g-box').filter({ has: p.locator('b', { hasText: exact(d.box[which]) }) })) }
  if (d.type === 'pair') { const pr = d.pairs[which]; await click(btn(p, '.g-col >> nth=0 >> .g-btn', pr[0])); return click(card(p).locator('.g-col').nth(1).locator('.g-btn').filter({ hasText: exact(pr[1]) })) }
}
async function solveRest(p, id) {
  for (let k = 0; k < 10 && !(await phaseSolved(p)); k++) await stepRight(p, id)
}
// Ein Fehler an Teil k (bei Einzelantworten: k-te falsche Antwort)
async function wrongAt(p, id, k) {
  const d = Q[id]
  switch (d.type) {
    case 'mc': case 'wc': return click(btn(p, '.g-btn', d.wrong[k]))
    case 'det': return click(card(p).locator('.g-btn').filter({ hasText: d.wrong[k] }))
    case 'sort': {
      const t = ['Regen', 'Wind', 'Schnee'][k]
      await click(btn(p, '.g-chips .g-btn', t))
      const wrongBox = d.box[t] === 'Niederschlag' ? 'Kein Niederschlag' : 'Niederschlag'
      return click(card(p).locator('.g-box').filter({ has: p.locator('b', { hasText: exact(wrongBox) }) }))
    }
    case 'pair': {
      await click(btn(p, '.g-col >> nth=0 >> .g-btn', d.pairs[k][0]))
      return click(card(p).locator('.g-col').nth(1).locator('.g-btn').filter({ hasText: exact(d.pairs[(k + 1) % 3][1]) }))
    }
    case 'seq': return click(btn(p, '.g-chips .g-btn', d.order[3]))
    case 'bub': return click(btn(p, '.g-bubble', d.wrong[k]))
  }
}

// Prüft nach einem nicht aufdeckenden Fehler: Hinweis, Sperre, Flash, danach wieder frei
async function checkMistakeHint(p, id, tag, opts = {}) {
  const d = Q[id]
  const m = await msg(p)
  ok(`${tag}: Hinweis „Kurz durchatmen!“ + Denkanstoß`, m.includes('Kurz durchatmen') && m.includes(HINT_DE[d.type]), m)
  ok(`${tag}: kein „Weiter“ nach Fehler`, !(await phaseSolved(p)))
  // Sperre: alle Spielknöpfe gesperrt, Tippen bewirkt nichts
  // Lautsprecher (.a-say) gehört nicht zum Spiel und bleibt bedienbar
  const enabled = await card(p).locator('button:not([disabled]):not(.a-say)').count()
  ok(`${tag}: Sperre aktiv (alle Spielknöpfe gesperrt)`, enabled === 0, `frei: ${enabled}`)
  if (MULTI.has(d.type) && d.type !== 'bub') {
    ok(`${tag}: falscher Teil leuchtet (flash)`, (await card(p).locator('.flash').count()) > 0)
  }
  if (opts.tryDuringLock) {
    // jeden Spielknopf einmal antippen (gesperrt → darf nichts bewirken)
    const n = await card(p).locator('button').count()
    for (let k = 0; k < n; k++) await card(p).locator('button').nth(k).click({ force: true, timeout: 300 }).catch(() => {})
    const st = await p.evaluate(() => ({ chosen: document.querySelectorAll('.arena .a-card .sel, .arena .a-card .ok, .arena .a-card .popped, .arena .a-card .mine').length }))
    ok(`${tag}: Tippen während der Sperre ignoriert`, !(await phaseSolved(p)) && (await msg(p)).includes('Kurz durchatmen') && st.chosen === 0, `markiert ${st.chosen}`)
  }
  await p.waitForTimeout(LOCK)
  const after = await card(p).locator('button:not([disabled])').count()
  ok(`${tag}: nach 1 s wieder frei`, after > 0, `frei: ${after}`)
  if (MULTI.has(d.type) && d.type !== 'bub') ok(`${tag}: flash nach 1 s weg`, (await card(p).locator('.flash').count()) === 0)
}

// Prüft aufgedeckte Lösung
async function checkRevealed(p, id, tag, kind, mineExpected) {
  const d = Q[id]
  const m = await msg(p)
  ok(`${tag}: Lösungstext`, m.includes('So ist es richtig'), m)
  ok(`${tag}: „Weiter“ erscheint`, (await p.locator('.a-next').count()) === 1)
  ok(`${tag}: pitStopNext nur bei normaler Frage`, m.includes('Die üben wir am Ende') === (kind === 'normal'), m)
  // yoursKept nur, wenn schon Teile richtig lagen (Arena: steps > 0); das prüft store.spec nicht, hier nur: kein yoursKept bei Einzelantworten
  if (!MULTI.has(d.type)) ok(`${tag}: kein yoursKept bei Einzelantwort`, !m.includes('Grün markiert'), m)
  switch (d.type) {
    case 'mc': ok(`${tag}: richtige Antwort als shown`, (await card(p).locator('.g-btn.shown').innerText()).trim() === d.right); break
    case 'wc': ok(`${tag}: Lücke gefüllt (shown)`, (await card(p).locator('.g-gap.shown').innerText()).trim() === d.right); break
    case 'det':
      ok(`${tag}: falscher Satz markiert`, (await card(p).locator('.g-btn.shown').innerText()).includes(d.right))
      ok(`${tag}: Auflösungstext sichtbar`, await card(p).locator('.g-reveal').isVisible()); break
    case 'sort': {
      ok(`${tag}: keine Begriffe mehr übrig`, (await card(p).locator('.g-chips .g-btn').count()) === 0)
      const mine = await card(p).locator('.g-inbox i.mine').count(), shown = await card(p).locator('.g-inbox i.shown').count()
      ok(`${tag}: eigene grün (mine=${mineExpected}), Rest shown`, mine === mineExpected && shown === 6 - mineExpected, `mine ${mine}, shown ${shown}`)
      for (const box of ['Niederschlag', 'Kein Niederschlag']) {
        const items = await card(p).locator('.g-box').filter({ has: p.locator('b', { hasText: exact(box) }) }).locator('.g-inbox i').allInnerTexts()
        ok(`${tag}: Kiste „${box}“ richtig gefüllt`, items.every((t) => d.box[t.trim()] === box) && items.length === 3, items.join(','))
      }
      break
    }
    case 'pair': {
      const okN = await card(p).locator('.g-btn.ok').count(), shownN = await card(p).locator('.g-btn.shown').count()
      ok(`${tag}: eigene Paare ok (${mineExpected}), Rest shown`, okN === 2 * mineExpected && shownN === 2 * (3 - mineExpected), `ok ${okN}, shown ${shownN}`)
      // Erkennt man, welche Karten zusammengehören? Aufgedeckt stehen die Paare zeilenweise nebeneinander (links, rechts)
      const all = (await card(p).locator('.g-btn').allInnerTexts()).map((t) => t.trim())
      const rows = []
      for (let k = 0; k + 1 < all.length; k += 2) rows.push([all[k], all[k + 1]])
      ok(`${tag}: aufgedeckte Paare stehen zeilenweise zusammen`, rows.length === 3 && rows.every(([l, r]) => d.pairs.some((x) => x[0] === l && x[1] === r)), JSON.stringify(rows))
      break
    }
    case 'seq': {
      const lis = (await card(p).locator('.g-order li').allInnerTexts()).map((t) => t.replace(/^\d+\s*/, '').trim())
      ok(`${tag}: Reihenfolge vollständig`, JSON.stringify(lis) === JSON.stringify(d.order), lis.join(' | '))
      const okN = await card(p).locator('.g-order li.ok').count(), shownN = await card(p).locator('.g-order li.shown').count()
      ok(`${tag}: eigene Schritte ok (${mineExpected}), Rest shown`, okN === mineExpected && shownN === 4 - mineExpected, `ok ${okN}, shown ${shownN}`)
      break
    }
  }
}

// Spielt die aktuelle Frage nach Szenario. Gibt {firstTry, revealed} zurück.
async function playQuestion(p, id, scenario, tag, kind) {
  const d = Q[id]
  const multi = MULTI.has(d.type)
  if (scenario === 'right') {
    if (d.type === 'sort') {
      await stepRight(p, id)
      ok(`${tag}: Teilschritt Sortieren – Begriff in Kiste (mine)`, (await card(p).locator('.g-inbox i.mine').count()) === 1 && (await card(p).locator('.g-chips .g-btn').count()) === 5)
      ok(`${tag}: Sortieren noch nicht gelöst nach 1 Schritt`, !(await phaseSolved(p)))
    }
    if (d.type === 'pair') {
      await stepRight(p, id)
      ok(`${tag}: Teilschritt Paare – Paar ok`, (await card(p).locator('.g-btn.ok').count()) === 2 && !(await phaseSolved(p)))
    }
    if (d.type === 'seq') {
      await stepRight(p, id); await stepRight(p, id)
      ok(`${tag}: Teilschritt Reihenfolge – 2 Plätze ok`, (await card(p).locator('.g-order li.ok').count()) === 2 && !(await phaseSolved(p)))
    }
    if (d.type === 'bub') {
      ok(`${tag}: Blasen-Hinweis „Noch 4 Blasen“`, (await card(p).locator('.g-hint').innerText()).includes('Noch 4 Blasen'))
      await stepRight(p, id)
      ok(`${tag}: Teilschritt Blasen – 1 geplatzt, „Noch 3 Blasen“`, (await card(p).locator('.g-bubble.popped').count()) === 1 && (await card(p).locator('.g-hint').innerText()).includes('Noch 3 Blasen'))
    }
    await solveRest(p, id)
    const m = await msg(p)
    ok(`${tag}: richtig im 1. Versuch → Lob`, (multi || d.type === 'bub') ? m.includes('Alles richtig zugeordnet') : PRAISE_DE.some((x) => m.includes(x)), m)
    ok(`${tag}: kein „Geschafft“ beim 1. Versuch`, !m.includes('Geschafft'))
    return { firstTry: true, revealed: false }
  }
  if (scenario === 'oneWrong') {
    await wrongAt(p, id, 0)
    await checkMistakeHint(p, id, tag, { tryDuringLock: true })
    await solveRest(p, id)
    const m = await msg(p)
    ok(`${tag}: 1 Fehler, dann richtig → „Geschafft …“`, m.startsWith('Geschafft'), m)
    return { firstTry: false, revealed: false }
  }
  if (scenario === 'reveal') {
    if (!multi) {
      await wrongAt(p, id, 0); await checkMistakeHint(p, id, tag)
      await wrongAt(p, id, 1)
      await checkRevealed(p, id, tag, kind, 0)
      return { firstTry: false, revealed: true }
    }
    if (d.type === 'bub') {
      // Nur 2 falsche Blasen: 3 Fehler unmöglich, gleicher Teil zweimal gesperrt → kein Aufdecken möglich
      await wrongAt(p, id, 0); await checkMistakeHint(p, id, tag)
      await wrongAt(p, id, 1)
      ok(`${tag}: Blasen nach 2 Fehlern (versch. Teile) noch nicht aufgedeckt`, !(await phaseSolved(p)))
      await p.waitForTimeout(LOCK)
      await solveRest(p, id)
      ok(`${tag}: Blasen danach gelöst → „Geschafft“`, (await msg(p)).startsWith('Geschafft'))
      return { firstTry: false, revealed: false }
    }
    // zufällig: gleicher Teil zweimal oder drei verschiedene Teile
    if (scenario === 'reveal' && (tag.length % 2 === 0)) return playQuestion(p, id, 'multiSame', tag, kind)
    return playQuestion(p, id, 'multi3', tag, kind)
  }
  if (scenario === 'multiSame') {
    // erst einen Teil richtig, dann derselbe Teil zweimal falsch
    let mine = 0
    if (d.type === 'sort') { await placeSpecific(p, id, 'Hagel'); mine = 1 }
    if (d.type === 'pair') { await placeSpecific(p, id, 2); mine = 1 }
    if (d.type === 'seq') { await stepRight(p, id); mine = 1 }
    await wrongAt(p, id, 0); await checkMistakeHint(p, id, tag + ' (gleicher Teil 1)')
    await wrongAt(p, id, 0)
    ok(`${tag}: 2. Fehler am selben Teil → aufgedeckt`, await phaseSolved(p))
    await checkRevealed(p, id, tag + ' (gleicher Teil)', kind, mine)
    return { firstTry: false, revealed: true }
  }
  if (scenario === 'multi3') {
    let mine = 0
    await wrongAt(p, id, 0); await checkMistakeHint(p, id, tag + ' (Teil A)')
    if (d.type === 'seq') { await stepRight(p, id); mine++ }
    await wrongAt(p, id, 1)
    ok(`${tag}: 2 Fehler an verschiedenen Teilen → noch nicht aufgedeckt`, !(await phaseSolved(p)), await msg(p))
    await checkMistakeHint(p, id, tag + ' (Teil B)')
    if (d.type === 'seq') { await stepRight(p, id); mine++ }
    await wrongAt(p, id, 2)
    ok(`${tag}: 3. Fehler → aufgedeckt`, await phaseSolved(p))
    await checkRevealed(p, id, tag + ' (3 Fehler)', kind, mine)
    return { firstTry: false, revealed: true }
  }
  throw new Error('unbekanntes Szenario ' + scenario)
}

// Layout-Prüfung je Frage: kein seitliches Scrollen, Spalten
async function checkLayout(p, id, sizeName, tag) {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok(`${tag}: kein seitliches Scrollen (${sizeName})`, over <= 0, `Überstand ${over}px`)
  const cols = (sel) => card(p).locator(sel).first().evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)
  const d = Q[id]
  if (d.type === 'mc') { const c = await cols('.g-choices'); ok(`${tag}: Antworten ${sizeName === 'iphone' ? 1 : 2} Spalte(n)`, c === (sizeName === 'iphone' ? 1 : 2), `${c}`) }
  if (d.type === 'sort') { const c = await cols('.g-boxes'); ok(`${tag}: Kisten 2 Spalten`, c === 2, `${c}`) }
  if (d.type === 'pair') { const c = await cols('.g-pairs'); ok(`${tag}: Paare 2 Spalten`, c === 2, `${c}`) }
  // Tippflächen mindestens 44 px (Kinder-Regel: 60)
  const small = await card(p).locator('button').evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44) }).map((e) => e.textContent.trim()))
  ok(`${tag}: Tippflächen ≥ 44 px`, small.length === 0, small.join(','))
  const cut = await p.evaluate(() => [...document.querySelectorAll('.arena button, .arena .a-msg')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 0.5 || r.left < -0.5 }).length)
  ok(`${tag}: nichts rechts/links abgeschnitten`, cut === 0, `${cut}`)
}

// Spielt eine ganze Runde mit Modell der Arena-Regeln und prüft Zähler, Notbremse, Wiederholung, Sterne.
async function playRound(p, chooser, label, sizeName, shotPrefix) {
  const model = { total: 10, slots: [], log: [], rescued: false }
  const order = []
  let idx = 0
  const kinds = Array(10).fill('normal')
  const ids = []
  for (let guard = 0; guard < 40; guard++) {
    if (await p.locator('.a-chest').count()) break
    const { i, n } = await counter(p)
    const id = await currentId(p)
    const kind = kinds[idx] ?? 'normal'
    const tag = `${label} #${idx + 1} ${id} (${Q[id].type}, ${kind})`
    ok(`${tag}: Zähler ${idx + 1}/${model.total}`, i === idx + 1 && n === model.total, `angezeigt ${i}/${n}`)
    const vmax = Number(await p.locator('.a-bar').getAttribute('aria-valuemax'))
    const vnow = Number(await p.locator('.a-bar').getAttribute('aria-valuenow'))
    const wcls = await p.locator('.a-bar > i').getAttribute('class')
    ok(`${tag}: Fortschritt ${idx}/${model.total}`, vmax === model.total && vnow === idx && wcls === `w${Math.round((idx / model.total) * 20)}`, `${vnow}/${vmax} ${wcls}`)
    const note = (await p.locator('.a-note').count()) ? await p.locator('.a-note').first().innerText() : ''
    if (kind === 'repeat') ok(`${tag}: Einleitung repeatIntro`, note.includes('Noch einmal üben'), note)
    if (kind === 'rescue') ok(`${tag}: Einleitung rescueIntro`, note.includes('Die kennst du schon'), note)
    if (kind === 'normal') ok(`${tag}: keine Einleitung`, !note.includes('Noch einmal üben') && !note.includes('Die kennst du schon'), note)
    if (kind === 'rescue') ok(`${tag}: sichere Frage war im 1. Versuch gelöst`, model.log.some((a) => a.firstTry && a.id === id))
    if (kind === 'repeat') ok(`${tag}: Wiederholung ist eine aufgedeckte Frage`, model.log.some((a) => a.kind === 'normal' && a.revealed && a.id === id))
    await checkLayout(p, id, sizeName, tag)
    if (kind === 'normal') { order.push(id); ids.push(id) }
    const scenario = kind === 'normal' ? chooser(order.length - 1, id) : 'right'
    const r = await playQuestion(p, id, scenario, tag, kind)
    if (shotPrefix && r.revealed) await p.screenshot({ path: join(SHOTS, `${shotPrefix}-${id}-aufgedeckt.png`) }).catch(() => {})
    model.log.push({ id, kind, ...r })
    // „Weiter“ / „Zur Schatzkiste“ erwartet?
    const normals = model.log.filter((a) => a.kind === 'normal')
    const lastNormalIdx = (() => { let at = -1; kinds.forEach((k, j) => { if (k === 'normal' && j < model.total) at = j }); return at })()
    // Modell: nächster Schritt
    let willRescue = false
    const last2 = normals.slice(-2)
    if (!model.rescued && kind === 'normal' && last2.length === 2 && last2.every((a) => a.revealed) && model.log.some((a) => a.firstTry)) {
      willRescue = true
    }
    let expectedTotal = model.total + (willRescue ? 1 : 0)
    const kinds2 = [...kinds.slice(0, idx + 1), ...(willRescue ? ['rescue'] : []), ...kinds.slice(idx + 1)]
    const lastNormal2 = kinds2.slice(0, expectedTotal).lastIndexOf('normal')
    let appended = 0
    if (idx === lastNormal2) {
      appended = normals.filter((a) => a.revealed).length
    }
    const nextLabel = (await p.locator('.a-next').innerText()).trim()
    const finishExpected = idx + 1 >= model.total && (kind === 'repeat' || !normals.some((a) => a.revealed))
    ok(`${tag}: Knopf „${finishExpected ? 'Zur Schatzkiste' : 'Weiter'}“`, nextLabel === (finishExpected ? 'Zur Schatzkiste' : 'Weiter'), nextLabel)
    await click(p.locator('.a-next'))
    if (willRescue) { model.rescued = true; kinds.splice(idx + 1, 0, 'rescue') }
    if (appended) { const k = kinds.slice(0, expectedTotal); for (let a = 0; a < appended; a++) k.push('repeat'); kinds.length = 0; kinds.push(...k) }
    model.total = expectedTotal + appended
    idx++
    void lastNormalIdx
  }
  ok(`${label}: Schatzkiste erreicht`, (await p.locator('.a-chest').count()) === 1)
  const normals = model.log.filter((a) => a.kind === 'normal')
  const right = normals.filter((a) => a.firstTry).length
  const stars = right + (normals.length >= 5 ? 3 : 0)
  const shown = (await p.locator('.a-stars .num').innerText()).trim()
  ok(`${label}: Sterne +${stars}`, shown === `+${stars}`, `angezeigt ${shown}`)
  const starsText = await p.locator('.a-stars').innerText()
  ok(`${label}: Zahl nicht doppelt im Sternetext`, (starsText.match(/\d+/g) || []).length === 1, starsText)
  const kept = normals.filter((a) => !a.firstTry).length
  const effort = await p.locator('.a-effort').innerText()
  ok(`${label}: Mühe-Satz`, kept ? effort.includes(`Bei ${kept} Frage`) : effort.includes('Alles beim ersten Versuch'), effort)
  const all = await p.locator('.a-end').innerText()
  ok(`${label}: „${right} von ${normals.length}“`, all.includes(`${right} von ${normals.length} Fragen gleich beim ersten Versuch`), all.replace(/\s+/g, ' '))
  ok(`${label}: Bonus-Text nur ab 5`, all.includes('+3 Sterne für die ganze Runde') === (normals.length >= 5))
  ok(`${label}: Demo-Hinweis`, all.includes('Proberunde mit Beispielstoff'))
  const effPos = all.indexOf(effort.trim()), rightPos = all.indexOf(`${right} von`)
  ok(`${label}: Mühe-Satz vor „x von n“`, effPos >= 0 && effPos < rightPos)
  return { model, order, stars }
}

async function newPage(browser, size, { theme = 'light', reduced = true, storage = {} } = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: size === 'desktop' ? 1 : 2, hasTouch: size !== 'desktop', isMobile: size === 'iphone' })
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('bb-init')) { sessionStorage.setItem('bb-init', '1'); localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) } }, { 'braincraft:demo': '1', ...storage })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => consoleErrors.push(`${size}: pageerror ${e.message}`))
  // WebKit: Playwright-Screenshots fügen ein Inline-Stylesheet ein, das die CSP (style-src 'self') ablehnt → kein App-Fehler
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Refused to apply a stylesheet')) consoleErrors.push(`${size}: ${m.text()}`) })
  await p.goto(BASE)
  await p.waitForSelector('.quickbtn')
  return { ctx, p }
}
const startRound = async (p, text = 'Tages-Training') => { await click(p.locator('.quickbtn').filter({ hasText: text })); await p.waitForSelector('.arena .a-card') }

// =====================================================================
const browser = await pw[process.env.BROWSER ?? 'chromium'].launch()
try {
  // ---- Runde 1: alles richtig (iPhone hell, mit Name) ----
  {
    const { ctx, p } = await newPage(browser, 'iphone', { storage: { 'braincraft:name': 'Mia' } })
    await startRound(p)
    ok('Runde: body.playing gesetzt', await p.evaluate(() => document.body.classList.contains('playing')))
    ok('Runde: Kopfzeile/Tab-Leiste weg', (await p.locator('.top').count()) === 0 && (await p.locator('.tabbar').count()) === 0)
    // Lob mit Name: über die erste Frage
    const r1 = await playRound(p, () => 'right', 'R1 alles richtig', 'iphone', 'r1')
    ok('R1: Name im Rundentitel', (await p.locator('.a-title').innerText()).includes('Mia'))
    await p.screenshot({ path: join(SHOTS, 'r1-schatzkiste-iphone.png') })
    // „Noch eine Runde“ neu gemischt
    await click(p.getByRole('button', { name: 'Noch eine Runde' }))
    await p.waitForSelector('.arena .a-card')
    const { n } = await counter(p)
    ok('Noch eine Runde: neue Runde 1/10', n === 10 && (await counter(p)).i === 1)
    const r1b = await playRound(p, () => 'right', 'R1b zweite Runde', 'iphone')
    ok('Noch eine Runde: neu gemischt', JSON.stringify(r1.order) !== JSON.stringify(r1b.order), `${r1.order.join(',')} vs ${r1b.order.join(',')}`)
    // Zurück
    await click(p.getByRole('button', { name: 'Zurück zur Zentrale' }))
    await p.waitForSelector('.quickbtn')
    ok('Zurück: Startseite', (await p.locator('.quickbtn').count()) === 2)
    ok('Zurück: body.playing entfernt', !(await p.evaluate(() => document.body.classList.contains('playing'))))
    ok('Zurück: Kopfzeile sichtbar', await p.locator('header.top').isVisible())
    ok('Zurück: Tab-Leiste sichtbar', await p.locator('nav.tabbar').isVisible())
    // Runde beenden über X mitten im Spiel
    await startRound(p)
    await click(p.locator('.arena .x'))
    await p.waitForSelector('.quickbtn')
    ok('X: Runde beendet, body.playing entfernt', !(await p.evaluate(() => document.body.classList.contains('playing'))) && (await p.locator('nav.tabbar').isVisible()))
    await ctx.close()
  }

  // ---- Runde 2: überall ein Fehler (iPad dunkel) ----
  {
    const { ctx, p } = await newPage(browser, 'ipad', { theme: 'dark' })
    await startRound(p)
    await playRound(p, () => 'oneWrong', 'R2 ein Fehler', 'ipad', null)
    await p.screenshot({ path: join(SHOTS, 'r2-schatzkiste-ipad-dunkel.png') })
    await ctx.close()
  }

  // ---- Runde 3: überall aufdecken (Desktop hell) → keine Notbremse (nichts im 1. Versuch), Wiederholungen ----
  {
    const { ctx, p } = await newPage(browser, 'desktop')
    await startRound(p)
    await playRound(p, () => 'reveal', 'R3 aufdecken', 'desktop', 'r3')
    await ctx.close()
  }

  // ---- Runde 4: Notbremse (iPhone dunkel): 1 richtig, dann aufdecken bis 2 in Folge, später erneut 2 ----
  for (const variant of ['a', 'b']) {
    const { ctx, p } = await newPage(browser, 'iphone', { theme: 'dark' })
    await startRound(p)
    const plan = variant === 'a' ? ['right', 'reveal', 'reveal', 'right', 'reveal', 'reveal', 'right', 'right', 'right', 'right']
      : ['right', 'right', 'reveal', 'reveal', 'reveal', 'reveal', 'reveal', 'oneWrong', 'right', 'reveal']
    const res = await playRound(p, (i) => plan[i], `R4${variant} Notbremse`, 'iphone', `r4${variant}`)
    const rescues = res.model.log.filter((a) => a.kind === 'rescue').length
    const pairsInRow = (() => { const n = res.model.log.filter((a) => a.kind === 'normal'); for (let k = 1; k < n.length; k++) if (n[k].revealed && n[k - 1].revealed) return true; return false })()
    console.log(`R4${variant}: Ablauf ${res.model.log.map((a) => `${a.id}:${a.kind[0]}${a.revealed ? '!' : a.firstTry ? '+' : '~'}`).join(' ')}`)
    ok(`R4${variant}: Notbremse höchstens einmal`, rescues <= 1, `${rescues}`)
    ok(`R4${variant}: Notbremse genau einmal, wenn 2 aufgedeckte in Folge`, rescues === (pairsInRow ? 1 : 0), `rescues ${rescues}, zwei in Folge ${pairsInRow}`)
    ok(`R4${variant}: Wiederholungen nicht erneut angehängt`, res.model.log.filter((a) => a.kind === 'repeat').length === res.model.log.filter((a) => a.kind === 'normal' && a.revealed).length)
    await ctx.close()
  }

  // ---- Shake bei jedem Fehler (ohne reduced motion) ----
  {
    const { ctx, p } = await newPage(browser, 'desktop', { reduced: false })
    await startRound(p)
    const id = await currentId(p)
    const anim = () => p.locator('.a-card').evaluate((e) => e.getAnimations().filter((a) => a.animationName.startsWith('bc-shake')).length)
    await wrongAt(p, id, 0)
    const a1 = await anim()
    await p.waitForTimeout(LOCK)
    await wrongAt(p, id, 1)
    const a2 = await anim()
    ok(`Wackeln beim 1. Fehler (${id})`, a1 === 1, `${a1}`)
    ok(`Wackeln beim 2. Fehler (${id})`, a2 === 1, `${a2} laufende bc-shake-Animationen`)
    await ctx.close()
  }

  // ---- Englisch: alle Arena-Texte übersetzt, bleibt nach Neuladen ----
  {
    const { ctx, p } = await newPage(browser, 'iphone')
    await click(p.locator('button.gear'))
    await click(p.locator('.seg label').filter({ hasText: 'English' }))
    ok('EN: html lang=en', (await p.evaluate(() => document.documentElement.lang)) === 'en')
    await click(p.locator('.st-done'))
    await p.reload(); await p.waitForSelector('.quickbtn')
    ok('EN: bleibt nach Neuladen', (await p.evaluate(() => document.documentElement.lang)) === 'en' && (await p.locator('.quickbtn').first().innerText()).includes('Daily training'))
    await startRound(p, 'Daily training')
    const GERMAN = /\b(Frage|Weiter|Kurz durchatmen|Geschafft|Tippe|Kiste|Blasen?|Zurück|Runde|Sterne?|Schatzkiste|stimmt|Was kommt|Gut überlegt|Genau hingeschaut|Alles richtig|Grün markiert|Die üben wir|Noch einmal|Die kennst du|Welche Antwort|Lies|Prüfe|Fang|Gehört|Proberunde|Jede|von)\b/
    const uiTexts = async () => p.evaluate(() => {
      const out = []
      document.querySelectorAll('.arena .kicker, .arena .a-msg, .arena .a-next, .arena .g-hint, .arena .a-note, .arena .a-count, .arena .g-tag, .arena .a-end h1, .arena .a-end p, .arena .a-end button').forEach((e) => out.push(e.innerText))
      document.querySelectorAll('.arena [aria-label]').forEach((e) => out.push(e.getAttribute('aria-label')))
      document.querySelectorAll('.g-order li').forEach((e) => { if (!e.classList.contains('ok') && !e.classList.contains('shown')) out.push(e.innerText.replace(/^\d+\s*/, '')) })
      return out
    })
    const bad = new Set()
    let idx = 0
    for (let guard = 0; guard < 40 && !(await p.locator('.a-chest').count()); guard++) {
      const id = await currentId(p)
      ;(await uiTexts()).forEach((t) => { if (GERMAN.test(t)) bad.add(t) })
      // Fehler machen, damit Hinweis/Lösung erscheinen
      if (idx < 3) {
        await wrongAt(p, id, 0).catch(() => {})
        ;(await uiTexts()).forEach((t) => { if (GERMAN.test(t)) bad.add(t) })
        await p.waitForTimeout(LOCK)
        await wrongAt(p, id, 0).catch(() => {})
        if (!(await phaseSolved(p))) { await p.waitForTimeout(LOCK); await wrongAt(p, id, 1).catch(() => {}) }
        if (!(await phaseSolved(p))) { await p.waitForTimeout(LOCK); await solveRest(p, id) }
      } else await solveRest(p, id)
      ;(await uiTexts()).forEach((t) => { if (GERMAN.test(t)) bad.add(t) })
      await click(p.locator('.a-next'))
      idx++
    }
    ;(await uiTexts()).forEach((t) => { if (GERMAN.test(t)) bad.add(t) })
    ok('EN: keine deutschen Texte in der Arena', bad.size === 0, [...bad].join(' ‖ '))
    ok('EN: Schatzkiste englisch', (await p.locator('.a-end').innerText()).includes('Another round'))
    await p.screenshot({ path: join(SHOTS, 'en-schatzkiste-iphone.png') })
    await ctx.close()
  }
} finally {
  await browser.close()
}

ok('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' ‖ '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} Prüfpunkte bestanden`)
// gleiche Fehler zusammenfassen
const groups = new Map()
for (const f of failed) { const k = f.name.replace(/^R\d\w* [^#]*#\d+ /, '').replace(/#\d+ /, ''); groups.set(k, [...(groups.get(k) ?? []), f]) }
for (const [k, fs] of groups) console.log(`FEHLER (${fs.length}×) ${k}  — z. B. ${fs[0].name}: ${fs[0].detail}`)
process.exit(failed.length ? 1 : 0)
