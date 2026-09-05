import type { CreateSessionInput, SessionMetadata, TrackKind } from '../../../shared/types'

const SEGMENT_DURATION_MS = 10 * 60 * 1000

export interface SegmentResult {
  track: TrackKind
  index: number
  mimeType: string
  startedAtMs: number
  durationMs: number
  hasData: boolean
}

export type RecorderTrackState = 'live' | 'muted' | 'ended' | 'error'

export interface RecorderHealthUpdate {
  track: TrackKind
  state: RecorderTrackState
  level?: number
  message?: string
}

export function observeSourceTrack(
  track: MediaStreamTrack,
  kind: TrackKind,
  label: string,
  isStopping: () => boolean,
  onHealthChange: (update: RecorderHealthUpdate) => void,
  onEnded: (error: Error) => void
): () => void {
  const report = () => onHealthChange({ track: kind, state: track.muted ? 'muted' : 'live' })
  const handleMute = () => onHealthChange({ track: kind, state: 'muted', message: `${label}暂时没有信号。` })
  const handleEnded = () => {
    if (isStopping()) return
    const error = new Error(`${label}已断开，录音已自动停止以避免产生不完整记录。`)
    onHealthChange({ track: kind, state: 'ended', message: error.message })
    onEnded(error)
  }
  track.addEventListener('mute', handleMute)
  track.addEventListener('unmute', report)
  track.addEventListener('ended', handleEnded)
  report()
  return () => {
    track.removeEventListener('mute', handleMute)
    track.removeEventListener('unmute', report)
    track.removeEventListener('ended', handleEnded)
  }
}

export function queueRecordingOperation(
  previous: Promise<void>,
  operation: () => Promise<void>,
  onFailure: (error: unknown) => void
): Promise<void> {
  return previous.then(operation).catch((error) => onFailure(error))
}

export class TrackRecorder {
  private recorder: MediaRecorder | null = null
  private fragmentWrite: Promise<void> = Promise.resolve()
  private stopped: Promise<void> = Promise.resolve()
  private stopResult: Promise<SegmentResult | null> | null = null
  private stopRequested = false
  private failure: Error | null = null
  private hasData = false
  private index = 0
  private startedAtMs = 0

  constructor(
    private readonly track: TrackKind,
    private readonly stream: MediaStream,
    private readonly mimeType: string,
    private readonly persistFragment: (track: TrackKind, index: number, mimeType: string, blob: Blob) => Promise<void>,
    private readonly onFailure: (track: TrackKind, error: Error) => void
  ) {}

  private fail(error: unknown): void {
    if (this.failure) return
    this.failure = error instanceof Error ? error : new Error(String(error))
    this.onFailure(this.track, this.failure)
  }

  start(index: number, startedAtMs: number): void {
    this.index = index
    this.startedAtMs = startedAtMs
    this.fragmentWrite = Promise.resolve()
    this.failure = null
    this.hasData = false
    this.stopRequested = false
    this.stopResult = null
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: this.track === 'mixed' ? 96_000 : 64_000
    })
    let resolveStopped!: () => void
    this.stopped = new Promise<void>((resolve) => { resolveStopped = resolve })
    this.recorder.addEventListener('stop', () => {
      if (!this.stopRequested) this.fail(new Error(`${this.track} 音轨意外停止。`))
      resolveStopped()
    }, { once: true })
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return
      this.hasData = true
      this.fragmentWrite = this.fragmentWrite
        .then(async () => {
          if (this.failure) return
          await this.persistFragment(this.track, index, this.mimeType, event.data)
        })
        .catch((error) => this.fail(new Error(`${this.track} 音轨写入失败：${error instanceof Error ? error.message : String(error)}`)))
    })
    this.recorder.addEventListener('error', () => this.fail(new Error(`${this.track} 音轨录制失败。`)))
    try {
      this.recorder.start(1_000)
    } catch (error) {
      this.recorder = null
      resolveStopped()
      throw error
    }
  }

  stop(endedAtMs: number): Promise<SegmentResult | null> {
    if (this.stopResult) return this.stopResult
    const current = this.recorder
    if (!current) return Promise.resolve(null)
    this.stopRequested = true
    this.stopResult = (async () => {
      if (current.state !== 'inactive') current.stop()
      // An inactive recorder can still have its final data/stop events queued.
      await this.stopped
      await this.fragmentWrite
      if (this.failure) throw this.failure
      return {
        track: this.track,
        index: this.index,
        mimeType: this.mimeType,
        startedAtMs: this.startedAtMs,
        durationMs: Math.max(0, endedAtMs - this.startedAtMs),
        hasData: this.hasData
      }
    })()
    return this.stopResult
  }
}

function supportedMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

export interface RecorderStartOptions extends CreateSessionInput {
  microphoneDeviceId?: string
  onFatalError?: (error: Error) => void
  onHealthChange?: (update: RecorderHealthUpdate) => void
}

export class DualTrackRecorder {
  private session: SessionMetadata | null = null
  private microphoneStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private recorders: TrackRecorder[] = []
  private rotationTimer: number | null = null
  private segmentIndex = 0
  private startedAt = 0
  private segmentStartedAt = 0
  private operation: Promise<void> = Promise.resolve()
  private stopping = false
  private fatalError: Error | null = null
  private onFatalError: ((error: Error) => void) | null = null
  private onHealthChange: ((update: RecorderHealthUpdate) => void) | null = null
  private healthCleanups: Array<() => void> = []
  private finalizedSegments = new Set<string>()

  get sessionId(): string | null {
    return this.session?.id ?? null
  }

  get elapsedMs(): number {
    return this.startedAt ? Math.max(0, performance.now() - this.startedAt) : 0
  }

  async start(options: RecorderStartOptions): Promise<SessionMetadata> {
    if (this.session) throw new Error('已有录音正在进行。')
    this.operation = Promise.resolve()
    this.stopping = false
    this.fatalError = null
    this.finalizedSegments.clear()
    this.onFatalError = options.onFatalError ?? null
    this.onHealthChange = options.onHealthChange ?? null
    const audioConstraints: MediaTrackConstraints = {
      deviceId: options.microphoneDeviceId ? { exact: options.microphoneDeviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
    this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false })

    try {
      if (options.hasSystemAudio) {
        this.systemStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        for (const track of this.systemStream.getVideoTracks()) track.stop()
        if (this.systemStream.getAudioTracks().length === 0) {
          throw new Error('没有捕获到系统音频，请检查 Windows 声音输出后重试。')
        }
      }

      const microphoneTrack = this.microphoneStream.getAudioTracks()[0]
      if (!microphoneTrack || microphoneTrack.readyState !== 'live') throw new Error('麦克风音轨不可用，请重新选择设备。')
      const systemTrack = this.systemStream?.getAudioTracks()[0]
      if (options.hasSystemAudio && (!systemTrack || systemTrack.readyState !== 'live')) {
        throw new Error('系统音频音轨不可用，请重新共享屏幕并勾选“共享系统音频”。')
      }
      const microphoneLabel = microphoneTrack.label || options.microphoneLabel
      this.session = await window.clarity.createSession({
        title: options.title,
        consentConfirmedAt: options.consentConfirmedAt,
        microphoneLabel,
        hasSystemAudio: options.hasSystemAudio
      })
      this.audioContext = new AudioContext()
      const mixedDestination = this.audioContext.createMediaStreamDestination()
      const microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream)
      microphoneSource.connect(mixedDestination)
      this.watchSignalLevel(microphoneSource, microphoneTrack, 'microphone')
      if (this.systemStream && systemTrack) {
        const systemSource = this.audioContext.createMediaStreamSource(this.systemStream)
        systemSource.connect(mixedDestination)
        this.watchSignalLevel(systemSource, systemTrack, 'system')
      }
      const mixedTrack = mixedDestination.stream.getAudioTracks()[0]
      if (mixedTrack) {
        this.watchSignalLevel(this.audioContext.createMediaStreamSource(mixedDestination.stream), mixedTrack, 'mixed')
      }

      const mimeType = supportedMimeType()
      const microphoneOnly = new MediaStream(this.microphoneStream.getAudioTracks())
      const sessionId = this.session.id
      const persistFragment = async (track: TrackKind, index: number, fragmentMimeType: string, blob: Blob) => {
        await window.clarity.appendRecordingFragment({
          sessionId,
          track,
          index,
          mimeType: fragmentMimeType,
          data: await blob.arrayBuffer()
        })
      }
      const handleFailure = (track: TrackKind, error: Error) => this.latchFatalError(track, error)
      this.recorders = [
        new TrackRecorder('microphone', microphoneOnly, mimeType, persistFragment, handleFailure),
        new TrackRecorder('mixed', mixedDestination.stream, mimeType, persistFragment, handleFailure)
      ]
      if (this.systemStream) {
        this.recorders.push(
          new TrackRecorder('system', new MediaStream(this.systemStream.getAudioTracks()), mimeType, persistFragment, handleFailure)
        )
      }

      this.watchSourceTrack(microphoneTrack, 'microphone', '麦克风')
      if (systemTrack) this.watchSourceTrack(systemTrack, 'system', '系统音频')

      this.startedAt = performance.now()
      this.segmentStartedAt = 0
      this.segmentIndex = 0
      for (const recorder of this.recorders) recorder.start(this.segmentIndex, this.segmentStartedAt)
      this.onHealthChange?.({ track: 'mixed', state: 'live' })
      this.rotationTimer = window.setInterval(() => this.queueRotation(), SEGMENT_DURATION_MS)
      await window.clarity.setRecordingActive(true)
      if (this.fatalError) throw this.fatalError
      return this.session
    } catch (error) {
      this.stopping = true
      try {
        await this.finishCurrentSegment(this.elapsedMs, false).catch(() => undefined)
        if (this.session) await window.clarity.failSession(this.session.id, error instanceof Error ? error.message : String(error))
      } finally {
        await this.cleanup()
      }
      throw error
    }
  }

  private queueRotation(): void {
    if (this.stopping || this.fatalError) return
    this.operation = queueRecordingOperation(this.operation, () => this.rotate(), (error) => {
      console.error('Unable to rotate recording segment', error)
      this.latchFatalError('mixed', error)
    })
  }

  private watchSourceTrack(track: MediaStreamTrack, kind: TrackKind, label: string): void {
    this.healthCleanups.push(
      observeSourceTrack(
        track,
        kind,
        label,
        () => this.stopping,
        (update) => this.onHealthChange?.(update),
        (error) => this.latchFatalError(kind, error)
      )
    )
  }

  private watchSignalLevel(source: MediaStreamAudioSourceNode, track: MediaStreamTrack, kind: TrackKind): void {
    if (!this.audioContext) return
    const analyser = this.audioContext.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const timer = window.setInterval(() => {
      if (this.stopping || this.fatalError) return
      analyser.getFloatTimeDomainData(samples)
      const rootMeanSquare = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
      this.onHealthChange?.({
        track: kind,
        state: track.muted ? 'muted' : 'live',
        level: Math.min(1, rootMeanSquare * 8)
      })
    }, 400)
    this.healthCleanups.push(() => {
      window.clearInterval(timer)
      source.disconnect(analyser)
      analyser.disconnect()
    })
  }

  private latchFatalError(track: TrackKind, error: unknown): void {
    if (this.fatalError || !this.session) return
    this.fatalError = error instanceof Error ? error : new Error(String(error))
    this.onHealthChange?.({ track, state: 'error', message: this.fatalError.message })
    if (!this.stopping) this.onFatalError?.(this.fatalError)
  }

  private async rotate(): Promise<void> {
    if (!this.session || this.stopping || this.fatalError) return
    await this.finishCurrentSegment(this.elapsedMs, true)
  }

  private async finishCurrentSegment(endedAtMs: number, restart: boolean): Promise<void> {
    const results = await Promise.allSettled(this.recorders.map((recorder) => recorder.stop(endedAtMs)))
    const completed = results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
    let failure: unknown = results.find((result) => result.status === 'rejected')?.reason
    if (!failure && completed.some((segment) => !segment.hasData)) failure = new Error('录音分段没有产生有效音频数据。')
    if (restart && !failure && !this.stopping && !this.fatalError) {
      this.segmentIndex += 1
      this.segmentStartedAt = endedAtMs
      try {
        for (const recorder of this.recorders) recorder.start(this.segmentIndex, this.segmentStartedAt)
      } catch (error) {
        failure = error
      }
    }
    // Preserve healthy tracks even when one recorder has failed, and drain all writes.
    try {
      await this.saveSegments(completed)
    } catch (error) {
      failure ??= error
    }
    if (failure) throw failure
  }

  private async saveSegments(segments: SegmentResult[]): Promise<void> {
    if (!this.session) return
    const sessionId = this.session.id
    const results = await Promise.allSettled(
      segments
        .filter((segment) => segment.hasData && !this.finalizedSegments.has(`${segment.track}:${segment.index}`))
        .map(async (segment) => {
          await window.clarity.finalizeRecordingChunk({
            sessionId,
            track: segment.track,
            index: segment.index,
            mimeType: segment.mimeType,
            startedAtMs: segment.startedAtMs,
            durationMs: segment.durationMs
          })
          this.finalizedSegments.add(`${segment.track}:${segment.index}`)
        })
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
  }

  async stop(): Promise<SessionMetadata | null> {
    if (!this.session || this.stopping) return null
    this.stopping = true
    if (this.rotationTimer !== null) window.clearInterval(this.rotationTimer)
    this.rotationTimer = null
    try {
      await this.operation
      const durationMs = this.elapsedMs
      await this.finishCurrentSegment(durationMs, false)
      if (this.fatalError) throw this.fatalError
      const finalized = await window.clarity.finalizeSession(this.session.id, durationMs)
      return finalized
    } catch (error) {
      await window.clarity.failSession(this.session.id, error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      await this.cleanup()
    }
  }

  private async cleanup(): Promise<void> {
    if (this.rotationTimer !== null) window.clearInterval(this.rotationTimer)
    this.rotationTimer = null
    try {
      await window.clarity.setRecordingActive(false)
    } catch (error) {
      console.error('Unable to reset recording indicator', error)
    } finally {
      this.releaseStreams()
      this.session = null
      this.startedAt = 0
      this.stopping = false
      this.recorders = []
      this.fatalError = null
      this.onFatalError = null
      this.onHealthChange = null
      this.finalizedSegments.clear()
    }
  }

  private releaseStreams(): void {
    for (const cleanup of this.healthCleanups.splice(0)) cleanup()
    for (const track of this.microphoneStream?.getTracks() ?? []) track.stop()
    for (const track of this.systemStream?.getTracks() ?? []) track.stop()
    this.microphoneStream = null
    this.systemStream = null
    if (this.audioContext) void this.audioContext.close()
    this.audioContext = null
  }
}
