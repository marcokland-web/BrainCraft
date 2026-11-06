import { useState } from 'react'
import { AccountRow } from '../components/Account'
import { Logo } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { signOutDevice, takeGoogleReturn, useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { resolveConflict, useStore, wipeLocal } from '../lib/store'
import { PairForm } from './Connect'
import { GoogleButton } from './Setup'

// Kinderansicht, wenn das Gerät neu verbunden werden muss (Lern-Lotte D3): erst ein freundlicher Satz fürs
// Kind, Bedienelemente für Eltern erst nach „Ich bin Mama oder Papa“. Stand und Warteschlange bleiben, bis
// neu verbunden ist oder die Eltern bewusst löschen (roter Knopf). Erscheint nie mitten in Runde oder Boss.
export function Reconnect() {
  const t = useT()
  const s = useStore()
  const auth = useAuth()
  const { name } = usePrefs()
  // Eltern-Bereich nur von selbst offen, wenn das Gerät in dieser Sitzung gerade von Google zurückkommt
  // (Merker beim Tipp auf den Google-Knopf); sonst erst nach „Ich bin Mama oder Papa“ (Doris M1)
  const [parent, setParent] = useState(takeGoogleReturn)
  const [askWipe, setAskWipe] = useState(false)
  const pending = s.queue.filter((q) => q.kind !== 'seen').length

  const help = s.access === 'legacy' ? t.parentHelpLegacy
    : s.access === 'expired' ? t.parentHelpExpired
    : s.access === 'no_family' ? t.parentHelpNoFamily
    : t.parentHelpRevoked
  const authError = auth.error === 'no_access' ? `${t.authNoAccess} ${t.authNoAccessHint}`
    : auth.error === 'expired' ? t.authExpired
    : auth.error === 'cancelled' ? t.authCancelled
    : auth.error === 'offline' ? t.errOffline
    : auth.error === 'failed' ? t.authFailed : null
  // Altgerät: Tausch gegen ein Geräte-Token läuft gerade (kein kurzes Aufblitzen des Spiels, Lotte D4)
  const waiting = s.access === 'legacy' && !s.offline

  return (
    <section className="bc-view setup reconnect">
      <div className="card setup-hero">
        <Logo className="setup-logo" />
        <h1 className="bc-title">{t.kidWaitTitle(name)}</h1>
        <p className="muted">{waiting ? t.authWait : t.kidWaitText}</p>
      </div>

      {!parent && !waiting && (
        <div className="setup-acts">
          <button type="button" className="btn tinted wide" onClick={() => setParent(true)}>{t.iAmParent}</button>
        </div>
      )}

      {parent && auth.user && s.needsFamily && (
        <>
          <div className="list"><AccountRow user={auth.user} /></div>
          <div className="card setup-form">
            <p>{t.reconnectNoFamily(pending)}</p>
            <div className="setup-acts">
              <button type="button" className="btn tinted wide" onClick={() => void signOutDevice()}>{t.otherAccount}</button>
              <button type="button" className="btn danger wide" onClick={() => setAskWipe(true)}>{t.reconnectNewFamily}</button>
            </div>
          </div>
        </>
      )}

      {parent && !(auth.user && s.needsFamily) && (
        <>
          <p className="muted setup-note reconnect-help">{help}</p>
          <PairForm onCancel={() => setParent(false)} />
          <div className="card setup-form setup-signin">
            <p>{t.googleCardText}</p>
            <GoogleButton />
            {authError && <p className="setup-err" role="alert">{authError}</p>}
          </div>
          <div className="list">
            <button type="button" className="row danger-row" onClick={() => setAskWipe(true)}>
              <span className="tx"><b>{t.wipeLocalBtn}</b></span>
            </button>
          </div>
        </>
      )}

      <Sheet open={askWipe} onClose={() => setAskWipe(false)} label={t.wipeLocalBtn}>
        <p>{t.wipeLocalAsk(pending)}</p>
        <div className="setup-acts">
          <button type="button" className="btn danger wide" onClick={() => { setAskWipe(false); wipeLocal() }}>{t.wipeLocalBtn}</button>
          <button type="button" className="btn plain wide" data-autofocus onClick={() => setAskWipe(false)}>{t.cancel}</button>
        </div>
      </Sheet>
    </section>
  )
}

// Neue Familie passt nicht zum Stand auf dem Gerät (anderes Konto, Code einer anderen Familie): nichts wird
// gesendet, bis die Eltern entscheiden (Lern-Lotte D1, Bodo C4)
export function ConflictView() {
  const t = useT()
  const s = useStore()
  const [busy, setBusy] = useState(false)
  const pending = s.queue.filter((q) => q.kind !== 'seen').length
  return (
    <section className="bc-view setup conflict">
      <div className="card setup-form">
        <h2>{t.conflictTitle}</h2>
        <p>{t.conflictText(pending)}</p>
        <div className="setup-acts">
          <button type="button" className="btn danger wide" disabled={busy} onClick={async () => { setBusy(true); try { await resolveConflict(true) } finally { setBusy(false) } }}>{t.conflictTake}</button>
          <button type="button" className="btn plain wide" disabled={busy} onClick={async () => {
            setBusy(true)
            // Google-Konto einer anderen Familie: abmelden, damit nichts an sie gesendet wird
            if (s.conflict?.source === 'google') await signOutDevice()
            await resolveConflict(false)
            setBusy(false)
          }}>{t.conflictKeep}</button>
        </div>
      </div>
    </section>
  )
}
