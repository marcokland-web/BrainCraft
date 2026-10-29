import { useState } from 'react'
import { RewardIcon, Star } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { ApiError } from '../lib/api'
import { play } from '../lib/audio'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { currentProfile, profileRedemptions, redeem, refresh, shopRewards, useStore } from '../lib/store'

// Sternen-Shop: Belohnungen der Eltern mit Fortschrittsbalken, Einlösen mit Rückfrage, Gutscheine.
// Einlösen nur online; die Eltern haken Gutscheine im Cockpit ab oder stornieren sie (Sterne zurück).

// Einlöse-ID je Kind und Belohnung bis zum Erfolg merken (auch über Tab-Wechsel): Nach Netzabbruch und
// erneutem Öffnen bucht der Server nicht doppelt (Bodo)
const pendingIds = new Map<string, string>()

interface Item {
  id: string
  icon: string
  title: string
  cost: number
}

export function Shop({ demo }: { demo: boolean }) {
  const t = useT()
  const { lang } = usePrefs()
  const s = useStore()
  const balance = demo ? 0 : (currentProfile(s)?.stars_balance ?? 0)
  const items: Item[] = demo
    ? t.shopExamples.map((x, i) => ({ id: `demo-${i}`, ...x }))
    : shopRewards(s).map((r) => ({ id: r.id, icon: r.icon, title: r.title, cost: r.cost_stars }))
  const vouchers = demo ? [] : profileRedemptions(s).slice(0, 10)
  const [ask, setAsk] = useState<{ item: Item; redemptionId: string } | null>(null)
  const [voucher, setVoucher] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Hinweis nach geschlossenem Sheet (z. B. Sterne reichen nach neuem Stand nicht mehr)
  const [notice, setNotice] = useState<string | null>(null)

  // Je Kind und Belohnung: Eine Belohnung „für alle“ darf beim Kinderwechsel keine fremde ID erben (Bodo)
  const pendingKey = (rewardId: string) => `${s.profileId}:${rewardId}`
  const n = (v: number) => v.toLocaleString(locale(lang))
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'long' })

  // Nächstes Ziel: die günstigste Belohnung, die noch nicht reicht
  const goal = items.filter((x) => x.cost > balance).sort((a, b) => a.cost - b.cost)[0]
  const anyReady = items.some((x) => x.cost <= balance)

  async function confirm() {
    if (!ask) return
    setBusy(true)
    setError(null)
    try {
      await redeem(ask.item.id, ask.redemptionId)
      pendingIds.delete(pendingKey(ask.item.id))
      setVoucher(ask.item.title)
      setAsk(null)
      play('chest')
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      // Stand hat sich geändert: Sheet schließen und neu laden statt „Ja, einlösen“ stehen zu lassen (Lotte)
      if (code === 'not_enough_stars' || code === 'reward_not_found') {
        setAsk(null)
        setNotice(code === 'not_enough_stars' ? t.errStars : t.errReward)
        void refresh().catch(() => undefined)
        return
      }
      setError(
        code === 'offline' ? t.errOffline
          : code === 'not_enough_stars' ? t.errStars
          : code === 'reward_not_found' ? t.errReward
          : code === 'limit_reached' ? t.errVoucherLimit
          : t.errGeneric,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bc-view shop">
      <h1 className="bc-title">{t.shopTitle}</h1>

      <div className="card shop-hero">
        <span className="shop-star"><Star className="st-ico" /></span>
        <div className="shop-bal">
          <small>{t.shopBalance}</small>
          <b className="num">{n(balance)}</b>
        </div>
        {/* Sparziel bleibt sichtbar, auch wenn schon etwas reicht (Lotte: nicht zum sofortigen Ausgeben drängen) */}
        {anyReady && <p className="shop-goal">{t.shopReadyAll}</p>}
        {goal && <p className="shop-goal">{t.shopGoal(goal.cost - balance, goal.title)}</p>}
      </div>

      {demo && <p className="muted bc-small shop-note">{t.shopDemo}</p>}
      {notice && <p className="setup-err" role="alert">{notice}</p>}

      {items.length === 0 ? (
        <div className="card bc-empty"><p>{t.shopEmpty}</p></div>
      ) : (
        <div>
          <p className="kicker">{t.shopRewards}</p>
          <ul className="shop-list">
            {items.map((x) => {
              const ready = !demo && x.cost <= balance
              return (
                <li key={x.id} className={`card shop-item${ready ? ' ready' : ''}`}>
                  <span className="shop-ic"><RewardIcon name={x.icon} /></span>
                  <div className="shop-tx">
                    <b>{x.title}</b>
                    <small className="num">{t.shopCost(n(x.cost))}</small>
                  </div>
                  <div className="shop-prog">
                    <div className="bar" role="progressbar" aria-label={x.title} aria-valuemin={0} aria-valuemax={x.cost} aria-valuenow={Math.min(balance, x.cost)} aria-valuetext={t.shopSoFar(n(Math.min(balance, x.cost)), n(x.cost))}>
                      <i style={{ width: `${Math.min(100, (balance / x.cost) * 100)}%` }} />
                    </div>
                    <small className={ready ? 'shop-ok' : 'muted'}>{ready ? t.shopReady : balance * 2 < x.cost ? t.shopSoFar(n(balance), n(x.cost)) : t.shopMissing(x.cost - balance)}</small>
                  </div>
                  <button
                    type="button"
                    className="btn tinted shop-btn"
                    disabled={!ready}
                    onClick={() => { setError(null); setNotice(null); setAsk({ item: x, redemptionId: pendingIds.get(pendingKey(x.id)) ?? pendingIds.set(pendingKey(x.id), crypto.randomUUID()).get(pendingKey(x.id))! }) }}
                  >
                    {t.shopRedeem}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {vouchers.length > 0 && (
        <div>
          <p className="kicker">{t.shopVouchers}</p>
          <div className="list">
            {vouchers.map((v) => (
              <div key={v.id} className="row" aria-disabled="true">
                <span className="tx">
                  <b>{v.reward_title}</b>
                  <small>
                    {v.status === 'offen' ? t.voucherOpen
                      : v.status === 'erledigt' ? t.voucherDoneOn(date(v.resolved_at ?? v.redeemed_at))
                      : t.voucherRefunded}
                  </small>
                </span>
                {v.status === 'offen' && <span className="hub-new">{t.shopCost(n(v.cost_stars))}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <Sheet open={!!ask} onClose={() => !busy && setAsk(null)} label={t.shopRedeem}>
        {ask && (
          <>
            <div className="shop-ask-ic"><RewardIcon name={ask.item.icon} /></div>
            <p>{t.shopAsk(ask.item.title, n(ask.item.cost), balance - ask.item.cost)}</p>
            {error && <p className="setup-err" role="alert">{error}</p>}
            <div className="setup-acts">
              <button type="button" className="btn primary wide" disabled={busy} onClick={confirm}>{t.shopYes}</button>
              <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAsk(null)}>{t.cancel}</button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={!!voucher} onClose={() => setVoucher(null)} label={t.shopVoucherTitle}>
        <div className="shop-voucher">
          <small>{t.shopVoucherTitle}</small>
          <b>{voucher}</b>
        </div>
        <p>{t.shopVoucherText}</p>
        <button type="button" className="btn primary wide" onClick={() => setVoucher(null)}>{t.shopVoucherOk}</button>
      </Sheet>
    </section>
  )
}
