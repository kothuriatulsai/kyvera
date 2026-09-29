import type { UserSummary } from '@kyvera/shared-types'
import { useEffect, useId, useRef, useState } from 'react'

interface AssigneesCellProps {
  stageName: string
  /** Everyone assigned to the stage. */
  assignees: UserSummary[]
  /** Shown only when nobody is assigned: whoever was recorded as responsible. */
  fallback: UserSummary | null
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="7.2" y="7" width="1.6" height="4.6" rx="0.4" fill="currentColor" />
      <circle cx="8" cy="4.7" r="1" fill="currentColor" />
    </svg>
  )
}

/**
 * Who is responsible for a stage, for the "Responsible" column. One person is just
 * their name; several are shown as "Multiple" with a small info button that opens a
 * popover listing all of them. It closes on a second press, on Escape, or on a
 * click anywhere else.
 */
export function AssigneesCell({ stageName, assignees, fallback }: AssigneesCellProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (assignees.length === 0) return <>{fallback ? fallback.name : '—'}</>
  if (assignees.length === 1) return <>{assignees[0].name}</>

  return (
    <span className="assignees" ref={root}>
      Multiple
      <button
        type="button"
        className="info-button"
        aria-label={`Show all ${assignees.length} assignees of ${stageName}`}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <InfoIcon />
      </button>
      {open && (
        <div id={popoverId} role="dialog" aria-label={`Assignees of ${stageName}`} className="popover">
          <ul>
            {assignees.map((assignee) => (
              <li key={assignee.id}>{assignee.name}</li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}
