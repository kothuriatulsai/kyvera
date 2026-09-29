import { describePending, type SignOff } from '../lib/transitions'

interface ForceConfirmationProps {
  signOff: SignOff
  stageName: string
  /** What confirming does, e.g. "force advance" or "approve anyway". */
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before overriding someone's sign-off, and says exactly what is being
 * overridden - the count and the people - rather than a generic "are you sure?".
 * The figures come from the assignments the page already shows, so they can be a
 * moment out of date; the server re-checks and refuses (409) if they are.
 */
export function ForceConfirmation({
  signOff,
  stageName,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: ForceConfirmationProps) {
  const names = signOff.pending.map((a) => a.user.name).join(', ')

  return (
    <div role="alertdialog" aria-label="Confirm override of sign-off" className="confirm">
      <p>
        <strong>{describePending(signOff)}.</strong>
      </p>
      <p>
        Still to sign off on {stageName}: {names}. Going ahead anyway overrides them, and is
        recorded against your name as a forced advance.
      </p>
      <div className="confirm-buttons">
        <button type="button" disabled={busy} onClick={onConfirm}>
          Confirm {confirmLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
