import { ItemIcon, TabGear } from '../components/Icons'
import { locale, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { bossToGo, bossWon, gear, useStore } from '../lib/store'
import type { Exam } from '../lib/types'

// Ausrüstung: alle 12 Teile als Raster in fester Reihenfolge. Gewonnene Teile golden mit Herkunft,
// fehlende als Umriss; das nächste Teil ist mit Namen hervorgehoben (Neugier statt Druck).
// Jedes Teil hat sein Symbol von Logo-Luisa (ItemIcon); Platzhalter ohne Teil zeigen das Schild.

const SLOTS = 12

export function GearView({ demo, onBoss }: { demo: boolean; onBoss: (exam: Exam) => void }) {
  const t = useT()
  const { lang } = usePrefs()
  const s = useStore()
  const { items, owned } = gear(s)
  const exams = s.pull?.exams ?? []
  const nameOf = (key: string, de: string, en: string) => t.itemNames[key] ?? (lang === 'en' ? en : de)
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' })

  // Ohne Liste vom Server (Probemodus, alter Stand): nur Umrisse
  const list = demo || items.length === 0 ? Array.from({ length: SLOTS }, () => null) : items
  const count = demo ? 0 : owned.size
  const next = demo ? null : items.find((i) => !owned.has(i.item_key))
  // Blockwächter, die auf Ben warten (bereit und noch nicht geschafft)
  const waiting = demo ? [] : exams.filter((e) => e.profile_id === s.profileId && !e.is_archived && bossToGo(s, e.id) === 0 && !bossWon(s, e.id))

  return (
    <section className="bc-view gear-view">
      <h1 className="bc-title">{t.gearTitle}</h1>

      <div className="card gear-head">
        <p className="gear-count num">{t.gearCount(count, list.length)}</p>
        {count === 0 && <p className="muted bc-small">{demo ? t.gearDemo : t.gearEmpty}</p>}
      </div>

      {/* Nur ein Hinweis, damit das Raster am iPhone sichtbar bleibt (Bodo) */}
      {waiting[0] && (
        <button type="button" className="btn tinted wide gear-boss" onClick={() => onBoss(waiting[0])}>
          <span className="tx">
            <b>{t.bossWaiting}</b>
            <small>{waiting.length > 1 ? t.bossWaitingMore(waiting[0].title, waiting.length - 1) : waiting[0].title}</small>
          </span>
        </button>
      )}

      <ul className="gear-grid">
        {list.map((item, i) => {
          if (!item) {
            return (
              <li key={i} className="gear-slot" aria-label={t.gearLocked}>
                <span className="gear-ic"><TabGear /></span>
              </li>
            )
          }
          const won = owned.get(item.item_key)
          const name = nameOf(item.item_key, item.title_de, item.title_en)
          if (won) {
            const exam = exams.find((e) => e.id === won.exam_id)
            return (
              <li key={item.item_key} className="gear-slot won">
                <span className="gear-ic"><ItemIcon name={item.item_key} /></span>
                <b>{name}</b>
                <small>{exam ? t.gearFrom(exam.title) : t.gearFromOld}</small>
                <small>{date(won.unlocked_at)}</small>
              </li>
            )
          }
          const isNext = next?.item_key === item.item_key
          return (
            <li key={item.item_key} className={`gear-slot${isNext ? ' next' : ''}`} aria-label={isNext ? `${t.gearNext}: ${name}` : t.gearLocked}>
              <span className="gear-ic"><ItemIcon name={item.item_key} /></span>
              {isNext && (
                <>
                  <span className="hub-new">{t.gearNext}</span>
                  <b>{name}</b>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
