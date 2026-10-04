import type {
  AssigneeProductDetail,
  AssigneeProductSummary,
  AssigneeStageDetail,
  ProductDelay,
  ProductDetail,
  ProductListItem,
  StageDefinition,
  UserSummary,
} from '@kyvera/shared-types'
import type { Session } from '../auth/authContext'

const SEPT_1 = '2026-09-01T00:00:00.000Z'

export const adminUser: UserSummary = {
  id: 'u-admin',
  name: 'Alex Admin',
  email: 'admin@kyvera.dev',
  role: 'ADMIN',
  createdAt: SEPT_1,
}

export const engineerUser: UserSummary = {
  id: 'u-eng',
  name: 'Eli Engineer',
  email: 'engineer@kyvera.dev',
  role: 'ENGINEER',
  createdAt: SEPT_1,
}

export const ownerUser: UserSummary = {
  id: 'u-owner',
  name: 'Dana Owner',
  email: 'owner@kyvera.dev',
  role: 'MANAGER',
  createdAt: SEPT_1,
}

export const financeUser: UserSummary = {
  id: 'u-finance',
  name: 'Fran Finance',
  email: 'finance@kyvera.dev',
  role: 'FINANCE',
  createdAt: SEPT_1,
}

export const adminSession: Session = { token: 'tok-admin', user: adminUser }
export const engineerSession: Session = { token: 'tok-eng', user: engineerUser }
export const managerSession: Session = { token: 'tok-owner', user: ownerUser }
export const financeSession: Session = { token: 'tok-finance', user: financeUser }

// ---------------------------------------------------------------------------
// SOP domain roles (ADR 0006/0007 in the API) — one user/session per role,
// alongside the old module's above (ADMIN/MANAGER/ENGINEER/FINANCE are
// shared; MANAGER/ENGINEER themselves have no SOP-domain meaning).
// ---------------------------------------------------------------------------

export const pmoUser: UserSummary = {
  id: 'u-pmo',
  name: 'Priya PMO',
  email: 'pmo@kyvera.dev',
  role: 'PMO',
  createdAt: SEPT_1,
}

export const productDesignerUser: UserSummary = {
  id: 'u-designer',
  name: 'Deepa Designer',
  email: 'designer@kyvera.dev',
  role: 'PRODUCT_DESIGNER',
  createdAt: SEPT_1,
}

export const engineeringUser: UserSummary = {
  id: 'u-engineering',
  name: 'Emre Engineering',
  email: 'engineering@kyvera.dev',
  role: 'ENGINEERING',
  createdAt: SEPT_1,
}

export const managementUser: UserSummary = {
  id: 'u-management',
  name: 'Mira Management',
  email: 'management@kyvera.dev',
  role: 'MANAGEMENT',
  createdAt: SEPT_1,
}

export const merchandiserUser: UserSummary = {
  id: 'u-merchandiser',
  name: 'Milo Merchandiser',
  email: 'merchandiser@kyvera.dev',
  role: 'MERCHANDISER',
  createdAt: SEPT_1,
}

export const pmoSession: Session = { token: 'tok-pmo', user: pmoUser }
export const productDesignerSession: Session = { token: 'tok-designer', user: productDesignerUser }
export const engineeringSession: Session = { token: 'tok-engineering', user: engineeringUser }
export const managementSession: Session = { token: 'tok-management', user: managementUser }
export const merchandiserSession: Session = { token: 'tok-merchandiser', user: merchandiserUser }

/** Every role that must see no SOP-domain action anywhere: the legacy roles
 * plus the SOP roles that aren't the one being tested. Screens import this
 * and filter out whichever role(s) the action under test *does* allow. */
export const ALL_SESSIONS: Session[] = [
  adminSession,
  managerSession,
  engineerSession,
  financeSession,
  pmoSession,
  productDesignerSession,
  engineeringSession,
  managementSession,
  merchandiserSession,
]

/** The whole workflow. An assignee must never see any name here but their own. */
export const ALL_STAGE_NAMES = [
  'Requirement',
  'Initial Design',
  'Engineering',
  'Review',
  'Prototype',
  'Testing',
  'Modification',
  'Final Review',
  'Approval',
]

export const stages: StageDefinition[] = ALL_STAGE_NAMES.map((name, index) => ({
  id: `s${index + 1}`,
  name,
  sequenceOrder: index + 1,
  expectedDurationDays: 5,
}))

// ---------------------------------------------------------------------------
// The full view: admin, owner or assigned manager
// ---------------------------------------------------------------------------

export function fullProduct(id: string, name: string, overrides: Partial<ProductListItem> = {}) {
  const product: ProductListItem = {
    id,
    name,
    description: null,
    ownerId: ownerUser.id,
    owner: ownerUser,
    currentStageId: stages[0].id,
    currentStage: stages[0],
    currentVersion: 1,
    view: 'full',
    access: 'ADMIN',
    status: 'ON_TRACK',
    delay: {
      delayed: false,
      totalDelayDays: 0,
      expectedCompletionDate: '2026-11-01T00:00:00.000Z',
    },
    startDate: SEPT_1,
    expectedCompletionDate: '2026-11-01T00:00:00.000Z',
    actualCompletionDate: null,
    createdAt: SEPT_1,
    ...overrides,
  }
  return product
}

export const onTimeProduct = fullProduct('p-ok', 'Steady Widget')
export const lateProduct = fullProduct('p-late', 'Overdue Gadget', {
  status: 'DELAYED',
  delay: {
    delayed: true,
    totalDelayDays: 4,
    expectedCompletionDate: '2026-11-05T00:00:00.000Z',
  },
})

export const lateDelay: ProductDelay = {
  view: 'full',
  expectedCompletionDate: '2026-11-05T00:00:00.000Z',
  totalDelayDays: 4,
  delayed: true,
  stages: [
    { sequenceOrder: 1, status: 'in_progress', durationDays: 9, expectedDurationDays: 5, delayDays: 4, delayed: true },
    ...stages.slice(1).map((s) => ({
      sequenceOrder: s.sequenceOrder,
      status: 'not_started' as const,
      durationDays: 5,
      expectedDurationDays: 5,
      delayDays: 0,
      delayed: false,
    })),
  ],
}

export const lateDetail: ProductDetail = {
  ...lateProduct,
  versions: [
    {
      id: 'v1',
      productId: 'p-late',
      versionNumber: 1,
      spec: 'first spec',
      createdAt: SEPT_1,
      createdById: ownerUser.id,
      createdBy: ownerUser,
    },
  ],
  stageHistory: [
    {
      id: 'h1',
      productId: 'p-late',
      stageId: 's1',
      stage: stages[0],
      enteredAt: SEPT_1,
      exitedAt: null,
      actualDurationDays: null,
      delayed: false,
      delayReason: null,
      responsibleUserId: ownerUser.id,
      responsibleUser: ownerUser,
      exitedById: null,
      forcedExit: false,
    },
  ],
  approvals: [],
  assignments: [
    {
      id: 'a1',
      productId: 'p-late',
      stageId: 's2',
      stage: stages[1],
      userId: engineerUser.id,
      user: engineerUser,
      assignedAt: SEPT_1,
      assignedById: adminUser.id,
      assignedBy: adminUser,
      readyAt: null,
    },
  ],
  progressNotes: [
    {
      id: 'n1',
      productId: 'p-late',
      stageId: 's2',
      userId: engineerUser.id,
      user: { id: engineerUser.id, name: engineerUser.name },
      note: 'Waiting on the housing supplier',
      createdAt: SEPT_1,
    },
  ],
}

// ---------------------------------------------------------------------------
// The assignee view: only their own stage, and nothing else
// ---------------------------------------------------------------------------

export function assigneeStage(overrides: Partial<AssigneeStageDetail> = {}): AssigneeStageDetail {
  return {
    assignmentId: 'a1',
    stage: { id: 's2', name: 'Initial Design', expectedDurationDays: 7 },
    readyAt: null,
    readiness: { state: 'open_now', opensInDays: null },
    delay: null,
    history: [],
    notes: [],
    ...overrides,
  }
}

export function assigneeDetail(
  stage: Partial<AssigneeStageDetail> = {},
  overrides: Partial<AssigneeProductDetail> = {},
): AssigneeProductDetail {
  return {
    view: 'assignee',
    access: 'ASSIGNEE',
    id: 'p-assigned',
    name: 'Assigned Gadget',
    description: null,
    stages: [assigneeStage(stage)],
    ...overrides,
  }
}

export function assigneeSummary(stage: Partial<AssigneeStageDetail> = {}): AssigneeProductSummary {
  const { history, notes, ...summaryStage } = assigneeStage(stage)
  void history
  void notes
  return {
    view: 'assignee',
    access: 'ASSIGNEE',
    id: 'p-assigned',
    name: 'Assigned Gadget',
    description: null,
    stages: [summaryStage],
  }
}
