import { useState, type FormEvent } from 'react'
import type { Project } from '@kyvera/shared-types'
import { ApiError } from '../api/client'
import { createProject } from '../api/projects'

interface NewProjectFormProps {
  /** Called with the created Project. The page decides what to do next. */
  onCreated: (project: Project) => void
}

/** Stage 1: PMO or ADMIN starts a new Project. Shown only to those roles - see lib/sopPermissions.ts. */
export function NewProjectForm({ onCreated }: NewProjectFormProps) {
  const [name, setName] = useState('')
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  const trimmedProductName = productName.trim()
  const canSubmit = trimmedName !== '' && trimmedProductName !== '' && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      const trimmedCategory = productCategory.trim()
      const project = await createProject({
        name: trimmedName,
        productName: trimmedProductName,
        ...(trimmedCategory !== '' ? { productCategory: trimmedCategory } : {}),
      })
      onCreated(project)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form className="control" onSubmit={handleSubmit}>
      <h3>New project</h3>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Product
        <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} />
      </label>
      <label>
        Category <span className="muted">(optional)</span>
        <input type="text" value={productCategory} onChange={(e) => setProductCategory(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={!canSubmit}>
        {submitting ? 'Creating…' : 'Create project'}
      </button>
    </form>
  )
}
