import { describe, expect, it } from 'vitest'
import {
  expectedRecordingTracks,
  incompleteRecordingSegments,
  missingRecordingTracks,
  recordingIntegrityError,
  recoveredRecordingDisposition
} from './recording-integrity'

describe('recording integrity', () => {
  it('requires microphone, system, and mixed tracks when system audio is enabled', () => {
    expect(expectedRecordingTracks(true)).toEqual(['microphone', 'system', 'mixed'])
    expect(
      missingRecordingTracks(
        [
          { track: 'microphone', size: 128 },
          { track: 'mixed', size: 256 }
        ],
        true
      )
    ).toEqual(['system'])
  })

  it('does not require a system track when system audio is disabled', () => {
    expect(
      missingRecordingTracks(
        [
          { track: 'microphone', size: 128 },
          { track: 'mixed', size: 256 }
        ],
        false
      )
    ).toEqual([])
  })

  it('treats an empty chunk as missing', () => {
    expect(
      missingRecordingTracks(
        [
          { track: 'microphone', size: 0 },
          { track: 'mixed', size: 256 }
        ],
        false
      )
    ).toEqual(['microphone'])
  })

  it('rejects a later segment that loses one expected track', () => {
    const chunks = [
      { track: 'microphone' as const, index: 0, size: 128 },
      { track: 'system' as const, index: 0, size: 128 },
      { track: 'mixed' as const, index: 0, size: 128 },
      { track: 'microphone' as const, index: 1, size: 128 },
      { track: 'mixed' as const, index: 1, size: 128 }
    ]
    expect(incompleteRecordingSegments(chunks, true)).toEqual([{ index: 1, missingTracks: ['system'] }])
    expect(recordingIntegrityError(chunks, true)).toContain('第 2 段缺少系统音频')
  })

  it('rejects a missing segment index between finalized segments', () => {
    const chunks = [
      { track: 'microphone' as const, index: 0, size: 128 },
      { track: 'mixed' as const, index: 0, size: 128 },
      { track: 'microphone' as const, index: 2, size: 128 },
      { track: 'mixed' as const, index: 2, size: 128 }
    ]
    expect(incompleteRecordingSegments(chunks, false)).toContainEqual({ index: 1, missingTracks: ['microphone', 'mixed'] })
  })

  it('does not hide a trailing segment whose recorded files are all empty', () => {
    const chunks = [
      { track: 'microphone' as const, index: 0, size: 128 },
      { track: 'mixed' as const, index: 0, size: 128 },
      { track: 'microphone' as const, index: 1, size: 0 },
      { track: 'mixed' as const, index: 1, size: 0 }
    ]
    expect(incompleteRecordingSegments(chunks, false)).toEqual([{ index: 1, missingTracks: ['microphone', 'mixed'] }])
  })

  it('never upgrades a previously failed recording during partial-file recovery', () => {
    expect(recoveredRecordingDisposition('failed', '设备断开', null)).toEqual({
      status: 'failed',
      error: '设备断开；已恢复落盘片段，但保留失败状态，请手动检查音频。'
    })
  })
})
