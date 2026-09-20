import type { AssigneeStageDetail } from '@kyvera/shared-types'
import { useState, type FormEvent } from 'react'
import { addProgressNote, advanceStage, markAssignmentReady } from '../api/products'
import { ApiError } from '../api/client'
import { formatDate, formatDays } from '../lib/format'
import { describeReadiness } from '../lib/readiness'

interface AssigneeStageCardProps {
  productId: string
  stage: AssigneeStageDetail
  /** Reload the product after something changed. */
  onChanged: () => Promise<void>
}

/**
 * One stage the viewer is assigned to. Everything shown comes from the assignee
 * view the API returned; nothing about any other stage is asked for or worked out.
 */
export function AssigneeStageCard({ productId, stage, onChanged }: AssigneeStageCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const isOpen = stage.readiness.state === 'open_now'

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault()
    if (noteText.trim() === '') return
    const ok = await run(() => addProgressNote(productId, stage.stage.id, noteText))
    if (ok) setNoteText('')
  }

  return (
    <article className="stage-card">
      <header>
        <h2>{stage.stage.name}</h2>
        <p className={`readiness readiness-${stage.readiness.state}`}>
          {describeReadiness(stage.readiness)}
        </p>
      </header>

      <dl className="facts">
        <div>
          <dt>Expected duration</dt>
          <dd>{formatDays(stage.stage.expectedDurationDays)}</dd>
        </div>
        {stage.delay?.delayed && (
          <div>
            <dt>Running late</dt>
            <dd className="delay">+{formatDays(stage.delay.delayDays)}</dd>
          </div>
        )}
      </dl>

      {stage.readiness.state !== 'completed' && (
        <div className="actions">
          {stage.readyAt ? (
            <p>You marked your part ready on {formatDate(stage.readyAt)}.</p>
          ) : isOpen ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => markAssignmentReady(productId, stage.assignmentId))}
            >
              Mark my part ready
            </button>
          ) : (
            <p className="muted">You can mark your part ready once this stage is open.</p>
          )}

          {isOpen && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => advanceStage(productId))}
              >
                Complete this stage
              </button>
              <p className="muted">
                You can complete it yourself if you are its only assignee. If several people share
                it, mark your part ready and an admin, the product&apos;s owner or an assigned
                manager moves it on.
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {stage.history.length > 0 && (
        <>
          <h3>History</h3>
          <table>
            <thead>
              <tr>
                <th>Entered</th>
                <th>Exited</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {stage.history.map((entry) => (
                <tr key={entry.enteredAt}>
                  <td>{formatDate(entry.enteredAt)}</td>
                  <td>{entry.exitedAt ? formatDate(entry.exitedAt) : 'Current'}</td>
                  <td>{entry.delayReason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Progress notes</h3>
      {stage.notes.length === 0 ? (
        <p className="muted">No notes yet.</p>
      ) : (
        <ul className="notes">
          {stage.notes.map((note) => (
            <li key={note.id}>
              <p>{note.note}</p>
              <span className="muted">
                {formatDate(note.createdAt)}
                {note.isMine ? ' · you' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitNote} className="note-form">
        <label>
          Add a note on this stage
          <textarea
            rows={3}
            maxLength={2000}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || noteText.trim() === ''}>
          Add note
        </button>
      </form>
    </article>
  )
}
