import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './useAuth'

/**
 * Wraps every route that needs a logged-in user. Anyone else is sent to the login
 * page, remembering where they were headed so login can take them back.
 */
export function RequireAuth() {
  const { session, notice } = useAuth()
  const location = useLocation()

  if (!session) {
    // Remember where they were headed so login can take them back - except after a
    // deliberate logout, when the next person to log in shouldn't land on the last
    // person's page. (An expired session does keep it: same person, same task.)
    const from = notice === 'signed-out' ? undefined : location
    return <Navigate to="/login" replace state={{ from }} />
  }
  return <Outlet />
}
