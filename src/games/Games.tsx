import { useEffect, useMemo, useRef, useState } from 'react'
import { play } from '../lib/audio'
import { useT } from '../lib/i18n'
import type {
  BubblePop,
  Detective,
  MultipleChoice,
  PairMatching,
  Question,
  QuestionType,
  Sequencing,
  SortBoxes,
  WordClicker,
} from '../lib/types'

// Blasen haben nur wenige Nieten, die nach dem Antippen gesperrt sind: Sie decken wie Einzelantworten
// nach dem 2. Fehler auf (Bug-Bodo).
// Die 7 Minispiele. Jede Antwort per Tippen (Zero-Typing), Tippflächen mindestens 60 px.
// Spiele mit mehreren Schritten prüfen jeden Schritt sofort; ein falscher Teil leuchtet kurz auf.
// onMistake(part) meldet, welcher Teil falsch war: Die Arena deckt bei diesen Spielen erst nach dem
// 3. Fehler oder dem 2. Fehler am selben Teil auf (Lern-Lotte).
// reveal = Lösung zeigen: Was das Kind schon richtig hatte, bleibt als „deins“ markiert (ok),
// der Rest erscheint als aufgedeckt (shown).

export const MULTI_STEP: QuestionType[] = ['sort_boxes', 'pair_matching', 'sequencing']

export interface GameProps<P> {
  payload: P
  locked: boolean
  reveal: boolean
  onMistake: (part?: string) => void
  onSolved: () => void
  // Ein Teilschritt war richtig (für den Hinweis „Grün markiert …“ beim Aufdecken)
  onStep?: () => void
}

const FLASH_MS = 1000

// Kurzes Aufleuchten des falsch angetippten Teils
function useFlash(): [string | null, (key: string) => void] {
  const [flash, setFlash] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [
    flash,
    (key: string) => {
      setFlash(key)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setFlash(null), FLASH_MS)
    },
  ]
}

function shuffled<T>(xs: T[], seed: string): T[] {
  // Fest je Frage gemischt, damit sich die Reihenfolge beim Neuzeichnen nicht ändert
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) | 0
    const j = Math.abs(h) % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function MultipleChoiceGame({ payload, locked, reveal, onMistake, onSolved }: GameProps<MultipleChoice>) {
  const [wrong, setWrong] = useState<number[]>([])
  const [done, setDone] = useState(false)
  return (
    <div className="g-choices">
      {payload.options.map((o, i) => {
        const isRight = i === payload.correct_index
        const state = done && isRight ? 'ok' : reveal && isRight ? 'shown' : wrong.includes(i) ? 'no' : ''
        return (
          <button
            key={i}
            type="button"
            className={`g-btn ${state}`}
            disabled={locked || done || reveal || wrong.includes(i)}
            onClick={() => {
              if (isRight) {
                setDone(true)
                onSolved()
              } else {
                setWrong([...wrong, i])
                onMistake()
              }
            }}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function WordClickerGame({ payload, locked, reveal, onMistake, onSolved }: GameProps<WordClicker>) {
  const words = useMemo(
    () => shuffled([payload.correct_word, ...payload.distractors], payload.sentence_with_gap),
    [payload],
  )
  const [wrong, setWrong] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [before, after] = payload.sentence_with_gap.split('[GAP]')
  const filled = done || reveal
  return (
    <div className="g-stack">
      <p className="g-sentence">
        {before}
        <span className={`g-gap ${done ? 'filled' : reveal ? 'shown' : ''}`}>{filled ? payload.correct_word : '…'}</span>
        {after}
      </p>
      <div className="g-chips">
        {words.map((w) => (
          <button
            key={w}
            type="button"
            className={`g-btn chip ${wrong.includes(w) ? 'no' : ''} ${filled && w === payload.correct_word ? (done ? 'ok' : 'shown') : ''}`}
            disabled={locked || filled || wrong.includes(w)}
            onClick={() => {
              if (w === payload.correct_word) {
                setDone(true)
                onSolved()
              } else {
                setWrong([...wrong, w])
                onMistake()
              }
            }}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  )
}

function SortBoxesGame({ payload, locked, reveal, onMistake, onSolved, onStep }: GameProps<SortBoxes>) {
  const t = useT()
  const items = useMemo(() => shuffled(payload.items.map((x, i) => ({ ...x, i })), payload.categories.join()), [payload])
  const [placed, setPlaced] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [flash, setFlash] = useFlash()
  const inBox = (i: number) => reveal || placed.includes(i)

  function drop(box: number) {
    if (selected === null) return
    const item = items.find((x) => x.i === selected)!
    if (item.category_index === box) {
      const next = [...placed, selected]
      setPlaced(next)
      setSelected(null)
      play('tap')
      onStep?.()
      if (next.length === items.length) onSolved()
    } else {
      // Begriff springt zurück und leuchtet kurz auf, die Kiste ebenso
      setFlash(`i${selected}b${box}`)
      setSelected(null)
      onMistake(`i${selected}`)
    }
  }

  return (
    <div className="g-stack">
      <div className="g-chips">
        {items.filter((x) => !inBox(x.i)).map((x) => (
          <button
            key={x.i}
            type="button"
            className={`g-btn chip ${selected === x.i ? 'sel' : ''} ${flash?.startsWith(`i${x.i}b`) ? 'flash' : ''}`}
            aria-pressed={selected === x.i}
            disabled={locked}
            onClick={() => setSelected(selected === x.i ? null : x.i)}
          >
            {x.text}
          </button>
        ))}
      </div>
      {!reveal && <p className="g-hint">{selected === null ? t.sortPick : t.sortDrop}</p>}
      <div className="g-boxes">
        {payload.categories.map((c, b) => (
          <button
            key={b}
            type="button"
            className={`g-box ${selected !== null ? 'ready' : ''} ${flash?.endsWith(`b${b}`) ? 'flash' : ''}`}
            disabled={locked || selected === null}
            onClick={() => drop(b)}
          >
            <b>{c}</b>
            <span className="g-inbox">
              {items.filter((x) => inBox(x.i) && x.category_index === b).map((x) => (
                <i key={x.i} className={placed.includes(x.i) ? 'mine' : 'shown'}>{x.text}</i>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function DetectiveGame({ payload, locked, reveal, onMistake, onSolved }: GameProps<Detective>) {
  const t = useT()
  const [cleared, setCleared] = useState<number[]>([])
  const [caught, setCaught] = useState(false)
  const show = caught || reveal
  return (
    <div className="g-stack">
      <div className="g-choices one">
        {payload.statements.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`g-btn left ${show && s.is_impostor ? (caught ? 'ok' : 'shown') : ''} ${cleared.includes(i) ? 'cleared' : ''}`}
            disabled={locked || show || cleared.includes(i)}
            onClick={() => {
              if (s.is_impostor) {
                setCaught(true)
                onSolved()
              } else {
                setCleared([...cleared, i])
                onMistake()
              }
            }}
          >
            {cleared.includes(i) && <span className="g-tag">{t.detTrue}</span>}
            {s.text}
          </button>
        ))}
      </div>
      {show && <p className="g-reveal">{payload.reveal_text}</p>}
    </div>
  )
}

function BubblePopGame({ payload, locked, reveal, onMistake, onSolved, onStep }: GameProps<BubblePop>) {
  const t = useT()
  const bubbles = useMemo(() => shuffled(payload.bubbles.map((b, i) => ({ ...b, i })), payload.target_rule), [payload])
  const [popped, setPopped] = useState<number[]>([])
  const [wrong, setWrong] = useState<number[]>([])
  const needed = bubbles.filter((b) => b.is_correct).length
  return (
    <div className="g-stack">
      <p className="g-rule">{payload.target_rule}</p>
      {!reveal && <p className="g-hint">{t.bubblesLeft(needed - popped.length)}</p>}
      <div className="g-bubbles">
        {bubbles.map((b, k) => {
          const mine = popped.includes(b.i)
          // Beim Aufdecken bleiben die richtigen Blasen sichtbar stehen, die falschen werden blass
          const cls = reveal ? (b.is_correct ? (mine ? 'ok' : 'shown') : 'faded') : mine ? 'popped' : wrong.includes(b.i) ? 'no' : ''
          return (
            <button
              key={b.i}
              type="button"
              className={`g-bubble d${k % 4} ${cls}`}
              disabled={locked || mine || wrong.includes(b.i) || reveal}
              onClick={() => {
                if (b.is_correct) {
                  const next = [...popped, b.i]
                  setPopped(next)
                  play('pop')
                  onStep?.()
                  if (next.length === needed) onSolved()
                } else {
                  setWrong([...wrong, b.i])
                  onMistake(`b${b.i}`)
                }
              }}
            >
              {b.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PairMatchingGame({ payload, locked, reveal, onMistake, onSolved, onStep }: GameProps<PairMatching>) {
  const rights = useMemo(() => shuffled(payload.pairs.map((p, i) => ({ text: p.right, i })), payload.pairs[0].left), [payload])
  const [matched, setMatched] = useState<number[]>([])
  const [left, setLeft] = useState<number | null>(null)
  const [flash, setFlash] = useFlash()
  const state = (i: number) => (matched.includes(i) ? `ok m${i % 4}` : reveal ? `shown m${i % 4}` : '')
  if (reveal) {
    // Aufgedeckt: jedes Paar in einer Zeile, damit links und rechts immer nebeneinander stehen
    return (
      <div className="g-pairs rows">
        {payload.pairs.map((p, i) => [
          <span key={`l${i}`} className={`g-btn ${state(i)}`}>{p.left}</span>,
          <span key={`r${i}`} className={`g-btn ${state(i)}`}>{p.right}</span>,
        ])}
      </div>
    )
  }
  return (
    <div className="g-pairs">
      <div className="g-col">
        {payload.pairs.map((p, i) => (
          <button
            key={i}
            type="button"
            className={`g-btn ${left === i ? 'sel' : ''} ${state(i)} ${flash === `l${i}` ? 'flash' : ''}`}
            aria-pressed={left === i}
            disabled={locked || reveal || matched.includes(i)}
            onClick={() => setLeft(left === i ? null : i)}
          >
            {p.left}
          </button>
        ))}
      </div>
      <div className="g-col">
        {rights.map((r) => (
          <button
            key={r.i}
            type="button"
            className={`g-btn ${state(r.i)} ${flash === `r${r.i}` ? 'flash' : ''}`}
            disabled={locked || reveal || matched.includes(r.i) || left === null}
            onClick={() => {
              if (left === null) return
              if (left === r.i) {
                const next = [...matched, r.i]
                setMatched(next)
                setLeft(null)
                play('tap')
                onStep?.()
                if (next.length === payload.pairs.length) onSolved()
              } else {
                setFlash(`r${r.i}`)
                onMistake(`l${left}`)
                setLeft(null)
              }
            }}
          >
            {r.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function SequencingGame({ payload, locked, reveal, onMistake, onSolved, onStep }: GameProps<Sequencing>) {
  const t = useT()
  const steps = useMemo(() => shuffled(payload.correct_order.map((s, i) => ({ s, i })), payload.correct_order.join()), [payload])
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useFlash()
  const shown = reveal ? payload.correct_order.length : count
  return (
    <div className="g-stack">
      <ol className="g-order">
        {payload.correct_order.map((s, i) => (
          <li key={i} className={i < count ? 'ok' : i < shown ? 'shown' : ''}>
            <span className="num">{i + 1}</span>
            {i < shown ? s : t.seqEmpty}
          </li>
        ))}
      </ol>
      <div className="g-chips">
        {steps.filter((x) => x.i >= shown).map((x) => (
          <button
            key={x.i}
            type="button"
            className={`g-btn chip ${flash === `s${x.i}` ? 'flash' : ''}`}
            disabled={locked || reveal}
            onClick={() => {
              if (x.i === count) {
                setCount(count + 1)
                play('tap')
                onStep?.()
                if (count + 1 === payload.correct_order.length) onSolved()
              } else {
                setFlash(`s${x.i}`)
                // Teil = der Platz, der gerade gesucht wird
                onMistake(`p${count}`)
              }
            }}
          >
            {x.s}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Game({ q, ...rest }: { q: Question } & Omit<GameProps<never>, 'payload'>) {
  switch (q.type) {
    case 'multiple_choice':
      return <MultipleChoiceGame payload={q.payload} {...rest} />
    case 'word_clicker':
      return <WordClickerGame payload={q.payload} {...rest} />
    case 'sort_boxes':
      return <SortBoxesGame payload={q.payload} {...rest} />
    case 'detective':
      return <DetectiveGame payload={q.payload} {...rest} />
    case 'bubble_pop':
      return <BubblePopGame payload={q.payload} {...rest} />
    case 'pair_matching':
      return <PairMatchingGame payload={q.payload} {...rest} />
    case 'sequencing':
      return <SequencingGame payload={q.payload} {...rest} />
  }
}
