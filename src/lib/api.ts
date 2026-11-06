// Zugriff auf Supabase nur über die bc_*-Funktionen (Schema braincraft ist nicht direkt erreichbar).
// Der öffentliche Schlüssel (publishable) steht wie in Rechenstern in der App; die Rechte prüfen die Funktionen
// über auth.uid() aus dem Zugangstoken der Google-Sitzung (Migration 007).

export const SUPABASE_URL = 'https://asfwbuptsfcrgmmgdgim.supabase.co'
export const PUBLISHABLE_KEY = 'sb_publishable_uXsPWezRtId6Eh3Dme7BcQ_mQzAx6Se'

// Liefert das Zugangstoken der Sitzung (auth.ts setzt die Quelle; ohne Sitzung null)
let tokenSource: () => Promise<string | null> = async () => null
export function setTokenSource(fn: () => Promise<string | null>) {
  tokenSource = fn
}

// Geräte-Token eines gekoppelten Kinder-Geräts (store.ts setzt die Quelle). Ist eins da, geht es im Header
// x-bc-device mit und die Google-Sitzung NICHT (Kinder-Gerät spricht nur mit Kinder-/PIN-Rechten).
let deviceSource: () => string | null = () => null
export function setDeviceSource(fn: () => string | null) {
  deviceSource = fn
}

export class ApiError extends Error {
  // code: eigener Fehlercode der bc_*-Funktion (z. B. pin_required) oder 'offline'
  // (ausgeschrieben statt Parameter-Eigenschaft, damit Node die Datei für die Unit-Tests direkt lädt)
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

// opts.deviceToken: einmalig mit einem anderen Geräte-Token senden (z. B. verworfene Kopplung abmelden)
export async function rpc<T>(fn: string, args: Record<string, unknown>, opts: { deviceToken?: string } = {}): Promise<T> {
  let res: Response
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' }
  const device = opts.deviceToken ?? deviceSource()
  if (device) headers['x-bc-device'] = device
  else {
    const access = await tokenSource()
    if (access) headers.Authorization = `Bearer ${access}`
  }
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    })
  } catch {
    throw new ApiError('offline')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Eigene Codes der bc_*-Funktionen kommen mit Status 400; ab 500 ist es immer ein Serverfehler (Bodo)
    const msg = typeof data?.message === 'string' ? data.message : ''
    // Funktion gibt es auf dem Server (noch) nicht, z. B. Migration nicht eingespielt
    if (res.status === 404 && data?.code === 'PGRST202') throw new ApiError('missing_function')
    // Ohne gültige Sitzung verweigert die Datenbank die Funktion (nur für angemeldete Konten)
    if (res.status === 401 || data?.code === '42501' || data?.code === 'PGRST301') throw new ApiError('not_signed_in')
    const own = res.status < 500 && /^[a-z_]{3,40}( \d{1,3})?$/.test(msg)
    throw new ApiError(own ? msg : 'server_error')
  }
  return data as T
}
