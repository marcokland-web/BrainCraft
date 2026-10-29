import { useState } from 'react'
import { Chevron, REWARD_ICONS, RewardIcon } from '../components/Icons'
import { Seg } from '../components/Settings'
import { Sheet } from '../components/Sheet'
import { ApiError } from '../lib/api'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import {
  deleteReward,
  parentLock,
  resolveRedemption,
  saveReward,
  useStore,
  type Redemption,
  type RewardDraft,
} from '../lib/store'

// Shop-Verwaltung im Eltern-Cockpit: offene Gutscheine abhaken oder stornieren, Belohnungen anlegen.
// Vorschläge 60/100/300 Sterne (Entscheidung Lern-Lotte), aber keine Startdaten in der Datenbank.

export function ShopManager() {
  const t = useT()
  const { lang } = usePrefs()
  const s = useStore()
  const profiles = s.pull?.profiles ?? []
  const rewards = s.pull?.rewards ?? []
  const open = (s.pull?.redemptions ?? []).filter((d) => d.status === 'offen')
  const [draft, setDraft] = useState<RewardDraft | null>(null)
  const [askDelete, setAskDelete] = useState(false)
  const [askCancel, setAskCancel] = useState<Redemption | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const n = (v: number) => v.toLocaleString(locale(lang))
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'long' })
  // Ganze Tage seit dem Einlösen; ab 7 Tagen sichtbar markieren (Lotte: Gutscheine zeitnah erfüllen)
  const waited = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  const kidName = (id: string) => profiles.find((p) => p.id === id)?.child_name ?? ''

  // Fehler: abgelaufene Freischaltung führt zurück zur PIN (wie beim Freigeben)
  async function run(fn: () => Promise<void>, onError: (msg: string) => void) {
    setBusy(true)
    try {
      await fn()
      return true
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      if (code === 'pin_required') parentLock()
      else onError(code === 'offline' ? t.errOffline : code === 'limit_reached' ? t.errLimit : t.errGeneric)
      return false
    } finally {
      setBusy(false)
    }
  }

  function edit(d: RewardDraft) {
    setFormError(null)
    setDraft(d)
  }

  async function save() {
    if (!draft) return
    const title = draft.title.trim()
    if (!title || title.length > 60) return setFormError(t.errRewardTitle)
    if (!Number.isInteger(draft.cost) || draft.cost < 1 || draft.cost > 100000) return setFormError(t.errRewardCost)
    setFormError(null)
    if (await run(() => saveReward({ ...draft, title }), setFormError)) setDraft(null)
  }

  async function remove() {
    if (!draft?.id) return
    const id = draft.id
    if (await run(() => deleteReward(id), setFormError)) {
      setAskDelete(false)
      setDraft(null)
    }
  }

  return (
    <>
      <div>
        <p className="kicker">{t.vouchersTitle}</p>
        {error && <p className="setup-err" role="alert">{error}</p>}
        {open.length === 0 ? (
          <div className="card bc-empty"><p>{t.vouchersEmpty}</p></div>
        ) : (
          <>
          <p className="muted bc-small vouchers-hint">{t.vouchersHint}</p>
          <ul className="card approve-list vouchers">
            {open.map((v) => (
              <li key={v.id}>
                <div className="approve-q">
                  <b>{v.reward_title}</b>
                  <small>
                    {profiles.length > 1 && <>{kidName(v.profile_id)} · </>}
                    <span className="num">{t.voucherLine(n(v.cost_stars), date(v.redeemed_at))}</span>
                    {waited(v.redeemed_at) >= 7 && <> · <b className="voucher-late">{t.voucherWaiting(waited(v.redeemed_at))}</b></>}
                  </small>
                </div>
                <div className="approve-acts">
                  <button type="button" className="btn tinted" disabled={busy} onClick={() => { setError(null); void run(() => resolveRedemption(v.id, 'erledigt'), setError) }}>
                    {t.voucherDone}
                  </button>
                  <button type="button" className="btn plain" disabled={busy} onClick={() => { setError(null); setAskCancel(v) }}>
                    {t.voucherCancel}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      <div>
        <p className="kicker">{t.rewardsTitle}</p>
        {rewards.length === 0 && (
          <div className="card rewards-empty">
            <p className="muted">{t.rewardsEmpty}</p>
            <div className="reward-suggest" role="group" aria-label={t.rewardsSuggest}>
              {t.shopExamples.map((x) => (
                <button key={x.title} type="button" onClick={() => edit({ id: null, profileId: null, title: x.title, icon: x.icon, cost: x.cost, active: true })}>
                  <RewardIcon name={x.icon} />
                  <span>{x.title}</span>
                  <small className="num">{n(x.cost)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="list rewards">
          {rewards.map((r) => (
            <button
              key={r.id}
              type="button"
              className="row"
              aria-label={`${t.rewardEdit}: ${r.title}`}
              onClick={() => edit({ id: r.id, profileId: r.profile_id, title: r.title, icon: r.icon, cost: r.cost_stars, active: r.is_active })}
            >
              <span className="ic"><RewardIcon name={r.icon} /></span>
              <span className="tx">
                <b>{r.title}</b>
                <small>
                  <span className="num">{t.shopCost(n(r.cost_stars))}</span>
                  {profiles.length > 1 && <> · {r.profile_id ? kidName(r.profile_id) : t.rewardForAll}</>}
                </small>
              </span>
              {!r.is_active && <span className="hub-new paused">{t.rewardPaused}</span>}
              <Chevron />
            </button>
          ))}
          <button type="button" className="row add-row" onClick={() => edit({ id: null, profileId: null, title: '', icon: 'gift', cost: 60, active: true })}>
            <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span>
            <span className="tx"><b>{t.rewardAdd}</b></span>
          </button>
        </div>
      </div>

      <Sheet open={!!draft && !askDelete} onClose={() => !busy && setDraft(null)} label={draft?.id ? t.rewardEdit : t.rewardNew}>
        {draft && (
          <form className="reward-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <div className="st-bar">
              <span />
              <b>{draft.id ? t.rewardEdit : t.rewardNew}</b>
              <button type="button" className="st-done" onClick={() => setDraft(null)}>{t.cancel}</button>
            </div>
            <label className="field">
              <span>{t.rewardName}</span>
              <input value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="field">
              <span>{t.rewardCost}</span>
              <input
                className="num"
                inputMode="numeric"
                value={Number.isNaN(draft.cost) ? '' : String(draft.cost)}
                onChange={(e) => {
                  // Nur Ziffern; ohne Ziffer leer statt „0“ (Bodo)
                  const digits = e.target.value.replace(/\D/g, '')
                  setDraft({ ...draft, cost: digits === '' ? NaN : Number(digits) })
                }}
              />
            </label>
            <div className="reward-costs" role="group" aria-label={t.rewardsSuggest}>
              {[60, 100, 300].map((c) => (
                <button key={c} type="button" className={draft.cost === c ? 'on' : ''} aria-pressed={draft.cost === c} onClick={() => setDraft({ ...draft, cost: c })}>
                  <span className="num">{n(c)}</span>
                </button>
              ))}
            </div>
            <div className="field">
              <span id="reward-icon-l">{t.rewardIcon}</span>
              <div className="reward-icons" role="radiogroup" aria-labelledby="reward-icon-l">
                {REWARD_ICONS.map((k) => (
                  <label key={k} title={t.iconNames[k]}>
                    <input type="radio" name="reward-icon" value={k} checked={draft.icon === k} onChange={() => setDraft({ ...draft, icon: k })} aria-label={t.iconNames[k]} />
                    <span><RewardIcon name={k} /></span>
                  </label>
                ))}
              </div>
            </div>
            {profiles.length > 1 && (
              <div className="field">
                <span id="reward-for-l">{t.rewardFor}</span>
                <Seg
                  name="reward-for"
                  labelledBy="reward-for-l"
                  value={draft.profileId ?? 'all'}
                  options={[{ value: 'all', text: t.rewardForAll }, ...profiles.map((p) => ({ value: p.id, text: p.child_name }))]}
                  onChange={(v) => setDraft({ ...draft, profileId: v === 'all' ? null : v })}
                />
              </div>
            )}
            {draft.id && (
              <div className="field">
                <span id="reward-active-l">{t.rewardInShop}</span>
                <Seg
                  name="reward-active"
                  labelledBy="reward-active-l"
                  value={draft.active ? 'on' : 'off'}
                  options={[{ value: 'on', text: t.rewardVisible }, { value: 'off', text: t.rewardPaused }]}
                  onChange={(v) => setDraft({ ...draft, active: v === 'on' })}
                />
              </div>
            )}
            <p className="muted bc-small">{t.rewardFairHint}</p>
            {formError && <p className="setup-err" role="alert">{formError}</p>}
            <div className="setup-acts">
              <button type="submit" className="btn primary wide" disabled={busy}>{t.rewardSave}</button>
              {draft.id && (
                <button type="button" className="btn plain wide danger-text" disabled={busy} onClick={() => setAskDelete(true)}>{t.rewardDelete}</button>
              )}
            </div>
          </form>
        )}
      </Sheet>

      <Sheet open={askDelete} onClose={() => !busy && setAskDelete(false)} label={t.rewardDelete}>
        <p>{t.rewardDeleteAsk(draft?.title ?? '')}</p>
        {formError && <p className="setup-err" role="alert">{formError}</p>}
        <div className="setup-acts">
          <button type="button" className="btn danger wide" disabled={busy} onClick={remove}>{t.rewardDeleteYes}</button>
          <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAskDelete(false)}>{t.cancel}</button>
        </div>
      </Sheet>

      <Sheet open={!!askCancel} onClose={() => !busy && setAskCancel(null)} label={t.voucherCancel}>
        {askCancel && (
          <>
            <p>{t.voucherCancelAsk(askCancel.reward_title, n(askCancel.cost_stars), kidName(askCancel.profile_id))}</p>
            <div className="setup-acts">
              <button
                type="button"
                className="btn danger wide"
                disabled={busy}
                onClick={async () => {
                  const v = askCancel
                  setAskCancel(null)
                  await run(() => resolveRedemption(v.id, 'storniert'), setError)
                }}
              >
                {t.voucherCancel}
              </button>
              <button type="button" className="btn plain wide" disabled={busy} onClick={() => setAskCancel(null)}>{t.cancel}</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
