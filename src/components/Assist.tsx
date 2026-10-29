import { useEffect, useState } from 'react'
import { fillName, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { speak, speechAvailable, splitSentences, stopSpeaking } from '../lib/speech'
import type { Question } from '../lib/types'
import { withKeywords, type Slide } from '../views/Learn'
import { Speaker } from './Icons'
import { Sheet } from './Sheet'

// Hilfen für Arena und Boss-Kampf: Frage vorlesen und Spickzettel (Lernfolie zur Frage).

// Was vorgelesen wird: die Frage, dazu Lückensatz bzw. Antwortmöglichkeiten
function spokenText(q: Question, name: string): string[] {
  const out = splitSentences(fillName(q.prompt, name))
  if (q.type === 'word_clicker') out.push(fillName(q.payload.sentence_with_gap, name).replace('[GAP]', '…'))
  if (q.type === 'multiple_choice') out.push(...q.payload.options.map((o) => fillName(o, name)))
  return out
}

// Vorlesen der aktuellen Frage. „Automatisch“ liest bei jedem neuen step vor; beim Wechsel wird gestoppt.
export function useQuestionSpeech(q: Question | undefined, step: unknown, active: boolean) {
  const { name, speech } = usePrefs()
  const [reading, setReading] = useState(false)
  const canSpeak = speechAvailable() && speech !== 'off'

  useEffect(() => {
    if (!q || !active) return
    if (canSpeak && speech === 'auto') {
      setReading(true)
      speak(spokenText(q, name), () => undefined, () => setReading(false))
    }
    return () => {
      stopSpeaking()
      setReading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, active])

  useEffect(() => stopSpeaking, [])

  function toggle() {
    if (!q) return
    if (reading) {
      stopSpeaking()
      setReading(false)
      return
    }
    setReading(true)
    speak(spokenText(q, name), () => undefined, () => setReading(false))
  }

  function stop() {
    stopSpeaking()
    setReading(false)
  }

  return { canSpeak, reading, toggle, stop }
}

export function SpeakButton({ reading, onClick }: { reading: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <button type="button" className={`a-say${reading ? ' on' : ''}`} aria-label={reading ? t.pause : t.readQuestion} aria-pressed={reading} onClick={onClick}>
      <Speaker />
    </button>
  )
}

// Spickzettel (Lern-Lotte): vor dem Aufdecken nur der Folientitel als Erinnerungsanker, danach der ganze Text
export function CheatSheet({ slide, open, revealed, onClose }: {
  slide: Slide | null
  open: boolean
  revealed: boolean
  onClose: () => void
}) {
  const t = useT()
  const { name, speech } = usePrefs()
  const canSpeak = speechAvailable() && speech !== 'off'
  const close = () => {
    stopSpeaking()
    onClose()
  }
  return (
    <Sheet open={open && !!slide} onClose={close} label={t.cheatTitle}>
      {slide && (
        <div className="a-cheatsheet">
          <p className="kicker">{t.cheatTitle}</p>
          <h2>{slide.title}</h2>
          {revealed
            ? <p>{withKeywords(fillName(slide.content, name), slide.keywords)}</p>
            : <p className="muted">{t.cheatTitleOnly}</p>}
          <div className="setup-acts">
            {canSpeak && (
              <button type="button" className="btn tinted wide" onClick={() => speak(revealed ? [slide.title + '.', ...splitSentences(fillName(slide.content, name))] : [slide.title + '.'], () => undefined, () => undefined)}>
                {t.readAloud}
              </button>
            )}
            <button type="button" className="btn primary wide" onClick={close}>{revealed ? t.cheatBackRevealed : t.cheatBack}</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
