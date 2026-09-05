import { describe, expect, it, vi } from 'vitest'
import type { RecordingChunk } from '../shared/types'
import {
  labelChunkSpeakers,
  parseTranscriptionSegments,
  resumeTranscriptionChunks,
  reusableCheckpointChunk
} from './transcript-checkpoint'

describe('transcription checkpoints', () => {
  it('rejects missing and malformed segments instead of accepting an empty transcript', () => {
    expect(() => parseTranscriptionSegments({}, 0)).toThrow('缺少 segments')
    expect(() => parseTranscriptionSegments({ segments: [] }, 0)).toThrow('没有返回有效')
    expect(() => parseTranscriptionSegments({ segments: [{ speaker: 'A', text: '', start: 0, end: 1 }] }, 0)).toThrow(
      '不完整'
    )
  })

  it('normalizes valid segments and applies the chunk offset', () => {
    expect(parseTranscriptionSegments({ segments: [{ speaker: 'A', text: ' 你好 ', start: 1, end: 2 }] }, 600)).toEqual([
      { speaker: 'A', text: '你好', start: 601, end: 602 }
    ])
  })

  it('reuses only checkpoints from the same session and unchanged file', () => {
    const checkpoint = {
      schemaVersion: 1 as const,
      sessionId: 'session-1',
      updatedAt: '2026-09-05T00:00:00.000Z',
      chunks: [{ fileName: 'mixed-0000.webm', size: 42, segments: [{ speaker: 'A', text: '你好', start: 0, end: 1 }] }]
    }
    expect(reusableCheckpointChunk(checkpoint, 'session-1', { fileName: 'mixed-0000.webm', size: 42 })).toBeDefined()
    expect(reusableCheckpointChunk(checkpoint, 'session-2', { fileName: 'mixed-0000.webm', size: 42 })).toBeUndefined()
    expect(reusableCheckpointChunk(checkpoint, 'session-1', { fileName: 'mixed-0000.webm', size: 43 })).toBeUndefined()
  })

  it('makes cross-chunk speaker labels explicitly local to each chunk', () => {
    const source = [{ speaker: 'A', text: '你好', start: 0, end: 1 }]
    expect(labelChunkSpeakers(source, 1, 3)[0]?.speaker).toBe('片段 02 · A')
    expect(labelChunkSpeakers(source, 0, 1)[0]?.speaker).toBe('A')
  })

  it('keeps the loaded checkpoint immutable so every cached chunk is reused', async () => {
    const segments = [{ speaker: 'A', text: '缓存', start: 0, end: 1 }]
    const chunks = [
      { track: 'mixed' as const, index: 0, fileName: 'mixed-0000.webm', mimeType: 'audio/webm', size: 40, startedAtMs: 0, durationMs: 1_000 },
      { track: 'mixed' as const, index: 1, fileName: 'mixed-0001.webm', mimeType: 'audio/webm', size: 41, startedAtMs: 1_000, durationMs: 1_000 }
    ]
    const checkpoint = {
      schemaVersion: 1 as const,
      sessionId: 'session-1',
      updatedAt: '2026-09-05T00:00:00.000Z',
      chunks: chunks.map((chunk) => ({ fileName: chunk.fileName, size: chunk.size, segments }))
    }
    const transcribe = vi.fn(async () => segments)
    const savedLengths: number[] = []

    const completed = await resumeTranscriptionChunks(
      'session-1',
      chunks,
      checkpoint,
      transcribe,
      async (progress) => { savedLengths.push(progress.length) }
    )

    expect(transcribe).not.toHaveBeenCalled()
    expect(completed).toHaveLength(2)
    expect(savedLengths).toEqual([2])
    expect(checkpoint.chunks).toHaveLength(2)
  })

  it('keeps later cached chunks on disk if a missing earlier chunk fails during retry', async () => {
    const segments = [{ speaker: 'A', text: '缓存', start: 0, end: 1 }]
    const chunks = Array.from({ length: 4 }, (_, index) => ({
      track: 'mixed' as const,
      index,
      fileName: `mixed-${index}.webm`,
      mimeType: 'audio/webm',
      size: 40 + index,
      startedAtMs: index * 1_000,
      durationMs: 1_000
    }))
    const checkpoint = {
      schemaVersion: 1 as const,
      sessionId: 'session-1',
      updatedAt: '2026-09-05T00:00:00.000Z',
      chunks: [chunks[0]!, chunks[3]!].map((chunk) => ({ fileName: chunk.fileName, size: chunk.size, segments }))
    }
    const transcribe = vi.fn(async (chunk: RecordingChunk) => {
      if (chunk.index === 2) throw new Error('network failed')
      return segments
    })
    let diskProgress = checkpoint.chunks

    await expect(resumeTranscriptionChunks('session-1', chunks, checkpoint, transcribe, async (progress) => {
      diskProgress = progress
    })).rejects.toThrow('network failed')

    expect(diskProgress.map((chunk) => chunk.fileName)).toEqual(['mixed-0.webm', 'mixed-1.webm', 'mixed-3.webm'])
    const retry = vi.fn(async () => segments)
    const completed = await resumeTranscriptionChunks(
      'session-1', chunks, { ...checkpoint, chunks: diskProgress }, retry, async () => undefined
    )
    expect(retry).toHaveBeenCalledOnce()
    expect(retry).toHaveBeenCalledWith(chunks[2])
    expect(completed.map((chunk) => chunk.fileName)).toEqual(chunks.map((chunk) => chunk.fileName))
  })
})
