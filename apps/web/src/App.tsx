import { Route, Routes } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppHeader } from './components/AppHeader'
import { LoginPage } from './pages/LoginPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectListPage } from './pages/ProjectListPage'
import { ProtoRequestDetailPage } from './pages/ProtoRequestDetailPage'
import { ProtoRequestListPage } from './pages/ProtoRequestListPage'
import { TechPackDetailPage } from './pages/TechPackDetailPage'
import { UsersPage } from './pages/UsersPage'

function App() {
  return (
    <>
      <AppHeader />
      <main>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Everything else needs a logged-in user, unknown paths included, so a
              logged-out visitor is never told which paths exist. */}
          <Route element={<RequireAuth />}>
            <Route path="/" element={<ProjectListPage />} />
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/tech-packs/:id" element={<TechPackDetailPage />} />
            <Route path="/proto-requests" element={<ProtoRequestListPage />} />
            <Route path="/proto-requests/:id" element={<ProtoRequestDetailPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="*" element={<p className="muted">Page not found.</p>} />
          </Route>
        </Routes>
      </main>
    </>
  )
}

export default App
