import { useState } from 'react'
import { ApiError } from '../api/client'
import { confirmTechPackVersion } from '../api/techPacks'

interface ConfirmControlProps {
  techPackId: string
  versionNumber: number
  onChanged: () => Promise<void>
}

/** ENGINEERING confirms the latest version, shown only while it's unconfirmed. */
export function ConfirmControl({ techPackId, versionNumber, onChanged }: ConfirmControlProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    try {
      await confirmTechPackVersion(techPackId, versionNumber)
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="control">
      <h3>Confirm</h3>
      <p className="muted">Confirms v{versionNumber} is ready for Management's decision.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={handleClick}>
        {busy ? 'Confirming…' : `Confirm v${versionNumber}`}
      </button>
    </div>
  )
}
