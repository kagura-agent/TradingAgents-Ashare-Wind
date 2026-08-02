/**
 * All four rooms at once — the whole firm on one floor.
 *
 * The per-team offices answer "what is this team doing"; this answers "where is
 * the work right now", which is the question you have while a run is going. It
 * is the view the app lands on, and it never navigates away on its own: rooms
 * light up as the run reaches them and stay lit, bubbles appear over the people
 * who have spoken and stay up, so the eye follows the work without the page
 * moving under whatever you were reading.
 *
 * Rooms are sized to their teams rather than laid out on an even grid — six
 * analysts across the top, the debate and the trading desk sharing the middle,
 * risk along the bottom — so the picture matches the shape of the org. Each is
 * a full `Office` in `compact` mode, not a reimplementation of it.
 */

import type { NodeStatus } from '../lib/analysisReducer'
import { OFFICE_ICON, OFFICE_LABEL, STAGES, type Stage } from '../lib/nodes'
import type { ResultView } from '../lib/view'
import { Office } from './Office'

interface Props {
  nodes: Record<string, NodeStatus>
  view: ResultView
  /** Per-speaker turn counts; omitted for an archived run (see App). */
  turns?: Record<string, number>
  onSelectNode: (slug: string) => void
  onSelectStage: (stage: Stage) => void
}

export function Floorplan({ nodes, view, turns, onSelectNode, onSelectStage }: Props) {
  return (
    <section className="floorplan" aria-label={OFFICE_LABEL}>
      <header className="floorplan__header">
        <span className="floorplan__icon" aria-hidden="true">
          {OFFICE_ICON}
        </span>
        <h2 className="floorplan__title">{OFFICE_LABEL}</h2>
        <span className="floorplan__hint">点团队名进房间，点工位看完整内容</span>
      </header>

      <div className="floorplan__rooms">
        {STAGES.map((stage) => (
          <Office
            key={stage}
            stage={stage}
            nodes={nodes}
            view={view}
            turns={turns}
            onSelectNode={onSelectNode}
            onOpenStage={onSelectStage}
            compact
          />
        ))}
      </div>
    </section>
  )
}
