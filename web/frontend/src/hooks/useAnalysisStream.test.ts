import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAnalysisStream, websocketUrl } from './useAnalysisStream'
import type { AnalysisEvent } from '../types/events'

/**
 * Minimal WebSocket stand-in.
 *
 * jsdom has no WebSocket, and a real server would make the reconnect timings
 * untestable. Only the four handlers the hook actually uses are implemented.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  /** Server accepted the connection. */
  open() {
    this.onopen?.()
  }

  /** Server pushed a frame. */
  send_(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  /** Frame that is not valid JSON. */
  sendRaw(data: string) {
    this.onmessage?.({ data })
  }

  /** Connection dropped, from either end. */
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

const sockets = () => MockWebSocket.instances
const latest = () => sockets()[sockets().length - 1]

const RUN: AnalysisEvent[] = [
  { type: 'status', status: 'running', message: '开始' },
  { type: 'node_start', node: 'Bull Researcher', label: '多头研究员' },
  { type: 'debate', phase: 'investment', speaker: 'Bull Researcher', label: '多头研究员', content: '第一轮' },
  { type: 'debate', phase: 'investment', speaker: 'Bull Researcher', label: '多头研究员', content: '第二轮' },
  { type: 'node_complete', node: 'Bull Researcher', label: '多头研究员' },
  { type: 'complete', signal: 'Overweight', message: '完成' },
]

/** Push events onto a socket the way the server replays them: from index 0. */
function replay(socket: MockWebSocket, events: AnalysisEvent[]) {
  act(() => {
    for (const event of events) socket.send_(event)
  })
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('websocketUrl', () => {
  it('follows the page scheme', () => {
    expect(websocketUrl('abc', { protocol: 'http:', host: 'localhost:8501' } as Location)).toBe(
      'ws://localhost:8501/ws/abc',
    )
    expect(websocketUrl('abc', { protocol: 'https:', host: 'example.com' } as Location)).toBe(
      'wss://example.com/ws/abc',
    )
  })
})

describe('useAnalysisStream', () => {
  it('opens no socket until a job is watched', () => {
    const { result } = renderHook(() => useAnalysisStream())

    expect(sockets()).toHaveLength(0)
    expect(result.current.connection).toBe('idle')
  })

  it('streams a run to completion', () => {
    const { result } = renderHook(() => useAnalysisStream())

    act(() => result.current.watch('job-1'))
    expect(sockets()).toHaveLength(1)
    expect(latest().url).toContain('/ws/job-1')
    expect(result.current.connection).toBe('connecting')

    act(() => latest().open())
    expect(result.current.connection).toBe('open')

    replay(latest(), RUN)

    expect(result.current.state.runStatus).toBe('completed')
    expect(result.current.state.signal).toBe('Overweight')
    expect(result.current.state.investmentDebate).toHaveLength(2)
  })

  it('reconnects after a drop and the replay does not duplicate anything', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    act(() => latest().open())

    replay(latest(), RUN.slice(0, 3))
    expect(result.current.state.investmentDebate).toHaveLength(1)

    act(() => latest().close())
    expect(result.current.connection).toBe('reconnecting')

    act(() => void vi.advanceTimersByTime(500))
    expect(sockets()).toHaveLength(2)

    act(() => latest().open())
    expect(result.current.connection).toBe('open')

    // The server replays from the beginning; the prefix must be a no-op.
    replay(latest(), RUN)

    expect(result.current.state.investmentDebate.map((e) => e.content)).toEqual(['第一轮', '第二轮'])
    expect(result.current.state.applied).toBe(RUN.length)
    expect(result.current.state.runStatus).toBe('completed')
  })

  it('backs off exponentially while the server stays down', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))

    for (const [attempt, delay] of [500, 1000, 2000].entries()) {
      act(() => latest().close())
      // Not yet: the timer has not elapsed.
      act(() => void vi.advanceTimersByTime(delay - 1))
      expect(sockets()).toHaveLength(attempt + 1)
      act(() => void vi.advanceTimersByTime(1))
      expect(sockets()).toHaveLength(attempt + 2)
    }
  })

  it('resets the backoff once a connection succeeds', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))

    act(() => latest().close())
    act(() => void vi.advanceTimersByTime(500))
    act(() => latest().open())

    act(() => latest().close())
    act(() => void vi.advanceTimersByTime(500))
    expect(sockets()).toHaveLength(3)
  })

  it('stops reconnecting once the run is terminal', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    act(() => latest().open())
    replay(latest(), RUN)

    act(() => latest().close())

    expect(result.current.connection).toBe('closed')
    act(() => void vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
  })

  it('stops reconnecting after an error event too', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    act(() => latest().open())
    replay(latest(), [{ type: 'error', message: '分析失败: Wind 超时' }])

    act(() => latest().close())

    expect(result.current.state.runStatus).toBe('failed')
    expect(result.current.connection).toBe('closed')
    act(() => void vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
  })

  it('ignores keepalives so they do not shift the replay index', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    act(() => latest().open())

    act(() => {
      latest().send_(RUN[0])
      latest().send_({ type: 'ping' })
      latest().send_(RUN[1])
    })

    // Three frames in, two analysis events applied.
    expect(result.current.state.applied).toBe(2)
    expect(result.current.state.nodes['Bull Researcher']).toBe('running')
  })

  it('survives a malformed frame', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    act(() => latest().open())

    act(() => latest().sendRaw('{not json'))
    replay(latest(), [RUN[0]])

    expect(result.current.state.applied).toBe(1)
    expect(result.current.state.statusMessage).toBe('开始')
  })

  it('tears the socket down when watching null', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    const first = latest()

    act(() => result.current.watch(null))

    expect(first.closed).toBe(true)
    expect(result.current.connection).toBe('idle')
  })

  it('switches to another job without carrying state over', () => {
    const { result } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    act(() => latest().open())
    replay(latest(), RUN.slice(0, 3))

    act(() => {
      result.current.reset()
      result.current.watch('job-2')
    })

    expect(latest().url).toContain('/ws/job-2')
    expect(result.current.state.applied).toBe(0)
    expect(result.current.state.investmentDebate).toEqual([])
  })

  it('closes the socket on unmount', () => {
    const { result, unmount } = renderHook(() => useAnalysisStream())
    act(() => result.current.watch('job-1'))
    const socket = latest()

    unmount()

    expect(socket.closed).toBe(true)
    act(() => void vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
  })

  it('marks a submission as starting before the socket exists', () => {
    const { result } = renderHook(() => useAnalysisStream())

    act(() => result.current.markStarting())

    expect(result.current.state.runStatus).toBe('starting')
    expect(sockets()).toHaveLength(0)
  })
})
