import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DualTrackRecorder, observeSourceTrack, queueRecordingOperation, TrackRecorder } from './dual-track-recorder'
import type { SegmentResult } from './dual-track-recorder'

class FakeMediaRecorder extends EventTarget {
  static current: FakeMediaRecorder | null = null
  state: RecordingState = 'inactive'

  constructor() {
    super()
    FakeMediaRecorder.current = this
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }

  emitData(blob: Blob): void {
    const event = new Event('dataavailable') as BlobEvent
    Object.defineProperty(event, 'data', { value: blob })
    this.dispatchEvent(event)
  }
}

describe('TrackRecorder failure handling', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    FakeMediaRecorder.current = null
  })

  it('persists data before reporting a completed segment', async () => {
    const persist = vi.fn(async () => undefined)
    const onFailure = vi.fn()
    const recorder = new TrackRecorder('microphone', {} as MediaStream, 'audio/webm', persist, onFailure)
    recorder.start(0, 0)
    FakeMediaRecorder.current?.emitData(new Blob(['audio']))

    const segment = await recorder.stop(1_000)

    expect(persist).toHaveBeenCalledOnce()
    expect(segment).toMatchObject({ track: 'microphone', index: 0, hasData: true, durationMs: 1_000 })
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('latches a fragment write failure and rejects stop instead of reporting success', async () => {
    const persist = vi.fn(async () => {
      throw new Error('disk full')
    })
    const onFailure = vi.fn()
    const recorder = new TrackRecorder('microphone', {} as MediaStream, 'audio/webm', persist, onFailure)
    recorder.start(0, 0)
    FakeMediaRecorder.current?.emitData(new Blob(['audio']))
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())

    await expect(recorder.stop(1_000)).rejects.toThrow('disk full')
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('waits for an inactive recorder final events and pending writes before rejecting', async () => {
    let finishWrite!: () => void
    const persist = vi.fn(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    const onFailure = vi.fn()
    const recorder = new TrackRecorder('microphone', {} as MediaStream, 'audio/webm', persist, onFailure)
    recorder.start(0, 0)
    const mediaRecorder = FakeMediaRecorder.current!
    mediaRecorder.emitData(new Blob(['audio']))
    await Promise.resolve()
    // MediaRecorder can become inactive before dispatching its final events.
    mediaRecorder.state = 'inactive'
    mediaRecorder.dispatchEvent(new Event('error'))
    let settled = false
    const stopped = recorder.stop(1_000).finally(() => { settled = true })
    const rejected = expect(stopped).rejects.toThrow('音轨录制失败')
    await Promise.resolve()
    expect(settled).toBe(false)
    mediaRecorder.dispatchEvent(new Event('stop'))
    await Promise.resolve()
    expect(settled).toBe(false)
    finishWrite()
    await rejected
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('reuses a stop request instead of rejecting a second call as an inactive recorder', async () => {
    const recorder = new TrackRecorder('microphone', {} as MediaStream, 'audio/webm', async () => undefined, vi.fn())
    recorder.start(0, 0)
    FakeMediaRecorder.current?.emitData(new Blob(['audio']))
    const first = recorder.stop(1_000)
    expect(recorder.stop(2_000)).toBe(first)
    await expect(first).resolves.toMatchObject({ durationMs: 1_000 })
  })

  it('turns a source-track ended event into a fatal recording error', () => {
    const track = new EventTarget() as MediaStreamTrack
    Object.defineProperty(track, 'muted', { configurable: true, value: false })
    const onHealth = vi.fn()
    const onEnded = vi.fn()
    const cleanup = observeSourceTrack(track, 'system', '系统音频', () => false, onHealth, onEnded)

    track.dispatchEvent(new Event('ended'))

    expect(onHealth).toHaveBeenLastCalledWith(expect.objectContaining({ track: 'system', state: 'ended' }))
    expect(onEnded).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('自动停止') }))
    cleanup()
  })

  it('surfaces a rotation operation rejection through the fatal callback', async () => {
    const onFailure = vi.fn()
    const operation = queueRecordingOperation(
      Promise.resolve(),
      async () => { throw new Error('rotation failed') },
      onFailure
    )

    await operation
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'rotation failed' }))
  })
})

describe('DualTrackRecorder finalization barriers', () => {
  const segment = (track: SegmentResult['track']): SegmentResult => ({
    track, index: 0, mimeType: 'audio/webm', startedAtMs: 0, durationMs: 1_000, hasData: true
  })
  const createRecorder = (stops: Array<() => Promise<SegmentResult>>) => {
    const recorder = new DualTrackRecorder()
    const sourceStop = vi.fn()
    Object.assign(recorder, {
      session: { id: 'session-test' },
      startedAt: performance.now(),
      recorders: stops.map((stop) => ({ stop })),
      microphoneStream: { getTracks: () => [{ stop: sourceStop }] }
    })
    return { recorder, sourceStop }
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      clearInterval: vi.fn(),
      clarity: {
        finalizeRecordingChunk: vi.fn(async () => undefined),
        finalizeSession: vi.fn(async () => ({ id: 'session-test', status: 'ready' })),
        failSession: vi.fn(async () => undefined),
        setRecordingActive: vi.fn(async () => undefined)
      }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('drains the healthy recorder after another stop fails, then saves its audio before cleanup', async () => {
    let finishMixed!: (value: SegmentResult) => void
    const { recorder, sourceStop } = createRecorder([
      async () => { throw new Error('microphone write failed') },
      () => new Promise((resolve) => { finishMixed = resolve })
    ])
    const stopped = expect(recorder.stop()).rejects.toThrow('microphone write failed')
    await Promise.resolve()
    await Promise.resolve()
    expect(window.clarity.failSession).not.toHaveBeenCalled()
    expect(sourceStop).not.toHaveBeenCalled()
    finishMixed(segment('mixed'))
    await stopped
    expect(window.clarity.finalizeRecordingChunk).toHaveBeenCalledWith(expect.objectContaining({ track: 'mixed' }))
    expect(window.clarity.finalizeSession).not.toHaveBeenCalled()
    expect(window.clarity.failSession).toHaveBeenCalledOnce()
    expect(sourceStop).toHaveBeenCalledOnce()
    expect(recorder.sessionId).toBeNull()
  })

  it('waits for all finalization writes even when one IPC finalization rejects', async () => {
    let finishMixed!: () => void
    vi.mocked(window.clarity.finalizeRecordingChunk).mockImplementation(async (input) => {
      if (input.track === 'microphone') throw new Error('metadata write failed')
      await new Promise<void>((resolve) => { finishMixed = resolve })
      return {} as Awaited<ReturnType<typeof window.clarity.finalizeRecordingChunk>>
    })
    const { recorder, sourceStop } = createRecorder([
      async () => segment('microphone'), async () => segment('mixed')
    ])
    const stopped = expect(recorder.stop()).rejects.toThrow('metadata write failed')
    await vi.waitFor(() => expect(window.clarity.finalizeRecordingChunk).toHaveBeenCalledTimes(2))
    expect(window.clarity.failSession).not.toHaveBeenCalled()
    expect(sourceStop).not.toHaveBeenCalled()
    finishMixed()
    await stopped
    expect(window.clarity.finalizeSession).not.toHaveBeenCalled()
    expect(sourceStop).toHaveBeenCalledOnce()
  })

  it('preserves a rotation failure that arrives while a user stop is waiting', async () => {
    const { recorder } = createRecorder([async () => segment('microphone'), async () => segment('mixed')])
    let rejectRotation!: (error: Error) => void
    const rotation = new Promise<void>((_resolve, reject) => { rejectRotation = reject })
    const internal = recorder as unknown as {
      operation: Promise<void>
      latchFatalError: (track: 'mixed', error: unknown) => void
    }
    internal.operation = queueRecordingOperation(Promise.resolve(), () => rotation, (error) => {
      internal.latchFatalError('mixed', error)
    })
    const stopped = expect(recorder.stop()).rejects.toThrow('rotation lost a chunk')
    rejectRotation(new Error('rotation lost a chunk'))
    await stopped
    expect(window.clarity.finalizeSession).not.toHaveBeenCalled()
    expect(window.clarity.failSession).toHaveBeenCalledWith('session-test', 'rotation lost a chunk')
  })

  it('releases device streams even when resetting the tray indicator rejects', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(window.clarity.setRecordingActive).mockRejectedValue(new Error('window closed'))
    const { recorder, sourceStop } = createRecorder([async () => segment('microphone'), async () => segment('mixed')])
    await expect(recorder.stop()).resolves.toMatchObject({ status: 'ready' })
    expect(sourceStop).toHaveBeenCalledOnce()
    expect(recorder.sessionId).toBeNull()
    report.mockRestore()
  })
})
