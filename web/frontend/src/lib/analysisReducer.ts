/**
 * Pure reducer over the analysis event stream.
 *
 * The server replays a job's entire event history to every new subscriber, so
 * a client that reconnects mid-run receives everything it has already seen.
 * That is what makes reconnection safe — but only if applying the stream twice
 * is a no-op.
 *
 * The mechanism is an applied-event count. Replay is a stable prefix: event #k
 * is always the same event, so on reconnect the first `applied` messages are
 * skipped and the state picks up exactly where it left off. No diffing, no
 * flash of empty UI, and no reliance on content being unique.
 */

import type { AnalysisEvent } from '../types/events'

export type NodeStatus = 'pending' | 'running' | 'done'
export type RunStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed'

export interface DebateEntry {
  speaker: string
  label: string
  content: string
}

export interface ReportEntry {
  key: string
  node: string
  label: string
  content: string
  summary?: string
}

export interface AnalysisState {
  /** Number of stream events already folded in; the replay-skip counter. */
  applied: number
  runStatus: RunStatus
  statusMessage: string
  nodes: Record<string, NodeStatus>
  reports: Record<string, ReportEntry>
  investmentDebate: DebateEntry[]
  investmentJudge: string | null
  investmentJudgeSummary: string | null
  traderPlan: string | null
  traderPlanSummary: string | null
  riskDebate: DebateEntry[]
  riskJudge: string | null
  riskJudgeSummary: string | null
  decision: string | null
  decisionSummary: string | null
  signal: string | null
  error: string | null
}

export const initialAnalysisState: AnalysisState = {
  applied: 0,
  runStatus: 'idle',
  statusMessage: '',
  nodes: {},
  reports: {},
  investmentDebate: [],
  investmentJudge: null,
  investmentJudgeSummary: null,
  traderPlan: null,
  traderPlanSummary: null,
  riskDebate: [],
  riskJudge: null,
  riskJudgeSummary: null,
  decision: null,
  decisionSummary: null,
  signal: null,
  error: null,
}

export type AnalysisAction =
  /** A stream message at zero-based position `index` within the connection. */
  | { kind: 'event'; index: number; event: AnalysisEvent }
  /** A new job was started; drop everything. */
  | { kind: 'reset' }
  | { kind: 'starting' }

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.kind) {
    case 'reset':
      return initialAnalysisState
    case 'starting':
      return { ...initialAnalysisState, runStatus: 'starting', statusMessage: '正在提交分析任务…' }
    case 'event':
      // Already-seen prefix of a replay: nothing to do.
      if (action.index < state.applied) return state
      return { ...applyEvent(state, action.event), applied: action.index + 1 }
  }
}

function applyEvent(state: AnalysisState, event: AnalysisEvent): AnalysisState {
  switch (event.type) {
    case 'status':
      return {
        ...state,
        runStatus: state.runStatus === 'completed' || state.runStatus === 'failed'
          ? state.runStatus
          : 'running',
        statusMessage: event.message,
      }

    case 'node_start':
      return { ...state, nodes: { ...state.nodes, [event.node]: 'running' } }

    case 'node_complete':
      return { ...state, nodes: { ...state.nodes, [event.node]: 'done' } }

    case 'report':
      return {
        ...state,
        reports: {
          ...state.reports,
          [event.report_key]: {
            key: event.report_key,
            node: event.node,
            label: event.label,
            content: event.content,
            summary: event.summary,
          },
        },
      }

    case 'debate': {
      const entry: DebateEntry = {
        speaker: event.speaker,
        label: event.label,
        content: event.content,
      }
      return event.phase === 'risk'
        ? { ...state, riskDebate: [...state.riskDebate, entry] }
        : { ...state, investmentDebate: [...state.investmentDebate, entry] }
    }

    case 'debate_decision':
      return event.phase === 'risk'
        ? { ...state, riskJudge: event.content, riskJudgeSummary: event.summary || null }
        : { ...state, investmentJudge: event.content, investmentJudgeSummary: event.summary || null }

    case 'trader_plan':
      return { ...state, traderPlan: event.content, traderPlanSummary: event.summary || null }

    case 'decision':
      return { ...state, decision: event.content, decisionSummary: event.summary || null }

    case 'complete':
      return {
        ...state,
        runStatus: 'completed',
        signal: event.signal,
        statusMessage: event.message,
        // A finished run leaves nothing running.
        nodes: Object.fromEntries(
          Object.entries(state.nodes).map(([node, status]) => [
            node,
            status === 'running' ? 'done' : status,
          ]),
        ),
      }

    case 'error':
      return { ...state, runStatus: 'failed', error: event.message }
  }
}

/** Whether the run has reached a terminal state and the socket can close. */
export function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed'
}
