import { useState } from 'react'
import { fetchMyTasksSilently } from '../api/tasks'
import { fetchUnreadCountSilently } from '../api/notifications'
import { usePolling } from './usePolling'

const POLL_INTERVAL_MS = 60_000

/**
 * ADR 0014: the "My tasks" nav badge and the notification bell's unread
 * count, kept fresh every 60s while the tab is visible. Only ever mounted
 * inside `AppHeader`'s `{session && ...}` branch, so it naturally stops
 * polling on logout along with everything else in there - no explicit
 * "only while logged in" check needed here.
 */
export function useBackgroundCounts() {
  const [taskCount, setTaskCount] = useState<number | null>(null)
  const [unreadCount, setUnreadCount] = useState<number | null>(null)

  usePolling(() => {
    void fetchMyTasksSilently().then((tasks) => {
      if (tasks) setTaskCount(tasks.length)
    })
    void fetchUnreadCountSilently().then((result) => {
      if (result) setUnreadCount(result.count)
    })
  }, POLL_INTERVAL_MS)

  return { taskCount, unreadCount }
}
