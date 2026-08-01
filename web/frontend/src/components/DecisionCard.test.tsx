import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DecisionCard } from './DecisionCard'
import { RATINGS_5_TIER, RATING_LABELS, RATING_TONE } from '../lib/rating'

describe('DecisionCard', () => {
  it.each(RATINGS_5_TIER)('renders the backend signal %s with its label and tone', (signal) => {
    render(<DecisionCard decision="正文" signal={signal} />)

    const badge = screen.getByTestId('rating-badge')
    expect(badge).toHaveTextContent(RATING_LABELS[signal])
    expect(badge).toHaveTextContent(signal)
    expect(badge).toHaveAttribute('data-tone', RATING_TONE[signal])
    expect(screen.getByTestId('decision-card')).toHaveAttribute('data-tone', RATING_TONE[signal])
  })

  it('trusts the signal over the wording of the decision', () => {
    // The old UI scanned the prose for 买入/卖出 on a four-tier scale of its own.
    // Prose like this — a Sell that opens by quoting the bull case — is exactly
    // what it got wrong.
    render(<DecisionCard decision="多头主张强烈买入，但估值已透支。" signal="Sell" />)

    const badge = screen.getByTestId('rating-badge')
    expect(badge).toHaveTextContent('卖出')
    expect(badge).not.toHaveTextContent('买入')
    expect(badge).toHaveAttribute('data-tone', 'bearish')
  })

  it('admits ignorance rather than inventing a rating', () => {
    render(<DecisionCard decision="正文" signal="Strong Buy" />)

    const badge = screen.getByTestId('rating-badge')
    expect(badge).toHaveTextContent('未知')
    expect(badge).toHaveAttribute('data-tone', 'neutral')
    // No rating means no code chip either.
    expect(badge.querySelector('.badge__code')).toBeNull()
  })

  it('still renders the decision when no signal has arrived', () => {
    render(<DecisionCard decision={'## 结论\n\n观望。'} signal={null} />)

    expect(screen.getByTestId('rating-badge')).toHaveTextContent('未知')
    expect(screen.getByRole('heading', { level: 2, name: '结论' })).toBeInTheDocument()
  })

  it('renders the decision body as Markdown', () => {
    render(<DecisionCard decision={'| 项 | 值 |\n| --- | --- |\n| 仓位 | 三成 |'} signal="Hold" />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '三成' })).toBeInTheDocument()
  })
})
