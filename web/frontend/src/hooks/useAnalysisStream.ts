/**
 * WebSocket lifecycle for one analysis job.
 *
 * An analysis runs for three to ten minutes, which is long enough that a laptop
 * sleeping, a Wi-Fi handover, or an idle proxy will drop the socket at least
 * sometimes. The previous UI printed "连接已断开" and gave up, even though the
 * server had event replay all along. This reconnects with exponential backoff
 * and lets the replay refill the gap; `analysisReducer` skips the prefix it has
 * already applied, so the refill is invisible.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  analysisReducer,
  initialAnalysisState,
  isTerminal,
  type AnalysisState,
} from '../lib/analysisReducer'
import { isAnalysisEvent } from '../types/events'

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

const BASE_RETRY_MS = 500
const MAX_RETRY_MS = 8000

export function websocketUrl(jobId: string, location: Location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws/${jobId}`
}

export interface AnalysisStream {
  state: AnalysisState
  connection: ConnectionState
  /** Begin (or restart) streaming a job. Passing null tears the socket down. */
  watch: (jobId: string | null) => void
  /** Clear accumulated state without touching the socket. */
  reset: () => void
  markStarting: () => void
}

export function useAnalysisStream(): AnalysisStream {
  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState)
  const [connection, setConnection] = useState<ConnectionState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  // Read inside the socket callbacks, which must not re-subscribe when the
  // state object changes on every event.
  const terminalRef = useRef(false)

  terminalRef.current = isTerminal(state.runStatus)

  const watch = useCallback((next: string | null) => {
    attemptsRef.current = 0
    setJobId(next)
  }, [])

  const reset = useCallback(() => dispatch({ kind: 'reset' }), [])
  const markStarting = useCallback(() => dispatch({ kind: 'starting' }), [])

  useEffect(() => {
    if (jobId === null) {
      setConnection('idle')
      return
    }

    let disposed = false

    const connect = () => {
      if (disposed) return
      setConnection(attemptsRef.current === 0 ? 'connecting' : 'reconnecting')

      const socket = new WebSocket(websocketUrl(jobId, window.location))
      socketRef.current = socket

      // Position within *this* connection. The server always replays from the
      // beginning, so this indexes the same events every time.
      let index = 0

      socket.onopen = () => {
        if (disposed) return
        attemptsRef.current = 0
        setConnection('open')
      }

      socket.onmessage = (message) => {
        if (disposed) return
        let payload: unknown
        try {
          payload = JSON.parse(message.data as string)
        } catch {
          return // malformed frame: ignore rather than kill the stream
        }
        // Keepalives carry no analysis meaning and must not shift the index.
        if (!isAnalysisEvent(payload)) return
        dispatch({ kind: 'event', index, event: payload })
        index += 1
      }

      socket.onclose = () => {
        if (disposed) return
        socketRef.current = null
        if (terminalRef.current) {
          setConnection('closed')
          return
        }
        const delay = Math.min(BASE_RETRY_MS * 2 ** attemptsRef.current, MAX_RETRY_MS)
        attemptsRef.current += 1
        setConnection('reconnecting')
        retryRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryRef.current !== null) clearTimeout(retryRef.current)
      retryRef.current = null
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [jobId])

  return { state, connection, watch, reset, markStarting }
}
