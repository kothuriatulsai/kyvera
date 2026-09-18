import { NavLink, Route, Routes } from 'react-router'
import { DelayedPage } from './pages/DelayedPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { ProductListPage } from './pages/ProductListPage'

function App() {
  return (
    <>
      <header className="app-header">
        <span className="brand">Kyvera</span>
        <nav>
          <NavLink to="/" end>
            Products
          </NavLink>
          <NavLink to="/delayed">Delayed</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<ProductListPage />} />
          <Route path="/delayed" element={<DelayedPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
    </>
  )
}

export default App
