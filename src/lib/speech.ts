// Vorlesen mit der Web Speech API. Satzweise (zuverlässig unter iOS Safari); innerhalb eines Satzes
// wird das gesprochene Wort hervorgehoben, wenn der Browser Wortgrenzen meldet (onboundary), sonst der Satz.

export interface SpeechPos {
  sentence: number
  word: number | null // Zeichenposition im Satz oder null (nur Satz hervorheben)
}

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// Abkürzungen und Zahlen mit Punkt („z. B.“, „1. Mose“, „3. Klasse“) trennen keinen Satz (Lern-Lotte)
// Zweiteilige Abkürzungen („z. B.“, „d. h.“, „u. a.“) zuerst, sonst trennte der zweite Punkt (Bodo)
const KEEP = /\b(?:z\.\s?B|d\.\s?h|u\.\s?a|z|d|u|s|v|vgl|bzw|ca|Nr|usw|etc|Dr|St)\.(?=\s)|\b\d+\.(?=\s)/g
export function splitSentences(text: string): string[] {
  const guarded = text.replace(KEEP, (m) => m.replaceAll('.', '\u2024'))
  const parts = guarded.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [guarded]
  return parts.map((s) => s.replaceAll('\u2024', '.'))
}

function voiceFor(lang: 'de' | 'en'): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang))
  // Bevorzugt lokale, natürlich klingende Stimmen (wie in Rechenstern); Englisch britisch
  const nice = lang === 'de' ? /premium|enhanced|anna|petra|helena/i : /premium|enhanced|daniel|kate|serena|en-gb/i
  return voices.find((v) => nice.test(v.name) || nice.test(v.lang)) ?? voices.find((v) => v.localService) ?? voices[0]
}

// Ein einzelnes Wort vorlesen (Schlüsselwort antippen); Englisch nur mit englischer Stimme
export function speakWord(word: string, lang: 'de' | 'en') {
  if (!speechAvailable()) return false
  const voice = voiceFor(lang)
  if (lang === 'en' && !voice) return false
  stopSpeaking()
  const u = new SpeechSynthesisUtterance(word)
  u.lang = lang === 'en' ? 'en-GB' : 'de-DE'
  if (voice) u.voice = voice
  u.rate = 0.8
  speechSynthesis.speak(u)
  return true
}

let session = 0

export function stopSpeaking() {
  session++
  if (speechAvailable()) speechSynthesis.cancel()
}

// Liest die Sätze nacheinander vor; onPos meldet die aktuelle Stelle, onEnd das Ende (nicht beim Abbrechen)
export function speak(sentences: string[], onPos: (p: SpeechPos | null) => void, onEnd: () => void) {
  if (!speechAvailable()) return
  stopSpeaking()
  const my = session
  const voice = voiceFor('de')
  const next = (i: number) => {
    if (my !== session) return
    if (i >= sentences.length) {
      onPos(null)
      onEnd()
      return
    }
    const u = new SpeechSynthesisUtterance(sentences[i])
    u.lang = 'de-DE'
    if (voice) u.voice = voice
    u.rate = 0.92
    u.onstart = () => my === session && onPos({ sentence: i, word: null })
    u.onboundary = (e) => {
      if (my === session && e.name === 'word') onPos({ sentence: i, word: e.charIndex })
    }
    u.onend = () => next(i + 1)
    u.onerror = () => my === session && onPos(null)
    speechSynthesis.speak(u)
  }
  next(0)
}
