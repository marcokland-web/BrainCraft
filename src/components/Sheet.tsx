import { useEffect, useRef, type ReactNode } from 'react'

// Pop-up im Studio-Look (Glas-Sheet); kurze Rückfragen mittig, Formulare am iPhone von unten mit Griff.
// Schließt mit Esc und Tipp daneben
export function Sheet({ open, onClose, label, children }: {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  // Bei jedem Zeichnen abgleichen: Hat Esc das Sheet geschlossen, während die Ansicht es offen hält
  // (z. B. beim Senden), erscheint es wieder statt unsichtbar „offen“ zu bleiben (Bodo)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  })

  return (
    <dialog
      ref={ref}
      className="settings confirm"
      aria-label={label}
      // Esc fragt die Ansicht, statt das Sheet selbst zu schließen
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // Nur melden, wenn der Browser selbst geschlossen hat, nicht beim Schließen durch open=false:
      // sonst löscht z. B. der Wechsel Bearbeiten → Löschen-Rückfrage den Entwurf (Bodo)
      onClose={() => {
        if (openRef.current) onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="st">
          <div className="st-grab" aria-hidden="true" />
          {children}
        </div>
      )}
    </dialog>
  )
}
