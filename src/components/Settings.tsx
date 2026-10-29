import { useEffect, useRef } from 'react'
import { useT } from '../lib/i18n'
import { setPref, usePrefs, type Lang, type Speech, type Theme } from '../lib/prefs'
import { Chevron, Logo } from './Icons'

declare const __APP_VERSION__: string

interface Props {
  open: boolean
  onClose: () => void
  // Ohne Verbindung (Einrichten) gibt es kein Eltern-Cockpit
  onParents?: () => void
}

// Segment-Steuerung als Radio-Gruppe (Tastatur und Screenreader), Aufbau wie in Rechenstern
export function Seg<V extends string>(props: {
  name: string
  label?: string
  labelledBy?: string
  value: V
  options: { value: V; text: string }[]
  onChange: (v: V) => void
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={props.label} aria-labelledby={props.labelledBy}>
      {props.options.map((o) => (
        <label key={o.value}>
          <input
            type="radio"
            name={props.name}
            value={o.value}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          <span>{o.text}</span>
        </label>
      ))}
    </div>
  )
}

export function Settings({ open, onClose, onParents }: Props) {
  const t = useT()
  const p = usePrefs()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="st-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="st">
        <div className="st-grab" aria-hidden="true" />
        <div className="st-bar">
          <span />
          <b id="st-title">{t.settings}</b>
          <button type="button" className="st-done" onClick={onClose}>
            {t.done}
          </button>
        </div>

        <p className="st-head" id="st-h-theme">{t.appearance}</p>
        <div className="st-group">
          <Seg<Theme>
            name="st-theme"
            labelledBy="st-h-theme"
            value={p.theme}
            onChange={(v) => setPref('theme', v)}
            options={[
              { value: 'auto', text: t.auto },
              { value: 'light', text: t.light },
              { value: 'dark', text: t.dark },
            ]}
          />
        </div>
        <p className="st-foot">{t.autoHint}</p>

        <p className="st-head" id="st-h-lang">{t.language}</p>
        <div className="st-group">
          <Seg<Lang>
            name="st-lang"
            labelledBy="st-h-lang"
            value={p.lang}
            onChange={(v) => setPref('lang', v)}
            options={[
              { value: 'de', text: 'Deutsch' },
              { value: 'en', text: 'English' },
            ]}
          />
        </div>

        <p className="st-head" id="st-h-game">{t.game}</p>
        <div className="st-group">
          <Seg<'on' | 'off'>
            name="st-sound"
            labelledBy="st-h-game"
            value={p.sound ? 'on' : 'off'}
            onChange={(v) => setPref('sound', v === 'on')}
            options={[
              { value: 'on', text: t.soundOn },
              { value: 'off', text: t.soundOff },
            ]}
          />
          <p className="st-sub" id="st-h-speech">{t.speechLabel}</p>
          <Seg<Speech>
            name="st-speech"
            labelledBy="st-h-speech"
            value={p.speech}
            onChange={(v) => setPref('speech', v)}
            options={[
              { value: 'off', text: t.speechOff },
              { value: 'tap', text: t.speechTap },
              { value: 'auto', text: t.speechAuto },
            ]}
          />
          <p className="st-foot st-in">{t.speechHint}</p>
          {onParents && (
            <button type="button" className="row" onClick={onParents}>
              <span className="tx">
                <b>{t.parents}</b>
              </span>
              <Chevron />
            </button>
          )}
        </div>
        {onParents && <p className="st-foot">{t.parentsHint}</p>}

        <p className="st-head">{t.about}</p>
        <div className="st-group st-about">
          <Logo className="st-icon" />
          <span className="st-t">
            <b>BrainCraft</b>
            <small>{t.aboutSub}</small>
            <small>
              {t.version} {__APP_VERSION__}
            </small>
            <small>{t.aboutPart}</small>
          </span>
        </div>
      </div>
    </dialog>
  )
}
