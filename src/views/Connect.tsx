import { useState } from 'react'
import { ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { pairDevice } from '../lib/store'

// Kinder-Gerät verbinden: Einmal-Code vom Eltern-Gerät eingeben (oder per QR-Link übernommen).
// Der Code hat 10 Zeichen ohne verwechselbare Zeichen (XXXXX-XXXXX); Groß/klein und Leerzeichen egal.

const PAIR_KEY = 'braincraft:paircode'

// QR-Link öffnet die App mit #pair=CODE: Code für das Formular merken, Adresse sofort säubern
export function takePairCodeFromUrl() {
  const m = /(?:^#|&)pair=([A-Za-z0-9-]{10,12})(?:&|$)/.exec(location.hash)
  if (!m) return
  try {
    sessionStorage.setItem(PAIR_KEY, m[1].toUpperCase())
  } catch {
    // Privater Modus: dann eben abtippen
  }
  history.replaceState(history.state, '', location.pathname + location.search)
}

export function pendingPairCode(): string {
  try {
    return sessionStorage.getItem(PAIR_KEY) ?? ''
  } catch {
    return ''
  }
}

function clearPendingPairCode() {
  try {
    sessionStorage.removeItem(PAIR_KEY)
  } catch {
    // egal
  }
}

// Eingabe gut lesbar halten: nur erlaubte Zeichen, Bindestrich nach 5
function formatCode(raw: string) {
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v
}

export function PairForm({ onCancel }: { onCancel?: () => void }) {
  const t = useT()
  const fromLink = pendingPairCode()
  const [code, setCode] = useState(formatCode(fromLink))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const err = await pairDevice(code)
      if (err) setError(err === 'pair_blocked' ? t.pairBlocked : t.pairInvalid)
      else clearPendingPairCode()
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'offline' ? t.errOffline : e instanceof ApiError && e.code === 'limit_reached' ? t.errLimit : t.errGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card setup-form pair-form" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <h2>{t.pairTitle}</h2>
      <label className="field">
        <span>{t.pairCodeLabel}</span>
        <input
          className="pair-input num"
          value={code}
          onChange={(e) => { setError(null); setCode(formatCode(e.target.value)) }}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="XXXXX-XXXXX"
          aria-describedby="pair-help"
        />
      </label>
      <p className="muted setup-note" id="pair-help">{fromLink ? t.pairFromLink : t.pairCodeHelp}</p>
      {error && <p className="setup-err" role="alert">{error}</p>}
      <div className="setup-acts">
        <button type="submit" className="btn primary wide" disabled={busy || code.replace('-', '').length !== 10}>{t.pairConnect}</button>
        {onCancel && <button type="button" className="btn plain wide" disabled={busy} onClick={onCancel}>{t.cancel}</button>}
      </div>
    </form>
  )
}
