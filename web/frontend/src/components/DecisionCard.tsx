/** The final call: rating badge plus the portfolio manager's reasoning. */

import { RATING_TONE, toRating } from '../lib/rating'
import { Markdown } from './Markdown'
import { RatingBadge } from './RatingBadge'

interface Props {
  decision: string
  signal: string | null
}

export function DecisionCard({ decision, signal }: Props) {
  const rating = toRating(signal)

  return (
    <article
      className="card decision"
      data-tone={rating ? RATING_TONE[rating] : 'neutral'}
      data-testid="decision-card"
    >
      <header className="decision__head">
        <RatingBadge signal={signal} size="lg" />
        <div>
          <h3 className="card__title">最终决策</h3>
          <p className="card__meta" style={{ margin: 0 }}>
            由组合经理在风控辩论后给出
          </p>
        </div>
      </header>
      <div className="card__body">
        <Markdown>{decision}</Markdown>
      </div>
    </article>
  )
}
