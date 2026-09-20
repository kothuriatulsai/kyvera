import { Route, Routes } from 'react-router'
import { RequireAuth } from './auth/RequireAuth'
import { AppHeader } from './components/AppHeader'
import { DelayedPage } from './pages/DelayedPage'
import { LoginPage } from './pages/LoginPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { ProductListPage } from './pages/ProductListPage'

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
            <Route path="/" element={<ProductListPage />} />
            <Route path="/delayed" element={<DelayedPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="*" element={<p className="muted">Page not found.</p>} />
          </Route>
        </Routes>
      </main>
    </>
  )
}

export default App
