/**
 * The execution timeline shown in the left column.
 *
 * Mirrors `TIMELINE_NODES` and `NODE_LABELS` in web/events.py; the labels are
 * duplicated so the timeline can render every step as "pending" before the run
 * emits anything. tests/test_web_event_contract.py pins both against Python.
 *
 * `stage` groups the nodes into the four phases the UI draws dividers between,
 * and `STAGE_SHAPES` records how each phase is actually wired in the graph —
 * see the topology notes above `STAGE_SHAPES` itself.
 */

export type Stage = 'analysis' | 'research' | 'trading' | 'risk'

/**
 * Whether a node argues inside its stage or rules on it.
 *
 * "Research Manager" and "Portfolio Manager" are not a third and fourth
 * debater: in tradingagents/graph/conditional_logic.py they are the targets the
 * debate loop exits *to*, once the turn counter hits its bound. Rendering them
 * level with the debaters is what makes the sidebar read as a flat queue.
 */
export type NodeRole = 'participant' | 'judge'

export interface TimelineNode {
  node: string
  label: string
  stage: Stage
  slug: string
  role: NodeRole
}

export const STAGE_LABELS: Record<Stage, string> = {
  analysis: '分析师团队',
  research: '研究团队',
  trading: '交易执行',
  risk: '风控与决策',
}

/**
 * How each stage is wired in tradingagents/graph/setup.py.
 *
 * The six analysts are chained one after another there, but only as an
 * implementation choice — no analyst reads another's report, so the stage is
 * a fan-out in every sense but its execution order. The two debates really are
 * cycles: `should_continue_debate` sends Bull and Bear back at each other, and
 * `should_continue_risk_analysis` rotates the three risk seats, until a turn
 * counter lets them out. Neither fact is recoverable from a flat list.
 */
export type StageShape = 'parallel' | 'debate' | 'round-robin' | 'linear'

export const STAGE_SHAPES: Record<Stage, StageShape> = {
  analysis: 'parallel',
  research: 'debate',
  trading: 'linear',
  risk: 'round-robin',
}

/** Static description of a stage's wiring, shown before a run produces turns. */
export const STAGE_SHAPE_HINT: Record<StageShape, string> = {
  parallel: '并行',
  debate: '多空往返辩论',
  'round-robin': '三方轮转',
  linear: '',
}

/** Verb used when reporting how many rounds a cyclic stage has completed. */
const STAGE_ROUND_VERB: Partial<Record<StageShape, string>> = {
  debate: '已辩论',
  'round-robin': '已轮转',
}

// Each entry must stay on ONE line: tests/test_web_event_contract.py parses this
// array line-by-line to pin it against web/events.py, and skips any line that
// does not start with `{`. Wrapping an entry makes it silently disappear from
// the comparison.
export const TIMELINE_NODES: readonly TimelineNode[] = [
  { node: 'Market Analyst', label: '市场分析师', stage: 'analysis', slug: 'market-analyst', role: 'participant' },
  { node: 'Sentiment Analyst', label: '舆情分析师', stage: 'analysis', slug: 'sentiment-analyst', role: 'participant' },
  { node: 'News Analyst', label: '新闻分析师', stage: 'analysis', slug: 'news-analyst', role: 'participant' },
  { node: 'Fundamentals Analyst', label: '基本面分析师', stage: 'analysis', slug: 'fundamentals-analyst', role: 'participant' },
  { node: 'Annual Report Analyst', label: '年报分析师', stage: 'analysis', slug: 'annual-report-analyst', role: 'participant' },
  { node: 'Industry Chain Analyst', label: '产业链分析师', stage: 'analysis', slug: 'industry-chain-analyst', role: 'participant' },
  { node: 'Bull Researcher', label: '多头研究员', stage: 'research', slug: 'bull-researcher', role: 'participant' },
  { node: 'Bear Researcher', label: '空头研究员', stage: 'research', slug: 'bear-researcher', role: 'participant' },
  { node: 'Research Manager', label: '研究主管', stage: 'research', slug: 'research-manager', role: 'judge' },
  { node: 'Trader', label: '交易员', stage: 'trading', slug: 'trader', role: 'participant' },
  { node: 'Aggressive Analyst', label: '激进风控', stage: 'risk', slug: 'aggressive-analyst', role: 'participant' },
  { node: 'Conservative Analyst', label: '保守风控', stage: 'risk', slug: 'conservative-analyst', role: 'participant' },
  { node: 'Neutral Analyst', label: '中性风控', stage: 'risk', slug: 'neutral-analyst', role: 'participant' },
  { node: 'Portfolio Manager', label: '组合经理', stage: 'risk', slug: 'portfolio-manager', role: 'judge' },
]

/** Nodes of a stage, split into the ones that argue and the ones that rule. */
export function stageNodes(stage: Stage, role: NodeRole): TimelineNode[] {
  return TIMELINE_NODES.filter((n) => n.stage === stage && n.role === role)
}

/**
 * How many turns each speaker has taken, keyed by graph node name.
 *
 * Only meaningful for a live run: a stored run collapses each speaker's whole
 * history into a single entry (see `viewFromHistory` in lib/view.ts), so
 * counting those would report one turn no matter how many rounds actually ran.
 */
export function countTurns(entries: readonly { speaker: string }[]): Record<string, number> {
  const turns: Record<string, number> = {}
  for (const { speaker } of entries) {
    turns[speaker] = (turns[speaker] ?? 0) + 1
  }
  return turns
}

/**
 * Rounds completed in a cyclic stage, or `null` where the notion is meaningless.
 *
 * A round is one pass through every participant, so the count rounds up: with
 * three risk seats, a fourth turn means round two is under way.
 */
export function stageRounds(stage: Stage, turns: Record<string, number>): number | null {
  if (!STAGE_ROUND_VERB[STAGE_SHAPES[stage]]) return null

  const participants = stageNodes(stage, 'participant')
  const taken = participants.reduce((sum, n) => sum + (turns[n.node] ?? 0), 0)
  if (taken === 0) return null

  return Math.ceil(taken / participants.length)
}

/** The chip shown beside a stage heading: its wiring, or its progress so far. */
export function stageHint(stage: Stage, turns?: Record<string, number>): string {
  const shape = STAGE_SHAPES[stage]
  const rounds = turns ? stageRounds(stage, turns) : null
  if (rounds === null) return STAGE_SHAPE_HINT[shape]
  return `${STAGE_ROUND_VERB[shape]} ${rounds} 轮`
}

/** Look up a timeline node by its URL slug. */
export function nodeBySlug(slug: string): TimelineNode | undefined {
  return TIMELINE_NODES.find((n) => n.slug === slug)
}

/** Set of all valid node slugs for route validation. */
export const VALID_SLUGS = new Set(TIMELINE_NODES.map((n) => n.slug))

/** Report state key -> section heading, in the order reports are produced. */
export const REPORT_SECTIONS: readonly { key: string; title: string }[] = [
  { key: 'market_report', title: '市场分析' },
  { key: 'sentiment_report', title: '舆情分析' },
  { key: 'news_report', title: '新闻分析' },
  { key: 'fundamentals_report', title: '基本面分析' },
  { key: 'annual_report', title: '年报分析' },
  { key: 'industry_report', title: '产业链分析' },
]
