// Leerer Zustand einer Ansicht: Überschrift und freundlicher Hinweis
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section className="bc-view">
      <h1 className="bc-title">{title}</h1>
      <div className="card bc-empty">
        <p>{text}</p>
      </div>
    </section>
  )
}
