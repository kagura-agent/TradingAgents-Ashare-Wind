/** Centre column body: reports, debates, plan and decision, in run order. */

import type { Stage } from '../lib/nodes'
import type { ResultView as ResultViewModel } from '../lib/view'
import { DebatePanel } from './DebatePanel'
import { DecisionCard } from './DecisionCard'
import { Markdown } from './Markdown'
import { ReportCard } from './ReportCard'

interface Props {
  view: ResultViewModel
  expandedStages: Set<Stage>
}

function CollapseWrap({
  expanded,
  children,
}: {
  expanded: boolean
  children: React.ReactNode
}) {
  return (
    <div className="stage-collapse" data-expanded={expanded}>
      <div className="stage-collapse__inner">{children}</div>
    </div>
  )
}

export function ResultView({ view, expandedStages }: Props) {
  const hasAnalysis = view.reports.length > 0
  const hasResearch = view.investmentDebate.length > 0 || view.investmentJudge !== null
  const hasTrading = view.traderPlan !== null
  const hasRisk =
    view.riskDebate.length > 0 || view.riskJudge !== null || view.decision !== null

  return (
    <div className="result-view">
      {hasAnalysis && (
        <CollapseWrap expanded={expandedStages.has('analysis')}>
          {view.reports.map((report) => (
            <ReportCard
              key={report.key}
              title={report.title}
              label={report.label}
              content={report.content}
            />
          ))}
        </CollapseWrap>
      )}

      {hasResearch && (
        <CollapseWrap expanded={expandedStages.has('research')}>
          <DebatePanel
            title="投资辩论"
            entries={view.investmentDebate}
            judge={view.investmentJudge}
            judgeTitle="研究主管裁决"
          />
        </CollapseWrap>
      )}

      {hasTrading && (
        <CollapseWrap expanded={expandedStages.has('trading')}>
          <article className="card" data-testid="trader-plan">
            <header className="card__header">
              <h3 className="card__title">交易计划</h3>
              <span className="card__meta">交易员</span>
            </header>
            <div className="card__body">
              <Markdown>{view.traderPlan!}</Markdown>
            </div>
          </article>
        </CollapseWrap>
      )}

      {hasRisk && (
        <CollapseWrap expanded={expandedStages.has('risk')}>
          <DebatePanel
            title="风控辩论"
            entries={view.riskDebate}
            judge={view.riskJudge}
            judgeTitle="组合经理裁决"
          />

          {view.decision && <DecisionCard decision={view.decision} signal={view.signal} />}
        </CollapseWrap>
      )}
    </div>
  )
}
