/** A debate round plus the manager's verdict that closes it. */

import type { DebateEntry } from '../lib/analysisReducer'
import { Markdown } from './Markdown'

/** Colour-codes the left rule; keyed by node name so labels stay in one place. */
const SIDE_BY_SPEAKER: Record<string, string> = {
  'Bull Researcher': 'bull',
  'Bear Researcher': 'bear',
  'Aggressive Analyst': 'aggressive',
  'Conservative Analyst': 'conservative',
  'Neutral Analyst': 'neutral',
}

interface Props {
  title: string
  entries: DebateEntry[]
  judge: string | null
  judgeTitle: string
}

export function DebatePanel({ title, entries, judge, judgeTitle }: Props) {
  if (entries.length === 0 && !judge) return null

  return (
    <article className="card" data-testid="debate-panel">
      <header className="card__header">
        <h3 className="card__title">{title}</h3>
        <span className="card__meta">{entries.length} 轮发言</span>
      </header>
      <div className="card__body">
        <div className="debate">
          {entries.map((entry, i) => (
            <div
              // Entries are append-only and never reordered, so the index is a
              // stable identity here.
              key={`${entry.speaker}-${i}`}
              className="debate__entry"
              data-side={SIDE_BY_SPEAKER[entry.speaker] ?? 'neutral'}
            >
              <div className="debate__speaker">{entry.label}</div>
              <Markdown>{entry.content}</Markdown>
            </div>
          ))}
        </div>

        {judge && (
          <>
            <h4 className="section-heading" style={{ marginTop: 'var(--space-5)' }}>
              {judgeTitle}
            </h4>
            <Markdown>{judge}</Markdown>
          </>
        )}
      </div>
    </article>
  )
}
