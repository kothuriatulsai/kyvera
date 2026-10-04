import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { TechPackDetail } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { createTechPack } from '../api/techPacks'
import { fileListError } from '../lib/attachmentValidation'

interface CreateTechPackFormProps {
  projectId: string
  /** Called with the created TechPack. The page decides what to do next. */
  onCreated: (techPack: TechPackDetail) => void
}

/** Stage 2: PRODUCT_DESIGNER or ADMIN uploads a Tech Pack. Shown only when
 * allowed - see lib/sopPermissions.ts's canCreateTechPack. */
export function CreateTechPackForm({ projectId, onCreated }: CreateTechPackFormProps) {
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
      const techPack = await createTechPack({
        projectId,
        files,
        ...(trimmedNotes !== '' ? { notes: trimmedNotes } : {}),
      })
      onCreated(techPack)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form className="control" onSubmit={handleSubmit}>
      <h3>Create tech pack</h3>
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
        {submitting ? 'Uploading…' : 'Create tech pack'}
      </button>
    </form>
  )
}
