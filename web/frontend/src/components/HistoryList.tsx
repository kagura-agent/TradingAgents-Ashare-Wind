/** Right column: past analyses, newest first. */

import type { HistoryRow } from '../lib/api'
import { RatingBadge } from './RatingBadge'

const STATUS_TEXT: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
}

interface Props {
  rows: HistoryRow[]
  selectedId: string | null
  onSelect: (row: HistoryRow) => void
}

export function HistoryList({ rows, selectedId, onSelect }: Props) {
  if (rows.length === 0) {
    return <p className="empty">暂无历史记录</p>
  }

  return (
    <div className="history" data-testid="history-list">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="history__item"
          aria-current={row.id === selectedId}
          onClick={() => onSelect(row)}
        >
          <div className="history__row">
            <span className="history__ticker">{row.ticker}</span>
            <span className="history__date">{row.trade_date}</span>
          </div>
          <div className="history__row">
            {row.status === 'completed' && row.decision ? (
              <RatingBadge signal={row.decision} />
            ) : (
              <span className="badge" data-tone="neutral">
                {STATUS_TEXT[row.status] ?? row.status}
              </span>
            )}
            <span className="history__date">{row.created_at}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
