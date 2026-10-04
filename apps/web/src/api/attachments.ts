import { apiGetBlob } from './client'

const enc = encodeURIComponent

/**
 * Downloads an attachment and saves it as `filename`. The token lives only in
 * memory (see client.ts), so a plain `<a href="/attachments/:id/download">`
 * can't carry it - this fetches with the auth header instead and saves the
 * resulting blob through a throwaway link.
 */
export async function downloadAttachment(id: string, filename: string): Promise<void> {
  const blob = await apiGetBlob(`/attachments/${enc(id)}/download`)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // The browser reads the blob asynchronously after the click, so revoking
  // the URL immediately can race it still reading from it. A short deferred
  // revoke avoids pulling the URL out from under an in-progress download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
