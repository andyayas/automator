import { normalizeName, tokenSortRatio } from './names'

type Searchable = { id: string; name: string; phone: string | null }

/**
 * Client search: every word typed must start a word of the name, or the digits
 * typed must appear in the phone. Clients in `priority` (active package or
 * approval) come first. With no hits, falls back to close spellings.
 */
export function searchClients<T extends Searchable>(
  clients: T[],
  query: string,
  priority: Set<string> = new Set(),
  limit = 50,
): { results: T[]; fuzzy: boolean; total: number } {
  const words = normalizeName(query).split(' ').filter(Boolean)
  const digits = query.replace(/\D/g, '')
  if (!words.length) return { results: [], fuzzy: false, total: 0 }

  const isPhoneQuery = digits.length >= 3 && digits.length === query.replace(/[\s+()-]/g, '').length
  const hits = clients.filter((c) => {
    if (isPhoneQuery) return (c.phone ?? '').includes(digits)
    const nameWords = normalizeName(c.name).split(' ')
    return words.every((w) => nameWords.some((n) => n.startsWith(w)))
  })
  const rank = (c: T) => (priority.has(c.id) ? 0 : 1)
  hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  if (hits.length || isPhoneQuery) return { results: hits.slice(0, limit), fuzzy: false, total: hits.length }

  const close = clients
    .map((c) => ({ c, score: tokenSortRatio(query, c.name) }))
    .filter((x) => x.score >= 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x) => x.c)
  return { results: close, fuzzy: true, total: close.length }
}
