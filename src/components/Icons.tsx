// Linien-Symbole (24er Raster, Strich über CSS)
type P = { className?: string }

// Logo von Logo-Luisa (brand/braincraft-rund.svg), als Datei eingebunden
export const Logo = ({ className }: P) => (
  <img className={className} src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" aria-hidden="true" />
)

export const Gear = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    <circle cx="12" cy="12" r="6.6" />
  </svg>
)

export const Star = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.6l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.8l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z" />
  </svg>
)

// Start: Cockpit-Instrument
export const TabStart = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="13" r="8" />
    <path d="M12 13l4-4M7.5 13h1M15.5 13h1M12 8.5v1" />
  </svg>
)

// Lernen: aufgeschlagenes Heft
export const TabLearn = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 5.5c3-.8 5.8-.5 8.5 1.2 2.7-1.7 5.5-2 8.5-1.2v13c-3-.8-5.8-.5-8.5 1.2-2.7-1.7-5.5-2-8.5-1.2z" />
    <path d="M12 6.7v13" />
  </svg>
)

// Ausrüstung: Schild
export const TabGear = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
)

// Shop: Geschenk
export const TabShop = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13" />
    <path d="M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7zM12 7c1.5-3 5-3.5 5-1.5S14 7 12 7z" />
  </svg>
)

export const Chevron = () => (
  <svg className="chev" viewBox="0 0 10 16" aria-hidden="true">
    <path d="M2 2l6 6-6 6" />
  </svg>
)

// Schnellstart: Triebwerk / Würfel
export const Rocket = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3c3 2 4.5 5 4.5 9l-2 3h-5l-2-3c0-4 1.5-7 4.5-9z" />
    <circle cx="12" cy="10" r="1.6" />
    <path d="M9.5 15l-2.5 3.5M14.5 15l2.5 3.5M12 16v4.5" />
  </svg>
)

export const Shuffle = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z" />
    <path d="M4.5 7.8L12 12l7.5-4.2M12 12v8.5" />
  </svg>
)

// Belohnungs-Symbole (Schlüssel wie braincraft.rewards.icon); unbekannte Schlüssel zeigen das Geschenk
const REWARD_PATHS: Record<string, string> = {
  'gamepad-2': 'M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14 15h-4l-.7.6A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4zM7.5 10.5v3M6 12h3M15.5 11.5h.01M17.5 13h.01',
  'ice-cream': 'M7.5 10a4.5 4.5 0 0 1 9 0M6.5 10h11l-5.5 11z',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  pizza: 'M12 21 3.5 6.5a14 14 0 0 1 17 0zM5.5 9.8a10.5 10.5 0 0 1 13 0M10 11.5h.01M13.5 14h.01M11.5 16.5h.01',
  book: 'M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2zM5 17.5a2 2 0 0 1 2-2h11',
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4zM12 3v4.5M15.5 10l5-1.5M14.2 14l3 4.2M9.8 14l-3 4.2M8.5 10l-5-1.5',
  bike: 'M2.5 17.5a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zM14.5 17.5a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zM6 17.5 9.5 9h5l3.5 8.5M6 17.5h6l2.5-8.5M12 17.5 9.5 9V6.5M8 6.5h3M14.5 9l-1-3h2',
  gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7zM12 7c1.5-3 5-3.5 5-1.5S14 7 12 7z',
}
export const REWARD_ICONS = Object.keys(REWARD_PATHS)

export const RewardIcon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={REWARD_PATHS[name] ?? REWARD_PATHS.gift} />
  </svg>
)

// Ausrüstungs-Symbole von Logo-Luisa (Schlüssel wie braincraft.items.item_key, docs/begriffe-boss.md),
// gleiche optische Größe (ca. 17 × 18 im 24er Raster) und Strichstärke; unbekannt zeigt das Schild von TabGear
const ITEM_FALLBACK = 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6zM9 12l2 2 4-4'
export const ITEM_PATHS: Record<string, string> = {
  // Pilotenhelm: Kuppel mit Visier und Mittelkamm
  helm: 'M4 13a8 8 0 0 1 16 0v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM7.5 11h9a1.5 1.5 0 0 1 1.5 1.5 2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 12.5 1.5 1.5 0 0 1 7.5 11zM12 5v3',
  // Rennhandschuh mit zwei Rennstreifen
  handschuhe: 'M8 20.5V17l-2.8-3.7a1.5 1.5 0 0 1 2.4-1.8L9 13V6.5a1.5 1.5 0 0 1 3 0v-1a1.5 1.5 0 0 1 3 0V7a1.5 1.5 0 0 1 3 0v8c0 2.3-.8 4-2 5.5zM7.5 20.5h9M12 6.5V10M15 7v3M10.5 15.5l5.5-2M11 18l4.5-1.6',
  // Turbo-Stiefel mit Tempolinien (keine Flammen)
  stiefel: 'M9 3.5h6v8.5l4.6 2.3a2 2 0 0 1 1.1 1.8V19a1 1 0 0 1-1 1H9zM9 6.5h6M9 17h11.7M2.5 9h3.5M3.5 12.5h2.5M2.5 16h3.5',
  // Werkzeuggürtel mit Schnalle und Hammer
  guertel: 'M9.5 8H4a2 2 0 0 0 0 4h5.5M14.5 8H20a2 2 0 0 1 0 4h-5.5M9.5 6.5h5v7h-5zM8.8 13l4.8 3.6-1.4 1.9-4.8-3.6zM6 21.8l3.8-5',
  // Blockschild: Schild mit 2 × 2 Blöcken
  schild: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6zM8 8h8v8H8zM12 8v8M8 12h8',
  // Windumhang mit Windlinien
  umhang: 'M8 4.5h5c.5 4 2.5 9 7.5 12.5-2.5 1.5-5 1.5-7 .5-2 1.5-5.5 1.5-8 0C6 13 7 8 8 4.5zM8 4.5l2.5 2.5 2.5-2.5M2.5 9.5h3M2 13h3',
  // Adler-Fernglas mit kleinem Flügel
  fernglas: 'M3.5 16a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zM13.5 16a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0zM4 14.5 5.8 9h3l1.5 5.5M20 14.5 18.2 9h-3l-1.5 5.5M10.3 12h3.4M9 8C11 4.5 15 3 20.5 3c-.6 1.3-1.4 2.2-2.6 2.6.6.4.6 1-.2 1.4-1 .4-2.4.5-3.6.4.4.5.2 1-.8 1.2C11.5 8.8 10 8.5 9 8z',
  // Sternenkompass: Stern als Nadel
  kompass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 6.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5zM12 3v1.5M12 19.5V21',
  // Rennabzeichen: runde Plakette mit Kurvenlinie und Bändern
  abzeichen: 'M12 3a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8.7 15.1 7.5 21l4.5-2.3 4.5 2.3-1.2-5.9M9 12c2.3.3 2.7-1.6 3-2.6s.8-2.8 3-2.6',
  // Düsenflügel: Flügelpaar mit Düse
  fluegel: 'M10.5 15.5V8a1.5 1.5 0 0 1 3 0v7.5zM10.5 15.5l-.6 3h4.2l-.6-3M10.5 9.5C7.5 9.5 4.5 8 2.5 6c.2 4 3 7 8 7.5M13.5 9.5c3 0 6-1.5 8-3.5-.2 4-3 7-8 7.5M5.2 10.7l2.5.6M18.8 10.7l-2.5.6',
  // Siegerpokal mit kleiner Zielflagge
  pokal: 'M7 7h10v2.5a5 5 0 0 1-10 0zM7 8.3H5a2 2 0 0 0 2.5 3.3M17 8.3h2a2 2 0 0 1-2.5 3.3M12 14.5V17M9 20.5h6l-.6-3.5H9.6zM12 7V2.5h4.5l-1.2 1.5 1.2 1.5H12',
  // Sternenkrone: Zacken mit Stern an der Spitze
  krone: 'M5 19h14M5 19 4 10l4.5 3.5L12 9l3.5 4.5L20 10l-1 9zM12 2.5l.9 1.9 1.9.9-1.9.9L12 8.1l-.9-1.9-1.9-.9 1.9-.9zM4 7.6h.01M20 7.6h.01',
}
export const ITEM_ICONS = Object.keys(ITEM_PATHS)

export const ItemIcon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={ITEM_PATHS[name] ?? ITEM_FALLBACK} />
  </svg>
)

// Vorlesen: Lautsprecher
export const Speaker = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
)
