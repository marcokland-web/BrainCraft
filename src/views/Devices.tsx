import qrcode from 'qrcode-generator'
import { useEffect, useState } from 'react'
import { Sheet } from '../components/Sheet'
import { ApiError } from '../lib/api'
import { redirectUrl } from '../lib/auth'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { createPairCode, loadDevices, parentLock, revokeDevice, type DeviceRow } from '../lib/store'

// Kinder-Geräte im Eltern-Cockpit (nur Eltern-Gerät mit Google): koppeln per Einmal-Code und QR-Code,
// Liste mit „zuletzt aktiv“, Entfernen mit roter Rückfrage (Token sofort ungültig). Nur im Speicher.

// QR-Code als SVG-Pfad (ohne Inline-Stile, passt zur CSP)
function Qr({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
  return (
    <svg className="pair-qr" viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#FFFFFF" />
      <path d={d} fill="#1D1A1C" />
    </svg>
  )
}

export function Devices() {
  const t = useT()
  const { lang } = usePrefs()
  const [list, setList] = useState<DeviceRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairOpen, setPairOpen] = useState(false)
  const [name, setName] = useState(t.devicePairDefault)
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [ask, setAsk] = useState<DeviceRow | null>(null)

  function fail(e: unknown) {
    const c = e instanceof ApiError ? e.code : ''
    if (c === 'pin_required') return parentLock()
    setError(c === 'offline' ? t.errOffline : c === 'limit_reached' ? t.errLimit : c === 'missing_function' ? t.errNotReady : t.errGeneric)
  }

  async function reload() {
    try {
      setList(await loadDevices())
    } catch (e) {
      fail(e)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ablauf des Codes sichtbar machen
  useEffect(() => {
    if (!code) return
    const id = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(id)
  }, [code])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      setCode(await createPairCode(name))
      setNow(Date.now())
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function remove(d: DeviceRow) {
    setBusy(true)
    setError(null)
    try {
      await revokeDevice(d.id)
      setAsk(null)
      await reload()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(locale(lang), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })
  const expired = !!code && new Date(code.expires_at).getTime() <= now
  const link = code ? `${redirectUrl()}#pair=${code.code}` : ''

  return (
    <div className="devices">
      <p className="kicker">{t.devicesTitle}</p>
      <div className="card">
        {list && list.length === 0 && <p className="muted bc-small">{t.devicesEmpty}</p>}
        {list && list.length > 0 && (
          <ul className="approve-list fam-parents">
            {list.map((d) => (
              <li key={d.id}>
                <div className="approve-q">
                  <b>{d.name}</b>
                  <small>{d.revoked_at ? t.deviceRemoved : d.last_seen_at ? t.deviceLastSeen(when(d.last_seen_at)) : t.deviceNever}</small>
                </div>
                {!d.revoked_at && (
                  <div className="approve-acts">
                    <button type="button" className="btn plain danger-text" disabled={busy} onClick={() => { setError(null); setAsk(d) }}>{t.deviceRemove}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && !ask && !pairOpen && <p className="setup-err" role="alert">{error}</p>}
        <div className="setup-acts devices-acts">
          <button type="button" className="btn tinted wide" onClick={() => { setError(null); setCode(null); setPairOpen(true) }}>{t.devicePair}</button>
        </div>
      </div>

      <Sheet open={pairOpen} onClose={() => { if (!busy) { setPairOpen(false); setCode(null); void reload() } }} label={t.devicePair}>
        {!code ? (
          <form className="pair-create" onSubmit={(e) => { e.preventDefault(); void create() }}>
            <label className="field">
              <span>{t.devicePairName}</span>
              <input value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
            </label>
            {error && <p className="setup-err" role="alert">{error}</p>}
            <div className="setup-acts">
              <button type="submit" className="btn primary wide" disabled={busy || !name.trim()}>{t.devicePairCreate}</button>
              <button type="button" className="btn plain wide" disabled={busy} onClick={() => setPairOpen(false)}>{t.cancel}</button>
            </div>
          </form>
        ) : (
          <div className="pair-show">
            <p>{t.devicePairShow}</p>
            <p className="pair-code num" aria-live="polite">{code.code}</p>
            {!expired && <Qr text={link} label={t.qrLabel} />}
            <p className={expired ? 'setup-err' : 'muted bc-small'} role={expired ? 'alert' : undefined}>
              {expired ? t.devicePairExpired : t.devicePairValid(time(code.expires_at))}
            </p>
            <div className="setup-acts">
              {expired && <button type="button" className="btn tinted wide" disabled={busy} onClick={() => void create()}>{t.devicePairCreate}</button>}
              <button type="button" className="btn plain wide" onClick={() => { setPairOpen(false); setCode(null); void reload() }}>{t.done}</button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!ask} onClose={() => !busy && setAsk(null)} label={t.deviceRemove}>
        {ask && (
          <>
            <p>{t.deviceRemoveAsk(ask.name)}</p>
            {error && <p className="setup-err" role="alert">{error}</p>}
            <div className="setup-acts">
              <button type="button" className="btn danger wide" disabled={busy} onClick={() => void remove(ask)}>{t.deviceRemove}</button>
              <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAsk(null)}>{t.cancel}</button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}
