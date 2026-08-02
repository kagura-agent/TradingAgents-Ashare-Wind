/** Full-page view for a single timeline node's content. */

import { SLUG_TO_REPORT_KEY } from '../lib/nodeContent'
import type { ResultView as ResultViewModel } from '../lib/view'
import { DecisionCard } from './DecisionCard'
import { Markdown } from './Markdown'
import { ReportCard } from './ReportCard'

interface Props {
  slug: string
  view: ResultViewModel
}

export function NodeDetail({ slug, view }: Props) {
  const content = renderNodeContent(slug, view)

  return (
    <div className="node-detail">
      {content ?? <p className="empty">暂无内容</p>}
    </div>
  )
}

function renderNodeContent(slug: string, view: ResultViewModel) {
  // --- Analyst report nodes ---
  const reportKey = SLUG_TO_REPORT_KEY[slug]
  if (reportKey) {
    const report = view.reports.find((r) => r.key === reportKey)
    if (!report) return null
    return (
      <ReportCard title={report.title} label={report.label} content={report.content} />
    )
  }

  // --- Research debate nodes ---
  if (slug === 'bull-researcher') {
    const entries = view.investmentDebate.filter((e) => e.speaker.includes('Bull'))
    if (entries.length === 0) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">多头研究员论点</h3>
          <span className="card__meta">{entries.length} 轮发言</span>
        </header>
        <div className="card__body">
          <div className="debate">
            {entries.map((entry, i) => (
              <div key={`bull-${i}`} className="debate__entry" data-side="bull">
                <div className="debate__speaker">{entry.label}</div>
                <Markdown>{entry.content}</Markdown>
              </div>
            ))}
          </div>
        </div>
      </article>
    )
  }

  if (slug === 'bear-researcher') {
    const entries = view.investmentDebate.filter((e) => e.speaker.includes('Bear'))
    if (entries.length === 0) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">空头研究员论点</h3>
          <span className="card__meta">{entries.length} 轮发言</span>
        </header>
        <div className="card__body">
          <div className="debate">
            {entries.map((entry, i) => (
              <div key={`bear-${i}`} className="debate__entry" data-side="bear">
                <div className="debate__speaker">{entry.label}</div>
                <Markdown>{entry.content}</Markdown>
              </div>
            ))}
          </div>
        </div>
      </article>
    )
  }

  if (slug === 'research-manager') {
    if (!view.investmentJudge) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">研究主管裁决</h3>
        </header>
        <div className="card__body">
          <Markdown>{view.investmentJudge}</Markdown>
        </div>
      </article>
    )
  }

  // --- Trading node ---
  if (slug === 'trader') {
    if (!view.traderPlan) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">交易计划</h3>
          <span className="card__meta">交易员</span>
        </header>
        <div className="card__body">
          <Markdown>{view.traderPlan}</Markdown>
        </div>
      </article>
    )
  }

  // --- Risk debate nodes ---
  if (slug === 'aggressive-analyst') {
    const entries = view.riskDebate.filter((e) => e.speaker.includes('Aggressive'))
    if (entries.length === 0) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">激进风控观点</h3>
          <span className="card__meta">{entries.length} 轮发言</span>
        </header>
        <div className="card__body">
          <div className="debate">
            {entries.map((entry, i) => (
              <div key={`aggressive-${i}`} className="debate__entry" data-side="aggressive">
                <div className="debate__speaker">{entry.label}</div>
                <Markdown>{entry.content}</Markdown>
              </div>
            ))}
          </div>
        </div>
      </article>
    )
  }

  if (slug === 'conservative-analyst') {
    const entries = view.riskDebate.filter((e) => e.speaker.includes('Conservative'))
    if (entries.length === 0) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">保守风控观点</h3>
          <span className="card__meta">{entries.length} 轮发言</span>
        </header>
        <div className="card__body">
          <div className="debate">
            {entries.map((entry, i) => (
              <div key={`conservative-${i}`} className="debate__entry" data-side="conservative">
                <div className="debate__speaker">{entry.label}</div>
                <Markdown>{entry.content}</Markdown>
              </div>
            ))}
          </div>
        </div>
      </article>
    )
  }

  if (slug === 'neutral-analyst') {
    const entries = view.riskDebate.filter((e) => e.speaker.includes('Neutral'))
    if (entries.length === 0) return null
    return (
      <article className="card">
        <header className="card__header">
          <h3 className="card__title">中性风控观点</h3>
          <span className="card__meta">{entries.length} 轮发言</span>
        </header>
        <div className="card__body">
          <div className="debate">
            {entries.map((entry, i) => (
              <div key={`neutral-${i}`} className="debate__entry" data-side="neutral">
                <div className="debate__speaker">{entry.label}</div>
                <Markdown>{entry.content}</Markdown>
              </div>
            ))}
          </div>
        </div>
      </article>
    )
  }

  // --- Portfolio Manager (final decision) ---
  if (slug === 'portfolio-manager') {
    if (!view.decision) return null
    return <DecisionCard decision={view.decision} signal={view.signal} />
  }

  return null
}
