import { useSyncExternalStore } from 'react'
import { ApiError, rpc, setDeviceSource } from './api'
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

// Google-Sitzung (nur Eltern-Geräte): unknown = noch nicht geprüft, signed_in, signed_out = nie angemeldet
// oder bewusst abgemeldet (signOutDevice). Ein unfreiwilliges Abmelden setzt access = 'expired'.
export type AuthStatus = 'unknown' | 'signed_in' | 'signed_out'
// Zugang dieses Geräts zur gespeicherten Familie. Alles außer 'ok' heißt: weiterspielen (Runde zu Ende),
// Stand und Warteschlange bleiben, danach kindgerechter Hinweis für die Eltern (Gerät neu verbinden).
export type Access = 'ok' | 'expired' | 'revoked' | 'no_family' | 'legacy'
// Neue Familie passt nicht zum gespeicherten Stand: nichts senden, Eltern entscheiden (roter Knopf)
export interface Conflict {
  family: string
  source: 'google' | 'device'
  deviceToken?: string
}

interface State {
  family: string | null
  // Geräte-Token eines gekoppelten Kinder-Geräts (nur auf diesem Gerät, nie im Klartext auf dem Server)
  device: string | null
  auth: AuthStatus
  access: Access
  conflict: Conflict | null
  // Angemeldet, aber noch keine Familie: Eltern legen eine an (oder wurden mit anderer Adresse eingeladen)
  needsFamily: boolean
  // Gerät war mit dem früheren Familien-Code verbunden (Tausch gegen ein Geräte-Token läuft oder steht aus)
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

const K = {
  family: 'braincraft:family', device: 'braincraft:device', access: 'braincraft:access', legacyCode: 'braincraft:code',
  profile: 'braincraft:profile', pull: 'braincraft:pull', queue: 'braincraft:queue', bossLocked: 'braincraft:bosslocked',
}

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

// Früherer Familien-Code: wird beim Start einmalig gegen ein Geräte-Token getauscht (bc_device_from_code,
// solange 008 nicht eingespielt ist). Bis dahin bleiben Stand, Kind und wartende Antworten unverändert.
const legacyCode = read<string | null>(K.legacyCode, null)
const storedFamily = read<string | null>(K.family, null)
const storedAccess = read<Access | null>(K.access, null)

let state: State = {
  family: storedFamily,
  device: read<string | null>(K.device, null),
  auth: 'unknown',
  access: legacyCode ? 'legacy' : (storedAccess ?? 'ok'),
  conflict: null,
  needsFamily: false,
  invites: [],
  legacy: !!legacyCode,
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
  if ('device' in patch) write(K.device, state.device)
  if ('access' in patch) write(K.access, state.access === 'ok' || state.access === 'legacy' ? null : state.access)
  if ('profileId' in patch) write(K.profile, state.profileId)
  if ('pull' in patch) write(K.pull, state.pull && childView(state.pull))
  if ('queue' in patch) write(K.queue, state.queue)
  listeners.forEach((l) => l())
}

// Kinder-Gerät schickt sein Token im Header x-bc-device (statt der Google-Sitzung)
setDeviceSource(() => state.device)

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function getState(): State {
  return state
}

const token = () => (state.parent && state.parent.until > Date.now() ? state.parent.token : null)

// Darf dieses Gerät gerade mit dem Server sprechen? (sonst nur lokal weiterspielen)
const online = () => !!state.family && state.access === 'ok' && !state.conflict && (!!state.device || state.auth === 'signed_in')

// Fehler, die den Zugang betreffen: nie Daten löschen, nur den Zugang vermerken (Bodo C1/C2)
function accessFromError(e: unknown): Access | null {
  if (!(e instanceof ApiError)) return null
  if (e.code === 'device_revoked' || e.code === 'device_unknown') return 'revoked'
  if (e.code === 'no_family') return 'no_family'
  if (e.code === 'not_signed_in' && !state.device) return 'expired'
  return null
}

// ---------- Anmelden, Koppeln und Einrichten ----------

function applyPull(pull: Pull) {
  const profileId = pull.profiles.some((p) => p.id === state.profileId) ? state.profileId : (pull.profiles[0]?.id ?? null)
  set({ pull, profileId, offline: false, legacy: false })
  const kid = pull.profiles.find((p) => p.id === profileId)
  if (kid) setPref('name', kid.child_name)
}

// Alles Familiäre von diesem Gerät entfernen (nicht die Einstellungen). Nur nach Rückfrage aufrufen.
function wipe() {
  set({ family: null, device: null, access: 'ok', conflict: null, profileId: null, pull: null, queue: [], parent: null, legacy: false })
  write(K.legacyCode, null)
  setPref('name', '')
}

// Liegt auf dem Gerät Stand, der zu einer ANDEREN Familie gehören könnte? (Altgerät ohne family_id: Kinder vergleichen)
function belongsElsewhere(familyId: string, pull?: Pull | null) {
  if (state.family) return state.family !== familyId
  if (!state.pull && !state.queue.length) return false
  if (!pull) return false
  const ids = new Set(pull.profiles.map((p) => p.id))
  const mine = [...(state.pull?.profiles.map((p) => p.id) ?? []), ...state.queue.map((q) => q.profileId)]
  return mine.length > 0 && !mine.some((id) => ids.has(id))
}

// Familie übernehmen. Passt sie nicht zum gespeicherten Stand: Rückfrage an die Eltern (resolveConflict)
async function adopt(familyId: string, source: 'google' | 'device', deviceToken?: string) {
  if (state.family && state.family !== familyId) {
    set({ conflict: { family: familyId, source, deviceToken }, needsFamily: false, invites: [] })
    return
  }
  // Altgerät/abgemeldeter Stand ohne Familien-ID: erst den neuen Stand holen und die Kinder vergleichen
  if (!state.family && (state.pull || state.queue.length)) {
    const prev = state.device
    if (deviceToken) set({ device: deviceToken })
    let pull: Pull | null = null
    try {
      pull = await rpc<Pull>('bc_pull', { p_token: null })
    } catch {
      pull = null
    }
    if (belongsElsewhere(familyId, pull)) {
      set({ device: prev, conflict: { family: familyId, source, deviceToken }, needsFamily: false, invites: [] })
      return
    }
  }
  set({ family: familyId, access: 'ok', conflict: null, legacy: false, needsFamily: false, invites: [],
        ...(deviceToken ? { device: deviceToken } : {}) })
  write(K.legacyCode, null)
  await refresh()
}

// Eltern entscheiden über fremden Stand: true = Stand dieses Geräts löschen und neue Familie nehmen,
// false = neue Verbindung verwerfen, alter Stand bleibt
export async function resolveConflict(takeNew: boolean) {
  const c = state.conflict
  if (!c) return
  if (!takeNew) {
    // Neue Verbindung verwerfen; ohne gültigen Zugang zeigt das Gerät danach „neu verbinden“
    set({ conflict: null, ...(c.source === 'google' || !state.device ? { access: state.pull ? ('expired' as Access) : 'ok' } : {}) })
    return
  }
  wipe()
  set({ family: c.family, access: 'ok', ...(c.deviceToken ? { device: c.deviceToken } : {}) })
  await refresh()
}

// Von auth.ts nach dem Start und bei jeder An- oder Abmeldung aufgerufen. explicit = signOutDevice()
export function authChanged(user: { id: string; email: string } | null, explicit = false) {
  if (state.device) return   // Kinder-Gerät: Google spielt keine Rolle
  if (!user) {
    // Unfreiwillig (abgelaufen, widerrufen): Kind spielt weiter, Eltern-Hinweis; nie Daten löschen (Bodo C1)
    // Auch beim Start ohne Sitzung (Familie gespeichert, kein Geräte-Token): ohne Zugang, Eltern-Hinweis
    const lost = !explicit && (state.auth === 'signed_in' || state.auth === 'unknown') && !!state.family
    set({ auth: 'signed_out', needsFamily: false, invites: [], parent: null,
          ...(state.family && (lost || explicit) ? { access: 'expired' as Access } : {}) })
    return
  }
  set({ auth: 'signed_in' })
  void linkSession().catch(() => undefined)
}

let linking: Promise<void> | null = null

// Nach der Google-Anmeldung: Familie des Kontos erfragen. Einladungen werden nur angezeigt.
export function linkSession(): Promise<void> {
  if (linking) return linking
  const p = (async () => {
    try {
      const r = await rpc<{ family_id: string | null }>('bc_session', {})
      if (state.auth !== 'signed_in') return
      if (r.family_id) {
        await adopt(r.family_id, 'google')
      } else if (state.family || state.pull) {
        // Konto ohne Familie, aber hier liegt Stand: nicht löschen, Eltern-Hinweis (Bodo C2/C4, Lotte D1)
        set({ access: state.family ? 'no_family' : state.access })
        const invites = await rpc<MyInvite[]>('bc_my_invites', {}).catch(() => [] as MyInvite[])
        set({ needsFamily: true, invites: Array.isArray(invites) ? invites : [] })
      } else {
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

// Kinder-Gerät: beim Start und bei Rückkehr ins Netz melden (Familie prüfen, zuletzt aktiv)
export async function deviceHello() {
  if (!state.device) return
  try {
    const r = await rpc<{ family_id: string }>('bc_device_hello', {})
    if (!state.family) await adopt(r.family_id, 'device')
    else if (r.family_id !== state.family) set({ access: 'revoked' })
    else {
      if (state.access !== 'ok') set({ access: 'ok' })
      await refresh()
    }
  } catch (e) {
    const a = accessFromError(e)
    if (a) set({ access: a })
    else if (e instanceof ApiError && e.code === 'offline') set({ offline: true })
  }
}

// Kinder-Gerät koppeln: Einmal-Code vom Eltern-Gerät einlösen. Liefert null bei Erfolg, sonst Fehlercode.
export async function pairDevice(code: string): Promise<string | null> {
  const prev = state.device
  // Ohne altes Token einlösen (der Server braucht keins); ein widerrufenes würde nur stören
  set({ device: null })
  let r: { ok: boolean; error?: string; device_token?: string; family_id?: string }
  try {
    r = await rpc('bc_pair_redeem', { p_pair_code: code })
  } catch (e) {
    set({ device: prev })
    throw e
  }
  if (!r.ok || !r.device_token || !r.family_id) {
    set({ device: prev })
    return r.error ?? 'pair_invalid'
  }
  await adopt(r.family_id, 'device', r.device_token)
  if (state.conflict) set({ device: prev })
  return null
}

// Altgerät: Familien-Code einmalig gegen ein Geräte-Token tauschen (nur bis 008). Scheitert es endgültig,
// zeigt das Kinder-Gerät den Hinweis „Gerät neu verbinden“, Stand und Schlange bleiben.
export async function exchangeLegacyCode() {
  const code = read<string | null>(K.legacyCode, null)
  if (!code || state.device) return
  try {
    const r = await rpc<{ ok: boolean; error?: string; device_token?: string; family_id?: string }>(
      'bc_device_from_code', { p_code: code, p_name: null })
    if (r.ok && r.device_token && r.family_id) {
      await adopt(r.family_id, 'device', r.device_token)
      return
    }
    if (r.error === 'pair_invalid') write(K.legacyCode, null)
    set({ access: 'revoked', legacy: false })
  } catch (e) {
    if (e instanceof ApiError && e.code === 'offline') set({ offline: true })
    else {
      // 008 eingespielt (missing_function): Code ist wertlos. Andere Fehler: Code behalten, später erneut
      // versuchen. In beiden Fällen können die Eltern neu koppeln; Stand und Schlange bleiben.
      if (e instanceof ApiError && e.code === 'missing_function') write(K.legacyCode, null)
      set({ access: 'revoked', legacy: false })
    }
  }
}

// Einladung in eine bestehende Familie annehmen (nach Tipp auf „Annehmen“) oder ablehnen
export async function acceptInvite(familyId: string) {
  const r = await rpc<{ family_id: string }>('bc_invite_accept', { p_family_id: familyId })
  await adopt(r.family_id, 'google')
}

export async function declineInvite(familyId: string) {
  await rpc('bc_invite_decline', { p_family_id: familyId })
  set({ invites: state.invites.filter((i) => i.family_id !== familyId) })
}

// Erste Einrichtung: das angemeldete Konto bekommt eine neue Familie mit erstem Kind und Eltern-PIN
export async function createFamily(childName: string, pin: string) {
  const r = await rpc<{ family_id: string; profile_id: string }>('bc_family_create', { p_child_name: childName, p_pin: pin })
  await adopt(r.family_id, 'google')
  if (!state.conflict) set({ profileId: r.profile_id })
}

// Nach dem Abmelden bzw. Trennen: mit wipeData alles Familiäre löschen (nach Rückfrage), sonst bleibt der
// Stand für die nächste Verbindung mit derselben Familie (wartende Antworten werden dann gesendet)
export function forgetDevice(wipeData: boolean) {
  set({ parent: null, needsFamily: false })
  if (wipeData) wipe()
}

// Kinder-Gerät trennt sich selbst (Token auf dem Server ungültig, falls online)
export async function leaveDevice(wipeData: boolean) {
  if (state.device) await Promise.race([rpc('bc_device_leave', {}).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))])
  set({ device: null, parent: null })
  if (wipeData) wipe()
  else if (state.family) set({ access: 'revoked' })
}

// Zurück im Netz bzw. beim Start: je nach Gerät melden, Code tauschen oder abgleichen
export async function reconnect() {
  try {
    if (state.device) await deviceHello()
    else if (read<string | null>(K.legacyCode, null)) await exchangeLegacyCode()
    else if (state.auth === 'signed_in' && (!state.family || !state.pull)) await linkSession()
    else await refresh()
  } catch {
    // Fehler zeigt die jeweilige Ansicht; hier nichts verlieren
  }
}

// Eltern löschen den Stand bewusst (Hinweis-Ansicht, roter Knopf)
export function wipeLocal() {
  wipe()
}

export function selectProfile(id: string) {
  set({ profileId: id })
  const kid = state.pull?.profiles.find((p) => p.id === id)
  if (kid) setPref('name', kid.child_name)
}

export async function refresh() {
  const family = state.family
  if (!online()) return
  try {
    await flush()
    const pull = await rpc<Pull>('bc_pull', { p_token: token() })
    // Während des Ladens abgemeldet oder andere Familie: Ergebnis verwerfen (Siggi N1)
    if (state.family !== family || !online()) return
    if (pull.family_id && pull.family_id !== family) return
    applyPull(pull)
  } catch (e) {
    const a = accessFromError(e)
    if (a) set({ access: a })
    else if (e instanceof ApiError && e.code === 'offline') set({ offline: true })
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
      while (online() && state.queue.length) {
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
          // Ohne Zugang (abgelaufen, Gerät entfernt, Familie weg) bleibt die Antwort liegen (Bodo C1/C2)
          const a = accessFromError(e)
          if (a) {
            set({ access: a })
            return
          }
          if (e instanceof ApiError && ['offline', 'server_error', 'retry', 'not_signed_in', 'missing_function'].includes(e.code)) {
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

// ---------- Kinder-Geräte (nur Eltern-Gerät mit Google + PIN) ----------

export interface DeviceRow {
  id: string
  name: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export function loadDevices() {
  return parentRpc<DeviceRow[]>('bc_devices', {})
}

export function createPairCode(name: string) {
  return parentRpc<{ code: string; expires_at: string }>('bc_pair_create', { p_name: name.trim().slice(0, 40) })
}

export async function revokeDevice(id: string) {
  await parentRpc('bc_device_revoke', { p_device_id: id })
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
  window.addEventListener('online', () => void reconnect())
  // Zurück in die App (z. B. am nächsten Morgen): neu abgleichen, damit Tagesstand und Sterne stimmen (Bodo)
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.family) void refresh().catch(() => undefined)
  })
  // Kinder-Gerät meldet sich selbst; Altgerät tauscht seinen Code. Eltern-Gerät: erster Abgleich, sobald
  // auth.ts die Sitzung kennt (authChanged → linkSession → refresh)
  if (state.device || legacyCode) void reconnect()
}
