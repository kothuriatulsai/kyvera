import { Route, Routes } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { RequireRole } from './auth/RequireRole'
import { useAuth } from './auth/useAuth'
import { AppHeader } from './components/AppHeader'
import { IdleWarningBanner } from './components/IdleWarningBanner'
import { NotFoundPage } from './components/NotFoundPage'
import { AccountPage } from './pages/AccountPage'
import { LoginPage } from './pages/LoginPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectListPage } from './pages/ProjectListPage'
import { ProtoRequestDetailPage } from './pages/ProtoRequestDetailPage'
import { ProtoRequestListPage } from './pages/ProtoRequestListPage'
import { TechPackDetailPage } from './pages/TechPackDetailPage'
import { UsersPage } from './pages/UsersPage'

function RoleChangeBanner() {
  const { roleChangeNotice, dismissRoleChangeNotice } = useAuth()
  if (!roleChangeNotice) return null
  return (
    <p className="notice">
      {roleChangeNotice}{' '}
      <button type="button" className="link-button" onClick={dismissRoleChangeNotice}>
        Dismiss
      </button>
    </p>
  )
}

function App() {
  return (
    <>
      <AppHeader />
      <main>
        <RoleChangeBanner />
        <IdleWarningBanner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Everything else needs a logged-in user, unknown paths included, so a
              logged-out visitor is never told which paths exist. */}
          <Route element={<RequireAuth />}>
            <Route path="/" element={<ProjectListPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/tech-packs/:id" element={<TechPackDetailPage />} />
            <Route path="/proto-requests" element={<ProtoRequestListPage />} />
            <Route path="/proto-requests/:id" element={<ProtoRequestDetailPage />} />
            <Route
              path="/users"
              element={
                <RequireRole role="ADMIN">
                  <UsersPage />
                </RequireRole>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </main>
    </>
  )
}

export default App
