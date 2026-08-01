import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { HistoryList } from './components/HistoryList'
import { ResultView } from './components/ResultView'
import { RunControls } from './components/RunControls'
import { Timeline } from './components/Timeline'
import { useAnalysisStream } from './hooks/useAnalysisStream'
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

  const handleStart = useCallback(
    async (ticker: string, date: string) => {
      setError(null)
      setArchived(null)
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
          <Timeline nodes={archived ? {} : state.nodes} />
        </aside>

        <main className="app__column app__column--main">
          {error && <div className="alert">{error}</div>}
          {state.error && <div className="alert">{state.error}</div>}

          {!archived && state.statusMessage && (
            <p className="status-line">{state.statusMessage}</p>
          )}

          {hasContent ? (
            <ResultView view={view} />
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
