/**
 * The canonical 5-tier rating vocabulary.
 *
 * This mirrors `RATINGS_5_TIER` in tradingagents/agents/utils/rating.py, whose
 * module docstring says centralising the scale "avoids drift between those call
 * sites". A frontend that re-derives a rating by scanning the decision text —
 * as the previous implementation did, and with a four-tier scale at that — is
 * exactly the drift it warns about. The badge below renders the authoritative
 * `signal` the backend already sends on the `complete` event.
 *
 * tests/test_web_event_contract.py asserts this list matches Python's.
 */

export const RATINGS_5_TIER = [
  'Buy',
  'Overweight',
  'Hold',
  'Underweight',
  'Sell',
] as const

export type Rating = (typeof RATINGS_5_TIER)[number]

export const RATING_LABELS: Record<Rating, string> = {
  Buy: '买入',
  Overweight: '增持',
  Hold: '持有',
  Underweight: '减持',
  Sell: '卖出',
}

/** Tone token driving the badge colour; see styles/tokens.css. */
export const RATING_TONE: Record<Rating, 'bullish' | 'lean-bullish' | 'neutral' | 'lean-bearish' | 'bearish'> = {
  Buy: 'bullish',
  Overweight: 'lean-bullish',
  Hold: 'neutral',
  Underweight: 'lean-bearish',
  Sell: 'bearish',
}

const BY_LOWER = new Map(RATINGS_5_TIER.map((r) => [r.toLowerCase(), r]))

/**
 * Normalise a backend signal to a known rating.
 *
 * Returns null for anything unrecognised so the UI can say "未知" instead of
 * inventing a rating — silently defaulting to Hold would be worse than
 * admitting ignorance.
 */
export function toRating(signal: string | null | undefined): Rating | null {
  if (!signal) return null
  return BY_LOWER.get(signal.trim().toLowerCase()) ?? null
}

export function ratingLabel(signal: string | null | undefined): string {
  const rating = toRating(signal)
  return rating ? RATING_LABELS[rating] : '未知'
}
