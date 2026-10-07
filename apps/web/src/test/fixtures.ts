import type { UserSummary } from '@kyvera/shared-types'
import type { Session } from '../auth/authContext'

const SEPT_1 = '2026-09-01T00:00:00.000Z'

export const adminUser: UserSummary = {
  id: 'u-admin',
  name: 'Alex Admin',
  email: 'admin@kyvera.dev',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const financeUser: UserSummary = {
  id: 'u-finance',
  name: 'Fran Finance',
  email: 'finance@kyvera.dev',
  role: 'FINANCE',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const adminSession: Session = { token: 'tok-admin', user: adminUser }
export const financeSession: Session = { token: 'tok-finance', user: financeUser }

// ---------------------------------------------------------------------------
// SOP domain roles (ADR 0006/0007/0010 in the API) — one user/session per
// role, alongside ADMIN/FINANCE above.
// ---------------------------------------------------------------------------

export const pmoUser: UserSummary = {
  id: 'u-pmo',
  name: 'Priya PMO',
  email: 'pmo@kyvera.dev',
  role: 'PMO',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const productDesignerUser: UserSummary = {
  id: 'u-designer',
  name: 'Deepa Designer',
  email: 'designer@kyvera.dev',
  role: 'PRODUCT_DESIGNER',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const engineeringUser: UserSummary = {
  id: 'u-engineering',
  name: 'Emre Engineering',
  email: 'engineering@kyvera.dev',
  role: 'ENGINEERING',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const managementUser: UserSummary = {
  id: 'u-management',
  name: 'Mira Management',
  email: 'management@kyvera.dev',
  role: 'MANAGEMENT',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const merchandiserUser: UserSummary = {
  id: 'u-merchandiser',
  name: 'Milo Merchandiser',
  email: 'merchandiser@kyvera.dev',
  role: 'MERCHANDISER',
  isActive: true,
  mustChangePassword: false,
  createdAt: SEPT_1,
}

export const pmoSession: Session = { token: 'tok-pmo', user: pmoUser }
export const productDesignerSession: Session = { token: 'tok-designer', user: productDesignerUser }
export const engineeringSession: Session = { token: 'tok-engineering', user: engineeringUser }
export const managementSession: Session = { token: 'tok-management', user: managementUser }
export const merchandiserSession: Session = { token: 'tok-merchandiser', user: merchandiserUser }

/** Every role that must see no SOP-domain action anywhere. Screens import
 * this and filter out whichever role(s) the action under test *does* allow. */
export const ALL_SESSIONS: Session[] = [
  adminSession,
  financeSession,
  pmoSession,
  productDesignerSession,
  engineeringSession,
  managementSession,
  merchandiserSession,
]
