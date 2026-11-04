import { useState } from 'react'
import type { AuthUser } from '../lib/auth'
import { useT } from '../lib/i18n'

// Konto-Zeile (gleich in allen Studio-Apps): Foto aus dem Google-Profil oder Anfangsbuchstabe,
// Name, E-Mail, „Angemeldet mit Google“
export function AccountRow({ user }: { user: AuthUser }) {
  const t = useT()
  const [broken, setBroken] = useState(false)
  const label = user.name || user.email
  const initial = (label.trim()[0] ?? '?').toUpperCase()
  return (
    <div className="row acc-row">
      {user.avatar && !broken ? (
        <img className="acc-pic" src={user.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span className="acc-pic acc-initial" aria-hidden="true">{initial}</span>
      )}
      <span className="tx">
        <b>{label}</b>
        {user.name && <small className="acc-mail">{user.email}</small>}
        <small>{t.deviceAccount}</small>
      </span>
    </div>
  )
}
