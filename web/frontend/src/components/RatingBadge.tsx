/**
 * Rating badge.
 *
 * Renders the backend's authoritative `signal` — the value `process_signal()`
 * already extracted with the shared 5-tier parser. Guessing a rating from the
 * decision prose, as the previous UI did with a four-tier scale of its own, is
 * precisely the drift tradingagents/agents/utils/rating.py exists to prevent.
 */

import { RATING_TONE, ratingLabel, toRating } from '../lib/rating'

interface Props {
  signal: string | null | undefined
  size?: 'sm' | 'lg'
}

export function RatingBadge({ signal, size = 'sm' }: Props) {
  const rating = toRating(signal)
  const tone = rating ? RATING_TONE[rating] : 'neutral'

  return (
    <span
      className={size === 'lg' ? 'badge badge--lg' : 'badge'}
      data-tone={tone}
      data-testid="rating-badge"
    >
      {ratingLabel(signal)}
      {rating && <span className="badge__code">{rating}</span>}
    </span>
  )
}
