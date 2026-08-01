/** One analyst report, rendered as Markdown. */

import { Markdown } from './Markdown'

interface Props {
  title: string
  label: string
  content: string
}

export function ReportCard({ title, label, content }: Props) {
  return (
    <article className="card" data-testid="report-card">
      <header className="card__header">
        <h3 className="card__title">{title}</h3>
        <span className="card__meta">{label}</span>
      </header>
      <div className="card__body">
        <Markdown>{content}</Markdown>
      </div>
    </article>
  )
}
