/**
 * Wire format of the analysis stream.
 *
 * `EVENT_TYPES` mirrors `EVENT_TYPES` in web/events.py, and
 * tests/test_web_event_contract.py fails the build if the two drift apart.
 * Keep the array a plain string literal list — that test parses this file.
 *
 * `ping` is deliberately absent: it is a transport keepalive emitted by the
 * WebSocket handler, not something the analysis produces.
 */

export const EVENT_TYPES = [
  'status',
  'node_start',
  'node_complete',
  'report',
  'debate',
  'debate_decision',
  'trader_plan',
  'decision',
  'complete',
  'error',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export interface StatusEvent {
  type: 'status'
  status: string
  message: string
}

export interface NodeStartEvent {
  type: 'node_start'
  node: string
  label: string
}

export interface NodeCompleteEvent {
  type: 'node_complete'
  node: string
  label: string
}

export interface ReportEvent {
  type: 'report'
  node: string
  label: string
  report_key: string
  content: string
}

export interface DebateEvent {
  type: 'debate'
  phase: 'investment' | 'risk'
  speaker: string
  label: string
  content: string
}

export interface DebateDecisionEvent {
  type: 'debate_decision'
  phase: 'investment' | 'risk'
  speaker: string
  label: string
  content: string
}

export interface TraderPlanEvent {
  type: 'trader_plan'
  node: string
  label: string
  content: string
}

export interface DecisionEvent {
  type: 'decision'
  content: string
}

export interface CompleteEvent {
  type: 'complete'
  signal: string
  message: string
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

export type AnalysisEvent =
  | StatusEvent
  | NodeStartEvent
  | NodeCompleteEvent
  | ReportEvent
  | DebateEvent
  | DebateDecisionEvent
  | TraderPlanEvent
  | DecisionEvent
  | CompleteEvent
  | ErrorEvent

/** Transport keepalive; carries no analysis meaning. */
export interface PingEvent {
  type: 'ping'
}

export type StreamMessage = AnalysisEvent | PingEvent

const ANALYSIS_TYPES = new Set<string>(EVENT_TYPES)

/** Narrow an untrusted parsed JSON payload to a known analysis event. */
export function isAnalysisEvent(value: unknown): value is AnalysisEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    ANALYSIS_TYPES.has((value as { type?: unknown }).type as string)
  )
}
