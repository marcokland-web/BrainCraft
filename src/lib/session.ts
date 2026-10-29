import type { Exam, Progress, Question } from './types'

// Rundenaufbau nach Lern-Lotte (docs/pruefung/lern-lotte.md, docs/entscheidungen.md):
// 8–10 Fragen: bis 4 fällige aus Stufe 1/2, bis 4 neue, 1–2 fällige aus Stufe 3/4.
// Auffüllen: fällig 1/2 → neu → fällig 3/4 → bald fällig. Reicht es nicht, kürzere Runde ab 5 Fragen.
// Am Vortag und am Tag der Arbeit nur die Chill-Runde: 5 Fragen aus Stufe 3–5.

export const ROUND_MAX = 10
export const ROUND_MIN = 5
export const CHILL_SIZE = 5

export type RoundMode = 'normal' | 'chill'

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Vortag oder Tag der Arbeit (lokales Datum)
export function isEve(exam: Exam | undefined, now = new Date()): boolean {
  if (!exam?.exam_date) return false
  const [y, m, d] = exam.exam_date.split('-').map(Number)
  const examDay = new Date(y, m - 1, d)
  const diff = Math.round((examDay.getTime() - dayStart(now).getTime()) / 86_400_000)
  return diff === 0 || diff === 1
}

export function buildRound(
  questions: Question[],
  progress: Progress[],
  opts: { mode?: RoundMode; now?: Date } = {},
): Question[] {
  const now = opts.now ?? new Date()
  const byId = new Map(progress.map((p) => [p.question_id, p]))
  const due = (q: Question) => {
    const p = byId.get(q.id)
    return !!p && new Date(p.next_review_at) <= now
  }
  const box = (q: Question) => byId.get(q.id)?.leitner_box ?? 0

  if (opts.mode === 'chill') {
    const known = shuffle(questions.filter((q) => box(q) >= 3))
    return known.slice(0, CHILL_SIZE)
  }

  const low = shuffle(questions.filter((q) => due(q) && box(q) <= 2))
  const fresh = shuffle(questions.filter((q) => !byId.has(q.id)))
  const high = shuffle(questions.filter((q) => due(q) && box(q) >= 3 && box(q) <= 4))
  // Stufe 5 (Sternenstahl): fällige Pflege, nur zum Auffüllen
  const master = shuffle(questions.filter((q) => due(q) && box(q) >= 5))
  const soon = questions
    .filter((q) => byId.has(q.id) && !due(q))
    .sort((a, b) => +new Date(byId.get(a.id)!.next_review_at) - +new Date(byId.get(b.id)!.next_review_at))

  const picked: Question[] = [...low.slice(0, 4), ...fresh.slice(0, 4), ...high.slice(0, 2)]
  // Auffüllen bis 10 in Lottes Reihenfolge
  for (const pool of [low.slice(4), fresh.slice(4), high.slice(2), master, soon]) {
    for (const q of pool) {
      if (picked.length >= ROUND_MAX) break
      if (!picked.includes(q)) picked.push(q)
    }
  }
  if (picked.length < ROUND_MIN && picked.length < questions.length) return shuffle(questions).slice(0, ROUND_MIN)
  return shuffle(picked).slice(0, ROUND_MAX)
}

// Frust-Notbremse: nach 2 Fehlern in Folge eine sichere Frage (Stufe 3/4, sonst 2, sonst schon gelöst)
export function rescueQuestion(
  pool: Question[],
  progress: Progress[],
  exclude: Set<string>,
  solvedThisRound: Question[],
): Question | undefined {
  const byId = new Map(progress.map((p) => [p.question_id, p]))
  const free = pool.filter((q) => !exclude.has(q.id))
  const at = (min: number, max: number) =>
    shuffle(free.filter((q) => {
      const b = byId.get(q.id)?.leitner_box ?? 0
      return b >= min && b <= max
    }))[0]
  return at(3, 4) ?? at(2, 2) ?? shuffle(solvedThisRound)[0]
}

// Sterne nach Lern-Lotte: 1 je richtig im 1. Versuch, +3 Rundenende (ab 5 Antworten), Tagesgrenze 40 (Spielregel)
export const STARS_PER_CORRECT = 1
export const STARS_ROUND_BONUS = 3
export const STARS_DAILY_RULE = 40
