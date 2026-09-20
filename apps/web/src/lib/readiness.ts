import type { ReadinessHint } from '@kyvera/shared-types'

function opensIn(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return 'any day now'
  return `in ~${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * Words for the server's readiness hint. The hint is all an assignee is told about
 * when their stage happens; this only phrases it, it never works anything out.
 */
export function describeReadiness(hint: ReadinessHint): string {
  switch (hint.state) {
    case 'completed':
      return 'Completed'
    case 'open_now':
      return 'Open now'
    case 'up_next':
      return `You're up next: opens ${opensIn(hint.opensInDays)}`
    case 'upcoming':
      return `Opens ${opensIn(hint.opensInDays)}`
  }
}
