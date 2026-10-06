import { NavLink } from 'react-router'
import { useAuth } from '../auth/useAuth'

export function AppHeader() {
  const { session, logout } = useAuth()

  return (
    <header className="app-header">
      <span className="brand">Kyvera</span>
      {session && (
        <>
          <nav>
            <NavLink to="/projects">Projects</NavLink>
            <NavLink to="/proto-requests">Proto Requests</NavLink>
          </nav>
          <div className="account">
            <span>
              {session.user.name} <span className="muted">({session.user.role.toLowerCase()})</span>
            </span>
            <button type="button" className="link-button" onClick={logout}>
              Log out
            </button>
          </div>
        </>
      )}
    </header>
  )
}
