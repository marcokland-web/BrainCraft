import { GoTrueClient, isAuthRetryableFetchError } from '@supabase/auth-js'
import { useSyncExternalStore } from 'react'
import { PUBLISHABLE_KEY, SUPABASE_URL, setTokenSource } from './api'

// Anmeldung der Eltern mit Google (Supabase Auth, PKCE mit Weiterleitung, auch in der installierten App).
// Die Sitzung bleibt auf dem Gerät (localStorage „braincraft-auth“, eigener Schlüssel, weil sich alle
// Studio-Apps auf marcokland-web.github.io einen Origin teilen). Das Kind meldet sich nie selbst an:
// Ein Elternteil meldet das Gerät einmal an; Eltern-Rechte gibt es trotzdem nur mit der Eltern-PIN.

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
  // Fehler aus der Weiterleitung als eigener Code für die Texte; no_access = Konto nicht zugelassen
  // (signup_disabled oder 403 eines Before-User-Created-Hooks)
  error: 'cancelled' | 'failed' | 'no_access' | null
  // Weiterleitung zu Google läuft („Google wird geöffnet …“)
  redirecting: boolean
}

const STORAGE_KEY = 'braincraft-auth'

let client: GoTrueClient | null = null
let state: AuthState = { ready: false, user: null, error: null, redirecting: false }
const listeners = new Set<() => void>()
const changed: ((user: AuthUser | null) => void)[] = []

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
    avatar: avatar && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(avatar) ? avatar : undefined,
  }
}

// Fehler der Rückleitung bzw. des Code-Tauschs einordnen
function classify(p: { error?: string | null; code?: string | null; description?: string | null; status?: number }) {
  const text = `${p.code ?? ''} ${p.description ?? ''}`
  if (p.code === 'signup_disabled' || p.status === 403 || /signup|sign[- ]?ups? not allowed|hook|not allowed/i.test(text)) return 'no_access' as const
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
    if (state.ready) window.setTimeout(() => changed.forEach((f) => f(user)), 0)
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
  void client!
    .getSession()
    .then(({ data, error }) => {
      // Netzfehler beim Erneuern: Sitzung ist nicht verloren, nur gerade nicht prüfbar
      const user = toUser(data.session?.user) ?? (error && isAuthRetryableFetchError(error) ? storedUser() : null)
      const failed = !!error && !user
      const e = error as { code?: string; status?: number; message?: string } | null
      set({
        ready: true,
        user,
        error: urlError ?? (failed ? classify({ code: e?.code, status: e?.status, description: e?.message }) : null),
      })
      cleanUrl()
      changed.forEach((f) => f(user))
    })
    .catch(() => {
      const user = storedUser()
      set({ ready: true, user, error: user ? null : 'failed' })
      cleanUrl()
      changed.forEach((f) => f(user))
    })
}

// Weiterleitung zu Google; zurück kommt die App mit ?code=…, das initAuth beim Start einlöst
export async function signInWithGoogle(): Promise<void> {
  if (!client) throw new Error('auth_not_ready')
  set({ error: null, redirecting: true })
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

// Nur dieses Gerät abmelden (andere Geräte der Familie bleiben angemeldet). Ergebnis prüfen: Scheitert
// signOut (z. B. offline), die Sitzung selbst entfernen und einen frischen Client ohne Sitzung anlegen.
export async function signOutDevice(): Promise<void> {
  if (!client) return
  let ok = false
  try {
    const { error } = await client.signOut({ scope: 'local' })
    ok = !error
  } catch {
    ok = false
  }
  clearStoredSession()
  if (!ok) makeClient()
  if (state.user) {
    set({ user: null })
    changed.forEach((f) => f(null))
  }
}
