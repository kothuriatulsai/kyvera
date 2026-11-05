import type { Task } from '@kyvera/shared-types'
import { apiGet, apiGetSilent } from './client'

export const fetchMyTasks = () => apiGet<Task[]>('/me/tasks')

/** ADR 0014: the nav badge's background poll - see `apiGetSilent` for why
 * this must not go through the normal 401/refresh path. */
export const fetchMyTasksSilently = () => apiGetSilent<Task[]>('/me/tasks')
