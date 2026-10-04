import { useState, type FormEvent } from 'react'
import type { TechPackRemark } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { addTechPackRemark } from '../api/techPacks'
import { formatDate } from '../lib/format'

interface RemarkThreadProps {
  techPackId: string
  versionNumber: number
  remarks: TechPackRemark[]
  /** Whether the viewer may post here - see lib/sopPermissions.ts's canRemark. */
  canPost: boolean
  /** Reload the page's data after a successful post. */
  onPosted: () => Promise<void>
}

/** One version's review thread (SOP Stage 3, Engineering half) - remarks, oldest
 * first as the API already returns them, plus a post form when `canPost`. */
export function RemarkThread({ techPackId, versionNumber, remarks, canPost, onPosted }: RemarkThreadProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = body.trim()
  const canSubmit = trimmed !== '' && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      await addTechPackRemark(techPackId, versionNumber, trimmed)
      setBody('')
      await onPosted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="remarks">
      <h4>Remarks</h4>
      {remarks.length === 0 ? (
        <p className="muted">No remarks yet.</p>
      ) : (
        <ul className="notes">
          {remarks.map((remark) => (
            <li key={remark.id}>
              <p>{remark.body}</p>
              <span className="muted">
                {remark.author.name} · {formatDate(remark.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canPost && (
        <form className="note-form" onSubmit={handleSubmit}>
          <label>
            Add a remark
            <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="submit" disabled={!canSubmit}>
            {submitting ? 'Posting…' : 'Post remark'}
          </button>
        </form>
      )}
    </div>
  )
}
