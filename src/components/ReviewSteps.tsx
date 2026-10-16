import { CheckIcon } from '../layout/icons'

export type ReviewStep = 'data' | 'clients' | 'money' | 'confirm'

const REVIEW_STEPS: Array<{ id: ReviewStep; label: string }> = [
  { id: 'data', label: 'Data' },
  { id: 'clients', label: 'Clients' },
  { id: 'money', label: 'Money' },
  { id: 'confirm', label: 'Confirm' },
]

/** What each step shows in its circle: a tick when done, a count when something needs a look. */
export type StepMark = { done?: boolean; count?: number }

/** The daily review's steps; any step can be opened directly. */
export function StepBar({ current, marks, onPick }: { current: ReviewStep; marks: Partial<Record<ReviewStep, StepMark>>; onPick: (s: ReviewStep) => void }) {
  return (
    <ol className="step-bar">
      {REVIEW_STEPS.map((s, i) => {
        const mark = marks[s.id] ?? {}
        const state = s.id === current ? 'current' : mark.count ? 'attention' : mark.done ? 'done' : ''
        return (
          <li key={s.id}>
            <button type="button" className={`step ${state}`} aria-current={s.id === current ? 'step' : undefined} onClick={() => onPick(s.id)}>
              <span className="step-dot" aria-hidden="true">
                {mark.done && !mark.count && s.id !== current ? <CheckIcon /> : i + 1}
                {mark.count ? <span className="step-count">{mark.count}</span> : null}
              </span>
              <span className="step-label">
                {s.label}
                {mark.count ? <span className="visually-hidden">, {mark.count} to check</span> : mark.done ? <span className="visually-hidden">, done</span> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Back / Next under each step. */
export function StepNav({ current, onPick, nextNote }: { current: ReviewStep; onPick: (s: ReviewStep) => void; nextNote?: string }) {
  const i = REVIEW_STEPS.findIndex((s) => s.id === current)
  const prev = REVIEW_STEPS[i - 1]
  const next = REVIEW_STEPS[i + 1]
  return (
    <div className={`step-nav${next ? '' : ' last'}`}>
      {nextNote && <p className="small warn-text center">{nextNote}</p>}
      <div className="step-nav-buttons">
        {prev && (
          <button type="button" className="button" onClick={() => onPick(prev.id)}>
            ‹ Back
          </button>
        )}
        {next && (
          <button type="button" className="button primary" onClick={() => onPick(next.id)}>
            Next: {next.label} ›
          </button>
        )}
      </div>
    </div>
  )
}
