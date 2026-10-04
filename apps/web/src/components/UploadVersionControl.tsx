import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { uploadTechPackVersion } from '../api/techPacks'
import { fileListError } from '../lib/attachmentValidation'

interface UploadVersionControlProps {
  techPackId: string
  nextVersionNumber: number
  /** Reload the page's data after a successful upload (or a failed one that
   * might mean something changed underneath - a concurrent approval, say). */
  onChanged: () => Promise<void>
}

/**
 * PRODUCT_DESIGNER/ADMIN uploads a new version. The same control for "upload
 * v1" (a fresh TechPack, or a rejection's successor, which starts with zero
 * versions) and "upload v4" on top of existing ones - `nextVersionNumber` is
 * computed by the caller either way.
 */
export function UploadVersionControl({ techPackId, nextVersionNumber, onChanged }: UploadVersionControlProps) {
  const [files, setFiles] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? [])
    const validationError = fileListError(chosen)
    setError(validationError)
    setFiles(validationError ? [] : chosen)
    if (validationError && inputRef.current) inputRef.current.value = ''
  }

  const canSubmit = files.length > 0 && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      const trimmedNotes = notes.trim()
      await uploadTechPackVersion(techPackId, {
        files,
        ...(trimmedNotes !== '' ? { notes: trimmedNotes } : {}),
      })
      setFiles([])
      setNotes('')
      if (inputRef.current) inputRef.current.value = ''
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      await onChanged()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="control" onSubmit={handleSubmit}>
      <h3>Upload version</h3>
      <label>
        Files
        <input ref={inputRef} type="file" multiple onChange={handleFilesChosen} />
      </label>
      {files.length > 0 && (
        <ul>
          {files.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      )}
      <label>
        Notes <span className="muted">(optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={!canSubmit}>
        {submitting ? 'Uploading…' : `Upload v${nextVersionNumber}`}
      </button>
    </form>
  )
}
