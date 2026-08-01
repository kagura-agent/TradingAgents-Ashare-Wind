import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { HistoryList } from './components/HistoryList'
import { NodeDetail, nodeHasContent } from './components/NodeDetail'
import { RunControls } from './components/RunControls'
import { Timeline } from './components/Timeline'
import { useAnalysisStream } from './hooks/useAnalysisStream'
import { VALID_SLUGS, nodeBySlug } from './lib/nodes'
import {
  fetchHistory,
  fetchHistoryDetail,
  fetchMeta,
  startAnalysis,
  type HistoryRow,
} from './lib/api'
import { EMPTY_VIEW, viewFromHistory, viewFromState, type ResultView as View } from './lib/view'
import './styles/app.css'

// --- Hash routing helpers ---
interface Route {
  jobId: string | null
  nodeSlug: string | null
}

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash) return { jobId: null, nodeSlug: null }
  const parts = hash.split('/')
  const jobId = parts[0] || null
  const nodeSlug = VALID_SLUGS.has(parts[1]) ? parts[1] : null
  return { jobId, nodeSlug }
}

function setHash(jobId: string | null, nodeSlug: string | null) {
  if (!jobId) {
    window.location.hash = ''
  } else if (!nodeSlug) {
    window.location.hash = `#/${jobId}`
  } else {
    window.location.hash = `#/${jobId}/${nodeSlug}`
  }
}

export default function App() {
  const { state, connection, watch, reset, markStarting } = useAnalysisStream()
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [archived, setArchived] = useState<View | null>(null)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>(parseHash)

  const refreshHistory = useCallback(() => {
    fetchHistory().then(setHistory).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshHistory()
    fetchMeta().then((meta) => setDemo(meta.demo)).catch(() => undefined)
  }, [refreshHistory])

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // A finished run belongs in the history list straight away.
  useEffect(() => {
    if (state.runStatus === 'completed' || state.runStatus === 'failed') refreshHistory()
  }, [state.runStatus, refreshHistory])

  // Navigate to a node detail page
  const navigateToNode = useCallback((slug: string) => {
    const jobId = selectedId
    if (!jobId) return
    setHash(jobId, slug)
  }, [selectedId])

  // Navigate back to overview
  const navigateToOverview = useCallback(() => {
    if (selectedId) {
      setHash(selectedId, null)
    } else {
      setHash(null, null)
    }
  }, [selectedId])

  const handleStart = useCallback(
    async (ticker: string, date: string) => {
      setError(null)
      setArchived(null)
      reset()
      markStarting()
      try {
        const { job_id } = await startAnalysis(ticker, date)
        setSelectedId(job_id)
        setHash(job_id, null)
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
      setHash(row.id, null)
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

  // Are we viewing a specific node?
  const activeSlug = route.nodeSlug
  const activeNode = activeSlug ? nodeBySlug(activeSlug) : null

  // Check if any content exists (for the empty-state message)
  const hasAnyContent = view.reports.length > 0
    || view.investmentDebate.length > 0
    || view.investmentJudge !== null
    || view.traderPlan !== null
    || view.riskDebate.length > 0
    || view.decision !== null

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

      {activeNode ? (
        /* ---- Node detail page: full width, no columns ---- */
        <div className="app__stage-detail">
          <NodeDetail
            slug={activeSlug!}
            label={activeNode.label}
            view={view}
            onBack={navigateToOverview}
          />
        </div>
      ) : (
        /* ---- Overview page: three columns ---- */
        <div className="app__body">
          <aside className="app__column app__column--timeline">
            <Timeline
              nodes={archived ? {} : state.nodes}
              onSelectNode={navigateToNode}
              nodeHasContent={(slug: string) => nodeHasContent(slug, view)}
            />
          </aside>

          <main className="app__column app__column--main">
            {error && <div className="alert">{error}</div>}
            {state.error && <div className="alert">{state.error}</div>}

            {!archived && state.statusMessage && (
              <p className="status-line">{state.statusMessage}</p>
            )}

            <p className="empty">
              {busy
                ? '分析进行中…点击左侧已完成的节点查看详情'
                : selectedId && archived
                  ? (!hasAnyContent
                    ? '❌ 该分析任务失败，无可用报告。请重新发起分析。'
                    : '分析已完成。点击左侧节点查看各步骤详细报告。')
                  : selectedId
                    ? '等待分析结果…'
                    : '输入股票代码与交易日期，点击「开始分析」。'}
            </p>
          </main>

          <aside className="app__column app__column--history">
            <h2 className="section-heading">历史记录</h2>
            <HistoryList rows={history} selectedId={selectedId} onSelect={handleSelectHistory} />
          </aside>
        </div>
      )}
    </div>
  )
}
