/** Live socket state — visible because reconnects are silent by design. */

import type { ConnectionState } from '../hooks/useAnalysisStream'

const TEXT: Record<ConnectionState, string> = {
  // Not "未连接": before a run there is nothing to connect to, and phrasing the
  // idle state as a connection failure reads like something is broken.
  idle: '待机中',
  connecting: '连接中…',
  open: '实时连接',
  reconnecting: '重新连接中…',
  closed: '连接已关闭',
}

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className="connection" data-state={state} data-testid="connection-badge">
      <span className="connection__dot" aria-hidden="true" />
      {TEXT[state]}
    </span>
  )
}
