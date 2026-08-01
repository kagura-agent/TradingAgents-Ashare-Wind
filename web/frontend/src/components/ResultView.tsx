/** Centre column body: reports, debates, plan and decision, in run order. */

import type { ResultView as ResultViewModel } from '../lib/view'
import { DebatePanel } from './DebatePanel'
import { DecisionCard } from './DecisionCard'
import { Markdown } from './Markdown'
import { ReportCard } from './ReportCard'

export function ResultView({ view }: { view: ResultViewModel }) {
  return (
    <>
      {view.reports.map((report) => (
        <ReportCard
          key={report.key}
          title={report.title}
          label={report.label}
          content={report.content}
        />
      ))}

      <DebatePanel
        title="投资辩论"
        entries={view.investmentDebate}
        judge={view.investmentJudge}
        judgeTitle="研究主管裁决"
      />

      {view.traderPlan && (
        <article className="card" data-testid="trader-plan">
          <header className="card__header">
            <h3 className="card__title">交易计划</h3>
            <span className="card__meta">交易员</span>
          </header>
          <div className="card__body">
            <Markdown>{view.traderPlan}</Markdown>
          </div>
        </article>
      )}

      <DebatePanel
        title="风控辩论"
        entries={view.riskDebate}
        judge={view.riskJudge}
        judgeTitle="组合经理裁决"
      />

      {view.decision && <DecisionCard decision={view.decision} signal={view.signal} />}
    </>
  )
}
