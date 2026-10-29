import { useSyncExternalStore } from 'react'
import { ApiError, rpc } from './api'
import { setPref } from './prefs'
import { STARS_DAILY_RULE } from './session'
import type { Exam, Progress, Question } from './types'

// Familien-Stand aus bc_pull, lokal zwischengespeichert (offline spielbar).
// Antworten gehen erst in eine Warteschlange und werden dann mit fester ID gesendet (doppelt senden schadet nicht).
// Familien-Code und Stand liegen nur auf diesem Gerät; das Eltern-Token nur im Speicher (14 Minuten,
// knapp unter der Gültigkeit auf dem Server). Eltern-Inhalte (Entwürfe mit Lösungen, Scan-Aufträge)
// werden nie gespeichert, nur im Speicher gehalten (Siggi N2).

export interface Profile {
  id: string
  child_name: string
  avatar_id: string
  stars_balance: number
  stars_today: number
  learn_days_week: number
}
export interface Subject {
  id: string
  name: string
  icon: string
}
export interface ExamRow extends Exam {
  profile_id: string
  subject_id: string
  is_archived: boolean
}
export interface Unit {
  id: string
  exam_id: string
  summary_slides: { title: string; content: string; keywords: string[] }[]
}
export type QuestionRow = Question & { unit_id: string | null; status: 'entwurf' | 'freigegeben'; slide_index?: number | null }
export interface Reward {
  id: string
  profile_id: string | null
  title: string
  icon: string
  cost_stars: number
  is_active: boolean
}
export interface Redemption {
  id: string
  profile_id: string
  reward_title: string
  cost_stars: number
  status: 'offen' | 'erledigt' | 'storniert'
  redeemed_at: string
  resolved_at: string | null
}
// Ausrüstungsteile (feste Liste auf dem Server) und gewonnene Teile je Kind
export interface Item {
  item_key: string
  title_de: string
  title_en: string
  sort: number
}
export interface InventoryRow {
  profile_id: string
  item_key: string
  exam_id: string | null
  unlocked_at: string
}
export interface Pull {
  today: string
  parent: boolean
  profiles: Profile[]
  subjects: Subject[]
  exams: ExamRow[]
  units: Unit[]
  questions: QuestionRow[]
  progress: (Progress & { profile_id: string })[]
  rewards: Reward[]
  redemptions: Redemption[]
  items?: Item[]
  inventory?: InventoryRow[]
  boss_wins?: { profile_id: string; exam_id: string; item_key: string | null; won_at: string }[]
  // Ab Migration 004: welche Kapitel (Einheiten) das Kind schon angeschaut hat; fehlt das Feld, gilt keine Sperre
  unit_views?: { profile_id: string; unit_id: string; seen_at: string }[]
}

type Queued =
  | { kind: 'answer'; id: string; profileId: string; questionId: string; correct: boolean; firstTry: boolean;
      mode: 'solo' | 'chill' | 'boss' | 'eltern'; at: string; roundId: string | null }
  | { kind: 'round'; roundId: string; profileId: string }
  | { kind: 'seen'; unitId: string; profileId: string }
  | { kind: 'boss'; examId: string; profileId: string }

interface State {
  code: string | null
  profileId: string | null
  pull: Pull | null
  queue: Queued[]
  syncing: boolean
  offline: boolean
  parent: { token: string; until: number } | null
}

const K = { code: 'braincraft:code', profile: 'braincraft:profile', pull: 'braincraft:pull', queue: 'braincraft:queue', bossLocked: 'braincraft:bosslocked' }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Privater Modus: gilt bis zum Neuladen
  }
}

// Was auf dem Gerät gespeichert werden darf: nur die Sicht des Kindes
function childView(pull: Pull): Pull {
  const { scan_jobs: _drop, ...rest } = pull as Pull & { scan_jobs?: unknown }
  void _drop
  return {
    ...rest,
    parent: false,
    questions: pull.questions.filter((q) => q.status === 'freigegeben'),
    rewards: pull.rewards.filter((r) => r.is_active),
  }
}

let state: State = {
  code: read<string | null>(K.code, null),
  profileId: read<string | null>(K.profile, null),
  pull: read<Pull | null>(K.pull, null),
  queue: read<Queued[]>(K.queue, []),
  syncing: false,
  offline: false,
  parent: null,
}
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  if ('code' in patch) write(K.code, state.code)
  if ('profileId' in patch) write(K.profile, state.profileId)
  if ('pull' in patch) write(K.pull, state.pull && childView(state.pull))
  if ('queue' in patch) write(K.queue, state.queue)
  listeners.forEach((l) => l())
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

const token = () => (state.parent && state.parent.until > Date.now() ? state.parent.token : null)

// ---------- Verbinden und Einrichten ----------

function applyPull(pull: Pull) {
  const profileId = pull.profiles.some((p) => p.id === state.profileId) ? state.profileId : (pull.profiles[0]?.id ?? null)
  set({ pull, profileId, offline: false })
  const kid = pull.profiles.find((p) => p.id === profileId)
  if (kid) setPref('name', kid.child_name)
}

export async function connect(code: string) {
  const pull = await rpc<Pull>('bc_pull', { p_code: code, p_token: null })
  set({ code })
  applyPull(pull)
}

// 20 Zeichen ohne verwechselbare Zeichen, in Vierergruppen
export function newFamilyCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  // Nur Bytes unter 248 (= 8 × 31) verwenden, damit jedes Zeichen gleich wahrscheinlich ist (Siggi N7)
  let raw = ''
  while (raw.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && raw.length < 20) raw += abc[b % abc.length]
    }
  }
  return raw.match(/.{4}/g)!.join('-')
}

export async function createFamily(invite: string, childName: string, pin: string) {
  const code = newFamilyCode()
  await rpc('bc_create', { p_invite: invite, p_code: code, p_child_name: childName, p_pin: pin })
  // Verbunden wird erst, wenn die Eltern den Code notiert haben (Setup zeigt ihn einmal an)
  return code
}

export function disconnect() {
  set({ code: null, profileId: null, pull: null, queue: [], parent: null })
  setPref('name', '')
}

export function selectProfile(id: string) {
  set({ profileId: id })
  const kid = state.pull?.profiles.find((p) => p.id === id)
  if (kid) setPref('name', kid.child_name)
}

export async function refresh() {
  const code = state.code
  if (!code) return
  try {
    await flush()
    const pull = await rpc<Pull>('bc_pull', { p_code: code, p_token: token() })
    // Während des Ladens getrennt oder anders verbunden: Ergebnis verwerfen (Siggi N1)
    if (state.code !== code) return
    applyPull(pull)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'offline') set({ offline: true })
    else throw e
  }
}

// ---------- Antworten (Warteschlange) ----------

export function queueAnswer(a: { questionId: string; correct: boolean; firstTry: boolean; mode: 'solo' | 'chill' | 'boss'; roundId: string | null }) {
  if (!state.profileId) return
  const item: Queued = { kind: 'answer', id: crypto.randomUUID(), profileId: state.profileId, at: new Date().toISOString(), ...a }
  // Sofort sichtbar: Stern für richtig im 1. Versuch (der Server bucht verbindlich). Nicht über der
  // Tagesgrenze und nicht im Boss-Kampf einer schon geschafften Arbeit (Wiederholung ohne Belohnung)
  const examId = state.pull?.questions.find((q) => q.id === a.questionId)?.exam_id
  const replay = a.mode === 'boss' && !!examId && bossWon(state, examId)
  if (state.pull && a.correct && a.firstTry && !replay && (currentProfile(state)?.stars_today ?? 0) < STARS_DAILY_RULE) {
    const profiles = state.pull.profiles.map((p) =>
      p.id === state.profileId ? { ...p, stars_balance: p.stars_balance + 1, stars_today: p.stars_today + 1 } : p,
    )
    set({ pull: { ...state.pull, profiles } })
  }
  set({ queue: [...state.queue, item] })
  void flush()
}

// Kapitel angeschaut: sofort lokal vermerken, dann an den Server (ab Migration 004)
export function markUnitSeen(unitId: string) {
  if (!state.profileId || !state.pull) return
  const views = state.pull.unit_views ?? []
  if (views.some((v) => v.profile_id === state.profileId && v.unit_id === unitId)) return
  const pull = { ...state.pull, unit_views: [...views, { profile_id: state.profileId, unit_id: unitId, seen_at: new Date().toISOString() }] }
  set({ pull, queue: [...state.queue, { kind: 'seen', unitId, profileId: state.profileId }] })
  void flush()
}

// Boss geschafft: Teil und +10 Sterne sofort zeigen (gleiche Wahl wie der Server: nächstes fehlendes nach sort),
// dann über die Warteschlange melden (doppelt senden harmlos, der Server antwortet „duplicate“)
export function queueBossWin(examId: string): { itemKey: string | null } | null {
  const profileId = state.profileId
  if (!profileId || !state.pull || bossWon(state, examId)) return null
  const { items, owned } = gear(state)
  const itemKey = items.find((i) => !owned.has(i.item_key))?.item_key ?? null
  const now = new Date().toISOString()
  const pull: Pull = {
    ...state.pull,
    profiles: state.pull.profiles.map((p) => (p.id === profileId ? { ...p, stars_balance: p.stars_balance + 10 } : p)),
    boss_wins: [...(state.pull.boss_wins ?? []), { profile_id: profileId, exam_id: examId, item_key: itemKey, won_at: now }],
    inventory: itemKey
      ? [...(state.pull.inventory ?? []), { profile_id: profileId, item_key: itemKey, exam_id: examId, unlocked_at: now }]
      : state.pull.inventory,
  }
  set({ pull, queue: [...state.queue, { kind: 'boss', examId, profileId }] })
  void flush().then(() => refresh().catch(() => undefined))
  return { itemKey }
}

export function queueRoundFinish(roundId: string) {
  if (!state.profileId) return
  set({ queue: [...state.queue, { kind: 'round', roundId, profileId: state.profileId }] })
  void flush().then(() => refresh().catch(() => undefined))
}

let flushing: Promise<void> | null = null

export function flush(): Promise<void> {
  if (flushing) return flushing
  const self: { p?: Promise<void> } = {}
  const p: Promise<void> = (async () => {
    // Erst nach der Zuweisung unten weiterlaufen, sonst bleibt bei leerer Schlange die Sperre hängen (Bodo)
    await Promise.resolve()
    set({ syncing: true })
    try {
      while (state.code && state.queue.length) {
        const item = state.queue[0]
        try {
          if (item.kind === 'answer') {
            await rpc('bc_answer', {
              p_code: state.code, p_answer_id: item.id, p_profile_id: item.profileId, p_question_id: item.questionId,
              p_correct: item.correct, p_first_try: item.firstTry, p_mode: item.mode, p_answered_at: item.at,
              p_round_id: item.roundId,
            })
          } else if (item.kind === 'round') {
            await rpc('bc_round_finish', { p_code: state.code, p_round_id: item.roundId, p_profile_id: item.profileId })
          } else if (item.kind === 'boss') {
            await rpc('bc_boss_win', { p_code: state.code, p_profile_id: item.profileId, p_exam_id: item.examId })
          } else {
            await rpc('bc_unit_seen', { p_code: state.code, p_profile_id: item.profileId, p_unit_id: item.unitId })
          }
        } catch (e) {
          // „Gesehen“ ist nur eine Komfortangabe: bei jedem Fehler außer offline verwerfen (z. B. vor Migration 004)
          if (item.kind === 'seen' && !(e instanceof ApiError && e.code === 'offline')) {
            set({ queue: state.queue.slice(1) })
            continue
          }
          if (e instanceof ApiError && (e.code === 'offline' || e.code === 'server_error' || e.code === 'retry')) {
            set({ offline: e.code === 'offline' })
            return
          }
          // Boss nicht mehr freigeschaltet (Eltern haben Fragen dazugetan): beim nächsten Start freundlich erklären
          if (item.kind === 'boss' && e instanceof ApiError && e.code === 'boss_locked') write(K.bossLocked, true)
          // Inhaltlicher Fehler (z. B. Frage gelöscht, Runde zu kurz): Eintrag verwerfen, sonst hängt die Schlange
        }
        set({ queue: state.queue.slice(1), offline: false })
      }
    } finally {
      set({ syncing: false })
      if (flushing === self.p) flushing = null
    }
  })()
  self.p = p
  flushing = p
  return p
}

// ---------- Sternen-Shop ----------

// Einlösen geht nur online (der Server bucht atomar). Die ID kommt vom Aufrufer und bleibt bei
// Wiederholungen gleich, damit ein zweiter Tipp nach Netzfehler nicht doppelt bucht.
export async function redeem(rewardId: string, redemptionId: string) {
  const code = state.code
  const profileId = state.profileId
  if (!code || !profileId) throw new ApiError('offline')
  // Erst offene Antworten senden, damit der Sternestand auf dem Server stimmt
  await flush()
  // Hängen noch Antworten (offline, Serverfehler), stimmt der Stand auf dem Server nicht: nicht einlösen (Bodo)
  if (state.queue.some((q) => q.kind !== 'seen')) throw new ApiError(state.offline ? 'offline' : 'retry')
  await rpc('bc_redeem', { p_code: code, p_redemption_id: redemptionId, p_profile_id: profileId, p_reward_id: rewardId })
  await refresh().catch(() => undefined)
}

// ---------- Eltern ----------

export async function parentUnlock(pin: string): Promise<{ ok: boolean; error?: string; locked_until?: string }> {
  const r = await rpc<{ ok: boolean; token?: string; expires_at?: string; error?: string; locked_until?: string }>(
    'bc_parent_unlock', { p_code: state.code, p_pin: pin },
  )
  if (r.ok && r.token) {
    set({ parent: { token: r.token, until: Date.now() + 14 * 60_000 } })
    await refresh()
  }
  return r
}

export function parentLock() {
  const t = token()
  set({ parent: null })
  if (t) void rpc('bc_parent_lock', { p_code: state.code, p_token: t }).catch(() => undefined)
  void refresh().catch(() => undefined)
}

export function parentActive() {
  return !!token()
}

async function parentRpc<T>(fn: string, args: Record<string, unknown>) {
  const t = token()
  if (!t) throw new ApiError('pin_required')
  return rpc<T>(fn, { p_code: state.code, p_token: t, ...args })
}

export async function setQuestionStatus(ids: string[], status: 'entwurf' | 'freigegeben') {
  await parentRpc('bc_question_set_status', { p_ids: ids, p_status: status })
  await refresh()
}

export async function setQuestionActive(id: string, active: boolean) {
  await parentRpc('bc_question_set_active', { p_id: id, p_active: active })
  await refresh()
}

export interface RewardDraft {
  id: string | null
  profileId: string | null
  title: string
  icon: string
  cost: number
  active: boolean
}

export async function saveReward(r: RewardDraft) {
  await parentRpc('bc_reward_save', {
    p_id: r.id, p_profile_id: r.profileId, p_title: r.title.trim(), p_icon: r.icon, p_cost_stars: r.cost, p_is_active: r.active,
  })
  await refresh()
}

export async function deleteReward(id: string) {
  await parentRpc('bc_reward_delete', { p_id: id })
  await refresh()
}

// Gutschein erledigt oder storniert (Storno bucht die Sterne zurück)
export async function resolveRedemption(id: string, status: 'erledigt' | 'storniert') {
  await parentRpc('bc_redemption_resolve', { p_id: id, p_status: status })
  await refresh()
}

// Gemeinsam-Abfragen: direkt senden (nicht in die gespeicherte Warteschlange, die kein Eltern-Token kennt).
// Die Antwort-ID kommt vom Aufrufer und bleibt bei Wiederholung gleich (kein Doppelstern). Liefert die gebuchten Sterne.
export async function parentAnswer(a: { answerId: string; profileId: string; questionId: string; correct: boolean; roundId: string }) {
  const r = await parentRpc<{ stars_booked?: number }>('bc_answer', {
    p_answer_id: a.answerId, p_profile_id: a.profileId, p_question_id: a.questionId, p_correct: a.correct,
    p_first_try: true, p_mode: 'eltern', p_answered_at: new Date().toISOString(), p_round_id: a.roundId,
  })
  return r.stars_booked ?? 0
}

// Klassenarbeit löschen: Lernfolien, Fragen, Lernstand und Antworten dazu löscht der Server mit;
// verdiente Sterne und Ausrüstungsteile bleiben
export async function deleteExam(id: string) {
  await parentRpc('bc_exam_delete', { p_id: id })
  await refresh()
}

// Sterne und Fortschritt zurücksetzen (ein Kind oder null = alle). Braucht zusätzlich die PIN.
// Wartende Antworten der betroffenen Kinder werden verworfen, sonst käme alter Fortschritt zurück.
export async function resetProgress(pin: string, profileId: string | null) {
  const r = await parentRpc<{ ok: boolean; error?: string; locked_until?: string }>('bc_progress_reset', { p_pin: pin, p_profile_id: profileId })
  if (r.ok) {
    set({ queue: state.queue.filter((q) => profileId !== null && q.profileId !== profileId) })
    await refresh()
  }
  return r
}

// ---------- Abgeleitete Werte ----------

export function currentProfile(s: State) {
  return s.pull?.profiles.find((p) => p.id === s.profileId) ?? null
}

export function profileProgress(s: State): Progress[] {
  return (s.pull?.progress ?? []).filter((p) => p.profile_id === s.profileId)
}

// Belohnungen, die das aktuelle Kind sehen darf (für alle oder nur für dieses Kind)
export function shopRewards(s: State): Reward[] {
  return (s.pull?.rewards ?? []).filter((r) => r.is_active && (!r.profile_id || r.profile_id === s.profileId))
}

export function profileRedemptions(s: State): Redemption[] {
  return (s.pull?.redemptions ?? []).filter((d) => d.profile_id === s.profileId)
}

export function bossWon(s: State, examId: string) {
  return (s.pull?.boss_wins ?? []).some((b) => b.profile_id === s.profileId && b.exam_id === examId)
}

// Wie viele Fragen noch Stufe 3 brauchen, bis der Boss kommt (gleiche Schwelle wie der Server: 70 %)
export function bossToGo(s: State, examId: string) {
  const qs = playableQuestions(s, examId)
  if (!qs.length) return null
  const box = new Map(profileProgress(s).map((p) => [p.question_id, p.leitner_box]))
  const mastered = qs.filter((q) => (box.get(q.id) ?? 0) >= 3).length
  return Math.max(0, Math.ceil(qs.length * 0.7) - mastered)
}

// Hinweis nach abgelehntem Boss-Sieg einmal abholen (danach gelöscht)
export function takeBossLockedNotice(): boolean {
  const on = read<boolean>(K.bossLocked, false)
  if (on) write(K.bossLocked, null)
  return on
}

// Alle Teile in fester Reihenfolge, dazu die des aktuellen Kindes
export function gear(s: State) {
  const items = [...(s.pull?.items ?? [])].sort((a, b) => a.sort - b.sort)
  const owned = new Map((s.pull?.inventory ?? []).filter((i) => i.profile_id === s.profileId).map((i) => [i.item_key, i]))
  return { items, owned }
}

// Freigegebene, aktive Fragen der nicht archivierten Klassenarbeiten des Kindes
export function playableQuestions(s: State, examId?: string): Question[] {
  const exams = new Set(
    (s.pull?.exams ?? []).filter((e) => e.profile_id === s.profileId && !e.is_archived && (!examId || e.id === examId)).map((e) => e.id),
  )
  return (s.pull?.questions ?? []).filter((q) => q.status === 'freigegeben' && exams.has(q.exam_id))
}

// Kapitel, die das Kind gesehen hat; null = Server kennt das noch nicht (keine Sperre)
export function seenUnits(s: State): Set<string> | null {
  if (!s.pull?.unit_views) return null
  return new Set(s.pull.unit_views.filter((v) => v.profile_id === s.profileId).map((v) => v.unit_id))
}

// Neue Fragen erst, wenn ihr Kapitel angeschaut wurde (Lern-Lotte: erst verstehen, dann üben).
// Fragen mit Lernstand (Wiederholungen) bleiben immer spielbar.
export function unlockedQuestions(s: State, examId?: string): Question[] {
  const seen = seenUnits(s)
  const qs = playableQuestions(s, examId) as QuestionRow[]
  if (!seen) return qs
  const known = new Set(profileProgress(s).map((p) => p.question_id))
  return qs.filter((q) => known.has(q.id) || !q.unit_id || seen.has(q.unit_id))
}

// Meister-Level einer Klassenarbeit: Anteil der Fragen ab Stufe 3 (gleiche Schwelle wie der Boss)
export function mastery(s: State, examId: string) {
  const qs = playableQuestions(s, examId)
  if (!qs.length) return 0
  const box = new Map(profileProgress(s).map((p) => [p.question_id, p.leitner_box]))
  return qs.filter((q) => (box.get(q.id) ?? 0) >= 3).length / qs.length
}

// Bei Rückkehr ins Netz und beim Start abgleichen
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void refresh().catch(() => undefined))
  // Zurück in die App (z. B. am nächsten Morgen): neu abgleichen, damit Tagesstand und Sterne stimmen (Bodo)
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.code) void refresh().catch(() => undefined)
  })
  if (state.code) void refresh().catch(() => undefined)
}
