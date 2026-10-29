// Bug-Bodo: Unit-Tests für src/lib/session.ts (buildRound, isEve, rescueQuestion) und fillName (src/lib/i18n.ts).
// Aufruf (Node 24, TypeScript direkt):
//   cd /Users/marcokland/Apps/BrainCraft && TZ=Europe/Berlin node --test tests/session.test.ts
// Ergebnis: Exit-Code 0 = alles bestanden.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// i18n.ts importiert './prefs' ohne Endung (Vite-Stil): für Node die Endung .ts ergänzen.
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

// prefs.ts setzt beim Laden Thema und Sprache am Dokument: minimale Attrappe für Node
const g = globalThis as any
g.document ??= { documentElement: { lang: '', setAttribute() {}, removeAttribute() {} }, querySelectorAll: () => [] }
g.matchMedia ??= () => ({ matches: false })

const { buildRound, isEve, rescueQuestion, ROUND_MAX, CHILL_SIZE } = await import('../src/lib/session.ts')
const { fillName } = await import('../src/lib/i18n.ts')
import type { Progress, Question } from '../src/lib/types.ts'

const NOW = new Date(2026, 9, 24, 12, 0, 0) // 24.10.2026 12:00 lokal
const DAY = 86_400_000
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString()

const mkQ = (id: string): Question => ({
  id, exam_id: 'x', type: 'multiple_choice', prompt: id,
  payload: { options: ['a', 'b'], correct_index: 0, explanation: '' },
})

// Baut Pool + Progress aus Gruppen: low = fällig Stufe 1/2, high = fällig Stufe 3/4, fresh = ohne Progress, soon = noch nicht fällig
function setup(g: { low?: number; fresh?: number; high?: number; soon?: number; box5due?: number }) {
  const qs: Question[] = []
  const pr: Progress[] = []
  const add = (prefix: string, n: number, box?: number, off?: number) => {
    for (let i = 0; i < n; i++) {
      const id = `${prefix}${i}`
      qs.push(mkQ(id))
      if (box !== undefined) pr.push({ question_id: id, leitner_box: box, next_review_at: iso(off! + i * 0.01), consecutive_correct: 0 })
    }
  }
  add('low', g.low ?? 0, 1, -1)
  add('fresh', g.fresh ?? 0)
  add('high', g.high ?? 0, 3, -1)
  // soon: aufsteigend fällig in 1, 2, 3 … Tagen
  for (let i = 0; i < (g.soon ?? 0); i++) {
    const id = `soon${i}`
    qs.push(mkQ(id))
    pr.push({ question_id: id, leitner_box: 2, next_review_at: iso(i + 1), consecutive_correct: 0 })
  }
  add('fivedue', g.box5due ?? 0, 5, -1)
  return { qs, pr }
}
const count = (r: Question[], prefix: string) => r.filter((q) => q.id.startsWith(prefix)).length
const noDupes = (r: Question[]) => assert.equal(new Set(r.map((q) => q.id)).size, r.length, 'doppelte Frage in der Runde')

// ---------- buildRound ----------
test('voller Pool: 4 fällig 1/2, 4 neu, 2 fällig 3/4 = 10', () => {
  const { qs, pr } = setup({ low: 6, fresh: 6, high: 4, soon: 5 })
  for (let k = 0; k < 50; k++) {
    const r = buildRound(qs, pr, { now: NOW })
    assert.equal(r.length, ROUND_MAX)
    assert.equal(count(r, 'low'), 4)
    assert.equal(count(r, 'fresh'), 4)
    assert.equal(count(r, 'high'), 2)
    assert.equal(count(r, 'soon'), 0)
    noDupes(r)
  }
})

test('Auffüllen: erst fällig 1/2', () => {
  const { qs, pr } = setup({ low: 9, fresh: 1, high: 0, soon: 5 })
  const r = buildRound(qs, pr, { now: NOW })
  assert.equal(r.length, 10)
  assert.equal(count(r, 'low'), 9)
  assert.equal(count(r, 'fresh'), 1)
  assert.equal(count(r, 'soon'), 0)
})

test('Auffüllen: dann neu', () => {
  const { qs, pr } = setup({ low: 1, fresh: 9, high: 3, soon: 5 })
  const r = buildRound(qs, pr, { now: NOW })
  assert.equal(count(r, 'low'), 1)
  assert.equal(count(r, 'high'), 2)
  assert.equal(count(r, 'fresh'), 7)
})

test('Auffüllen: dann fällig 3/4, dann bald fällig (früheste zuerst)', () => {
  const { qs, pr } = setup({ low: 1, fresh: 1, high: 4, soon: 6 })
  for (let k = 0; k < 30; k++) {
    const r = buildRound(qs, pr, { now: NOW })
    assert.equal(r.length, 10)
    assert.equal(count(r, 'high'), 4)
    assert.equal(count(r, 'soon'), 4)
    assert.deepEqual(r.filter((q) => q.id.startsWith('soon')).map((q) => q.id).sort(), ['soon0', 'soon1', 'soon2', 'soon3'])
  }
})

test('Stufe 5 fällig zählt bei den 1–2 aus Stufe 3/4 mit (Beobachtung)', () => {
  const { qs, pr } = setup({ fresh: 0, box5due: 3 })
  const r = buildRound(qs, pr, { now: NOW })
  assert.equal(r.length, 3)
})

test('weniger als 5 Fragen im Pool: kürzere Runde mit allem, was da ist', () => {
  const { qs, pr } = setup({ low: 1, fresh: 1, soon: 1 })
  const r = buildRound(qs, pr, { now: NOW })
  assert.equal(r.length, 3)
  noDupes(r)
})

test('genau 5 und 7 Fragen: Runde 5 bzw. 7', () => {
  assert.equal(buildRound(setup({ fresh: 5 }).qs, [], { now: NOW }).length, 5)
  const s = setup({ low: 2, fresh: 2, high: 1, soon: 2 })
  assert.equal(buildRound(s.qs, s.pr, { now: NOW }).length, 7)
})

test('leerer Pool: leere Runde', () => {
  assert.deepEqual(buildRound([], [], { now: NOW }), [])
  assert.deepEqual(buildRound([], [], { mode: 'chill', now: NOW }), [])
})

test('Progress zu Fragen außerhalb des Pools stört nicht', () => {
  const { qs } = setup({ fresh: 3 })
  const r = buildRound(qs, [{ question_id: 'fremd', leitner_box: 1, next_review_at: iso(-1), consecutive_correct: 0 }], { now: NOW })
  assert.equal(r.length, 3)
})

test('chill: nur Stufe ≥ 3, höchstens 5', () => {
  const { qs, pr } = setup({ low: 5, fresh: 5, high: 4, soon: 3, box5due: 4 })
  // soon = Stufe 2 → nicht dabei
  for (let k = 0; k < 30; k++) {
    const r = buildRound(qs, pr, { mode: 'chill', now: NOW })
    assert.equal(r.length, CHILL_SIZE)
    assert.ok(r.every((q) => q.id.startsWith('high') || q.id.startsWith('fivedue')), 'chill mit Stufe < 3')
    noDupes(r)
  }
  // Stufe 3 noch nicht fällig zählt auch (chill fragt Bekanntes, nicht Fälliges)
  const p2: Progress[] = [{ question_id: 'a', leitner_box: 4, next_review_at: iso(5), consecutive_correct: 0 }]
  assert.equal(buildRound([mkQ('a'), mkQ('b')], p2, { mode: 'chill', now: NOW }).length, 1)
})

// ---------- isEve ----------
const ex = (d: string | null) => ({ id: 'e', title: 't', exam_date: d })
test('isEve: Vortag und Tag der Arbeit ja, sonst nein', () => {
  assert.equal(isEve(ex('2026-10-25'), NOW), true, 'Vortag')
  assert.equal(isEve(ex('2026-10-24'), NOW), true, 'Tag der Arbeit')
  assert.equal(isEve(ex('2026-10-26'), NOW), false, '2 Tage vorher')
  assert.equal(isEve(ex('2026-10-23'), NOW), false, 'Tag danach')
  assert.equal(isEve(ex(null), NOW), false, 'ohne Datum')
  assert.equal(isEve(undefined, NOW), false, 'ohne Arbeit')
})
test('isEve: Grenzen 0:00 und 23:59, Zeitumstellung 25.10.2026', () => {
  assert.equal(isEve(ex('2026-10-25'), new Date(2026, 9, 24, 0, 0, 0)), true, 'Vortag 0:00')
  assert.equal(isEve(ex('2026-10-25'), new Date(2026, 9, 23, 23, 59, 59)), false, '2 Tage vorher 23:59')
  assert.equal(isEve(ex('2026-10-25'), new Date(2026, 9, 25, 23, 59, 0)), true, 'Tag selbst 23:59 (Umstellungstag)')
  assert.equal(isEve(ex('2026-03-29'), new Date(2026, 2, 28, 0, 30)), true, 'Vortag Sommerzeit')
  assert.equal(isEve(ex('2026-03-30'), new Date(2026, 2, 28, 12)), false)
})

// ---------- rescueQuestion ----------
test('rescueQuestion: Stufe 3/4 vor 2 vor schon gelöst; ausgeschlossene nie', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map(mkQ)
  const p = (id: string, box: number): Progress => ({ question_id: id, leitner_box: box, next_review_at: iso(1), consecutive_correct: 0 })
  const prog = [p('a', 3), p('b', 2), p('c', 5), p('d', 1)]
  assert.equal(rescueQuestion(pool, prog, new Set(), [])!.id, 'a')
  assert.equal(rescueQuestion(pool, prog, new Set(['a']), [])!.id, 'b')
  const solved = [mkQ('z')]
  assert.equal(rescueQuestion(pool, prog, new Set(['a', 'b']), solved)!.id, 'z', 'Stufe 5/1 nicht nehmen, sondern gelöste')
  assert.equal(rescueQuestion(pool, [], new Set(), []), undefined)
})

// ---------- fillName ----------
test('fillName: Name einsetzen', () => {
  assert.equal(fillName('Super, [NAME]! Weiter, [NAME].', 'Mia'), 'Super, Mia! Weiter, Mia.')
})
test('fillName: ohne Name samt Komma entfernen', () => {
  assert.equal(fillName('Super, [NAME]!', ''), 'Super!')
  assert.equal(fillName('Weißt du es [NAME]?', ''), 'Weißt du es?')
})
test('fillName: [NAME] am Satzanfang ohne Name', () => {
  assert.equal(fillName('[NAME], was verdunstet?', ''), 'Was verdunstet?')
})
test('fillName: Name mit $-Zeichen wird wörtlich eingesetzt', () => {
  assert.equal(fillName('Hallo [NAME]!', 'Ali$&'), 'Hallo Ali$&!')
})
