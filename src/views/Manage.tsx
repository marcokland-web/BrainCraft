import { useState } from 'react'
import { Seg } from '../components/Settings'
import { Sheet } from '../components/Sheet'
import { ApiError } from '../lib/api'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { deleteExam, parentLock, resetProgress, useStore, type ExamRow } from '../lib/store'

// Verwalten im Eltern-Cockpit: einzelne Klassenarbeiten löschen und Sterne/Fortschritt zurücksetzen.
// Beides mit Rückfrage und rotem Knopf (Studio-Regel); Zurücksetzen verlangt zusätzlich die PIN.

export function Manage() {
  const t = useT()
  const { lang } = usePrefs()
  const s = useStore()
  const kids = s.pull?.profiles ?? []
  const exams = s.pull?.exams ?? []
  const questions = s.pull?.questions ?? []
  const [askExam, setAskExam] = useState<ExamRow | null>(null)
  const [askReset, setAskReset] = useState(false)
  const [who, setWho] = useState<string>(kids.length > 1 ? 'all' : (kids[0]?.id ?? 'all'))
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const kidName = (id: string) => kids.find((k) => k.id === id)?.child_name ?? ''
  const date = (d: string | null) => {
    if (!d) return null
    const [y, m, dd] = d.split('-').map(Number)
    return new Date(y, m - 1, dd).toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' })
  }

  function fail(e: unknown) {
    const code = e instanceof ApiError ? e.code : ''
    if (code === 'pin_required') return parentLock()
    setError(code === 'offline' ? t.errOffline : code === 'missing_function' ? t.errNotReady : t.errGeneric)
  }

  async function removeExam() {
    if (!askExam) return
    setBusy(true)
    setError(null)
    try {
      await deleteExam(askExam.id)
      setAskExam(null)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!/^\d{4}$/.test(pin)) return setError(t.errPinFormat)
    setBusy(true)
    setError(null)
    try {
      const r = await resetProgress(pin, who === 'all' ? null : who)
      if (r.ok) {
        setAskReset(false)
        setNotice(t.resetDone)
      } else {
        setError(r.locked_until
          ? t.pinLocked(new Date(r.locked_until).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' }))
          : t.pinWrong)
      }
    } catch (e) {
      fail(e)
    } finally {
      setPin('')
      setBusy(false)
    }
  }

  return (
    <>
      <div>
        <p className="kicker">{t.examsTitle}</p>
        {exams.length === 0 ? (
          <div className="card bc-empty"><p>{t.examsEmpty}</p></div>
        ) : (
          <ul className="card approve-list manage-exams">
            {exams.map((e) => {
              const n = questions.filter((q) => q.exam_id === e.id).length
              const line = [kids.length > 1 ? kidName(e.profile_id) : null, date(e.exam_date), t.examLine(n)].filter(Boolean).join(' · ')
              return (
                <li key={e.id}>
                  <div className="approve-q">
                    <b>{e.title}</b>
                    <small>{line}</small>
                  </div>
                  <div className="approve-acts">
                    <button type="button" className="btn plain danger-text" onClick={() => { setError(null); setAskExam(e) }}>{t.examDelete}</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <p className="kicker">{t.resetTitle}</p>
        {notice && <p className="muted bc-small manage-notice" role="status">{notice}</p>}
        <div className="list">
          <button type="button" className="row danger-row" onClick={() => { setError(null); setNotice(null); setPin(''); setAskReset(true) }}>
            <span className="tx"><b>{t.resetRow}</b></span>
          </button>
        </div>
      </div>

      <Sheet open={!!askExam} onClose={() => !busy && setAskExam(null)} label={t.examDeleteYes}>
        {askExam && (
          <>
            <p>{t.examDeleteAsk(askExam.title)}</p>
            {error && <p className="setup-err" role="alert">{error}</p>}
            <div className="setup-acts">
              <button type="button" className="btn danger wide" disabled={busy} onClick={removeExam}>{t.examDeleteYes}</button>
              <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAskExam(null)}>{t.cancel}</button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={askReset} onClose={() => !busy && setAskReset(false)} label={t.resetYes}>
        <form className="manage-reset" onSubmit={(e) => { e.preventDefault(); void reset() }}>
          <p>{t.resetAsk}</p>
          {kids.length > 1 && (
            <div className="field">
              <span id="reset-who-l">{t.resetWho}</span>
              <Seg
                name="reset-who"
                labelledBy="reset-who-l"
                value={who}
                options={[{ value: 'all', text: t.resetAll }, ...kids.map((k) => ({ value: k.id, text: k.child_name }))]}
                onChange={setWho}
              />
            </div>
          )}
          <label className="field">
            <span>{t.resetPin}</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) => { setError(null); setPin(e.target.value.replace(/\D/g, '').slice(0, 4)) }}
            />
          </label>
          {error && <p className="setup-err" role="alert">{error}</p>}
          <div className="setup-acts">
            <button type="submit" className="btn danger wide" disabled={busy || pin.length !== 4}>{t.resetYes}</button>
            <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAskReset(false)}>{t.cancel}</button>
          </div>
        </form>
      </Sheet>
    </>
  )
}
