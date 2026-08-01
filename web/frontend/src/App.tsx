import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { HistoryList } from './components/HistoryList'
import { RunControls } from './components/RunControls'
import { StageDetail } from './components/StageDetail'
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

// --- Hash routing helpers ---
interface Route {
  jobId: string | null
  stage: Stage | null
}

const VALID_STAGES = new Set<Stage>(['analysis', 'research', 'trading', 'risk'])

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash) return { jobId: null, stage: null }
  const parts = hash.split('/')
  const jobId = parts[0] || null
  const stage = VALID_STAGES.has(parts[1] as Stage) ? (parts[1] as Stage) : null
  return { jobId, stage }
}

function setHash(jobId: string | null, stage: Stage | null) {
  if (!jobId) {
    window.location.hash = ''
  } else if (!stage) {
    window.location.hash = `#/${jobId}`
  } else {
    window.location.hash = `#/${jobId}/${stage}`
  }
}

// --- Check if a stage has any content ---
function stageHasContent(stage: Stage, view: View): boolean {
  switch (stage) {
    case 'analysis':
      return view.reports.length > 0
    case 'research':
      return view.investmentDebate.length > 0 || view.investmentJudge !== null
    case 'trading':
      return view.traderPlan !== null
    case 'risk':
      return view.riskDebate.length > 0 || view.riskJudge !== null || view.decision !== null
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

  // Navigate to a stage detail page
  const navigateToStage = useCallback((stage: Stage) => {
    const jobId = selectedId
    if (!jobId) return
    setHash(jobId, stage)
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

  // Are we viewing a stage detail page?
  const activeStage = route.stage

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

      {activeStage ? (
        /* ---- Stage detail page: full width, no columns ---- */
        <div className="app__stage-detail">
          <StageDetail
            stage={activeStage}
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
              onSelectStage={navigateToStage}
              stageHasContent={(s: Stage) => stageHasContent(s, view)}
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
                ? '分析进行中…点击左侧已完成的阶段查看详情'
                : selectedId
                  ? '分析已完成。点击左侧阶段查看各步骤详细报告。'
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
