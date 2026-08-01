/** Full-page view for a single analysis stage. */

import type { Stage } from '../lib/nodes'
import { STAGE_LABELS } from '../lib/nodes'
import type { ResultView as ResultViewModel } from '../lib/view'
import { DebatePanel } from './DebatePanel'
import { DecisionCard } from './DecisionCard'
import { Markdown } from './Markdown'
import { ReportCard } from './ReportCard'

interface Props {
  stage: Stage
  view: ResultViewModel
  onBack: () => void
}

const STAGE_ICONS: Record<Stage, string> = {
  analysis: '📊',
  research: '⚔️',
  trading: '💹',
  risk: '🛡️',
}

export function StageDetail({ stage, view, onBack }: Props) {
  return (
    <div className="stage-detail">
      <button type="button" className="stage-detail__back" onClick={onBack}>
        ← 返回总览
      </button>
      <h2 className="stage-detail__title">
        {STAGE_ICONS[stage]} {STAGE_LABELS[stage]}
      </h2>

      <div className="stage-detail__content">
        {stage === 'analysis' && (
          view.reports.length > 0 ? (
            view.reports.map((report) => (
              <ReportCard
                key={report.key}
                title={report.title}
                label={report.label}
                content={report.content}
              />
            ))
          ) : (
            <p className="empty">暂无分析报告</p>
          )
        )}

        {stage === 'research' && (
          view.investmentDebate.length > 0 || view.investmentJudge ? (
            <DebatePanel
              title="投资辩论"
              entries={view.investmentDebate}
              judge={view.investmentJudge}
              judgeTitle="研究主管裁决"
            />
          ) : (
            <p className="empty">暂无辩论内容</p>
          )
        )}

        {stage === 'trading' && (
          view.traderPlan ? (
            <article className="card">
              <header className="card__header">
                <h3 className="card__title">交易计划</h3>
                <span className="card__meta">交易员</span>
              </header>
              <div className="card__body">
                <Markdown>{view.traderPlan}</Markdown>
              </div>
            </article>
          ) : (
            <p className="empty">暂无交易计划</p>
          )
        )}

        {stage === 'risk' && (
          <>
            {(view.riskDebate.length > 0 || view.riskJudge) && (
              <DebatePanel
                title="风控辩论"
                entries={view.riskDebate}
                judge={view.riskJudge}
                judgeTitle="组合经理裁决"
              />
            )}
            {view.decision && <DecisionCard decision={view.decision} signal={view.signal} />}
            {!view.riskDebate.length && !view.riskJudge && !view.decision && (
              <p className="empty">暂无风控决策</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
