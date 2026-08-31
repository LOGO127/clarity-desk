import type { CreateSessionInput, SessionMetadata, TrackKind } from '../../../shared/types'

const SEGMENT_DURATION_MS = 10 * 60 * 1000

interface SegmentResult {
  track: TrackKind
  index: number
  mimeType: string
  startedAtMs: number
  durationMs: number
  hasData: boolean
}

class TrackRecorder {
  private recorder: MediaRecorder | null = null
  private fragmentWrite: Promise<void> = Promise.resolve()
  private hasData = false
  private index = 0
  private startedAtMs = 0

  constructor(
    private readonly track: TrackKind,
    private readonly stream: MediaStream,
    private readonly mimeType: string,
    private readonly persistFragment: (track: TrackKind, index: number, mimeType: string, blob: Blob) => Promise<void>
  ) {}

  start(index: number, startedAtMs: number): void {
    this.index = index
    this.startedAtMs = startedAtMs
    this.fragmentWrite = Promise.resolve()
    this.hasData = false
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: this.track === 'mixed' ? 96_000 : 64_000
    })
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return
      this.hasData = true
      this.fragmentWrite = this.fragmentWrite.then(() => this.persistFragment(this.track, this.index, this.mimeType, event.data))
    })
    this.recorder.start(1_000)
  }

  stop(endedAtMs: number): Promise<SegmentResult | null> {
    const current = this.recorder
    if (!current || current.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      current.addEventListener(
        'stop',
        async () => {
          try {
            await this.fragmentWrite
            resolve({
              track: this.track,
              index: this.index,
              mimeType: this.mimeType,
              startedAtMs: this.startedAtMs,
              durationMs: Math.max(0, endedAtMs - this.startedAtMs),
              hasData: this.hasData
            })
          } catch (error) {
            reject(error)
          }
        },
        { once: true }
      )
      current.addEventListener('error', () => reject(new Error(`${this.track} 音轨录制失败。`)), { once: true })
      current.stop()
    })
  }
}

function supportedMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

export interface RecorderStartOptions extends CreateSessionInput {
  microphoneDeviceId?: string
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

  get sessionId(): string | null {
    return this.session?.id ?? null
  }

  get elapsedMs(): number {
    return this.startedAt ? Math.max(0, performance.now() - this.startedAt) : 0
  }

  async start(options: RecorderStartOptions): Promise<SessionMetadata> {
    if (this.session) throw new Error('已有录音正在进行。')
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

      const microphoneLabel = this.microphoneStream.getAudioTracks()[0]?.label || options.microphoneLabel
      this.session = await window.clarity.createSession({ ...options, microphoneLabel })
      this.audioContext = new AudioContext()
      const mixedDestination = this.audioContext.createMediaStreamDestination()
      this.audioContext.createMediaStreamSource(this.microphoneStream).connect(mixedDestination)
      if (this.systemStream) this.audioContext.createMediaStreamSource(this.systemStream).connect(mixedDestination)

      const mimeType = supportedMimeType()
      const microphoneOnly = new MediaStream(this.microphoneStream.getAudioTracks())
      const persistFragment = async (track: TrackKind, index: number, fragmentMimeType: string, blob: Blob) => {
        await window.clarity.appendRecordingFragment({
          sessionId: this.session!.id,
          track,
          index,
          mimeType: fragmentMimeType,
          data: await blob.arrayBuffer()
        })
      }
      this.recorders = [
        new TrackRecorder('microphone', microphoneOnly, mimeType, persistFragment),
        new TrackRecorder('mixed', mixedDestination.stream, mimeType, persistFragment)
      ]
      if (this.systemStream) {
        this.recorders.push(
          new TrackRecorder('system', new MediaStream(this.systemStream.getAudioTracks()), mimeType, persistFragment)
        )
      }

      this.startedAt = performance.now()
      this.segmentStartedAt = 0
      this.segmentIndex = 0
      for (const recorder of this.recorders) recorder.start(this.segmentIndex, this.segmentStartedAt)
      this.rotationTimer = window.setInterval(() => this.queueRotation(), SEGMENT_DURATION_MS)
      await window.clarity.setRecordingActive(true)
      return this.session
    } catch (error) {
      this.releaseStreams()
      if (this.session) await window.clarity.failSession(this.session.id, error instanceof Error ? error.message : String(error))
      this.session = null
      throw error
    }
  }

  private queueRotation(): void {
    if (this.stopping) return
    this.operation = this.operation.then(() => this.rotate()).catch((error) => {
      console.error('Unable to rotate recording segment', error)
    })
  }

  private async rotate(): Promise<void> {
    if (!this.session || this.stopping) return
    const endedAtMs = this.elapsedMs
    const completed = (await Promise.all(this.recorders.map((recorder) => recorder.stop(endedAtMs)))).filter(
      (entry): entry is SegmentResult => entry !== null
    )
    this.segmentIndex += 1
    this.segmentStartedAt = endedAtMs
    for (const recorder of this.recorders) recorder.start(this.segmentIndex, this.segmentStartedAt)
    await this.saveSegments(completed)
  }

  private async saveSegments(segments: SegmentResult[]): Promise<void> {
    if (!this.session) return
    await Promise.all(
      segments
        .filter((segment) => segment.hasData)
        .map(async (segment) => {
          await window.clarity.finalizeRecordingChunk({
            sessionId: this.session!.id,
            track: segment.track,
            index: segment.index,
            mimeType: segment.mimeType,
            startedAtMs: segment.startedAtMs,
            durationMs: segment.durationMs
          })
        })
    )
  }

  async stop(): Promise<SessionMetadata | null> {
    if (!this.session || this.stopping) return null
    this.stopping = true
    if (this.rotationTimer !== null) window.clearInterval(this.rotationTimer)
    this.rotationTimer = null
    await this.operation
    const durationMs = this.elapsedMs
    try {
      const completed = (await Promise.all(this.recorders.map((recorder) => recorder.stop(durationMs)))).filter(
        (entry): entry is SegmentResult => entry !== null
      )
      await this.saveSegments(completed)
      const finalized = await window.clarity.finalizeSession(this.session.id, durationMs)
      return finalized
    } catch (error) {
      await window.clarity.failSession(this.session.id, error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      await window.clarity.setRecordingActive(false)
      this.releaseStreams()
      this.session = null
      this.startedAt = 0
      this.stopping = false
      this.recorders = []
    }
  }

  private releaseStreams(): void {
    for (const track of this.microphoneStream?.getTracks() ?? []) track.stop()
    for (const track of this.systemStream?.getTracks() ?? []) track.stop()
    this.microphoneStream = null
    this.systemStream = null
    if (this.audioContext) void this.audioContext.close()
    this.audioContext = null
  }
}
