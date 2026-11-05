import type { NotificationPage } from '@kyvera/shared-types'
import { apiGet, apiGetSilent, apiPost } from './client'

const enc = encodeURIComponent

export const fetchMyNotifications = (cursor?: string) =>
  apiGet<NotificationPage>(cursor ? `/me/notifications?cursor=${enc(cursor)}` : '/me/notifications')

export const fetchUnreadCount = () => apiGet<{ count: number }>('/me/notifications/unread-count')

/** ADR 0014: the bell badge's background poll - see `apiGetSilent` for why
 * this must not go through the normal 401/refresh path. */
export const fetchUnreadCountSilently = () => apiGetSilent<{ count: number }>('/me/notifications/unread-count')

export const markNotificationRead = (id: string) => apiPost<void>(`/me/notifications/${enc(id)}/read`)

export const markAllNotificationsRead = () => apiPost<void>('/me/notifications/read-all')
