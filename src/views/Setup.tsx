import { useState } from 'react'
import { Chevron, Logo } from '../components/Icons'
import { ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { connect, createFamily } from '../lib/store'

// Einrichten (Eltern): mit Familien-Code verbinden, mit Einladungscode neu anlegen oder Probemodus.
// Hier darf getippt werden; Zero-Typing gilt für das Kind im Spiel.

type Step = 'choose' | 'code' | 'new' | 'show'
const NEW_CODE = 'braincraft:newcode'

export function Setup({ onDemo }: { onDemo: () => void }) {
  const t = useT()
  const [step, setStep] = useState<Step>(() => {
    try {
      return sessionStorage.getItem(NEW_CODE) ? 'show' : 'choose'
    } catch {
      return 'choose'
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  const [child, setChild] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  // Neuer Code bleibt bis zum Bestätigen in der Sitzung erhalten, auch wenn die Seite neu lädt (Siggi N3)
  const [created, setCreatedState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(NEW_CODE)
    } catch {
      return null
    }
  })
  function setCreated(value: string | null) {
    setCreatedState(value)
    try {
      if (value) sessionStorage.setItem(NEW_CODE, value)
      else sessionStorage.removeItem(NEW_CODE)
    } catch {
      // Privater Modus
    }
  }

  function message(e: unknown, fallback: string) {
    if (e instanceof ApiError && e.code === 'offline') return t.errOffline
    if (e instanceof ApiError && e.code === 'invite_invalid') return t.errInvite
    if (e instanceof ApiError && e.code === 'not_found') return t.errCode
    return fallback
  }

  async function doConnect() {
    setBusy(true)
    setError(null)
    try {
      await connect(code.trim())
    } catch (e) {
      setError(message(e, t.errGeneric))
    } finally {
      setBusy(false)
    }
  }

  async function doCreate() {
    const name = child.trim()
    if (!name || name.length > 30) return setError(t.errName)
    if (!/^[0-9]{4}$/.test(pin)) return setError(t.errPinFormat)
    if (pin !== pin2) return setError(t.errPinMatch)
    setBusy(true)
    setError(null)
    try {
      setCreated(await createFamily(invite.trim(), name, pin))
      setStep('show')
    } catch (e) {
      setError(message(e, t.errGeneric))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bc-view setup">
      <div className="card setup-hero">
        <Logo className="setup-logo" />
        <h1 className="bc-title">{t.welcomeTitle}</h1>
        <p className="muted">{t.welcomeText}</p>
      </div>

      {step === 'choose' && (
        <div className="list">
          <button type="button" className="row" onClick={() => setStep('code')}>
            <span className="tx"><b>{t.haveCode}</b><small>{t.haveCodeSub}</small></span>
            <Chevron />
          </button>
          <button type="button" className="row" onClick={() => setStep('new')}>
            <span className="tx"><b>{t.newFamily}</b><small>{t.newFamilySub}</small></span>
            <Chevron />
          </button>
          <button type="button" className="row" onClick={onDemo}>
            <span className="tx"><b>{t.tryDemo}</b><small>{t.tryDemoSub}</small></span>
            <Chevron />
          </button>
        </div>
      )}

      {step === 'code' && (
        <form className="card setup-form" onSubmit={(e) => { e.preventDefault(); void doConnect() }}>
          <label className="field">
            <span>{t.familyCode}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" />
          </label>
          {error && <p className="setup-err" role="alert">{error}</p>}
          <div className="setup-acts">
            <button type="submit" className="btn primary wide" disabled={busy || code.trim().length < 20}>{t.connect}</button>
            <button type="button" className="btn plain wide" onClick={() => { setStep('choose'); setError(null) }}>{t.cancel}</button>
          </div>
        </form>
      )}

      {step === 'new' && (
        <form className="card setup-form" onSubmit={(e) => { e.preventDefault(); void doCreate() }}>
          <label className="field">
            <span>{t.inviteCode}</span>
            <input value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" />
          </label>
          <label className="field">
            <span>{t.childName}</span>
            <input value={child} onChange={(e) => setChild(e.target.value)} autoComplete="off" maxLength={30} />
          </label>
          <label className="field">
            <span>{t.newPin}</span>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete="new-password" />
          </label>
          <label className="field">
            <span>{t.repeatPin}</span>
            <input value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete="new-password" />
          </label>
          {error && <p className="setup-err" role="alert">{error}</p>}
          <div className="setup-acts">
            <button type="submit" className="btn primary wide" disabled={busy || invite.trim().length < 16}>{t.create}</button>
            <button type="button" className="btn plain wide" onClick={() => { setStep('choose'); setError(null) }}>{t.cancel}</button>
          </div>
        </form>
      )}

      {step === 'show' && created && (
        <div className="card setup-form">
          <h2>{t.codeShowTitle}</h2>
          <p className="muted">{t.codeShowText}</p>
          <p className="setup-code num">{created}</p>
          <button type="button" className="btn primary wide" disabled={busy} onClick={() => { setCode(created); void (async () => {
            setBusy(true)
            try { await connect(created); setCreated(null) } catch (e) { setError(message(e, t.errGeneric)) } finally { setBusy(false) }
          })() }}>{t.codeShowDone}</button>
          {error && <p className="setup-err" role="alert">{error}</p>}
        </div>
      )}
    </section>
  )
}
