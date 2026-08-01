import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { HistoryList } from './components/HistoryList'
import { NodeDetail, nodeHasContent } from './components/NodeDetail'
import { RunControls } from './components/RunControls'
import { Timeline } from './components/Timeline'
import { useAnalysisStream } from './hooks/useAnalysisStream'
import { TIMELINE_NODES, VALID_SLUGS } from './lib/nodes'
import {
  fetchHistory,
  fetchHistoryDetail,
  fetchMeta,
  startAnalysis,
  type HistoryRow,
} from './lib/api'
import { EMPTY_VIEW, viewFromHistory, viewFromState, type ResultView as View } from './lib/view'
import './styles/app.css'

// --- URL sync helpers (no page navigation, just update address bar) ---
function parseHash(): { jobId: string | null; nodeSlug: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash) return { jobId: null, nodeSlug: null }
  const parts = hash.split('/')
  const jobId = parts[0] || null
  const nodeSlug = parts[1] && VALID_SLUGS.has(parts[1]) ? parts[1] : null
  return { jobId, nodeSlug }
}

function updateHash(jobId: string | null, nodeSlug: string | null) {
  const newHash = !jobId ? '' : nodeSlug ? `#/${jobId}/${nodeSlug}` : `#/${jobId}`
  if (window.location.hash !== newHash) {
    // replaceState to avoid polluting browser history on every click
    history.replaceState(null, '', newHash || window.location.pathname)
  }
}

export default function App() {
  const { state, connection, watch, reset, markStarting } = useAnalysisStream()
  const [historyList, setHistoryList] = useState<HistoryRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => parseHash().jobId)
  const [archived, setArchived] = useState<View | null>(null)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => parseHash().nodeSlug)

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

  // Sync URL when selection changes
  useEffect(() => {
    updateHash(selectedId, selectedSlug)
  }, [selectedId, selectedSlug])

  // Restore from URL on page load (for history entries)
  useEffect(() => {
    const { jobId } = parseHash()
    if (jobId && !selectedId) {
      setSelectedId(jobId)
      // Try to load from history
      fetchHistoryDetail(jobId).then((detail) => {
        if (detail.result) setArchived(viewFromHistory(detail.result))
      }).catch(() => undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select the first completed node when none is selected
  useEffect(() => {
    if (archived || selectedSlug) return
    const doneNodes = Object.entries(state.nodes)
      .filter(([, s]) => s === 'done')
      .map(([n]) => n)
    if (doneNodes.length > 0) {
      const order = TIMELINE_NODES.map((t) => t.node)
      const firstDone = order.find((n) => doneNodes.includes(n))
      if (firstDone) {
        const tn = TIMELINE_NODES.find((t) => t.node === firstDone)
        if (tn) setSelectedSlug(tn.slug)
      }
    }
  }, [state.nodes, archived, selectedSlug])

  const handleSelectNode = useCallback((slug: string) => {
    setSelectedSlug(slug)
  }, [])

  const handleStart = useCallback(
    async (ticker: string, date: string) => {
      setError(null)
      setArchived(null)
      setSelectedSlug(null)
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
      setSelectedSlug(null)
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

  const hasAnyContent = view.reports.length > 0
    || view.investmentDebate.length > 0
    || view.investmentJudge !== null
    || view.traderPlan !== null
    || view.riskDebate.length > 0
    || view.decision !== null

  const selectedLabel = selectedSlug
    ? TIMELINE_NODES.find((t) => t.slug === selectedSlug)?.label ?? ''
    : ''

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
            selectedSlug={selectedSlug}
            onSelectNode={handleSelectNode}
            nodeHasContent={(slug: string) => nodeHasContent(slug, view)}
          />
        </aside>

        <main className="app__column app__column--main">
          {error && <div className="alert">{error}</div>}
          {state.error && <div className="alert">{state.error}</div>}

          {!archived && state.statusMessage && (
            <p className="status-line">{state.statusMessage}</p>
          )}

          {selectedSlug && (hasAnyContent || archived) ? (
            <div className="node-content">
              <h2 className="node-content__title">{selectedLabel}</h2>
              <NodeDetail
                slug={selectedSlug}
                label={selectedLabel}
                view={view}
              />
            </div>
          ) : (
            <p className="empty">
              {busy
                ? '分析进行中…完成的角色会亮起，点击查看报告'
                : selectedId && !hasAnyContent
                  ? '❌ 该分析任务失败，无可用报告。请重新发起分析。'
                  : hasAnyContent
                    ? '点击左侧角色查看详细报告'
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
