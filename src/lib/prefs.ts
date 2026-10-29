import { useSyncExternalStore } from 'react'

// Einstellungen pro Gerät. studio-theme und studio-lang gelten im ganzen Studio,
// alles andere bekommt das Präfix braincraft: (GitHub Pages teilt den Origin mit anderen Apps).
export type Theme = 'auto' | 'light' | 'dark'
export type Lang = 'de' | 'en'
export type Speech = 'off' | 'tap' | 'auto'

export interface Prefs {
  theme: Theme
  lang: Lang
  sound: boolean
  speech: Speech
  name: string
}

const KEYS = {
  theme: 'studio-theme',
  lang: 'studio-lang',
  sound: 'braincraft:sound',
  speech: 'braincraft:speech',
  name: 'braincraft:name',
} as const

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Privater Modus: Einstellung gilt nur bis zum Neuladen
  }
}

function load(): Prefs {
  const theme = read(KEYS.theme)
  const speech = read(KEYS.speech)
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    lang: read(KEYS.lang) === 'en' ? 'en' : 'de',
    sound: read(KEYS.sound) !== 'off',
    speech: speech === 'off' || speech === 'auto' ? speech : 'tap',
    name: (read(KEYS.name) ?? '').slice(0, 30),
  }
}

let state = load()
const listeners = new Set<() => void>()

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute('media') ?? ''
    // Bei „Automatisch“ übernehmen die media-Abfragen; sonst beide Einträge auf das gewählte Thema
    const color = theme === 'auto' ? (media.includes('dark') ? '#141012' : '#FAF7F2') : dark ? '#141012' : '#FAF7F2'
    m.setAttribute('content', color)
  })
}

function applyLang(lang: Lang) {
  document.documentElement.lang = lang
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  state = { ...state, [key]: value }
  if (key === 'theme') applyTheme(value as Theme)
  if (key === 'lang') applyLang(value as Lang)
  const raw = typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)
  write(KEYS[key], raw)
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function getPrefs(): Prefs {
  return state
}

applyTheme(state.theme)
applyLang(state.lang)
