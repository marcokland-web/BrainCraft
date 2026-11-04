import { useEffect, useState } from 'react'
import { Sheet } from '../components/Sheet'
import { ApiError } from '../lib/api'
import { normEmail, validEmail } from '../lib/email'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { deleteInvite, inviteParent, loadParents, parentLock, removeParent, type ParentList } from '../lib/store'

// Eltern der Familie im Eltern-Cockpit: Google-Konten der Familie, offene Einladungen, weiteres Elternteil
// per Gmail-Adresse einladen. Die Liste bleibt nur im Speicher (Eltern-Inhalt, Siggi N2).

type Ask = { kind: 'invite'; email: string } | { kind: 'parent'; email: string; userId: string }

export function Family() {
  const t = useT()
  const { lang } = usePrefs()
  const [list, setList] = useState<ParentList | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)

  function fail(e: unknown) {
    const code = e instanceof ApiError ? e.code : ''
    if (code === 'pin_required') return parentLock()
    setError(
      code === 'offline' ? t.errOffline
        : code === 'bad_email' ? t.errBadEmail
        : code === 'already_parent' ? t.errAlreadyParent
        : code === 'limit_reached' ? t.errLimit
        : code === 'missing_function' ? t.errNotReady
        : t.errGeneric,
    )
  }

  async function reload() {
    try {
      setList(await loadParents())
    } catch (e) {
      fail(e)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function invite() {
    const v = normEmail(email)
    if (!validEmail(v)) return setError(t.errBadEmail)
    if (await run(() => inviteParent(v))) setEmail('')
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="family">
      <p className="kicker">{t.parentsTitle}</p>
      <div className="card">
        {list && (
          <ul className="approve-list fam-parents">
            {list.parents.map((p) => (
              <li key={p.user_id}>
                <div className="approve-q">
                  <b>{p.email}</b>
                  {p.is_me && <small>{t.parentsMe}</small>}
                </div>
                {!p.is_me && (
                  <div className="approve-acts">
                    <button type="button" className="btn plain danger-text" disabled={busy} onClick={() => { setError(null); setAsk({ kind: 'parent', email: p.email, userId: p.user_id }) }}>{t.parentRemove}</button>
                  </div>
                )}
              </li>
            ))}
            {list.invites.map((i) => (
              <li key={i.email}>
                <div className="approve-q">
                  <b>{i.email}</b>
                  <small>{t.parentsInvited(date(i.expires_at))}</small>
                </div>
                <div className="approve-acts">
                  <button type="button" className="btn plain danger-text" disabled={busy} onClick={() => { setError(null); setAsk({ kind: 'invite', email: i.email }) }}>{t.inviteRemove}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className="invite-form" noValidate onSubmit={(e) => { e.preventDefault(); void invite() }}>
          <div className="invite-row">
            <label className="field">
              <span>{t.inviteLabel}</span>
              <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254}
                value={email} onChange={(e) => { setError(null); setEmail(e.target.value) }} />
            </label>
            <button type="submit" className="btn tinted" disabled={busy || !email.trim()}>{t.inviteButton}</button>
          </div>
          {error && !ask && <p className="setup-err" role="alert">{error}</p>}
          <p className="muted bc-small">{t.inviteHint}</p>
        </form>
      </div>

      <Sheet open={!!ask} onClose={() => !busy && setAsk(null)} label={ask?.kind === 'parent' ? t.parentRemove : t.inviteRemove}>
        {ask && (
          <>
            <p>{ask.kind === 'parent' ? t.parentRemoveAsk(ask.email) : t.inviteRemoveAsk(ask.email)}</p>
            {error && <p className="setup-err" role="alert">{error}</p>}
            <div className="setup-acts">
              <button
                type="button"
                className="btn danger wide"
                disabled={busy}
                onClick={async () => {
                  const a = ask
                  const done = await run(() => (a.kind === 'parent' ? removeParent(a.userId) : deleteInvite(a.email)))
                  if (done) setAsk(null)
                }}
              >
                {ask.kind === 'parent' ? t.parentRemove : t.inviteRemove}
              </button>
              <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAsk(null)}>{t.cancel}</button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}
