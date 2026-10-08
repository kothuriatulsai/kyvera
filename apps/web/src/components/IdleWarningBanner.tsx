import { useAuth } from '../auth/useAuth'

/**
 * ADR 0012: shown once idle time is within a minute of ending the session.
 * A static notice, not a live countdown - a ticking clock would need its
 * own recurring timer just for cosmetics, which is exactly the kind of
 * polling this feature otherwise goes out of its way to avoid.
 */
export function IdleWarningBanner() {
  const { idleWarningVisible, staySignedIn } = useAuth()
  if (!idleWarningVisible) return null

  return (
    <p className="notice" role="alert">
      You&rsquo;ll be logged out in about a minute due to inactivity.{' '}
      <button type="button" className="link-button" onClick={staySignedIn}>
        Stay signed in
      </button>
    </p>
  )
}
