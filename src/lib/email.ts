// Adressen einheitlich vergleichen, exakt gleiche Regel wie braincraft.email_norm (supabase/007_google.sql,
// dort als chr()-Liste): Leer- und unsichtbare Zeichen weg, nur A–Z klein schreiben (ASCII, wie translate()
// im SQL), bei gmail.com und googlemail.com ohne Punkte und +Zusatz, googlemail → gmail. Höchstens 320 Zeichen.
// Geprüft in supabase/tests/007_google.probe.mjs (SQL und JS mit denselben Beispielen).
const RANGES: [number, number][] = [
  [9, 13], [32, 32], [0x85, 0x85], [0xa0, 0xa0], [0xad, 0xad], [0x1680, 0x1680], [0x180e, 0x180e],
  [0x2000, 0x200f], [0x2028, 0x202f], [0x205f, 0x205f], [0x2060, 0x2064], [0x3000, 0x3000], [0xfeff, 0xfeff],
]
const invisible = (cp: number) => RANGES.some(([a, b]) => cp >= a && cp <= b)

export function normEmail(raw: string): string {
  const v = Array.from(raw)
    .slice(0, 320)
    .filter((ch) => !invisible(ch.codePointAt(0)!))
    .map((ch) => (ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch))
    .join('')
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
