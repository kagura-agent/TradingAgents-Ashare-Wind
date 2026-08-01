/** Header form: ticker, trade date, and the start button. */

import { useState, type FormEvent } from 'react'

interface Props {
  busy: boolean
  onSubmit: (ticker: string, date: string) => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RunControls({ busy, onSubmit }: Props) {
  const [ticker, setTicker] = useState('600519.SH')
  const [date, setDate] = useState(today)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = ticker.trim()
    if (!trimmed || !date || busy) return
    onSubmit(trimmed, date)
  }

  return (
    <form className="controls" onSubmit={handleSubmit}>
      <div className="field">
        <label className="field__label" htmlFor="ticker">
          股票代码
        </label>
        <input
          id="ticker"
          className="input"
          value={ticker}
          placeholder="600519.SH"
          onChange={(e) => setTicker(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="trade-date">
          交易日期
        </label>
        <input
          id="trade-date"
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <button className="button" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
        {busy ? '分析中…' : '开始分析'}
      </button>
    </form>
  )
}
