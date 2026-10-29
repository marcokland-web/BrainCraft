import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { fillName, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import type { Question } from '../lib/types'
import {
  disconnect,
  parentActive,
  parentLock,
  parentUnlock,
  setQuestionActive,
  setQuestionStatus,
  useStore,
  type QuestionRow,
} from '../lib/store'
import { ShopManager } from './ShopManager'
import { resetTogether, Together, togetherRunning } from './Together'

const IDLE_MS = 3 * 60_000

// Eltern-Cockpit (PIN-geschützt): Fragen freigeben, Gutscheine und Belohnungen, Scan-Anleitung, Gerät verwalten.
// Analytik folgt mit dem Boss-Fight.

function PinPad({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(value: string) {
    setBusy(true)
    try {
      const r = await parentUnlock(value)
      if (r.ok) return onDone()
      // Sperrzeit immer zeigen, sobald der Server eine meldet (auch beim 3. Fehlversuch, Siggi N6)
      setError(
        r.locked_until
          ? t.pinLocked(new Date(r.locked_until).toLocaleTimeString(document.documentElement.lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }))
          : t.pinWrong,
      )
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'offline' ? t.errOffline : t.errGeneric)
    } finally {
      setPin('')
      setBusy(false)
    }
  }

  function press(d: string) {
    if (busy || pin.length >= 4) return
    const next = pin + d
    setPin(next)
    setError(null)
    if (next.length === 4) void check(next)
  }

  return (
    <div className="card pin">
      <h2>{t.pinTitle}</h2>
      <p className="muted">{t.pinText}</p>
      <div className="pin-dots" aria-label={`${pin.length}/4`}>
        {[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {error && <p className="setup-err" role="alert">{error}</p>}
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key num" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <span />
        <button type="button" className="key num" onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" className="key small" onClick={() => setPin(pin.slice(0, -1))} disabled={busy || !pin}>{t.pinDelete}</button>
      </div>
    </div>
  )
}

// Lösung einer Frage als kurzer Text (Freigabe und Gemeinsam-Abfragen)
export function solution(q: Question): string {
  switch (q.type) {
    case 'multiple_choice': return q.payload.options[q.payload.correct_index]
    case 'word_clicker': return q.payload.sentence_with_gap.replace('[GAP]', q.payload.correct_word)
    case 'sort_boxes': return q.payload.categories.map((c, i) => `${c}: ${q.payload.items.filter((x) => x.category_index === i).map((x) => x.text).join(', ')}`).join(' · ')
    case 'detective': return q.payload.statements.find((s) => s.is_impostor)?.text ?? ''
    case 'bubble_pop': return q.payload.bubbles.filter((b) => b.is_correct).map((b) => b.text).join(', ')
    case 'pair_matching': return q.payload.pairs.map((p) => `${p.left} – ${p.right}`).join(' · ')
    case 'sequencing': return q.payload.correct_order.join(' → ')
  }
}

export function Parents({ onClose }: { onClose: () => void }) {
  const t = useT()
  const s = useStore()
  const { name } = usePrefs()
  const [, tick] = useState(0)
  const [showCode, setShowCode] = useState(false)
  const [askDisconnect, setAskDisconnect] = useState(false)
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Während einer Gemeinsam-Runde zeigt das Cockpit nur die Abfrage (ein Hauptknopf je Ansicht)
  const [quizzing, setQuizzing] = useState(togetherRunning)
  const unlocked = parentActive() && !!s.pull?.parent

  // Sperre läuft nach 14 Minuten ab: einmal pro Minute neu zeichnen
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Sperren, sobald die App verlassen wird oder 3 Minuten nichts passiert (Siggi M1)
  useEffect(() => {
    if (!unlocked) return
    const lockAndClose = () => {
      resetTogether()
      parentLock()
      onClose()
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') lockAndClose()
    }
    let idle = window.setTimeout(lockAndClose, IDLE_MS)
    const activity = () => {
      window.clearTimeout(idle)
      idle = window.setTimeout(lockAndClose, IDLE_MS)
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', lockAndClose)
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      window.clearTimeout(idle)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', lockAndClose)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [unlocked, onClose])

  useEffect(() => {
    if (askDisconnect) dialog.current?.showModal()
    else dialog.current?.close()
  }, [askDisconnect])

  if (!unlocked) {
    return (
      <section className="bc-view parents">
        <div className="parents-bar">
          <h1 className="bc-title">{t.cockpitTitle}</h1>
          <button type="button" className="btn plain" onClick={() => { resetTogether(); onClose() }}>{t.done}</button>
        </div>
        <PinPad onDone={() => tick((n) => n + 1)} />
      </section>
    )
  }

  const drafts = (s.pull?.questions ?? []).filter((q) => q.status === 'entwurf') as QuestionRow[]
  const exams = s.pull?.exams ?? []
  const draftExams = exams.filter((e) => drafts.some((q) => q.exam_id === e.id)).length

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      // Abgelaufene Freischaltung: zurück zur PIN-Tastatur (Siggi N5)
      if (e instanceof ApiError && e.code === 'pin_required') parentLock()
      else setError(e instanceof ApiError && e.code === 'offline' ? t.errOffline : t.errGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bc-view parents">
      <div className="parents-bar">
        <h1 className="bc-title">{t.cockpitTitle}</h1>
        <button type="button" className="btn tinted" onClick={() => { resetTogether(); parentLock(); onClose() }}>{t.lockNow}</button>
      </div>

      {error && <p className="setup-err" role="alert">{error}</p>}

      <Together onRunning={setQuizzing} />

      {!quizzing && (
      <>
      <div>
        <p className="kicker">{t.approveTitle}</p>
        {drafts.length === 0 ? (
          <div className="card bc-empty"><p>{t.approveEmpty}</p></div>
        ) : (
          <div className="approve">
            {exams.filter((e) => drafts.some((q) => q.exam_id === e.id)).map((e) => {
              const qs = drafts.filter((q) => q.exam_id === e.id)
              return (
                <div key={e.id} className="card approve-exam">
                  <div className="approve-head">
                    <h2>{e.title}</h2>
                    {/* Höchstens ein gefüllter Hauptknopf je Ansicht (Designsystem) */}
                    <button type="button" className={`btn ${draftExams > 1 ? 'tinted' : 'primary'}`} disabled={busy} onClick={() => run(() => setQuestionStatus(qs.map((q) => q.id), 'freigegeben'))}>
                      {t.approveAll(qs.length)}
                    </button>
                  </div>
                  <ul className="approve-list">
                    {qs.map((q) => (
                      <li key={q.id}>
                        <div className="approve-q">
                          <b>{fillName(q.prompt, name)}</b>
                          <small><span className="approve-type">{t.qtype[q.type] ?? q.type}</span> {t.answerLabel}: {solution(q)}</small>
                        </div>
                        <div className="approve-acts">
                          <button type="button" className="btn tinted" disabled={busy} onClick={() => run(() => setQuestionStatus([q.id], 'freigegeben'))}>{t.approve}</button>
                          <button type="button" className="btn plain" disabled={busy} onClick={() => run(() => setQuestionActive(q.id, false))}>{t.hide}</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ShopManager />

      <div>
        <p className="kicker">{t.scanTitle}</p>
        <div className="card scan-help">
          <p>{t.scanText}</p>
          <p className="muted">{t.scanHint}</p>
        </div>
      </div>

      <div>
        <p className="kicker">{t.deviceTitle}</p>
        <div className="list">
          <button type="button" className="row" onClick={() => setShowCode(!showCode)}>
            <span className="tx"><b>{t.showCode}</b>{showCode && <small className="num">{s.code}</small>}</span>
          </button>
          <button type="button" className="row danger-row" onClick={() => setAskDisconnect(true)}>
            <span className="tx"><b>{t.disconnect}</b></span>
          </button>
        </div>
      </div>

      </>
      )}

      <dialog ref={dialog} className="settings confirm" onClose={() => setAskDisconnect(false)}>
        <div className="st">
          <p>{t.disconnectAsk}</p>
          <div className="setup-acts">
            <button type="button" className="btn danger wide" onClick={() => { parentLock(); disconnect(); setAskDisconnect(false); onClose() }}>{t.disconnectYes}</button>
            <button type="button" className="btn plain wide" onClick={() => setAskDisconnect(false)}>{t.cancel}</button>
          </div>
        </div>
      </dialog>
    </section>
  )
}
