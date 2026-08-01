/** Thin fetch wrappers around the FastAPI routes. */

export interface HistoryRow {
  id: string
  ticker: string
  trade_date: string
  status: string
  decision: string | null
  created_at: string
  finished_at: string | null
}

export interface AnalysisResult {
  market_report: string
  sentiment_report: string
  news_report: string
  fundamentals_report: string
  annual_report: string
  industry_report: string
  investment_debate: { bull_history: string; bear_history: string; judge_decision: string }
  trader_plan: string
  risk_debate: {
    aggressive_history: string
    conservative_history: string
    neutral_history: string
    judge_decision: string
  }
  final_decision: string
  signal: string
}

export interface HistoryDetail extends HistoryRow {
  result: AnalysisResult | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error
    throw new Error(message ?? `请求失败（HTTP ${response.status}）`)
  }
  return body as T
}

export function startAnalysis(ticker: string, date: string): Promise<{ job_id: string }> {
  return request('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, date }),
  })
}

export function fetchHistory(): Promise<HistoryRow[]> {
  return request('/api/history')
}

export function fetchHistoryDetail(jobId: string): Promise<HistoryDetail> {
  return request(`/api/history/${jobId}`)
}

export function fetchMeta(): Promise<{ demo: boolean }> {
  return request('/api/meta')
}
