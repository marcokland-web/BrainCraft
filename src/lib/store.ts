import { useSyncExternalStore } from 'react'
import { ApiError, rpc } from './api'
import { normEmail } from './email'
import { setPref } from './prefs'
import { STARS_DAILY_RULE } from './session'
import type { Exam, Progress, Question } from './types'

// Familien-Stand aus bc_pull, lokal zwischengespeichert (offline spielbar).
// Antworten gehen erst in eine Warteschlange und werden dann mit fester ID gesendet (doppelt senden schadet nicht).
// Welche Familie: ergibt sich auf dem Server aus der Google-Sitzung des Geräts (auth.uid(), Migration 007);
// gemerkt wird nur ihre ID, um einen Wechsel des Kontos zu erkennen. Stand und Warteschlange liegen nur auf
// diesem Gerät; das Eltern-Token nur im Speicher (14 Minuten, knapp unter der Gültigkeit auf dem Server).
// Eltern-Inhalte (Entwürfe mit Lösungen, Scan-Aufträge, Eltern-Liste) werden nie gespeichert (Siggi N2).

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
  // ab Migration 007
  family_id?: string
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

export interface MyInvite {
  family_id: string
  invited_by: string | null
  created_at: string
  expires_at: string
}

// Anmeldung des Geräts: unknown = noch nicht geprüft (Start), signed_in / signed_out laut Google-Sitzung
export type AuthStatus = 'unknown' | 'signed_in' | 'signed_out'

interface State {
  family: string | null
  auth: AuthStatus
  // Angemeldet, aber noch keine Familie: Eltern legen eine an (oder wurden mit anderer Adresse eingeladen)
  needsFamily: boolean
  // Gerät war mit dem früheren Familien-Code verbunden: einmal mit Google anmelden, Stand bleibt
  legacy: boolean
  // Offene Einladungen an das angemeldete Konto (nur ohne Familie, nur im Speicher); Annehmen nur sichtbar
  invites: MyInvite[]
  profileId: string | null
  pull: Pull | null
  queue: Queued[]
  syncing: boolean
  offline: boolean
  parent: { token: string; until: number } | null
}

const K = { family: 'braincraft:family', legacyCode: 'braincraft:code', profile: 'braincraft:profile', pull: 'braincraft:pull', queue: 'braincraft:queue', bossLocked: 'braincraft:bosslocked' }

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

// Früherer Familien-Code: nicht mehr nötig (und nicht mehr gültig, sobald 008 eingespielt ist), daher löschen.
// Stand, Kind und wartende Antworten bleiben, bis die Eltern das Gerät mit Google anmelden.
const legacy = read<string | null>(K.legacyCode, null) !== null
if (legacy) write(K.legacyCode, null)

let state: State = {
  family: read<string | null>(K.family, null),
  auth: 'unknown',
  needsFamily: false,
  invites: [],
  legacy: legacy || (read<string | null>(K.family, null) === null && read<Pull | null>(K.pull, null) !== null),
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
  if ('family' in patch) write(K.family, state.family)
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

// ---------- Anmelden und Einrichten ----------

function applyPull(pull: Pull) {
  const profileId = pull.profiles.some((p) => p.id === state.profileId) ? state.profileId : (pull.profiles[0]?.id ?? null)
  // Antworten für Kinder, die es in dieser Familie nicht gibt (z. B. altes Gerät), nie senden
  const ids = new Set(pull.profiles.map((p) => p.id))
  const queue = state.queue.filter((q) => ids.has(q.profileId))
  set({ pull, profileId, offline: false, legacy: false, ...(queue.length !== state.queue.length ? { queue } : {}) })
  const kid = pull.profiles.find((p) => p.id === profileId)
  if (kid) setPref('name', kid.child_name)
}

// Alles Familiäre von diesem Gerät entfernen (nicht die Einstellungen)
function wipe() {
  set({ family: null, profileId: null, pull: null, queue: [], parent: null, legacy: false })
  setPref('name', '')
}

// Familie des angemeldeten Kontos übernehmen; anderes Konto als vorher: alten Stand verwerfen
function adopt(familyId: string) {
  if (state.family && state.family !== familyId) wipe()
  set({ family: familyId, needsFamily: false, invites: [] })
}

// Von auth.ts nach dem Start und bei jeder An- oder Abmeldung aufgerufen
export function authChanged(user: { id: string; email: string } | null) {
  if (!user) {
    set({ auth: 'signed_out', needsFamily: false, invites: [], parent: null })
    return
  }
  set({ auth: 'signed_in' })
  void linkSession().catch(() => undefined)
}

let linking: Promise<void> | null = null

// Nach der Anmeldung: Familie des Kontos erfragen (löst dabei eine Einladung für die Gmail-Adresse ein)
export function linkSession(): Promise<void> {
  if (linking) return linking
  const p = (async () => {
    try {
      const r = await rpc<{ family_id: string | null }>('bc_session', {})
      if (state.auth !== 'signed_in') return
      if (r.family_id) {
        adopt(r.family_id)
        await refresh()
      } else {
        // Konto hat (nicht mehr) eine Familie: gespeicherten Stand nicht weiter zeigen
        if (state.family) wipe()
        // Einladungen nur anzeigen; angenommen wird erst nach sichtbarer Rückfrage (acceptInvite)
        const invites = await rpc<MyInvite[]>('bc_my_invites', {}).catch(() => [] as MyInvite[])
        if (state.auth !== 'signed_in') return
        set({ needsFamily: true, invites: Array.isArray(invites) ? invites : [] })
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'offline') set({ offline: true })
      else throw e
    }
  })()
  linking = p
  void p.finally(() => {
    if (linking === p) linking = null
  })
  return p
}

// Einladung in eine bestehende Familie annehmen (nach Tipp auf „Annehmen“) oder ablehnen
export async function acceptInvite(familyId: string) {
  const r = await rpc<{ family_id: string }>('bc_invite_accept', { p_family_id: familyId })
  adopt(r.family_id)
  await refresh()
}

export async function declineInvite(familyId: string) {
  await rpc('bc_invite_decline', { p_family_id: familyId })
  set({ invites: state.invites.filter((i) => i.family_id !== familyId) })
}

// Erste Einrichtung: das angemeldete Konto bekommt eine neue Familie mit erstem Kind und Eltern-PIN
export async function createFamily(childName: string, pin: string) {
  const r = await rpc<{ family_id: string; profile_id: string }>('bc_family_create', { p_child_name: childName, p_pin: pin })
  adopt(r.family_id)
  set({ profileId: r.profile_id })
  await refresh()
}

// Nach dem Abmelden (auth.ts): mit wipeData alles Familiäre löschen, sonst bleibt der Stand für die
// nächste Anmeldung mit demselben Konto (wartende Antworten werden dann gesendet)
export function forgetDevice(wipeData: boolean) {
  set({ parent: null, needsFamily: false })
  if (wipeData) wipe()
}

export function selectProfile(id: string) {
  set({ profileId: id })
  const kid = state.pull?.profiles.find((p) => p.id === id)
  if (kid) setPref('name', kid.child_name)
}

export async function refresh() {
  const family = state.family
  if (!family || state.auth === 'signed_out') return
  try {
    await flush()
    const pull = await rpc<Pull>('bc_pull', { p_token: token() })
    // Während des Ladens abgemeldet oder andere Familie: Ergebnis verwerfen (Siggi N1)
    if (state.family !== family || (state.auth as AuthStatus) === 'signed_out') return
    if (pull.family_id && pull.family_id !== family) return
    applyPull(pull)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'offline') set({ offline: true })
    // Konto gehört keiner Familie mehr (z. B. von den anderen Eltern entfernt)
    else if (e instanceof ApiError && e.code === 'no_family') {
      if (state.family === family) {
        wipe()
        set({ needsFamily: state.auth === 'signed_in' })
      }
    } else throw e
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
      while (state.family && state.auth !== 'signed_out' && state.queue.length) {
        const item = state.queue[0]
        try {
          if (item.kind === 'answer') {
            await rpc('bc_answer', {
              p_answer_id: item.id, p_profile_id: item.profileId, p_question_id: item.questionId,
              p_correct: item.correct, p_first_try: item.firstTry, p_mode: item.mode, p_answered_at: item.at,
              p_round_id: item.roundId,
            })
          } else if (item.kind === 'round') {
            await rpc('bc_round_finish', { p_round_id: item.roundId, p_profile_id: item.profileId })
          } else if (item.kind === 'boss') {
            await rpc('bc_boss_win', { p_profile_id: item.profileId, p_exam_id: item.examId })
          } else {
            await rpc('bc_unit_seen', { p_profile_id: item.profileId, p_unit_id: item.unitId })
          }
        } catch (e) {
          // „Gesehen“ ist nur eine Komfortangabe: bei jedem Fehler außer offline verwerfen (z. B. vor Migration 004)
          if (item.kind === 'seen' && !(e instanceof ApiError && e.code === 'offline')) {
            set({ queue: state.queue.filter((q) => q !== item) })
            continue
          }
          // Ohne Sitzung oder Familie bleibt die Antwort liegen, bis das Gerät wieder angemeldet ist
          if (e instanceof ApiError && ['offline', 'server_error', 'retry', 'not_signed_in', 'no_family', 'missing_function'].includes(e.code)) {
            set({ offline: e.code === 'offline' })
            return
          }
          // Boss nicht mehr freigeschaltet (Eltern haben Fragen dazugetan): beim nächsten Start freundlich erklären
          if (item.kind === 'boss' && e instanceof ApiError && e.code === 'boss_locked') write(K.bossLocked, true)
          // Inhaltlicher Fehler (z. B. Frage gelöscht, Runde zu kurz): Eintrag verwerfen, sonst hängt die Schlange
        }
        // Über den Eintrag selbst entfernen: Hat jemand die Schlange inzwischen gekürzt (Zurücksetzen),
        // ginge mit slice(1) sonst ein fremder, noch nicht gesendeter Eintrag verloren (Siggi N2, Bodo)
        set({ queue: state.queue.filter((q) => q !== item), offline: false })
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
  const profileId = state.profileId
  if (!state.family || !profileId) throw new ApiError('offline')
  // Erst offene Antworten senden, damit der Sternestand auf dem Server stimmt
  await flush()
  // Hängen noch Antworten (offline, Serverfehler), stimmt der Stand auf dem Server nicht: nicht einlösen (Bodo)
  if (state.queue.some((q) => q.kind !== 'seen')) throw new ApiError(state.offline ? 'offline' : 'retry')
  await rpc('bc_redeem', { p_redemption_id: redemptionId, p_profile_id: profileId, p_reward_id: rewardId })
  await refresh().catch(() => undefined)
}

// ---------- Eltern ----------

export async function parentUnlock(pin: string): Promise<{ ok: boolean; error?: string; locked_until?: string }> {
  const r = await rpc<{ ok: boolean; token?: string; expires_at?: string; error?: string; locked_until?: string }>(
    'bc_parent_unlock', { p_pin: pin },
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
  if (t) void rpc('bc_parent_lock', { p_token: t }).catch(() => undefined)
  void refresh().catch(() => undefined)
}

export function parentActive() {
  return !!token()
}

async function parentRpc<T>(fn: string, args: Record<string, unknown>) {
  const t = token()
  if (!t) throw new ApiError('pin_required')
  return rpc<T>(fn, { p_token: t, ...args })
}

// ---------- Eltern der Familie (Google-Konten) ----------

export interface ParentList {
  parents: { user_id: string; email: string; is_me: boolean; added_at: string }[]
  invites: { email: string; created_at: string; expires_at: string }[]
}

// Nur im Speicher (Eltern-Inhalt, Siggi N2)
export function loadParents() {
  return parentRpc<ParentList>('bc_parents', {})
}

export async function inviteParent(email: string) {
  await parentRpc('bc_parent_invite', { p_email: normEmail(email) })
}

export async function deleteInvite(email: string) {
  await parentRpc('bc_parent_invite_delete', { p_email: email })
}

export async function removeParent(userId: string) {
  await parentRpc('bc_parent_remove', { p_user_id: userId })
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
  // Erst laufende/wartende Sendungen abschließen, damit keine Antwort NACH dem Zurücksetzen ankommt (Siggi N2)
  await flush()
  const r = await parentRpc<{ ok: boolean; error?: string; locked_until?: string }>('bc_progress_reset', { p_pin: pin, p_profile_id: profileId })
  if (r.ok) {
    set({ queue: state.queue.filter((q) => profileId !== null && q.profileId !== profileId) })
    // Zurücksetzen hat geklappt: ein Fehler beim Nachladen darf nicht als „hat nicht geklappt“ erscheinen (Bodo)
    await refresh().catch(() => undefined)
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
    if (document.visibilityState === 'visible' && state.family) void refresh().catch(() => undefined)
  })
  // Der erste Abgleich startet, sobald auth.ts die Sitzung kennt (authChanged → linkSession → refresh)
}
