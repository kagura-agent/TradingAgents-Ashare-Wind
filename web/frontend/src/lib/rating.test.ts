import { describe, expect, it } from 'vitest'
import { RATINGS_5_TIER, RATING_LABELS, RATING_TONE, ratingLabel, toRating } from './rating'

describe('rating', () => {
  it('covers the canonical 5-tier scale', () => {
    // Pinned against tradingagents/agents/utils/rating.py by
    // tests/test_web_event_contract.py; asserted here too so a local edit fails
    // the frontend suite without waiting for pytest.
    expect(RATINGS_5_TIER).toEqual(['Buy', 'Overweight', 'Hold', 'Underweight', 'Sell'])
    expect(Object.keys(RATING_LABELS)).toEqual([...RATINGS_5_TIER])
    expect(Object.keys(RATING_TONE)).toEqual([...RATINGS_5_TIER])
  })

  it('maps every rating to a distinct Chinese label and tone', () => {
    expect(Object.values(RATING_LABELS)).toEqual(['买入', '增持', '持有', '减持', '卖出'])
    expect(new Set(Object.values(RATING_TONE)).size).toBe(RATINGS_5_TIER.length)
  })

  it('normalises case and surrounding whitespace', () => {
    expect(toRating('overweight')).toBe('Overweight')
    expect(toRating('  SELL  ')).toBe('Sell')
  })

  it('returns null for anything it does not recognise', () => {
    // Never silently fall back to Hold: an invented rating is worse than 未知.
    expect(toRating('强烈买入')).toBeNull()
    expect(toRating('Strong Buy')).toBeNull()
    expect(toRating('')).toBeNull()
    expect(toRating(null)).toBeNull()
    expect(toRating(undefined)).toBeNull()
  })

  it('labels unknown signals as 未知', () => {
    expect(ratingLabel('Buy')).toBe('买入')
    expect(ratingLabel('HOLD')).toBe('持有')
    expect(ratingLabel('nonsense')).toBe('未知')
    expect(ratingLabel(null)).toBe('未知')
  })
})
