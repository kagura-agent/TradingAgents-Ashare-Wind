import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { HistoryList } from './components/HistoryList'
import { ResultView } from './components/ResultView'
import { RunControls } from './components/RunControls'
import { Timeline } from './components/Timeline'
import { useAnalysisStream } from './hooks/useAnalysisStream'
import { TIMELINE_NODES, type Stage } from './lib/nodes'
import {
  fetchHistory,
  fetchHistoryDetail,
  fetchMeta,
  startAnalysis,
  type HistoryRow,
} from './lib/api'
import { EMPTY_VIEW, viewFromHistory, viewFromState, type ResultView as View } from './lib/view'
import './styles/app.css'

export default function App() {
  const { state, connection, watch, reset, markStarting } = useAnalysisStream()
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [archived, setArchived] = useState<View | null>(null)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedStages, setExpandedStages] = useState<Set<Stage>>(new Set())

  const refreshHistory = useCallback(() => {
    fetchHistory().then(setHistory).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshHistory()
    fetchMeta().then((meta) => setDemo(meta.demo)).catch(() => undefined)
  }, [refreshHistory])

  // A finished run belongs in the history list straight away.
  useEffect(() => {
    if (state.runStatus === 'completed' || state.runStatus === 'failed') refreshHistory()
  }, [state.runStatus, refreshHistory])

  const toggleStage = useCallback((stage: Stage) => {
    setExpandedStages((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
    // Scroll to the stage section in the main content area
    setTimeout(() => {
      const el = document.getElementById(`stage-${stage}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  // Auto-expand the stage of any currently-running node.
  useEffect(() => {
    if (archived) return
    const running = Object.entries(state.nodes).filter(([, s]) => s === 'running')
    if (running.length === 0) return
    setExpandedStages((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const [node] of running) {
        const tn = TIMELINE_NODES.find((t) => t.node === node)
        if (tn && !next.has(tn.stage)) {
          next.add(tn.stage)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [state.nodes, archived])

  // Auto-expand risk stage on completion (final decision).
  useEffect(() => {
    if (archived) return
    if (state.runStatus === 'completed') {
      setExpandedStages((prev) => {
        if (prev.has('risk')) return prev
        return new Set(prev).add('risk')
      })
    }
  }, [state.runStatus, archived])

  // Expand all stages when viewing archived results.
  useEffect(() => {
    if (archived) {
      setExpandedStages(new Set<Stage>(['analysis', 'research', 'trading', 'risk']))
    }
  }, [archived])

  const handleStart = useCallback(
    async (ticker: string, date: string) => {
      setError(null)
      setArchived(null)
      setExpandedStages(new Set())
      reset()
      markStarting()
      try {
        const { job_id } = await startAnalysis(ticker, date)
        setSelectedId(job_id)
        watch(job_id)
        refreshHistory()
      } catch (err) {
        reset()
        setError(err instanceof Error ? err.message : '启动分析失败')
      }
    },
    [markStarting, refreshHistory, reset, watch],
  )

  const handleSelectHistory = useCallback(
    async (row: HistoryRow) => {
      setError(null)
      setSelectedId(row.id)
      if (row.status === 'running') {
        // Still live: rejoin the stream and let replay rebuild the view.
        setArchived(null)
        setExpandedStages(new Set())
        reset()
        watch(row.id)
        return
      }
      watch(null)
      try {
        const detail = await fetchHistoryDetail(row.id)
        setArchived(detail.result ? viewFromHistory(detail.result) : EMPTY_VIEW)
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取历史记录失败')
      }
    },
    [reset, watch],
  )

  const liveView = useMemo(() => viewFromState(state), [state])
  const view = archived ?? liveView
  const busy = state.runStatus === 'starting' || state.runStatus === 'running'
  const hasContent =
    view.reports.length > 0 ||
    view.investmentDebate.length > 0 ||
    view.riskDebate.length > 0 ||
    view.traderPlan !== null ||
    view.decision !== null

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          TradingAgents
          <span>A 股实时分析</span>
        </div>
        {demo && (
          <span className="badge" data-tone="lean-bullish">
            演示模式
          </span>
        )}
        <div className="header__spacer" />
        <RunControls busy={busy} onSubmit={handleStart} />
        <ConnectionBadge state={connection} />
      </header>

      <div className="app__body">
        <aside className="app__column app__column--timeline">
          <Timeline
            nodes={archived ? {} : state.nodes}
            expandedStages={expandedStages}
            onToggleStage={toggleStage}
          />
        </aside>

        <main className="app__column app__column--main">
          {error && <div className="alert">{error}</div>}
          {state.error && <div className="alert">{state.error}</div>}

          {!archived && state.statusMessage && (
            <p className="status-line">{state.statusMessage}</p>
          )}

          {hasContent ? (
            <ResultView view={view} expandedStages={expandedStages} onToggleStage={toggleStage} />
          ) : (
            <p className="empty">
              输入股票代码与交易日期，点击「开始分析」；分析过程会实时显示在这里。
            </p>
          )}
        </main>

        <aside className="app__column app__column--history">
          <h2 className="section-heading">历史记录</h2>
          <HistoryList rows={history} selectedId={selectedId} onSelect={handleSelectHistory} />
        </aside>
      </div>
    </div>
  )
}
