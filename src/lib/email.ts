// Adressen einheitlich vergleichen, gleiche Regel wie braincraft.email_norm (supabase/007_google.sql):
// klein, ohne Leer- und unsichtbare Zeichen (Zero-Width, BOM, weiches Trennzeichen); bei gmail.com und
// googlemail.com ohne Punkte und +Zusatz (Google behandelt sie als dieselbe Adresse), googlemail → gmail.
const INVISIBLE = /[\s\u00A0\u00AD\u180E\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF]/g

export function normEmail(raw: string): string {
  const v = raw.slice(0, 320).replace(INVISIBLE, '').toLowerCase()
  const at = v.indexOf('@')
  if (at < 0) return v
  let local = v.slice(0, at)
  let domain = v.slice(at + 1)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replaceAll('.', '')
    domain = 'gmail.com'
  }
  return `${local}@${domain}`
}

// Gleiche Prüfung wie der Server (bad_email): genau ein @, Punkt in der Domain, höchstens 254 Zeichen
export function validEmail(v: string): boolean {
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
}
