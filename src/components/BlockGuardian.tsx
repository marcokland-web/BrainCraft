import { useId } from 'react'

// Blockwächter (Boss) von Logo-Luisa, nach docs/begriffe-boss.md Abschnitt 2 und 3.
// Turm aus 3 × 4 Blöcken: die mittlere Spalte oben ist der Kopf (zwei Felder hoch, bleibt immer),
// die übrigen 10 Blöcke sind die Lebenspunkte. Block i ist da, solange i < hp; sonst gestrichelter Umriss.
// Jeder Block ist eine eigene <g> mit id (…-b0 bis …-b9), data-block und Klasse bg-block, damit CSS ihn
// später herausfliegen lassen kann. Keine Animation hier (macht CSS mit prefers-reduced-motion).
// Farben nur über CSS-Variablen; freundlich: keine Zähne, keine roten Augen.

export type GuardianMood = 'brummig' | 'staunend' | 'geduldig' | 'froh'

const S = 50 // Kantenlänge eines Blocks
const COL = [23, 77, 131]
const ROW = [70, 124, 178, 232]
// Reihenfolge der Lebenspunkte: Index 9 fliegt zuerst heraus (oben außen), Index 0 zuletzt (unten Mitte)
const BLOCKS: [number, number][] = [
  [1, 3], [2, 3], [0, 3],
  [1, 2], [2, 2], [0, 2],
  [2, 1], [0, 1],
  [2, 0], [0, 0],
]
const HEAD = { x: COL[1], y: ROW[0], w: S, h: S * 2 + 4 }
const CX = HEAD.x + S / 2 // 102

const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Sparkle({ x, y, r }: { x: number; y: number; r: number }) {
  const k = r * 0.28
  return (
    <path
      d={`M${x} ${y - r}l${k} ${r - k} ${r - k} ${k}-${r - k} ${k}-${k} ${r - k}-${k}-${r - k}-${r - k}-${k} ${r - k}-${k}z`}
      style={{ fill: 'var(--gold)', stroke: 'var(--gold)', strokeWidth: 1.5, strokeLinejoin: 'round' }}
    />
  )
}

function Face({ mood }: { mood: GuardianMood }) {
  const fg = { ...line, stroke: 'var(--fg)' }
  const eyeL = CX - 11
  const eyeR = CX + 11
  const ey = 101
  const whites = (
    <>
      <circle cx={eyeL} cy={ey} r={7.5} style={{ fill: 'var(--surface)', stroke: 'var(--fg)', strokeWidth: 2.5 }} />
      <circle cx={eyeR} cy={ey} r={7.5} style={{ fill: 'var(--surface)', stroke: 'var(--fg)', strokeWidth: 2.5 }} />
    </>
  )
  const pupils = (dy: number, r = 3.4) => (
    <>
      <circle cx={eyeL} cy={ey + dy} r={r} style={{ fill: 'var(--fg)' }} />
      <circle cx={eyeR} cy={ey + dy} r={r} style={{ fill: 'var(--fg)' }} />
    </>
  )
  switch (mood) {
    case 'brummig': // freundlich-brummig: buschige Brauen fast flach, nur ein Hauch nach innen; Mund leicht nach unten
      return (
        <g className="bg-face" data-mood={mood}>
          <path d={`M${eyeL - 8} 86.5q7-1.5 14 1.5M${eyeR + 8} 86.5q-7-1.5-14 1.5`} style={{ ...fg, strokeWidth: 5 }} />
          {whites}
          {pupils(1.5)}
          <path d={`M${CX - 8} 141q8-5 16 0`} style={{ ...fg, strokeWidth: 3.5 }} />
        </g>
      )
    case 'staunend': // Brauen hoch, kleine Pupillen, Mund rund
      return (
        <g className="bg-face" data-mood={mood}>
          <path d={`M${eyeL - 8} 84q7-6 14-1M${eyeR + 8} 84q-7-6-14-1`} style={{ ...fg, strokeWidth: 5 }} />
          {whites}
          {pupils(0, 2.6)}
          <ellipse cx={CX} cy={140} rx={5} ry={6} style={{ ...fg, strokeWidth: 3.5 }} />
        </g>
      )
    case 'geduldig': // Brauen gerade, Lider halb gesenkt, sanftes Lächeln
      return (
        <g className="bg-face" data-mood={mood}>
          <path d={`M${eyeL - 7} 87h13M${eyeR + 7} 87h-13`} style={{ ...fg, strokeWidth: 5 }} />
          {whites}
          {pupils(2.5)}
          <path
            d={`M${eyeL - 7.5} ${ey}a7.5 7.5 0 0 1 15 0zM${eyeR - 7.5} ${ey}a7.5 7.5 0 0 1 15 0z`}
            style={{ fill: 'var(--muted)', fillOpacity: 0.35, stroke: 'var(--fg)', strokeWidth: 2.5, strokeLinejoin: 'round' }}
          />
          <path d={`M${CX - 7} 138q7 4.5 14 0`} style={{ ...fg, strokeWidth: 3.5 }} />
        </g>
      )
    case 'froh': // Lachaugen, Bäckchen, breites Lächeln
      return (
        <g className="bg-face" data-mood={mood}>
          <path d={`M${eyeL - 7} 84q7-5 13-1M${eyeR + 7} 84q-7-5-13-1`} style={{ ...fg, strokeWidth: 5 }} />
          <path d={`M${eyeL - 7} ${ey + 2}q7-9 14 0M${eyeR - 7} ${ey + 2}q7-9 14 0`} style={{ ...fg, strokeWidth: 3.5 }} />
          <circle cx={eyeL - 4} cy={121} r={4.5} style={{ fill: 'var(--accent)', fillOpacity: 0.3 }} />
          <circle cx={eyeR + 4} cy={121} r={4.5} style={{ fill: 'var(--accent)', fillOpacity: 0.3 }} />
          <path d={`M${CX - 11} 133q11 13 22 0`} style={{ ...fg, strokeWidth: 3.5 }} />
        </g>
      )
  }
}

function Sky({ hp }: { hp: number }) {
  if (hp <= 0) {
    // Sieg: die Wolke ist zur Sonne geworden
    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4
      const c = Math.cos(a)
      const s = Math.sin(a)
      return `M${(CX + c * 16).toFixed(1)} ${(34 + s * 16).toFixed(1)}L${(CX + c * 22).toFixed(1)} ${(34 + s * 22).toFixed(1)}`
    }).join('')
    return (
      <g className="bg-sky bg-sun">
        <circle cx={CX} cy={34} r={11} style={{ fill: 'var(--gold)', fillOpacity: 0.35, stroke: 'var(--gold)', strokeWidth: 3.5 }} />
        <path d={rays} style={{ ...line, stroke: 'var(--gold)', strokeWidth: 3.5 }} />
      </g>
    )
  }
  const t = Math.min(10, hp) / 10 // 1 = dunkle Gewitterwolke, nahe 0 = hell
  const cloud = `M${CX - 24} 50h46a10 10 0 0 0 0-20 14 14 0 0 0-26-5 11 11 0 0 0-20 7 9 9 0 0 0 0 18z`
  return (
    <g className="bg-sky bg-cloud">
      {hp <= 3 && (
        // Die Sonne lugt schon hinter der Wolke hervor
        <circle cx={CX + 18} cy={26} r={10} style={{ fill: 'var(--gold)', fillOpacity: 0.35, stroke: 'var(--gold)', strokeWidth: 3 }} />
      )}
      <path d={cloud} style={{ fill: 'var(--surface)' }} />
      <path
        d={cloud}
        style={{ ...line, fill: 'var(--muted)', fillOpacity: 0.06 + 0.4 * t, stroke: 'var(--muted)', strokeOpacity: 0.4 + 0.6 * t, strokeWidth: 3.5 }}
      />
      {hp >= 6 && <path d={`M${CX + 2} 52l-5 7h7l-4 7`} style={{ ...line, stroke: 'var(--gold)', strokeWidth: 3 }} />}
    </g>
  )
}

export function BlockGuardian({
  hp,
  mood,
  className,
  label,
}: {
  hp: number
  mood: GuardianMood
  className?: string
  label?: string
}) {
  const uid = useId().replace(/:/g, '')
  const life = Math.max(0, Math.min(10, Math.round(hp)))
  const solid = { fill: 'var(--accent)', fillOpacity: 0.12, stroke: 'var(--accent)', strokeWidth: 3.5 }
  const ghost = { fill: 'none', stroke: 'var(--muted)', strokeOpacity: 0.5, strokeWidth: 2.5, strokeDasharray: '5 7' }

  return (
    <svg
      className={className}
      viewBox="0 0 204 290"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-hp={life}
      data-mood={mood}
    >
      <Sky hp={life} />

      {BLOCKS.map(([c, r], i) => {
        const x = COL[c]
        const y = ROW[r]
        const on = i < life
        return (
          <g key={i} id={`${uid}-b${i}`} data-block={i} className={`bg-block${on ? '' : ' bg-out'}`}>
            <rect x={x} y={y} width={S} height={S} rx={9} style={on ? solid : ghost} />
            {on && <path d={`M${x + 10} ${y + 12}h10M${x + 10} ${y + 12}v8`} style={{ ...line, stroke: 'var(--gold)', strokeWidth: 3 }} />}
          </g>
        )
      })}

      {life === 0 && (
        <g className="bg-stars">
          <Sparkle x={COL[0] + 25} y={ROW[1] + 22} r={7} />
          <Sparkle x={COL[2] + 26} y={ROW[0] + 28} r={6} />
          <Sparkle x={COL[2] + 22} y={ROW[2] + 26} r={8} />
          <Sparkle x={COL[0] + 20} y={ROW[3] + 18} r={6} />
        </g>
      )}

      {/* Kopf: zwei Felder hoch, verbeugt sich bei „froh“ */}
      <g className="bg-head" transform={mood === 'froh' ? `rotate(8 ${CX} ${HEAD.y + HEAD.h})` : undefined}>
        <rect x={HEAD.x} y={HEAD.y} width={HEAD.w} height={HEAD.h} rx={11} style={{ fill: 'var(--surface)', stroke: 'var(--accent)', strokeWidth: 3.5 }} />
        <rect x={HEAD.x} y={HEAD.y} width={HEAD.w} height={HEAD.h} rx={11} style={{ fill: 'var(--accent)', fillOpacity: 0.2, stroke: 'none' }} />
        <Face mood={mood} />
      </g>
    </svg>
  )
}
