import { GoTrueClient, isAuthRetryableFetchError } from '@supabase/auth-js'
import { useSyncExternalStore } from 'react'
import { PUBLISHABLE_KEY, SUPABASE_URL, setTokenSource } from './api'

// Anmeldung der Eltern mit Google (Supabase Auth, PKCE mit Weiterleitung, auch in der installierten App).
// Die Sitzung bleibt auf dem Gerät (localStorage „braincraft-auth“, eigener Schlüssel, weil sich alle
// Studio-Apps auf marcokland-web.github.io einen Origin teilen). Nur für Eltern-Geräte (Handy, Mac):
// Kinder-Geräte werden vom Eltern-Gerät gekoppelt und haben nie eine Google-Sitzung (Marco, 04.11.2026).

export interface AuthUser {
  id: string
  email: string
  // Aus dem Google-Profil (nur zur Anzeige der Konto-Zeile)
  name?: string
  avatar?: string
}
export interface AuthState {
  ready: boolean
  user: AuthUser | null
  // Fehler aus der Weiterleitung bzw. dem Code-Tausch als eigener Code für die Texte:
  // no_access = Konto nicht zugelassen (signup_disabled oder Ablehnung durch den Before-User-Created-Hook),
  // expired = Anmeldung abgelaufen (flow_state_expired, bad_code_verifier), offline = Netz weg beim Tausch
  error: 'cancelled' | 'failed' | 'no_access' | 'expired' | 'offline' | null
  // Weiterleitung zu Google läuft („Google wird geöffnet …“)
  redirecting: boolean
}

const STORAGE_KEY = 'braincraft-auth'
const RETURN_KEY = 'braincraft:google-return'

// Kommt die Seite gerade von Google zurück (Merker beim Tipp gesetzt UND Rückleitung mit ?code=/error=)?
// Gilt nur kurz nach dem Start und nur einmal (Doris M1); sonst öffnet erst „Ich bin Mama oder Papa“.
let returnedAt = 0
export function takeGoogleReturn(): boolean {
  const on = returnedAt > 0 && Date.now() - returnedAt < 60_000
  returnedAt = 0
  return on
}

let client: GoTrueClient | null = null
let state: AuthState = { ready: false, user: null, error: null, redirecting: false }
const listeners = new Set<() => void>()
const changed: ((user: AuthUser | null, explicit?: boolean) => void)[] = []
// Während signOutDevice() keine Ereignisse als „unfreiwillig abgemeldet“ melden
let signingOut = false

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

// Adresse, zu der Google zurückleitet: die App selbst (inkl. /BrainCraft/), lokal entsprechend localhost
export function redirectUrl() {
  return new URL(import.meta.env.BASE_URL, location.origin).href
}

// Gespeicherte Sitzung direkt lesen (ohne Netz): offline bleibt das Gerät angemeldet, auch wenn das
// Zugangstoken gerade nicht erneuert werden kann. Die Kinder sehen dann keinen Anmelde-Bildschirm.
function storedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const s = raw ? JSON.parse(raw) : null
    return s?.refresh_token && s?.user?.id ? toUser(s.user) : null
  } catch {
    return null
  }
}

type RawUser = { id: string; email?: string; user_metadata?: Record<string, unknown> }
function toUser(u: RawUser | null | undefined): AuthUser | null {
  if (!u) return null
  const m = u.user_metadata ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 300 ? v : undefined)
  const avatar = str(m.avatar_url) ?? str(m.picture)
  return {
    id: u.id,
    email: u.email ?? '',
    name: str(m.full_name) ?? str(m.name),
    // Nur Google-Profilbilder über https (die CSP erlaubt nur diese Quelle)
    avatar: avatar && avatar.startsWith('https://lh3.googleusercontent.com/') ? avatar : undefined,
  }
}

// Fehler der Rückleitung bzw. des Code-Tauschs einordnen
// Der Hook antwortet live mit 403 {"error_code":"unknown","msg":"Kein Zugang – bitte von der Familie
// freischalten lassen."}; bei der Rückleitung steht diese Meldung in error_description. 403 allein heißt
// NICHT „kein Zugang“ (z. B. flow_state_expired kommt auch mit 403; Bodo C3).
function classify(p: { error?: string | null; code?: string | null; description?: string | null }) {
  if (p.code === 'signup_disabled' || /Kein Zugang|Signups not allowed/i.test(p.description ?? '')) return 'no_access' as const
  if (p.code === 'flow_state_expired' || p.code === 'bad_code_verifier') return 'expired' as const
  if (p.error === 'access_denied') return 'cancelled' as const
  return 'failed' as const
}

// Parameter der Weiterleitung aus der Adresszeile nehmen (Code nicht im Verlauf stehen lassen)
function cleanUrl() {
  const url = new URL(location.href)
  let dirty = false
  for (const k of ['code', 'error', 'error_code', 'error_description', 'state']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k)
      dirty = true
    }
  }
  if (url.hash.includes('error=') || url.hash.includes('access_token=')) {
    url.hash = ''
    dirty = true
  }
  if (dirty) history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

function makeClient() {
  client = new GoTrueClient({
    url: `${SUPABASE_URL}/auth/v1`,
    headers: { apikey: PUBLISHABLE_KEY },
    storageKey: STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  })
  const own = client
  client.onAuthStateChange((event, session) => {
    // Erneuerte Tokens ändern nichts an der Familie; Ereignisse eines ersetzten Clients ignorieren
    if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || own !== client) return
    const user = toUser(session?.user)
    if (user?.id === state.user?.id && state.ready) return
    set({ user })
    // Nicht im Rückruf selbst weiterarbeiten (auth-js hält dort eine Sperre; RPCs würden warten)
    if (state.ready && !signingOut) window.setTimeout(() => changed.forEach((f) => f(user)), 0)
  })
  return client
}

export function initAuth(onChange: (user: AuthUser | null) => void) {
  if (client) return
  changed.push(onChange)
  const params = new URLSearchParams(location.search + '&' + location.hash.slice(1))
  const urlError = params.get('error')
    ? classify({ error: params.get('error'), code: params.get('error_code'), description: params.get('error_description') })
    : null
  makeClient()
  // Jede RPC schickt das Zugangstoken der Sitzung mit (getSession wartet auf die Anmeldung und erneuert)
  setTokenSource(async () => {
    try {
      const { data } = await client!.getSession()
      return data.session?.access_token ?? null
    } catch {
      return null
    }
  })
  // Mit ?code= zurück von Google: Ergebnis des Tauschs auswerten, sonst stünde man still am Anfang (Bodo C3)
  const hadCode = params.has('code')
  try {
    if (sessionStorage.getItem(RETURN_KEY) === '1' && (hadCode || !!urlError)) returnedAt = Date.now()
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    // Privater Modus
  }
  void (async () => {
    let initError: { code?: string; message?: string } | null = null
    let retryable = false
    try {
      const r = await client!.initialize()
      initError = (r.error as { code?: string; message?: string } | null) ?? null
      // Nur echter Netzfehler (ohne HTTP-Status) heißt „offline“; 5xx ist „hat nicht geklappt“
      retryable = !!r.error && isAuthRetryableFetchError(r.error) && !(r.error as { status?: number }).status
    } catch {
      retryable = true
    }
    let user: AuthUser | null = null
    let sessionError: unknown = null
    try {
      const { data, error } = await client!.getSession()
      user = toUser(data.session?.user)
      sessionError = error
    } catch (e) {
      sessionError = e
    }
    // Netzfehler beim Erneuern: Sitzung ist nicht verloren, nur gerade nicht prüfbar
    if (!user && sessionError && isAuthRetryableFetchError(sessionError)) user = storedUser()
    let error: AuthState['error'] = urlError
    if (!error && !user && hadCode) {
      error = retryable ? 'offline' : initError ? classify({ code: initError.code, description: initError.message }) : 'failed'
    }
    set({ ready: true, user, error })
    cleanUrl()
    changed.forEach((f) => f(user))
  })()
}

// Weiterleitung zu Google; zurück kommt die App mit ?code=…, das initAuth beim Start einlöst
export async function signInWithGoogle(): Promise<void> {
  if (!client) throw new Error('auth_not_ready')
  set({ error: null, redirecting: true })
  // Merker für die Rückkehr: Nur dann öffnet die Kinderansicht den Eltern-Bereich von selbst (Doris M1)
  try {
    sessionStorage.setItem(RETURN_KEY, '1')
  } catch {
    // Privater Modus: Eltern tippen dann eben „Ich bin Mama oder Papa“
  }
  const { error } = await client.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl(), queryParams: { prompt: 'select_account' } },
  })
  if (error) {
    set({ error: 'failed', redirecting: false })
    throw error
  }
  // Kehrt die Seite aus dem Zwischenspeicher zurück (Zurück-Taste), Knopf wieder freigeben
  window.addEventListener('pageshow', () => set({ redirecting: false }), { once: true })
}

function clearStoredSession() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(`${STORAGE_KEY}-code-verifier`)
    localStorage.removeItem(`${STORAGE_KEY}-user`)
  } catch {
    // Privater Modus
  }
}

// Abmelden: scope 'local' = nur dieses Gerät, 'global' = auf allen Geräten dieses Kontos.
// Ergebnis prüfen: Scheitert signOut oder dauert es länger als 3 s (offline), die Sitzung selbst entfernen
// und einen frischen Client ohne Sitzung anlegen (Bodo C6). Meldet das Abmelden als bewusst (explicit).
export async function signOutDevice(scope: 'local' | 'global' = 'local'): Promise<void> {
  if (!client) return
  signingOut = true
  let ok = false
  try {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      const r = await Promise.race([
        client.signOut({ scope }).then((x) => !x.error).catch(() => false),
        new Promise<boolean>((res) => setTimeout(() => res(false), 3000)),
      ])
      ok = r
    }
  } finally {
    clearStoredSession()
    if (!ok) makeClient()
    signingOut = false
  }
  set({ user: null })
  changed.forEach((f) => f(null, true))
}
