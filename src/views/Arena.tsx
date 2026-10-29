import { useEffect, useMemo, useRef, useState } from 'react'
import { Game, MULTI_STEP } from '../games/Games'
import { CheatSheet, SpeakButton, useQuestionSpeech } from '../components/Assist'
import { Star } from '../components/Icons'
import { play } from '../lib/audio'
import { fillName, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { buildRound, rescueQuestion, STARS_PER_CORRECT, STARS_ROUND_BONUS, ROUND_MIN, type RoundMode } from '../lib/session'
import type { Progress, Question } from '../lib/types'
import type { Slide } from './Learn'

// Game Arena (Übe-Modus): 8–10 Fragen, Fortschrittsbalken, keine Herzen (Kinder-Regel: nie Strafe).
// Fehler: Klicksperre 1 s mit Wackeln und Denkanstoß je Spielform.
// Lösung: bei Einzelantworten nach dem 2. Fehler, bei Spielen mit mehreren Schritten nach dem
// 3. Fehler oder dem 2. Fehler am selben Teil (Lern-Lotte). Kein Stern.
// Aufgedeckte Fragen kommen am Rundenende noch einmal (ohne Stern, ohne Leitner-Änderung).
// Nach 2 aufgedeckten Fragen in Folge kommt einmal je Runde eine sichere Frage (Frust-Notbremse, ohne Stern).
// Spickzettel (Lern-Lotte): nach dem 1. Fehler nur der Folientitel als Erinnerungsanker, nach dem Aufdecken
// der ganze Folientext (slide_index aus dem Scan). Kein weiterer Abzug.
// Vorlesen: Lautsprecher-Knopf an der Frage; bei „Automatisch“ wird jede neue Frage vorgelesen.

const LOCK_MS = 1000

export type AnswerKind = 'normal' | 'repeat' | 'rescue'

export interface AnswerLog {
  question: Question
  kind: AnswerKind
  firstTry: boolean
  revealed: boolean
}

interface Props {
  pool: Question[]
  progress: Progress[]
  mode: RoundMode
  demo: boolean
  onAnswer?: (a: AnswerLog) => void
  // Rundenende mit allen Antworten (für Rundenbonus und Abgleich)
  onFinished?: (log: AnswerLog[]) => void
  onExit: () => void
  onAgain: () => void
  // Lernfolie zur Frage für den Spickzettel (null = keine Zuordnung)
  slideFor?: (q: Question) => Slide | null
}

interface Slot {
  q: Question
  kind: AnswerKind
}

type Phase = 'play' | 'solved' | 'revealed'

export function Arena({ pool, progress, mode, demo, onAnswer, onFinished, onExit, onAgain, slideFor }: Props) {
  const t = useT()
  const { name } = usePrefs()
  const [cheatOpen, setCheatOpen] = useState(false)
  const [slots, setSlots] = useState<Slot[]>(() => buildRound(pool, progress, { mode }).map((q) => ({ q, kind: 'normal' })))
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('play')
  const [mistakes, setMistakes] = useState(0)
  const [partMistakes, setPartMistakes] = useState<Record<string, number>>({})
  const [steps, setSteps] = useState(0)
  const [locked, setLocked] = useState(false)
  const [shake, setShake] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [log, setLog] = useState<AnswerLog[]>([])
  const [rescued, setRescued] = useState(false)
  const [finished, setFinished] = useState(false)
  const lockTimer = useRef<number | undefined>(undefined)

  // Kopfzeile und Tab-Leiste während des Spiels ausblenden (wie Rechenstern)
  useEffect(() => {
    document.body.classList.add('playing')
    return () => {
      document.body.classList.remove('playing')
      window.clearTimeout(lockTimer.current)
    }
  }, [])

  const slot = slots[idx]
  const q = slot?.q
  const multi = !!q && MULTI_STEP.includes(q.type)
  const praiseMulti = !!q && (multi || q.type === 'bubble_pop')
  const praise = useMemo(() => t.praise[Math.floor(Math.random() * t.praise.length)], [idx, t])

  const slide = q && slideFor ? slideFor(q) : null

  const voice = useQuestionSpeech(q, idx, !finished)

  function hintFor(question: Question) {
    if (question.type === 'sort_boxes') return t.hints.sort_boxes(question.payload.categories[0])
    return t.hints[question.type]
  }

  function record(firstTry: boolean, revealed: boolean) {
    const entry: AnswerLog = { question: q, kind: slot.kind, firstTry, revealed }
    setLog((l) => [...l, entry])
    onAnswer?.(entry)
  }

  function mistake(part?: string) {
    const m = mistakes + 1
    const pm = part ? (partMistakes[part] ?? 0) + 1 : 0
    setMistakes(m)
    if (part) setPartMistakes({ ...partMistakes, [part]: pm })
    setShake((s) => s + 1)
    play('wrong')
    const reveal = multi ? m >= 3 || pm >= 2 : m >= 2
    if (reveal) {
      setPhase('revealed')
      setMessage(t.pitStop(name))
      record(false, true)
      return
    }
    setMessage(`${t.breathe(name)} ${hintFor(q)}`)
    setLocked(true)
    lockTimer.current = window.setTimeout(() => setLocked(false), LOCK_MS)
  }

  function solved() {
    setPhase('solved')
    play('correct')
    setMessage(mistakes > 0 ? t.solvedLate(name) : praiseMulti ? t.praiseMulti(name) : praise(name))
    record(mistakes === 0, false)
  }

  function next() {
    let nextSlots = slots
    const normal = log.filter((a) => a.kind === 'normal')
    const last2 = normal.slice(-2)
    // Frust-Notbremse: die letzten beiden Fragen wurden aufgedeckt → sichere Frage einschieben
    if (!rescued && slot.kind === 'normal' && last2.length === 2 && last2.every((a) => a.revealed)) {
      const used = new Set(slots.map((s) => s.q.id))
      const solvedHere = log.filter((a) => a.firstTry).map((a) => a.question)
      const safe = rescueQuestion(pool, progress, used, solvedHere)
      if (safe) {
        nextSlots = [...slots.slice(0, idx + 1), { q: safe, kind: 'rescue' }, ...slots.slice(idx + 1)]
        setRescued(true)
      }
    }
    // Am Ende der normalen Fragen: aufgedeckte Fragen noch einmal üben
    const lastNormal = nextSlots.reduce((at, s, i) => (s.kind === 'normal' ? i : at), -1)
    if (idx === lastNormal || (idx + 1 >= nextSlots.length && slot.kind !== 'repeat')) {
      const again = log.filter((a) => a.kind === 'normal' && a.revealed).map((a) => ({ q: a.question, kind: 'repeat' as const }))
      const queued = new Set(nextSlots.filter((s) => s.kind === 'repeat').map((s) => s.q.id))
      nextSlots = [...nextSlots, ...again.filter((s) => !queued.has(s.q.id))]
    }
    if (nextSlots !== slots) setSlots(nextSlots)
    if (idx + 1 >= nextSlots.length) {
      setFinished(true)
      play('chest')
      onFinished?.(log)
      return
    }
    setIdx(idx + 1)
    setPhase('play')
    setMistakes(0)
    setPartMistakes({})
    setSteps(0)
    setMessage(null)
    setLocked(false)
  }

  if (!slots.length) {
    return (
      <section className="arena">
        <div className="card a-end">
          <p>{t.noQuestions}</p>
          <button type="button" className="btn primary wide" onClick={onExit}>{t.backHome}</button>
        </div>
      </section>
    )
  }

  if (finished) {
    // Sterne nur für die normalen Fragen der Runde (Wiederholung und Notbremse geben keine)
    const normal = log.filter((a) => a.kind === 'normal')
    const right = normal.filter((a) => a.firstTry).length
    const kept = normal.filter((a) => !a.firstTry).length
    const bonus = normal.length >= ROUND_MIN ? STARS_ROUND_BONUS : 0
    const stars = right * STARS_PER_CORRECT + bonus
    return (
      <section className="arena">
        <div className="card a-end">
          <div className="a-chest" aria-hidden="true">
            <svg viewBox="0 0 120 100">
              <path className="lid" d="M14 44 Q60 4 106 44 Z" />
              <rect className="box" x="14" y="44" width="92" height="44" rx="6" />
              <rect className="lock" x="52" y="50" width="16" height="18" rx="3" />
            </svg>
            <Star className="a-star s1" />
            <Star className="a-star s2" />
            <Star className="a-star s3" />
          </div>
          <h1 className="a-title">{t.chestTitle(name)}</h1>
          <p className="a-stars"><Star className="st-ico" /> <span className="num">+{stars}</span> {t.chestStars(stars)}</p>
          {bonus > 0 && <p className="muted">{t.chestBonus}</p>}
          <p className="a-effort">{kept > 0 ? t.chestEffort(kept) : t.chestPerfect}</p>
          <p className="muted">{t.chestRight(right, normal.length)}</p>
          {demo && <p className="a-note">{t.demoNote}</p>}
          <div className="a-acts">
            <button type="button" className="btn primary wide" onClick={onAgain}>{t.again}</button>
            <button type="button" className="btn plain wide" onClick={onExit}>{t.backHome}</button>
          </div>
        </div>
      </section>
    )
  }

  const total = slots.length
  const solvedPhase = phase !== 'play'
  const done = idx + (solvedPhase ? 1 : 0)
  return (
    <section className="arena">
      <div className="a-top">
        <button type="button" className="x" aria-label={t.close} onClick={onExit}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="a-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t.question(idx + 1, total)}>
          <i className={`w${Math.round((done / total) * 20)}`} />
        </div>
        <span className="a-count num">{idx + 1}/{total}</span>
      </div>

      {mode === 'chill' && idx === 0 && phase === 'play' && <p className="a-note">{t.chillNote}</p>}
      {slot.kind !== 'normal' && phase === 'play' && mistakes === 0 && (
        <p className="a-note">{slot.kind === 'repeat' ? t.repeatIntro : t.rescueIntro}</p>
      )}

      <div className={`card a-card ${shake % 2 ? 'shake-a' : shake ? 'shake-b' : ''}`}>
        <p className="kicker">{t.question(idx + 1, total)}</p>
        <div className="a-ask">
          <h1 className="a-prompt">{fillName(q.prompt, name)}</h1>
          {voice.canSpeak && <SpeakButton reading={voice.reading} onClick={voice.toggle} />}
        </div>
        <Game
          key={`${idx}-${q.id}`}
          q={q}
          locked={locked || solvedPhase}
          reveal={phase === 'revealed'}
          onMistake={mistake}
          onSolved={solved}
          onStep={() => setSteps((n) => n + 1)}
        />
      </div>

      <div className="a-foot" aria-live="polite">
        {message && (
          <p className={`a-msg ${phase === 'solved' ? 'ok' : phase === 'revealed' ? 'pit' : 'hint'}`}>
            {message}
            {phase === 'revealed' && q.type === 'multiple_choice' && <span> {fillName(q.payload.explanation, name)}</span>}
            {phase === 'revealed' && steps > 0 && <small>{t.yoursKept}</small>}
            {phase === 'revealed' && slot.kind === 'normal' && <small>{t.pitStopNext}</small>}
          </p>
        )}
        {slide && (mistakes > 0 || phase === 'revealed') && phase !== 'solved' && (
          <button type="button" className="btn tinted wide a-cheat" onClick={() => { voice.stop(); setCheatOpen(true) }}>
            {t.cheat}
          </button>
        )}
        {solvedPhase && (
          <button type="button" className="btn primary wide a-next" onClick={next}>
            {idx + 1 >= total && (slot.kind === 'repeat' || !log.some((a) => a.kind === 'normal' && a.revealed)) ? t.finish : t.next}
          </button>
        )}
      </div>

      <CheatSheet slide={slide} open={cheatOpen} revealed={phase === 'revealed'} onClose={() => setCheatOpen(false)} />
    </section>
  )
}
