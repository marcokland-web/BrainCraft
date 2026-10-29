import { useState } from 'react'
import { Rocket, Shuffle } from '../components/Icons'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { isEve } from '../lib/session'
import { bossToGo, bossWon, currentProfile, mastery, playableQuestions, takeBossLockedNotice, useStore } from '../lib/store'
import type { Exam } from '../lib/types'

// Missions-Zentrale: Begrüßung, Lerntage der Woche, Schnellstart, Klassenarbeiten mit Meister-Ring

export type PlayRequest = { kind: 'daily' } | { kind: 'mix' } | { kind: 'exam'; exam: Exam }

interface Props {
  demo: boolean
  demoExam: Exam
  onPlay: (r: PlayRequest) => void
  onBoss: (exam: Exam) => void
  onConnect: () => void
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <span className="ring" role="img" aria-label={label}>
      <svg viewBox="0 0 60 60">
        <circle className="tr" cx="30" cy="30" r={r} />
        <circle className="pr" cx="30" cy="30" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
      </svg>
      <span className="num">{Math.round(value * 100)}</span>
    </span>
  )
}

export function Start({ demo, demoExam, onPlay, onBoss, onConnect }: Props) {
  const t = useT()
  const { name, lang } = usePrefs()
  const s = useStore()
  const kid = currentProfile(s)
  const learnDays = kid?.learn_days_week ?? 0
  const exams: Exam[] = demo
    ? [demoExam]
    : (s.pull?.exams ?? []).filter((e) => e.profile_id === s.profileId && !e.is_archived)
  const pending = s.queue.filter((q) => q.kind === 'answer').length
  // Einmal zeigen, wenn der Server einen Boss-Sieg abgelehnt hat (Plan A4)
  const [lockedNotice] = useState(takeBossLockedNotice)
  // Boss bereit: 70 % der Fragen auf Stufe ≥ 3 (wie der Server); nicht im Probemodus
  const ready = demo ? [] : exams.filter((e) => bossToGo(s, e.id) === 0)

  function dateLine(e: Exam) {
    if (!e.exam_date) return null
    const [y, m, d] = e.exam_date.split('-').map(Number)
    const day = new Date(y, m - 1, d)
    if (isEve(e)) return day.toDateString() === new Date().toDateString() ? t.examToday : t.examEve
    return t.examDate(day.toLocaleDateString(locale(lang), { day: 'numeric', month: 'long' }))
  }

  return (
    <section className="bc-view home">
      {demo && (
        <div className="card demo-banner">
          <span>{t.demoBanner}</span>
          <button type="button" className="btn tinted" onClick={onConnect}>{t.demoConnect}</button>
        </div>
      )}

      <div className="card hero">
        <h1 className="hello">{name ? t.helloName(name) : t.hello}</h1>
        <div className="week" aria-label={t.learnDays(learnDays)}>
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className={i < learnDays ? 'on' : undefined} />
          ))}
        </div>
        <p className="muted bc-small">{t.learnDays(learnDays)}</p>
        {pending > 0 && <p className="muted bc-small">{t.syncPending(pending)}</p>}
        {lockedNotice && <p className="bc-small boss-locked">{t.bossLockedNotice}</p>}
      </div>

      <div className="quick">
        <button type="button" className="quickbtn" onClick={() => onPlay({ kind: 'daily' })}>
          <span className="ic"><Rocket /></span>
          <span className="tx"><b>{t.dailyTraining}</b><small>{t.dailyTrainingSub}</small></span>
        </button>
        <button type="button" className="quickbtn" onClick={() => onPlay({ kind: 'mix' })}>
          <span className="ic"><Shuffle /></span>
          <span className="tx"><b>{t.randomMix}</b><small>{t.randomMixSub}</small></span>
        </button>
      </div>

      <div>
        <p className="kicker">{t.exams}</p>
        <div className="list">
          {exams.length === 0 && (
            <div className="row" aria-disabled="true">
              <span className="tx"><b>{t.noExamsTitle}</b><small>{t.noExamsText}</small></span>
            </div>
          )}
          {exams.map((e) => {
            const count = demo ? 1 : playableQuestions(s, e.id).length
            const value = demo ? 0 : mastery(s, e.id)
            const line = dateLine(e)
            const toGo = demo ? null : bossToGo(s, e.id)
            return (
              <button
                key={e.id}
                type="button"
                className="row exam-row"
                disabled={count === 0}
                onClick={() => onPlay({ kind: 'exam', exam: e })}
              >
                <Ring value={value} label={t.examRing(Math.round(value * 100))} />
                <span className="tx">
                  <b>{e.title}</b>
                  <small>{count === 0 ? t.noReleased : (line ?? t.examRing(Math.round(value * 100)))}</small>
                  {/* Freundlicher Stand statt gesperrtem Knopf (Plan A2) */}
                  {toGo !== null && toGo > 0 && <small>{t.bossToGo(toGo)}</small>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {ready.length > 0 && (
        <div>
          <p className="kicker">{t.bossName}</p>
          <div className="boss-list">
            {ready.map((e) => (
              <button key={e.id} type="button" className="btn tinted wide boss-btn" onClick={() => onBoss(e)}>
                <span className="tx">
                  <b>{bossWon(s, e.id) ? t.bossAgain : t.bossButton}</b>
                  <small>{bossWon(s, e.id) ? `${t.bossAgainSub} · ${e.title}` : e.title}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
