import { getPrefs } from './prefs'

// Eigene, synthetisch erzeugte Töne (keine fremden Sounds, Markenrecht).
// iOS Safari erlaubt Ton erst nach einer Berührung: unlock() beim ersten Tippen aufrufen.

let ctx: AudioContext | null = null

export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  // Stummer Mini-Ton entsperrt die Ausgabe unter iOS
  const g = ctx.createGain()
  g.gain.value = 0
  const o = ctx.createOscillator()
  o.connect(g).connect(ctx.destination)
  o.start()
  o.stop(ctx.currentTime + 0.01)
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, slideTo?: number) {
  if (!ctx) return
  const t = ctx.currentTime + start
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export type Sound = 'correct' | 'wrong' | 'pop' | 'tap' | 'thrust' | 'chest'

export function play(sound: Sound) {
  if (!getPrefs().sound || !ctx) return
  switch (sound) {
    case 'correct': // Sternenklang: zwei helle Töne aufwärts
      tone(880, 0, 0.18, 'triangle')
      tone(1318.5, 0.09, 0.28, 'triangle')
      break
    case 'wrong': // sanfter Feder-Ton, nicht strafend
      tone(330, 0, 0.22, 'sine', 0.12, 262)
      break
    case 'pop':
      tone(660, 0, 0.08, 'square', 0.06, 990)
      break
    case 'tap':
      tone(520, 0, 0.05, 'sine', 0.06)
      break
    case 'thrust': // Triebwerk: aufsteigendes Rauschen als Sägezahn
      tone(90, 0, 0.6, 'sawtooth', 0.05, 360)
      break
    case 'chest': // kleine Fanfare
      ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.14))
      break
  }
}
