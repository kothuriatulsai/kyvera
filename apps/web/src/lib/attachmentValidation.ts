import { ALLOWED_ATTACHMENT_EXTENSIONS, isAllowedAttachmentExtension, MAX_ATTACHMENT_SIZE_BYTES } from '@kyvera/shared-types'

const MAX_SIZE_MB = MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)

/**
 * The same rule the API's `attachmentUpload` middleware enforces (same
 * shared-types constants, so the two can't drift) - checked here first, by
 * every upload form, so a disallowed file never leaves the browser.
 */
export function fileListError(files: File[]): string | null {
  if (files.length === 0) return 'Select at least one file.'
  for (const file of files) {
    if (!isAllowedAttachmentExtension(file.name)) {
      return `${file.name} has a file type that is not allowed. Allowed types: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}.`
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return `${file.name} exceeds the maximum upload size (${MAX_SIZE_MB} MB).`
    }
  }
  return null
}
