import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Chevron } from '../components/Icons'
import { fillName, useT } from '../lib/i18n'
import { usePrefs } from '../lib/prefs'
import { speak, speakWord, speechAvailable, splitSentences, stopSpeaking, type SpeechPos } from '../lib/speech'
import type { Exam } from '../lib/types'

// Wissens-Hub: Lernfolien je Kapitel (eine gescannte Einheit = ein Kapitel mit 3–5 Folien),
// Schlüsselwörter fett im Text und zum Anhören antippbar, Vorlesen mit Hervorhebung.
// Auf der letzten Folie eines Kapitels gilt es als gesehen; erst dann kommen seine neuen Fragen ins Spiel.

export interface Slide {
  title: string
  content: string
  keywords: string[]
}

export interface Chapter {
  unitId: string
  slides: Slide[]
  seen: boolean
}

export interface LearnTopic {
  exam: Exam
  chapters: Chapter[]
  // Sprache der Schlüsselwörter (Englisch-Fach: englische Stimme)
  wordLang: 'de' | 'en'
}

// Schlüsselwörter im Text fett hervorheben (Groß-/Kleinschreibung egal)
export function withKeywords(text: string, keywords: string[]): ReactNode[] {
  const words = keywords.filter((k) => k.trim().length > 1).sort((a, b) => b.length - a.length)
  if (!words.length) return [text]
  const esc = words.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`((?<![\\p{L}\\p{N}])(?:${esc.join('|')})(?![\\p{L}\\p{N}]))`, 'giu')
  return text.split(re).map((part, i) => (i % 2 ? <b key={i} className="hub-kw">{part}</b> : part))
}

// Satz mit Hervorhebung beim Vorlesen
function Spoken({ text, keywords, active }: { text: string; keywords: string[]; active: SpeechPos | null }) {
  if (!active) return <>{withKeywords(text, keywords)} </>
  if (active.word === null) return <><mark className="hub-say">{withKeywords(text, keywords)}</mark> </>
  const rest = text.slice(active.word)
  const len = rest.match(/^[\p{L}\p{N}’'-]+/u)?.[0].length ?? 0
  return (
    <>
      <span className="hub-say-s">{text.slice(0, active.word)}</span>
      <mark className="hub-say">{rest.slice(0, len)}</mark>
      <span className="hub-say-s">{rest.slice(len)}</span>{' '}
    </>
  )
}

function Hub({ topic, onBack, onPlay, onSeen }: {
  topic: LearnTopic
  onBack: () => void
  onPlay: () => void
  onSeen: (unitId: string) => void
}) {
  const t = useT()
  const { name, speech } = usePrefs()
  // Beim ersten ungesehenen Kapitel öffnen
  const [ch, setCh] = useState(() => Math.max(0, topic.chapters.findIndex((c) => !c.seen)))
  const [idx, setIdx] = useState(0)
  const [pos, setPos] = useState<SpeechPos | null>(null)
  const [reading, setReading] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const chapter = topic.chapters[ch]
  const slides = chapter.slides
  const last = idx === slides.length - 1
  const canSpeak = speechAvailable() && speech !== 'off'

  const sentencesOf = (i: number) => [slides[i].title + '.', ...splitSentences(fillName(slides[i].content, name))]

  function read(i: number) {
    setReading(true)
    speak(sentencesOf(i), setPos, () => setReading(false))
  }

  function stop() {
    stopSpeaking()
    setReading(false)
    setPos(null)
  }

  // Abstand von Folie zu Folie inklusive Lücke (Doris: clientWidth allein verrutscht bei langen Kapiteln)
  function step() {
    const el = track.current
    if (!el) return 1
    const [a, b] = el.children as unknown as HTMLElement[]
    return b ? b.offsetLeft - a.offsetLeft : el.clientWidth
  }

  function onScroll() {
    const el = track.current
    if (!el) return
    const i = Math.round(el.scrollLeft / step())
    if (i !== idx) {
      stop()
      setIdx(i)
    }
  }

  function go(i: number) {
    track.current?.scrollTo({ left: i * step(), behavior: 'smooth' })
  }

  function openChapter(i: number) {
    stop()
    setCh(i)
    setIdx(0)
    track.current?.scrollTo({ left: 0 })
  }

  // Letzte Folie erreicht: Kapitel gilt als gesehen (keine Zeit- oder Vorlese-Pflicht)
  useEffect(() => {
    if (last && !chapter.seen) onSeen(chapter.unitId)
  }, [last, chapter, onSeen])

  // „Automatisch“ liest jede neue Folie vor
  useEffect(() => {
    if (canSpeak && speech === 'auto') read(idx)
    return stopSpeaking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, ch])

  return (
    <section className="bc-view hub">
      <div className="hub-bar">
        <button type="button" className="btn plain" onClick={() => { stop(); onBack() }}>{t.back}</button>
        <span className="hub-count num">{t.slideOf(idx + 1, slides.length)}</span>
      </div>
      <h1 className="bc-title">{topic.exam.title}</h1>

      {topic.chapters.length > 1 && (
        <div className="hub-chapters" role="tablist">
          {topic.chapters.map((c, i) => (
            <button key={c.unitId} type="button" role="tab" aria-selected={i === ch} className={i === ch ? 'on' : ''} onClick={() => openChapter(i)}>
              {t.chapter(i + 1)}
              {!c.seen && <span className="hub-new">{t.chapterNew}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="hub-track" ref={track} onScroll={onScroll}>
        {slides.map((s, i) => {
          const sentences = splitSentences(fillName(s.content, name))
          const active = i === idx ? pos : null
          return (
            <article key={`${ch}-${i}`} className="card hub-slide" aria-roledescription={t.slide} aria-label={t.slideOf(i + 1, slides.length)}>
              <h2 className={`hub-title ${active?.sentence === 0 ? 'say' : ''}`}>{s.title}</h2>
              <p className="hub-text">
                {sentences.map((x, k) => (
                  <Spoken key={k} text={x} keywords={s.keywords} active={active?.sentence === k + 1 ? active : null} />
                ))}
              </p>
              {s.keywords.length > 0 && (
                <div className="hub-keys">
                  {s.keywords.map((k) => (
                    <button key={k} type="button" aria-label={t.hearWord(k)} onClick={() => { stop(); speakWord(k, topic.wordLang) }}>
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="hub-dots" aria-hidden="true">
        {slides.map((_, i) => <i key={i} className={i === idx ? 'on' : ''} />)}
      </div>

      <div className="hub-ctrl">
        <button type="button" className="btn tinted hub-nav" disabled={idx === 0} onClick={() => go(idx - 1)} aria-label={t.prevSlide}>
          <Chevron />
        </button>
        {canSpeak ? (
          <button type="button" className="btn tinted hub-read" onClick={() => (reading ? stop() : read(idx))} aria-pressed={reading}>
            {reading ? t.pause : t.readAloud}
          </button>
        ) : <span />}
        <button type="button" className="btn tinted hub-nav next" disabled={last} onClick={() => go(idx + 1)} aria-label={t.nextSlide}>
          <Chevron />
        </button>
      </div>

      {last && (
        <button type="button" className="btn primary wide hub-play" onClick={() => { stop(); onPlay() }}>
          {t.craftDone}
        </button>
      )}
    </section>
  )
}

export function Learn({ topics, onPlay, onSeen, openExamId }: {
  topics: LearnTopic[]
  onPlay: (exam: Exam) => void
  onSeen: (unitId: string) => void
  openExamId?: string | null
}) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(openExamId ?? null)
  const topic = topics.find((x) => x.exam.id === open)

  if (topic) return <Hub topic={topic} onBack={() => setOpen(null)} onPlay={() => onPlay(topic.exam)} onSeen={onSeen} />

  return (
    <section className="bc-view">
      <h1 className="bc-title">{t.learnTitle}</h1>
      {topics.length === 0 ? (
        <div className="card bc-empty"><p>{t.learnEmpty}</p></div>
      ) : (
        <div className="list">
          {topics.map((x) => {
            const n = x.chapters.reduce((a, c) => a + c.slides.length, 0)
            const fresh = x.chapters.some((c) => !c.seen)
            return (
              <button key={x.exam.id} type="button" className="row" onClick={() => setOpen(x.exam.id)}>
                <span className="tx">
                  <b>{x.exam.title}</b>
                  <small>{t.slidesCount(n)}</small>
                </span>
                {fresh && <span className="hub-new">{t.chapterNew}</span>}
                <Chevron />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
