import type { ReactNode } from 'react'

/** Stand-in for screens whose phase hasn't been built yet. */
export function Placeholder({ title, phase, children }: { title: string; phase: string; children: ReactNode }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <div className="card">
        <p className="eyebrow">Coming in {phase}</p>
        {children}
      </div>
    </section>
  )
}
