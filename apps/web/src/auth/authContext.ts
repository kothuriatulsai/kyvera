import type { UserSummary } from '@kyvera/shared-types'
import { createContext } from 'react'

export interface Session {
  token: string
  user: UserSummary
}

/** Why the visitor is looking at the login page, when it isn't a fresh visit. */
export type LoginNotice = 'expired' | 'signed-out' | null

export interface AuthContextValue {
  /** Null when logged out. Held in memory only, so a hard refresh clears it. */
  session: Session | null
  notice: LoginNotice
  /** Set after a background resync (a 403, or regaining window focus) finds
   * the caller's role changed from what the session already had. */
  roleChangeNotice: string | null
  dismissRoleChangeNotice: () => void
  /** Rejects with an `ApiError` on bad credentials or an unreachable API. */
  login: (email: string, password: string) => Promise<void>
  /** Clears the in-memory token. There is no server-side revocation to call. */
  logout: () => void
  /** Replaces the session's user object - after the user changes their own
   * password, or after a background resync picks up fresher data. */
  applyUserUpdate: (user: UserSummary) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
