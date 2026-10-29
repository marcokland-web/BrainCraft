import { useEffect, useRef, useState } from 'react'
import { CheatSheet, SpeakButton, useQuestionSpeech } from '../components/Assist'
import { BlockGuardian } from '../components/BlockGuardian'
import { ItemIcon, Star } from '../components/Icons'
import { Game, MULTI_STEP } from '../games/Games'
import { play } from '../lib/audio'
import { fillName, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import type { Progress, Question } from '../lib/types'
import type { Slide } from './Learn'

// Boss-Kampf gegen den Blockwächter (Plan A3/A4, Begriffe docs/begriffe-boss.md): 10 Blöcke,
// Schaden 2 bei richtig im 1. Versuch, 1 nach Hinweis, 0 bei aufgedeckter Lösung. Fehler kosten nichts,
// der Boss greift nie an. Fehlerregeln wie in der Arena (Sperre 1 s, Denkanstoß, Aufdecken).
// Lebenspunkte werden nicht gespeichert; Schließen beendet den Kampf ohne Verlust.
// Lern-Lotte (docs/pruefung/lotte-boss.md): aufgedeckte Fragen bringen beim Wiederkommen nur 1 Block und keinen
// Stern; höchstens ein Stern je Frage und Kampf; Spickzettel und Vorlesen wie in der Arena; brummig nur zur Begrüßung.

const HP = 10
const LOCK_MS = 1000

type Phase = 'play' | 'solved' | 'revealed'
type Mood = 'brummig' | 'staunend' | 'geduldig' | 'froh'

// Reihenfolge: zuerst sichere Fragen (Stufe ≥ 3) gemischt, dann die übrigen
function order(pool: Question[], progress: Progress[]): Question[] {
  const box = new Map(progress.map((p) => [p.question_id, p.leitner_box]))
  const mix = (qs: Question[]) => [...qs].sort(() => Math.random() - 0.5)
  return [...mix(pool.filter((q) => (box.get(q.id) ?? 0) >= 3)), ...mix(pool.filter((q) => (box.get(q.id) ?? 0) < 3))]
}

export interface BossResult {
  // Erster Sieg: gewonnenes Teil (null = alle Teile schon da); Wiederholung: replay
  replay: boolean
  itemKey: string | null
}

interface Props {
  pool: Question[]
  progress: Progress[]
  // Wiederholung nach dem ersten Sieg: zum Spaß, ohne Sterne und Teil
  replay: boolean
  // Antwort protokollieren (mode 'boss'); firstTry = Stern verdient (der Server bucht nur dann)
  onAnswer: (q: Question, correct: boolean, firstTry: boolean) => void
  // Boss bei 0 Blöcken: meldet den Sieg und liefert, was gewonnen wurde
  onWin: () => BossResult
  itemName: (key: string) => string
  onExit: () => void
  onGear: () => void
  slideFor?: (q: Question) => Slide | null
}

export function Boss({ pool, progress, replay, onAnswer, onWin, itemName, onExit, onGear, slideFor }: Props) {
  const t = useT()
  const { name } = usePrefs()
  const [queue, setQueue] = useState<Question[]>(() => order(pool, progress))
  const [hp, setHp] = useState(HP)
  const [phase, setPhase] = useState<Phase>('play')
  const [mistakes, setMistakes] = useState(0)
  const [partMistakes, setPartMistakes] = useState<Record<string, number>>({})
  const [locked, setLocked] = useState(false)
  const [message, setMessage] = useState<string>(replay ? t.bossStartReplay(name) : t.bossStart(name))
  const [mood, setMood] = useState<Mood>('brummig')
  const [count, setCount] = useState(0)
  const [result, setResult] = useState<BossResult | null>(null)
  const [cheatOpen, setCheatOpen] = useState(false)
  // Schon aufgedeckt (beim Wiederkommen nur 1 Block, kein Stern) bzw. schon mit Stern belohnt
  const [shown, setShown] = useState<Set<string>>(() => new Set())
  const [starred, setStarred] = useState<Set<string>>(() => new Set())
  const lockTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    document.body.classList.add('playing')
    return () => {
      document.body.classList.remove('playing')
      window.clearTimeout(lockTimer.current)
    }
  }, [])

  const q = queue[0]
  const multi = !!q && MULTI_STEP.includes(q.type)
  const slide = q && slideFor ? slideFor(q) : null
  const voice = useQuestionSpeech(q, count, !result)

  function hintFor(question: Question) {
    if (question.type === 'sort_boxes') return t.hints.sort_boxes(question.payload.categories[0])
    return t.hints[question.type]
  }

  function mistake(part?: string) {
    const m = mistakes + 1
    const pm = part ? (partMistakes[part] ?? 0) + 1 : 0
    setMistakes(m)
    if (part) setPartMistakes({ ...partMistakes, [part]: pm })
    play('wrong')
    setMood('geduldig')
    if (multi ? m >= 3 || pm >= 2 : m >= 2) {
      setPhase('revealed')
      setMessage(t.bossShown(name))
      setShown(new Set(shown).add(q.id))
      onAnswer(q, false, false)
      return
    }
    setMessage(`${t.bossMiss} ${hintFor(q)}`)
    setLocked(true)
    lockTimer.current = window.setTimeout(() => setLocked(false), LOCK_MS)
  }

  function solved() {
    // Volltreffer nur mit eigenem Denken: nicht bei einer vorher aufgedeckten Frage
    const clean = mistakes === 0 && !shown.has(q.id)
    const damage = clean ? 2 : 1
    const star = clean && !starred.has(q.id)
    if (star) setStarred(new Set(starred).add(q.id))
    const left = Math.max(0, hp - damage)
    setHp(left)
    setPhase('solved')
    setMood('staunend')
    play(left === 0 ? 'chest' : 'correct')
    onAnswer(q, true, star)
    if (left === 0) {
      setMood('froh')
      setResult(onWin())
      return
    }
    setMessage(left === 1 ? t.bossAlmost : left === 2 ? t.bossTwoLeft : damage === 2 ? t.bossHit : t.bossHitSmall)
  }

  function next() {
    const [cur, ...rest] = queue
    let nextQueue = rest
    // Aufgedeckte Frage kommt nach zwei anderen wieder
    // (zu wenige übrig: mit frischer Reihenfolge auffüllen, sonst käme sie sofort wieder; Bodo)
    if (phase === 'revealed') {
      const base = rest.length >= 2 ? rest
        : [...rest, ...order(pool, progress).filter((x) => x.id !== cur.id && !rest.some((r) => r.id === x.id))]
      nextQueue = [...base.slice(0, 2), cur, ...base.slice(2)]
    }
    // Runde durch: von vorn, aber nie dieselbe Frage zweimal hintereinander
    if (!nextQueue.length) {
      nextQueue = order(pool, progress)
      if (nextQueue.length > 1 && nextQueue[0].id === cur.id) nextQueue.push(nextQueue.shift()!)
    }
    setQueue(nextQueue)
    setCount((c) => c + 1)
    setPhase('play')
    setMistakes(0)
    setPartMistakes({})
    setLocked(false)
    setMood('geduldig')
    setMessage('')
    setCheatOpen(false)
  }

  if (result) {
    return (
      <section className="arena boss">
        <div className="card a-end boss-end">
          <BlockGuardian hp={0} mood="froh" />
          <h1 className="a-title">{t.bossWin(name)}</h1>
          {result.replay ? (
            <p className="a-effort">{t.bossReplayWin}</p>
          ) : result.itemKey ? (
            <>
              <div className="boss-prize"><ItemIcon name={result.itemKey} /></div>
              <p className="a-stars"><Star className="st-ico" /> {t.bossPrize(itemName(result.itemKey))}</p>
            </>
          ) : (
            <p className="a-stars"><Star className="st-ico" /> {t.bossAllItems}</p>
          )}
          <div className="a-acts">
            <button type="button" className="btn primary wide" onClick={onGear}>{t.bossToGear}</button>
            <button type="button" className="btn plain wide" onClick={onExit}>{t.backHome}</button>
          </div>
        </div>
      </section>
    )
  }

  if (!q) {
    return (
      <section className="arena">
        <div className="card a-end">
          <p>{t.noQuestions}</p>
          <button type="button" className="btn primary wide" onClick={onExit}>{t.backHome}</button>
        </div>
      </section>
    )
  }

  return (
    <section className="arena boss">
      <div className="a-top">
        <button type="button" className="x" aria-label={t.close} onClick={onExit}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="boss-hp" role="progressbar" aria-valuemin={0} aria-valuemax={HP} aria-valuenow={hp} aria-label={t.bossHp(hp)}>
          {Array.from({ length: HP }, (_, i) => <i key={i} className={i < hp ? 'on' : ''} />)}
        </div>
      </div>

      <div className="boss-stage">
        <BlockGuardian hp={hp} mood={mood} />
        {message && <p className="bubble boss-say" aria-live="polite">{message}</p>}
      </div>

      <div className="card a-card">
        <p className="kicker">{t.bossName}</p>
        <div className="a-ask">
          <h1 className="a-prompt">{fillName(q.prompt, name)}</h1>
          {voice.canSpeak && <SpeakButton reading={voice.reading} onClick={voice.toggle} />}
        </div>
        <Game
          key={`${count}-${q.id}`}
          q={q}
          locked={locked || phase !== 'play'}
          reveal={phase === 'revealed'}
          onMistake={mistake}
          onSolved={solved}
          onStep={() => undefined}
        />
      </div>

      <div className="a-foot">
        {slide && (mistakes > 0 || phase === 'revealed') && phase !== 'solved' && (
          <button type="button" className="btn tinted wide a-cheat" onClick={() => { voice.stop(); setCheatOpen(true) }}>{t.cheat}</button>
        )}
        {phase !== 'play' && <button type="button" className="btn primary wide a-next" onClick={next}>{t.next}</button>}
      </div>

      <CheatSheet slide={slide} open={cheatOpen} revealed={phase === 'revealed'} onClose={() => setCheatOpen(false)} />
    </section>
  )
}
