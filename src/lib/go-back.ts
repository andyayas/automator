import { useNavigate } from 'react-router'

/** True when an earlier page of this app is in the browser history (react-router numbers its entries). */
export function canGoBack(): boolean {
  const state = window.history.state as { idx?: unknown } | null
  return typeof state?.idx === 'number' && state.idx > 0
}

/**
 * Back to the page she came from; when there is none (a link opened fresh),
 * to `fallback`, the page's usual parent.
 */
export function useGoBack() {
  const navigate = useNavigate()
  return (fallback: string) => {
    if (canGoBack()) void navigate(-1)
    else void navigate(fallback, { replace: true })
  }
}
