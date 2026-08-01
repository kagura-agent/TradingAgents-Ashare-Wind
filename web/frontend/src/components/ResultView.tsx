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
  onToggleStage: (stage: Stage) => void
}

function CollapseWrap({
  stage,
  title,
  expanded,
  onToggle,
  children,
}: {
  stage: Stage
  title: string
  expanded: boolean
  onToggle: (stage: Stage) => void
  children: React.ReactNode
}) {
  return (
    <section className="stage-section" id={`stage-${stage}`}>
      <button
        type="button"
        className="stage-section__header"
        onClick={() => onToggle(stage)}
        aria-expanded={expanded}
      >
        <span className="stage-section__chevron" data-open={expanded || undefined} aria-hidden="true">▶</span>
        <h3 className="stage-section__title">{title}</h3>
      </button>
      <div className="stage-collapse" data-expanded={expanded}>
        <div className="stage-collapse__inner">{children}</div>
      </div>
    </section>
  )
}

export function ResultView({ view, expandedStages, onToggleStage }: Props) {
  const hasAnalysis = view.reports.length > 0
  const hasResearch = view.investmentDebate.length > 0 || view.investmentJudge !== null
  const hasTrading = view.traderPlan !== null
  const hasRisk =
    view.riskDebate.length > 0 || view.riskJudge !== null || view.decision !== null

  return (
    <div className="result-view">
      {hasAnalysis && (
        <CollapseWrap stage="analysis" title="📊 分析师团队" expanded={expandedStages.has('analysis')} onToggle={onToggleStage}>
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
        <CollapseWrap stage="research" title="⚔️ 投资辩论" expanded={expandedStages.has('research')} onToggle={onToggleStage}>
          <DebatePanel
            title="投资辩论"
            entries={view.investmentDebate}
            judge={view.investmentJudge}
            judgeTitle="研究主管裁决"
          />
        </CollapseWrap>
      )}

      {hasTrading && (
        <CollapseWrap stage="trading" title="💹 交易计划" expanded={expandedStages.has('trading')} onToggle={onToggleStage}>
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
        <CollapseWrap stage="risk" title="🛡️ 风控与决策" expanded={expandedStages.has('risk')} onToggle={onToggleStage}>
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
