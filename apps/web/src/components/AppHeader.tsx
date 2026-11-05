import { NavLink } from 'react-router'
import type { Session } from '../auth/authContext'
import { useAuth } from '../auth/useAuth'
import { useBackgroundCounts } from '../hooks/useBackgroundCounts'
import { NotificationBell } from './NotificationBell'

/**
 * Split out from `AppHeader` so `useBackgroundCounts`'s polling only ever
 * mounts once a `session` exists, and stops (unmounts) on logout - it's
 * conditionally *rendered*, not conditionally called, since hooks can't be
 * conditional themselves.
 */
function AuthedNav({ session, logout }: { session: Session; logout: () => void }) {
  const { taskCount, unreadCount } = useBackgroundCounts()

  return (
    <>
      <nav>
        <NavLink to="/">My tasks{taskCount ? ` (${taskCount})` : ''}</NavLink>
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/proto-requests">Proto Requests</NavLink>
        {session.user.role === 'ADMIN' && <NavLink to="/users">Users</NavLink>}
      </nav>
      <div className="account">
        <NotificationBell unreadCount={unreadCount} />
        <span>
          {session.user.name} <span className="muted">({session.user.role.toLowerCase()})</span>
        </span>
        <NavLink to="/account">My account</NavLink>
        <button type="button" className="link-button" onClick={logout}>
          Log out
        </button>
      </div>
    </>
  )
}

export function AppHeader() {
  const { session, logout } = useAuth()

  return (
    <header className="app-header">
      <span className="brand">Kyvera</span>
      {session && <AuthedNav session={session} logout={logout} />}
    </header>
  )
}
