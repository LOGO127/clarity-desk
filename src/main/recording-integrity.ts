import type { RecordingChunk, SessionStatus, TrackKind } from '../shared/types'

export function expectedRecordingTracks(hasSystemAudio: boolean): TrackKind[] {
  return hasSystemAudio ? ['microphone', 'system', 'mixed'] : ['microphone', 'mixed']
}

export function missingRecordingTracks(
  chunks: ReadonlyArray<Pick<RecordingChunk, 'track' | 'size'>>,
  hasSystemAudio: boolean
): TrackKind[] {
  const available = new Set(chunks.filter((chunk) => chunk.size > 0).map((chunk) => chunk.track))
  return expectedRecordingTracks(hasSystemAudio).filter((track) => !available.has(track))
}

export interface IncompleteRecordingSegment {
  index: number
  missingTracks: TrackKind[]
}

export function incompleteRecordingSegments(
  chunks: ReadonlyArray<Pick<RecordingChunk, 'track' | 'index' | 'size'>>,
  hasSystemAudio: boolean
): IncompleteRecordingSegment[] {
  const nonEmptyChunks = chunks.filter((chunk) => chunk.size > 0)
  const highestIndex = chunks.reduce((highest, chunk) => Math.max(highest, chunk.index), 0)
  const incomplete: IncompleteRecordingSegment[] = []
  for (let index = 0; index <= highestIndex; index += 1) {
    const available = new Set(nonEmptyChunks.filter((chunk) => chunk.index === index).map((chunk) => chunk.track))
    const missingTracks = expectedRecordingTracks(hasSystemAudio).filter((track) => !available.has(track))
    if (missingTracks.length > 0) incomplete.push({ index, missingTracks })
  }
  return incomplete
}

export function recordingIntegrityError(
  chunks: ReadonlyArray<Pick<RecordingChunk, 'track' | 'index' | 'size'>>,
  hasSystemAudio: boolean
): string | null {
  const incomplete = incompleteRecordingSegments(chunks, hasSystemAudio)
  if (incomplete.length === 0) return null
  const detail = incomplete
    .slice(0, 3)
    .map((segment) => `第 ${segment.index + 1} 段缺少${segment.missingTracks.map(recordingTrackLabel).join('、')}`)
    .join('；')
  return `录音不完整：${detail}${incomplete.length > 3 ? `；另有 ${incomplete.length - 3} 段不完整` : ''}。`
}

export function recoveredRecordingDisposition(
  previousStatus: SessionStatus,
  previousError: string | undefined,
  integrityError: string | null
): { status: 'ready' | 'failed'; error: string } {
  if (previousStatus === 'failed') {
    return {
      status: 'failed',
      error: `${previousError ?? '该录音此前已标记失败'}；已恢复落盘片段，但保留失败状态，请手动检查音频。`
    }
  }
  if (integrityError) return { status: 'failed', error: `上次录音异常中断，${integrityError}` }
  return {
    status: 'ready',
    error: '上次录音异常中断，Clarity Desk 已恢复落盘的完整分段。请先试听确认完整性。'
  }
}

export function recordingTrackLabel(track: TrackKind): string {
  if (track === 'microphone') return '麦克风'
  if (track === 'system') return '系统音频'
  return '混合音轨'
}
