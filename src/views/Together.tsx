import { useState } from 'react'
import { SpeakButton, useQuestionSpeech } from '../components/Assist'
import { Chevron } from '../components/Icons'
import { Seg } from '../components/Settings'
import { ApiError } from '../lib/api'
import { fillName, useT } from '../lib/i18n'
import { buildRound, isEve } from '../lib/session'
import { parentAnswer, parentLock, refresh, useStore } from '../lib/store'
import type { Question } from '../lib/types'
import { solution } from './Parents'

// Gemeinsam-Abfragen (Plan B1–B3): Eltern stellen die Fragen mündlich, das Kind antwortet ohne Tippen.
// Antworten gehen direkt mit Eltern-Token an bc_answer (mode 'eltern'), nie in die gespeicherte Warteschlange.
// Die laufende Runde liegt nur im Speicher (nichts in localStorage): nach abgelaufener PIN geht es bei derselben
// Frage weiter; beim Sperren oder Verlassen des Cockpits wird sie verworfen (resetTogether).

interface Run {
  id: string
  profileId: string
  name: string
  questions: Question[]
  idx: number
  // feste Antwort-ID je Frage, damit erneutes Tippen nach Netzfehler nicht doppelt bucht
  answerIds: string[]
  known: number
  again: number
  stars: number
}

let saved: Run | null = null

export function resetTogether() {
  saved = null
}

export function togetherRunning() {
  return !!saved
}

// Mündliche Fassung je Spielform: was die Eltern zusätzlich zur Frage vorlesen
function Oral({ q }: { q: Question }) {
  const t = useT()
  const list = (items: string[]) => <ul className="quiz-oral-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
  const mix = (items: string[]) => [...items].sort((a, b) => a.localeCompare(b))
  switch (q.type) {
    case 'multiple_choice': return <>{t.oral.multiple_choice}{list(q.payload.options)}</>
    case 'word_clicker': return <>{t.oral.word_clicker}<p className="quiz-oral-line">{q.payload.sentence_with_gap.replace('[GAP]', '…')}</p></>
    case 'sort_boxes': return <>{t.oral.sort_boxes(q.payload.categories.map((c) => `„${c}“`).join(' / '))}{list(mix(q.payload.items.map((x) => x.text)))}</>
    case 'detective': return <>{t.oral.detective}{list(q.payload.statements.map((x) => x.text))}</>
    case 'bubble_pop': return <>{t.oral.bubble_pop(q.payload.target_rule)}{list(mix(q.payload.bubbles.map((x) => x.text)))}</>
    case 'pair_matching': return <>{t.oral.pair_matching}{list(q.payload.pairs.map((p) => p.left))}</>
    case 'sequencing': return <>{t.oral.sequencing}{list(mix(q.payload.correct_order))}</>
  }
}

export function Together({ onRunning }: { onRunning: (on: boolean) => void }) {
  const t = useT()
  const s = useStore()
  const pull = s.pull
  const kids = pull?.profiles ?? []
  const [kidId, setKidId] = useState(() => saved?.profileId ?? s.profileId ?? kids[0]?.id ?? '')
  const [run, setRunState] = useState<Run | null>(saved)
  const [showSolution, setShowSolution] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kid = kids.find((k) => k.id === kidId)
  const q = run && run.idx < run.questions.length ? run.questions[run.idx] : undefined
  const voice = useQuestionSpeech(q, run ? `${run.id}-${run.idx}` : null, !!q)

  function setRun(r: Run | null) {
    saved = r
    setRunState(r)
    onRunning(!!r)
  }

  const exams = (pull?.exams ?? []).filter((e) => e.profile_id === kidId && !e.is_archived)
  const released = (examId?: string) =>
    (pull?.questions ?? []).filter((x) => x.status === 'freigegeben' && exams.some((e) => e.id === x.exam_id && (!examId || e.id === examId))) as Question[]
  const progress = (pull?.progress ?? []).filter((p) => p.profile_id === kidId)

  function start(examId?: string) {
    const exam = exams.find((e) => e.id === examId)
    const questions = buildRound(released(examId), progress, { mode: exam && isEve(exam) ? 'chill' : 'normal' })
    setShowSolution(false)
    setError(null)
    setRun({
      id: crypto.randomUUID(), profileId: kidId, name: kid?.child_name ?? '', questions, idx: 0,
      answerIds: questions.map(() => crypto.randomUUID()), known: 0, again: 0, stars: 0,
    })
  }

  async function rate(correct: boolean) {
    if (!run || !q) return
    setBusy(true)
    setError(null)
    try {
      const stars = await parentAnswer({ answerId: run.answerIds[run.idx], profileId: run.profileId, questionId: q.id, correct, roundId: run.id })
      const next = { ...run, idx: run.idx + 1, known: run.known + (correct ? 1 : 0), again: run.again + (correct ? 0 : 1), stars: run.stars + stars }
      setRun(next)
      setShowSolution(false)
      if (next.idx >= next.questions.length) void refresh().catch(() => undefined)
    } catch (e) {
      // Abgelaufene Freischaltung: PIN eingeben, danach weiter bei derselben Frage (Runde bleibt im Speicher)
      if (e instanceof ApiError && e.code === 'pin_required') parentLock()
      else setError(t.quizRetry)
    } finally {
      setBusy(false)
    }
  }

  // Auswahl: Kind und Klassenarbeit
  if (!run) {
    return (
      <div>
        <p className="kicker">{t.quizTitle}</p>
        <div className="card quiz-pick">
          <p className="muted bc-small">{t.quizText}</p>
          {kids.length > 1 && (
            <div className="field">
              <span id="quiz-kid-l">{t.quizFor}</span>
              <Seg name="quiz-kid" labelledBy="quiz-kid-l" value={kidId} options={kids.map((k) => ({ value: k.id, text: k.child_name }))} onChange={setKidId} />
            </div>
          )}
          {released().length === 0 ? (
            <p className="muted">{t.quizNone(kid?.child_name ?? '')}</p>
          ) : (
            <div className="list">
              <button type="button" className="row" onClick={() => start()}>
                <span className="tx"><b>{t.quizDue}</b></span>
                <Chevron />
              </button>
              {exams.filter((e) => released(e.id).length > 0).map((e) => (
                <button key={e.id} type="button" className="row" onClick={() => start(e.id)}>
                  <span className="tx"><b>{e.title}</b></span>
                  <Chevron />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Abschluss
  if (!q) {
    return (
      <div>
        <p className="kicker">{t.quizTitle}</p>
        <div className="card quiz-end">
          <h2>{t.quizDone}</h2>
          <p>{t.quizResult(run.known, run.again)}</p>
          {run.stars > 0 && <p className="quiz-stars num">{t.quizStars(run.stars)}</p>}
          {run.stars < run.known && <p className="muted bc-small">{t.quizLimit}</p>}
          <button type="button" className="btn tinted wide" onClick={() => setRun(null)}>{t.quizBack}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="quiz-bar">
        <p className="kicker">{t.quizOf(run.idx + 1, run.questions.length)}</p>
        <button type="button" className="btn plain" onClick={() => { voice.stop(); setRun(null) }}>{t.quizStop}</button>
      </div>
      <div className="card quiz-card">
        <div className="a-ask">
          <h2 className="quiz-prompt">{fillName(q.prompt, run.name)}</h2>
          {voice.canSpeak && <SpeakButton reading={voice.reading} onClick={voice.toggle} />}
        </div>
        <div className="quiz-oral"><Oral q={q} /></div>
        {showSolution ? (
          <p className="quiz-solution"><b>{t.answerLabel}:</b> {solution(q)}</p>
        ) : (
          <button type="button" className="btn tinted wide" onClick={() => setShowSolution(true)}>{t.quizShow}</button>
        )}
        {error && <p className="setup-err" role="alert">{error}</p>}
        <div className="setup-acts">
          <button type="button" className="btn primary wide" disabled={busy} onClick={() => rate(true)}>{t.quizKnown}</button>
          <button type="button" className="btn plain wide" disabled={busy} onClick={() => rate(false)}>{t.quizAgain}</button>
        </div>
      </div>
    </div>
  )
}
