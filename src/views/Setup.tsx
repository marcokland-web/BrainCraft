import { useState } from 'react'
import { AccountRow } from '../components/Account'
import { Chevron, Logo } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { ApiError } from '../lib/api'
import { signInWithGoogle, signOutDevice, useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { acceptInvite, createFamily, declineInvite, linkSession, useStore } from '../lib/store'

// Einrichten (Eltern): Gerät einmal mit Google anmelden, beim ersten Mal Familie anlegen, oder Probemodus.
// Hier darf getippt werden; Zero-Typing gilt für das Kind im Spiel. Ist das Gerät angemeldet und gehört
// das Konto zu einer Familie, erscheint diese Ansicht nie (App zeigt direkt das Spiel).

// Offizielles „G“ von Google (Branding-Richtlinien für „Sign in with Google“), als Inline-SVG
function GoogleG() {
  return (
    <svg className="gsi-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  )
}

export function GoogleButton({ disabled }: { disabled?: boolean }) {
  const t = useT()
  const { redirecting } = useAuth()
  return (
    <button
      type="button"
      className="gsi-btn"
      disabled={disabled || redirecting}
      aria-busy={redirecting || undefined}
      // Bei Erfolg verlässt die Seite die App (Weiterleitung zu Google); Fehler zeigt die Ansicht
      onClick={() => void signInWithGoogle().catch(() => undefined)}
    >
      <GoogleG />
      <span>{redirecting ? t.googleOpening : t.googleSignIn}</span>
    </button>
  )
}

export function Setup({ onDemo }: { onDemo: () => void }) {
  const t = useT()
  const s = useStore()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [child, setChild] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [askDecline, setAskDecline] = useState<string | null>(null)

  function message(e: unknown) {
    if (!(e instanceof ApiError)) return t.errGeneric
    if (e.code === 'offline') return t.errOffline
    if (e.code === 'has_family') return t.errHasFamily
    if (e.code === 'limit_reached') return t.errLimitFamilies
    if (e.code === 'not_signed_in') return t.errSignedOut
    if (e.code === 'bad_pin') return t.errPinFormat
    if (e.code === 'invite_not_found') return t.inviteGone
    return t.errGeneric
  }

  async function accept(familyId: string) {
    setBusy(true)
    setError(null)
    try {
      await acceptInvite(familyId)
    } catch (e) {
      setError(message(e))
      void linkSession().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  async function decline(familyId: string) {
    setBusy(true)
    setError(null)
    try {
      await declineInvite(familyId)
      setAskDecline(null)
    } catch (e) {
      setError(message(e))
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
      await createFamily(name, pin)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  async function retry() {
    setBusy(true)
    try {
      await linkSession()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const signedIn = auth.ready && !!auth.user
  // Angemeldet, Familie wird gerade erfragt (oder offline nicht erreichbar)
  const linking = signedIn && !s.needsFamily
  const authError = auth.error === 'cancelled' ? t.authCancelled : auth.error === 'no_access' ? t.authNoAccess : auth.error === 'failed' ? t.authFailed : null
  // Früher verbunden (alter Code) oder abgemeldet mit behaltenem Stand: Kind sieht freundlichen Hinweis
  const intro = s.legacy ? t.legacyText : s.family ? t.relinkText : t.welcomeText

  return (
    <section className="bc-view setup">
      <div className="card setup-hero">
        <Logo className="setup-logo" />
        <h1 className="bc-title">{t.welcomeTitle}</h1>
        <p className="muted">{intro}</p>
      </div>

      {!auth.ready && (
        <div className="card setup-form" aria-busy="true">
          <p className="muted setup-wait" role="status">{t.authWait}</p>
        </div>
      )}

      {auth.ready && !signedIn && (
        <>
          <div className="card setup-form setup-signin">
            <p>{t.signInText}</p>
            <GoogleButton />
            {authError && <p className="setup-err" role="alert">{authError}</p>}
          </div>
          {!s.family && (
            <div className="list">
              <button type="button" className="row" onClick={onDemo}>
                <span className="tx"><b>{t.tryDemo}</b><small>{t.tryDemoSub}</small></span>
                <Chevron />
              </button>
            </div>
          )}
        </>
      )}

      {linking && (
        <div className="card setup-form">
          <p className="muted setup-wait" role="status">{s.offline ? t.errOffline : t.authWait}</p>
          {(s.offline || error) && (
            <>
              {error && <p className="setup-err" role="alert">{error}</p>}
              <button type="button" className="btn tinted wide" disabled={busy} onClick={() => void retry()}>{t.retry}</button>
            </>
          )}
        </div>
      )}

      {signedIn && s.needsFamily && (
        <div className="list"><AccountRow user={auth.user!} /></div>
      )}

      {signedIn && s.needsFamily && s.invites.map((inv) => (
        <div key={inv.family_id} className="card setup-form setup-invite">
          <h2>{t.invitesTitle}</h2>
          <p>{inv.invited_by ? t.inviteFrom(inv.invited_by) : t.inviteFromUnknown}</p>
          {error && !askDecline && <p className="setup-err" role="alert">{error}</p>}
          <div className="setup-acts">
            <button type="button" className="btn primary wide" disabled={busy} onClick={() => void accept(inv.family_id)}>{t.inviteAccept}</button>
            <button type="button" className="btn plain wide" disabled={busy} onClick={() => { setError(null); setAskDecline(inv.family_id) }}>{t.inviteDecline}</button>
          </div>
        </div>
      ))}

      {signedIn && s.needsFamily && (
        <form className="card setup-form" onSubmit={(e) => { e.preventDefault(); void doCreate() }}>
          <h2>{s.invites.length ? t.orCreate : t.createTitle}</h2>
          <p>{t.createText}</p>
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
          {error && !s.invites.length && <p className="setup-err" role="alert">{error}</p>}
          <div className="setup-acts">
            {/* Höchstens ein gefüllter Hauptknopf je Ansicht: mit Einladung ist „Annehmen“ der Hauptknopf */}
            <button type="submit" className={`btn ${s.invites.length ? 'tinted' : 'primary'} wide`} disabled={busy}>{t.create}</button>
            <button type="button" className="btn plain wide" disabled={busy} onClick={() => { setError(null); void signOutDevice() }}>{t.otherAccount}</button>
          </div>
          {!s.invites.length && <p className="muted setup-note">{t.invitedHint}</p>}
        </form>
      )}

      <Sheet open={!!askDecline} onClose={() => !busy && setAskDecline(null)} label={t.inviteDecline}>
        <p>{t.inviteDeclineAsk}</p>
        {error && <p className="setup-err" role="alert">{error}</p>}
        <div className="setup-acts">
          <button type="button" className="btn danger wide" disabled={busy} onClick={() => askDecline && void decline(askDecline)}>{t.inviteDecline}</button>
          <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAskDecline(null)}>{t.cancel}</button>
        </div>
      </Sheet>
    </section>
  )
}
