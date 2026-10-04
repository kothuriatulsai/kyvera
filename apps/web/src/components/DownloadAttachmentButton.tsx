import { useState } from 'react'
import type { Attachment } from '@kyvera/shared-types'
import { downloadAttachment } from '../api/attachments'
import { ApiError } from '../api/client'

interface DownloadAttachmentButtonProps {
  attachment: Attachment
}

/** A button, never a plain `<a href>` - the access token lives only in
 * memory (see api/client.ts), so downloading has to carry it as a header on
 * a real fetch, which a browser navigation can't do. */
export function DownloadAttachmentButton({ attachment }: DownloadAttachmentButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    try {
      await downloadAttachment(attachment.id, attachment.originalName)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not download this file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="link-button" disabled={busy} onClick={handleClick}>
        {attachment.originalName}
      </button>
      {error && (
        <span role="alert" className="error">
          {' '}
          {error}
        </span>
      )}
    </>
  )
}
