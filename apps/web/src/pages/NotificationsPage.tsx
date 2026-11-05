import type { Notification } from '@kyvera/shared-types'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: Notification[]; nextCursor: string | null }

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

/** ADR 0014: the full notification history, newest first, behind the bell.
 * Clicking one marks it read and navigates to where it points; "Mark all
 * as read" clears every unread one for this viewer only. */
export function NotificationsPage() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const navigate = useNavigate()

  // Initial state is already 'loading' - no need to set it again here, just
  // to resolve it once the first page arrives.
  useEffect(() => {
    fetchMyNotifications().then(
      (page) => setState({ status: 'success', items: page.items, nextCursor: page.nextCursor }),
      (err: unknown) => setState({ status: 'error', message: messageOf(err) }),
    )
  }, [])

  async function loadMore() {
    if (state.status !== 'success' || state.nextCursor === null) return
    setLoadingMore(true)
    try {
      const page = await fetchMyNotifications(state.nextCursor)
      setState({ status: 'success', items: [...state.items, ...page.items], nextCursor: page.nextCursor })
    } finally {
      setLoadingMore(false)
    }
  }

  async function openNotification(notification: Notification) {
    if (!notification.readAt) {
      await markNotificationRead(notification.id)
      if (state.status === 'success') {
        setState({
          ...state,
          items: state.items.map((n) =>
            n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        })
      }
    }
    navigate(notification.link)
  }

  async function markAllRead() {
    await markAllNotificationsRead()
    if (state.status === 'success') {
      setState({ ...state, items: state.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) })
    }
  }

  return (
    <section>
      <h1>Notifications</h1>

      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <>
          <button type="button" onClick={markAllRead} disabled={state.items.every((n) => n.readAt)}>
            Mark all as read
          </button>
          {state.items.length === 0 ? (
            <p className="muted">No notifications yet.</p>
          ) : (
            <ul className="notification-list">
              {state.items.map((notification) => (
                <li key={notification.id} className={notification.readAt ? 'read' : 'unread'}>
                  <button type="button" className="link-button" onClick={() => openNotification(notification)}>
                    {notification.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.nextCursor !== null && (
            <button type="button" onClick={loadMore} disabled={loadingMore}>
              Load more
            </button>
          )}
        </>
      )}
    </section>
  )
}
