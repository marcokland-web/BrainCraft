import { useEffect, useState, type ReactNode } from 'react'
import { Settings } from './components/Settings'
import { Gear, Logo, Star, TabGear, TabLearn, TabShop, TabStart } from './components/Icons'
import { unlockAudio } from './lib/audio'
import { DEMO_EXAM, DEMO_QUESTIONS, DEMO_SLIDES } from './lib/demo'
import { locale, useT } from './lib/i18n'
import { usePrefs } from './lib/prefs'
import { isEve, ROUND_MIN, type RoundMode } from './lib/session'
import {
  currentProfile,
  bossWon,
  markUnitSeen,
  queueBossWin,
  playableQuestions,
  profileProgress,
  queueAnswer,
  queueRoundFinish,
  seenUnits,
  unlockedQuestions,
  useStore,
  type QuestionRow,
} from './lib/store'
import type { Exam, Question } from './lib/types'
import { Arena, type AnswerLog } from './views/Arena'
import { Boss } from './views/Boss'
import { GearView } from './views/Gear'
import { Learn, type LearnTopic } from './views/Learn'
import { Parents } from './views/Parents'
import { Setup } from './views/Setup'
import { Shop } from './views/Shop'
import { Start, type PlayRequest } from './views/Start'

export type Tab = 'start' | 'learn' | 'gear' | 'shop'

const DEMO_KEY = 'braincraft:demo'
const readDemo = () => {
  try {
    return localStorage.getItem(DEMO_KEY) === '1'
  } catch {
    return false
  }
}
const writeDemo = (on: boolean) => {
  try {
    if (on) localStorage.setItem(DEMO_KEY, '1')
    else localStorage.removeItem(DEMO_KEY)
  } catch {
    // Privater Modus
  }
}

interface Round {
  key: number
  id: string
  mode: RoundMode
  pool: Question[]
  request: PlayRequest
}

export function App() {
  const t = useT()
  const { lang } = usePrefs()
  const s = useStore()
  const [tab, setTab] = useState<Tab>('start')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [parentsOpen, setParentsOpen] = useState(false)
  const [demo, setDemo] = useState(readDemo)
  const [round, setRound] = useState<Round | null>(null)
  // Boss-Kampf: Arbeit, Kampf-ID (round_id der Antworten) und ob es eine Wiederholung ohne Belohnung ist
  const [boss, setBoss] = useState<{ exam: Exam; id: string; replay: boolean } | null>(null)
  const [learnExam, setLearnExam] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const connected = !!s.code && !!s.pull
  const playDemo = demo && !connected
  const stars = connected ? (currentProfile(s)?.stars_balance ?? 0) : 0

  // iOS: Ton erst nach der ersten Berührung erlaubt
  useEffect(() => {
    const once = () => unlockAudio()
    window.addEventListener('pointerdown', once, { once: true })
    return () => window.removeEventListener('pointerdown', once)
  }, [])

  // Lernen-Tab wieder als Liste öffnen, wenn man ihn verlässt
  useEffect(() => {
    if (tab !== 'learn') setLearnExam(null)
  }, [tab])

  // Nach dem Verbinden Probemodus beenden
  useEffect(() => {
    if (connected && demo) {
      writeDemo(false)
      setDemo(false)
    }
  }, [connected, demo])

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'start', label: t.tabStart, icon: <TabStart /> },
    { id: 'learn', label: t.tabLearn, icon: <TabLearn /> },
    { id: 'gear', label: t.tabGear, icon: <TabGear /> },
    { id: 'shop', label: t.tabShop, icon: <TabShop /> },
  ]

  // Lernfolien je Klassenarbeit, gegliedert in Kapitel (eine gescannte Einheit = ein Kapitel)
  const seen = seenUnits(s)
  const topics: LearnTopic[] = playDemo
    ? [{ exam: DEMO_EXAM, chapters: [{ unitId: 'demo', slides: DEMO_SLIDES, seen: true }], wordLang: 'de' }]
    : (s.pull?.exams ?? [])
        .filter((e) => e.profile_id === s.profileId && !e.is_archived)
        .map((exam) => {
          const subject = s.pull?.subjects.find((x) => x.id === exam.subject_id)?.name ?? ''
          return {
            exam,
            wordLang: /englisch|english/i.test(subject) ? ('en' as const) : ('de' as const),
            chapters: (s.pull?.units ?? [])
              .filter((u) => u.exam_id === exam.id && u.summary_slides.length > 0)
              .map((u) => ({ unitId: u.id, slides: u.summary_slides, seen: !seen || seen.has(u.id) })),
          }
        })
        .filter((x) => x.chapters.length > 0)

  // Spickzettel: Folie, auf die der Scan die Frage bezogen hat
  function slideFor(q: Question) {
    const row = q as QuestionRow
    if (playDemo || !row.unit_id || row.slide_index == null) return null
    return s.pull?.units.find((u) => u.id === row.unit_id)?.summary_slides[row.slide_index] ?? null
  }

  function showToast(text: string) {
    setToast(text)
    window.setTimeout(() => setToast(null), 3600)
  }

  function start(request: PlayRequest, key = Date.now()) {
    let pool: Question[]
    let mode: RoundMode = 'normal'
    if (playDemo) pool = DEMO_QUESTIONS
    else if (request.kind === 'exam') {
      pool = unlockedQuestions(s, request.exam.id)
      if (isEve(request.exam)) mode = 'chill'
    } else pool = unlockedQuestions(s)
    // Nichts spielbar, aber Fragen vorhanden: erst die Lernfolien ansehen
    if (!playDemo && pool.length === 0) {
      const all = request.kind === 'exam' ? playableQuestions(s, request.exam.id) : playableQuestions(s)
      if (all.length > 0) {
        const examId = request.kind === 'exam' ? request.exam.id : (all[0]?.exam_id ?? null)
        setLearnExam(examId)
        setTab('learn')
        showToast(t.seeSlidesFirst)
        return
      }
    }
    if (request.kind === 'mix') pool = [...pool].sort(() => Math.random() - 0.5).slice(0, 30)
    setRound({ key, id: crypto.randomUUID(), mode, pool, request })
  }

  function answered(a: AnswerLog) {
    if (!connected || !round || a.kind !== 'normal') return
    // Aufgedeckt = falsch; nach Hinweis gelöst = richtig, aber ohne Stern (first_try = false)
    queueAnswer({
      questionId: a.question.id,
      correct: !a.revealed,
      firstTry: a.firstTry,
      mode: round.mode === 'chill' ? 'chill' : 'solo',
      roundId: round.id,
    })
  }

  function finished(log: AnswerLog[]) {
    if (!connected || !round) return
    // Rundenbonus ab 5 normalen Antworten, auch in der Chill-Runde
    if (log.filter((a) => a.kind === 'normal').length >= ROUND_MIN) queueRoundFinish(round.id)
  }

  if (!s.code && !demo) {
    return (
      <div className="app">
        <div className="setup-top">
          <button type="button" className="gear" aria-haspopup="dialog" aria-label={t.settings} onClick={() => setSettingsOpen(true)}>
            <Gear />
          </button>
        </div>
        <Setup onDemo={() => { writeDemo(true); setDemo(true) }} />
        <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    )
  }

  if (boss) {
    return (
      <div className="app">
        <Boss
          key={boss.id}
          pool={unlockedQuestions(s, boss.exam.id)}
          progress={profileProgress(s)}
          onAnswer={(q, correct, firstTry) => queueAnswer({ questionId: q.id, correct, firstTry, mode: 'boss', roundId: boss.id })}
          replay={boss.replay}
          slideFor={slideFor}
          onWin={() => {
            if (boss.replay) return { replay: true, itemKey: null }
            // null = inzwischen schon besiegt (z. B. auf einem anderen Gerät, Abgleich während des Kampfs): Wiederholung (Bodo)
            const win = queueBossWin(boss.exam.id)
            return win ? { replay: false, itemKey: win.itemKey } : { replay: true, itemKey: null }
          }}
          itemName={(key) => t.itemNames[key] ?? s.pull?.items?.find((i) => i.item_key === key)?.title_de ?? key}
          onExit={() => setBoss(null)}
          onGear={() => { setBoss(null); setTab('gear') }}
        />
      </div>
    )
  }

  if (round) {
    return (
      <div className="app">
        <Arena
          key={round.key}
          pool={round.pool}
          progress={playDemo ? [] : profileProgress(s)}
          mode={round.mode}
          demo={playDemo}
          onAnswer={answered}
          onFinished={finished}
          onExit={() => setRound(null)}
          onAgain={() => start(round.request, round.key + 1)}
          slideFor={slideFor}
        />
      </div>
    )
  }

  if (parentsOpen) {
    return (
      <div className="app">
        <Parents onClose={() => setParentsOpen(false)} />
      </div>
    )
  }

  return (
    <>
      <div className="app">
        <header className="top">
          <button type="button" className="brandbtn" onClick={() => setTab('start')}>
            <Logo className="mark" />
            <span className="wm">
              <b>BrainCraft</b>
              <small>{t.tagline}</small>
            </span>
          </button>
          <nav className="toptabs" aria-label={t.navLabel}>
            {tabs.map((x) => (
              <button key={x.id} type="button" aria-current={tab === x.id ? 'page' : undefined} onClick={() => setTab(x.id)}>
                {x.label}
              </button>
            ))}
          </nav>
          <button type="button" className="starpill" onClick={() => setTab('shop')} aria-label={`${stars} ${t.stars}`}>
            <Star className="st-ico" />
            <span className="num">{stars.toLocaleString(locale(lang))}</span>
          </button>
          <button type="button" className="gear" aria-haspopup="dialog" aria-label={t.settings} onClick={() => setSettingsOpen(true)}>
            <Gear />
          </button>
        </header>

        <main>
          {tab === 'start' && (
            <Start
              demo={playDemo}
              demoExam={DEMO_EXAM}
              onPlay={(r) => start(r)}
              onBoss={(exam) => setBoss({ exam, id: crypto.randomUUID(), replay: bossWon(s, exam.id) })}
              onConnect={() => { writeDemo(false); setDemo(false) }}
            />
          )}
          {tab === 'learn' && (
            <Learn
              key={learnExam ?? 'list'}
              topics={topics}
              openExamId={learnExam}
              onSeen={(unitId) => { if (!playDemo) markUnitSeen(unitId) }}
              onPlay={(exam) => { setLearnExam(null); start({ kind: 'exam', exam }) }}
            />
          )}
          {tab === 'gear' && <GearView demo={playDemo} onBoss={(exam) => setBoss({ exam, id: crypto.randomUUID(), replay: bossWon(s, exam.id) })} />}
          {tab === 'shop' && <Shop demo={playDemo} />}
        </main>
      </div>

      <nav className="tabbar" aria-label={t.navLabel}>
        {tabs.map((x) => (
          <button key={x.id} type="button" aria-current={tab === x.id ? 'page' : undefined} onClick={() => setTab(x.id)}>
            {x.icon}
            <span>{x.label}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onParents={() => {
          setSettingsOpen(false)
          if (connected) setParentsOpen(true)
          else { writeDemo(false); setDemo(false) }
        }}
      />
    </>
  )
}
