import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { HistoryList } from './components/HistoryList'
import { NodeDetail } from './components/NodeDetail'
import { Office } from './components/Office'
import { RunControls } from './components/RunControls'
import { Timeline } from './components/Timeline'
import { useAnalysisStream } from './hooks/useAnalysisStream'
import { nodeHasContent } from './lib/nodeContent'
import { STAGE_LABELS, TIMELINE_NODES, countTurns, nodeBySlug, type Stage } from './lib/nodes'
import { hashFor, parseHash, type Selection } from './lib/route'
import {
  fetchHistory,
  fetchHistoryDetail,
  fetchMeta,
  startAnalysis,
  type HistoryRow,
} from './lib/api'
import { EMPTY_VIEW, viewFromHistory, viewFromState, type ResultView as View } from './lib/view'
import './styles/app.css'

/** The stage a run is currently inside, or `null` if nothing is running. */
function runningStage(nodes: Record<string, string>): Stage | null {
  const active = TIMELINE_NODES.find((n) => nodes[n.node] === 'running')
  return active?.stage ?? null
}

export default function App() {
  const { state, connection, watch, reset, markStarting } = useAnalysisStream()
  const [historyList, setHistoryList] = useState<HistoryRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => parseHash(window.location.hash).jobId)
  const [archived, setArchived] = useState<View | null>(null)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(
    () => parseHash(window.location.hash).selection,
  )

  const refreshHistory = useCallback(() => {
    fetchHistory().then(setHistoryList).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshHistory()
    fetchMeta().then((meta) => setDemo(meta.demo)).catch(() => undefined)
  }, [refreshHistory])

  useEffect(() => {
    if (state.runStatus === 'completed' || state.runStatus === 'failed') refreshHistory()
  }, [state.runStatus, refreshHistory])

  // Sync URL when selection changes. replaceState, so clicking around a run
  // does not fill the back button with a trail of desks.
  useEffect(() => {
    const next = hashFor(selectedId, selection)
    if (window.location.hash !== next) {
      history.replaceState(null, '', next || window.location.pathname)
    }
  }, [selectedId, selection])

  // Restore from URL on page load (for history entries)
  useEffect(() => {
    const { jobId } = parseHash(window.location.hash)
    if (jobId && !selectedId) {
      setSelectedId(jobId)
      // Try to load from history
      fetchHistoryDetail(jobId).then((detail) => {
        if (detail.result) setArchived(viewFromHistory(detail.result))
      }).catch(() => undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Land in an office rather than on a blank panel: whichever team is working
  // right now, or the analysts, who are always where a run begins.
  useEffect(() => {
    if (selection) return
    setSelection({ kind: 'stage', stage: runningStage(state.nodes) ?? 'analysis' })
  }, [state.nodes, selection])

  const handleSelectNode = useCallback((slug: string) => {
    setSelection({ kind: 'node', slug })
  }, [])

  const handleSelectStage = useCallback((stage: Stage) => {
    setSelection({ kind: 'stage', stage })
  }, [])

  const handleStart = useCallback(
    async (ticker: string, date: string) => {
      setError(null)
      setArchived(null)
      setSelection(null)
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
      setSelection(null)
      if (row.status === 'running') {
        setArchived(null)
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

  // Debate turns come from the live event stream only. A stored run keeps whole
  // histories rather than per-turn slices (see `viewFromHistory`), so counting
  // an archived run would report one round however many actually ran.
  const turns = useMemo(
    () => countTurns([...state.investmentDebate, ...state.riskDebate]),
    [state.investmentDebate, state.riskDebate],
  )

  const hasAnyContent = view.reports.length > 0
    || view.investmentDebate.length > 0
    || view.investmentJudge !== null
    || view.traderPlan !== null
    || view.riskDebate.length > 0
    || view.decision !== null

  const selectedNode = selection?.kind === 'node' ? nodeBySlug(selection.slug) : undefined
  const selectedStage = selection?.kind === 'stage' ? selection.stage : null

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
            selectedSlug={selectedNode?.slug ?? null}
            selectedStage={selectedStage}
            onSelectNode={handleSelectNode}
            onSelectStage={handleSelectStage}
            nodeHasContent={(slug: string) => nodeHasContent(slug, view)}
            turns={archived ? undefined : turns}
          />
        </aside>

        <main className="app__column app__column--main">
          {error && <div className="alert">{error}</div>}
          {state.error && <div className="alert">{state.error}</div>}

          {!archived && state.statusMessage && (
            <p className="status-line">{state.statusMessage}</p>
          )}

          {selectedNode ? (
            <div className="node-content">
              <nav className="node-content__crumbs" aria-label="面包屑">
                <button
                  type="button"
                  className="node-content__crumb"
                  onClick={() => handleSelectStage(selectedNode.stage)}
                >
                  ← {STAGE_LABELS[selectedNode.stage]}
                </button>
                <span aria-hidden="true">/</span>
                <span>{selectedNode.label}</span>
              </nav>
              <h2 className="node-content__title">{selectedNode.label}</h2>
              <NodeDetail slug={selectedNode.slug} view={view} />
            </div>
          ) : selectedStage ? (
            <Office
              stage={selectedStage}
              nodes={archived ? {} : state.nodes}
              view={view}
              turns={archived ? undefined : turns}
              onSelectNode={handleSelectNode}
            />
          ) : (
            <p className="empty">
              {selectedId && !hasAnyContent && !busy
                ? '❌ 该分析任务失败，无可用报告。请重新发起分析。'
                : '输入股票代码与交易日期，点击「开始分析」'}
            </p>
          )}
        </main>

        <aside className="app__column app__column--history">
          <h2 className="section-heading">历史记录</h2>
          <HistoryList rows={historyList} selectedId={selectedId} onSelect={handleSelectHistory} />
        </aside>
      </div>
    </div>
  )
}
