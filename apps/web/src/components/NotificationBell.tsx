import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Notification } from '@kyvera/shared-types'
import { fetchMyNotifications, markNotificationRead } from '../api/notifications'

interface NotificationBellProps {
  unreadCount: number | null
}

/**
 * ADR 0014: a bell showing the live-polled unread count (`unreadCount`,
 * from `useBackgroundCounts`); opening the dropdown fetches the first page
 * of real notifications through the normal `apiGet` path (a deliberate user
 * action, not the silent background poll). Clicking one marks it read and
 * navigates to its link.
 */
export function NotificationBell({ unreadCount }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[] | null>(null)
  const navigate = useNavigate()

  async function toggle() {
    if (!open && items === null) {
      const page = await fetchMyNotifications()
      setItems(page.items)
    }
    setOpen((was) => !was)
  }

  async function openNotification(notification: Notification) {
    setOpen(false)
    if (!notification.readAt) {
      await markNotificationRead(notification.id)
    }
    navigate(notification.link)
  }

  return (
    <div className="notification-bell">
      <button type="button" className="link-button" onClick={toggle} aria-expanded={open}>
        Notifications{unreadCount ? ` (${unreadCount})` : ''}
      </button>
      {open && (
        <div className="notification-dropdown">
          {items === null ? (
            <p className="muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="muted">No notifications yet.</p>
          ) : (
            <ul>
              {items.map((notification) => (
                <li key={notification.id} className={notification.readAt ? 'read' : 'unread'}>
                  <button type="button" className="link-button" onClick={() => openNotification(notification)}>
                    {notification.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/notifications" onClick={() => setOpen(false)}>
            View all
          </Link>
        </div>
      )}
    </div>
  )
}
