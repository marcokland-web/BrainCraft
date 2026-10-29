// Zugriff auf Supabase nur über die bc_*-Funktionen (Schema braincraft ist nicht direkt erreichbar).
// Der öffentliche Schlüssel (publishable) steht wie in Rechenstern in der App; die Rechte prüfen die Funktionen.

const SUPABASE_URL = 'https://asfwbuptsfcrgmmgdgim.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_uXsPWezRtId6Eh3Dme7BcQ_mQzAx6Se'

export class ApiError extends Error {
  // code: eigener Fehlercode der bc_*-Funktion (z. B. pin_required) oder 'offline'
  // (ausgeschrieben statt Parameter-Eigenschaft, damit Node die Datei für die Unit-Tests direkt lädt)
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
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
    const own = res.status < 500 && /^[a-z_]{3,40}( \d{1,3})?$/.test(msg)
    throw new ApiError(own ? msg : 'server_error')
  }
  return data as T
}
