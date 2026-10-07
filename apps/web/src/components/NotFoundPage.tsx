/** Shared by the catch-all route and `RequireRole` (ADR 0011, point 3): a
 * role-restricted page a visitor can't use looks exactly like one that
 * doesn't exist, rather than naming the restriction. */
export function NotFoundPage() {
  return <p className="muted">Page not found.</p>
}
