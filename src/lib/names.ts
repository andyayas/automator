// Name normalization and matching, shared by every import.
//
// Matching order (CLAUDE.md): exact alias -> exact name -> fuzzy token-sort
// ratio >= 0.85 against known clients. Every confirmed match is saved as an
// alias by the caller, so a variant only has to be fixed once.

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** "jane  DOE" -> "Jane Doe", but leaves mixed-case names as typed. */
export function displayName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim()
  const isOneCase = name === name.toLowerCase() || name === name.toUpperCase()
  if (!isOneCase) return name
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** Similarity in [0, 1] of two strings: 1 - indel distance / total length (as rapidfuzz `ratio`). */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  return (2 * lcsLength(a, b)) / (a.length + b.length)
}

/** `ratio` after sorting the words, so "doe jane" matches "jane doe". */
export function tokenSortRatio(a: string, b: string): number {
  const sort = (s: string) => normalizeName(s).split(' ').filter(Boolean).sort().join(' ')
  return ratio(sort(a), sort(b))
}

export const FUZZY_THRESHOLD = 0.85

export type Candidate = { id: string; name: string }
export type NameMatch =
  | { kind: 'alias' | 'exact'; id: string; score: 1 }
  | { kind: 'fuzzy'; id: string; score: number; ambiguousWith?: string }
  | { kind: 'none'; best?: { id: string; score: number } }

/**
 * Builds a matcher over known clients. `aliases` maps normalized alias -> client id.
 * A fuzzy match is reported as ambiguous when a second client scores within 0.02.
 */
export function createNameMatcher(candidates: Candidate[], aliases: Map<string, string> = new Map()) {
  const byName = new Map<string, string>()
  const prepared = candidates.map((c) => {
    const normalized = normalizeName(c.name)
    if (!byName.has(normalized)) byName.set(normalized, c.id)
    return { id: c.id, sorted: normalized.split(' ').filter(Boolean).sort().join(' ') }
  })

  return function match(rawName: string): NameMatch {
    const normalized = normalizeName(rawName)
    if (!normalized) return { kind: 'none' }
    const aliasId = aliases.get(normalized)
    if (aliasId) return { kind: 'alias', id: aliasId, score: 1 }
    const exactId = byName.get(normalized)
    if (exactId) return { kind: 'exact', id: exactId, score: 1 }

    const sorted = normalized.split(' ').sort().join(' ')
    let best: { id: string; score: number } | undefined
    let second: { id: string; score: number } | undefined
    for (const c of prepared) {
      // Cheap length bound: ratio can't reach the threshold if lengths differ too much.
      const maxPossible = (2 * Math.min(sorted.length, c.sorted.length)) / (sorted.length + c.sorted.length)
      if (maxPossible < FUZZY_THRESHOLD) continue
      const score = ratio(sorted, c.sorted)
      if (!best || score > best.score) {
        second = best
        best = { id: c.id, score }
      } else if (!second || score > second.score) {
        second = { id: c.id, score }
      }
    }
    if (!best || best.score < FUZZY_THRESHOLD) return { kind: 'none', best }
    const ambiguous = second && second.score >= FUZZY_THRESHOLD && best.score - second.score < 0.02
    return { kind: 'fuzzy', id: best.id, score: best.score, ...(ambiguous ? { ambiguousWith: second!.id } : {}) }
  }
}

function lcsLength(a: string, b: string): number {
  let prev = new Uint16Array(b.length + 1)
  let curr = new Uint16Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}
