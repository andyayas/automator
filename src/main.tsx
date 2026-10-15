import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { queryClient } from './lib/queries'
import { routes } from './routes'
import './styles.css'

// After a deploy, a page that was already open may ask for code files that no
// longer exist. Reload once to pick up the new version (the flag stops a loop
// if a file is genuinely missing).
const RELOAD_FLAG = 'reloaded-for-update'
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    // Storage unavailable (private mode); nothing to clear.
  }
}, 10_000)

const router = createHashRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
