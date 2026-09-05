import type { RecordingChunk, TranscriptSegment } from '../shared/types'

export interface TranscriptCheckpointChunk {
  fileName: string
  size: number
  segments: TranscriptSegment[]
}

export interface TranscriptCheckpoint {
  schemaVersion: 1
  sessionId: string
  updatedAt: string
  chunks: TranscriptCheckpointChunk[]
}

export function parseTranscriptionSegments(payload: unknown, offsetSeconds: number): TranscriptSegment[] {
  if (typeof payload !== 'object' || payload === null || !('segments' in payload)) {
    throw new Error('转写服务返回的数据缺少 segments。')
  }
  const segments = (payload as { segments?: unknown }).segments
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('转写服务没有返回有效的文字片段。')
  }

  return segments.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`转写服务返回的第 ${index + 1} 个片段格式无效。`)
    }
    const segment = value as Record<string, unknown>
    const text = typeof segment.text === 'string' ? segment.text.trim() : ''
    const start = segment.start
    const end = segment.end
    if (!text || typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end)) {
      throw new Error(`转写服务返回的第 ${index + 1} 个片段不完整。`)
    }
    if (start < 0 || end < start) throw new Error(`转写服务返回的第 ${index + 1} 个时间范围无效。`)

    return {
      speaker: typeof segment.speaker === 'string' && segment.speaker.trim() ? segment.speaker.trim() : '说话人',
      text,
      start: offsetSeconds + start,
      end: offsetSeconds + end
    }
  })
}

export function reusableCheckpointChunk(
  checkpoint: TranscriptCheckpoint | null,
  sessionId: string,
  chunk: Pick<RecordingChunk, 'fileName' | 'size'>
): TranscriptCheckpointChunk | undefined {
  if (
    !checkpoint ||
    checkpoint.schemaVersion !== 1 ||
    checkpoint.sessionId !== sessionId ||
    !Array.isArray(checkpoint.chunks)
  ) return undefined
  return checkpoint.chunks.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      entry.fileName === chunk.fileName &&
      entry.size === chunk.size &&
      Array.isArray(entry.segments) &&
      entry.segments.length > 0 &&
      entry.segments.every(
        (segment) =>
          typeof segment === 'object' &&
          segment !== null &&
          typeof segment.speaker === 'string' &&
          typeof segment.text === 'string' &&
          segment.text.trim().length > 0 &&
          typeof segment.start === 'number' &&
          Number.isFinite(segment.start) &&
          typeof segment.end === 'number' &&
          Number.isFinite(segment.end) &&
          segment.end >= segment.start
      )
  )
}

export async function resumeTranscriptionChunks(
  sessionId: string,
  chunks: ReadonlyArray<RecordingChunk>,
  loadedCheckpoint: TranscriptCheckpoint | null,
  transcribe: (chunk: RecordingChunk) => Promise<TranscriptSegment[]>,
  saveProgress: (completed: TranscriptCheckpointChunk[]) => Promise<void>
): Promise<TranscriptCheckpointChunk[]> {
  const completed = new Map<string, TranscriptCheckpointChunk>()
  // Preserve every reusable entry, including entries after the next failed request.
  for (const chunk of chunks) {
    const cached = reusableCheckpointChunk(loadedCheckpoint, sessionId, chunk)
    if (cached) completed.set(chunk.fileName, cached)
  }
  const progress = () => chunks.flatMap((chunk) => {
    const entry = completed.get(chunk.fileName)
    return entry ? [entry] : []
  })
  if (completed.size > 0) await saveProgress(progress())
  for (const chunk of chunks) {
    if (completed.has(chunk.fileName)) continue
    completed.set(chunk.fileName, {
      fileName: chunk.fileName,
      size: chunk.size,
      segments: await transcribe(chunk)
    })
    await saveProgress(progress())
  }
  return progress()
}

export function labelChunkSpeakers(
  segments: ReadonlyArray<TranscriptSegment>,
  chunkIndex: number,
  chunkCount: number
): TranscriptSegment[] {
  if (chunkCount <= 1) return segments.map((segment) => ({ ...segment }))
  const label = `片段 ${(chunkIndex + 1).toString().padStart(2, '0')}`
  return segments.map((segment) => ({ ...segment, speaker: `${label} · ${segment.speaker}` }))
}
