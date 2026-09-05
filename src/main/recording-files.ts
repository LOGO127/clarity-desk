import { promises as fs } from 'node:fs'
import type { Stats } from 'node:fs'
import path from 'node:path'
import type { RecordingChunk, SessionMetadata } from '../shared/types'

const AUDIO_FILE_PATTERN = /^(microphone|system|mixed)-(\d{4,5})\.(webm|ogg|m4a)$/

function parseAudioFileName(fileName: string): RegExpMatchArray | null {
  const match = fileName.match(AUDIO_FILE_PATTERN)
  return match && Number(match[2]) <= 10_000 ? match : null
}

export async function finalizeAudioChunkFile(directory: string, fileName: string): Promise<Stats> {
  if (!parseAudioFileName(fileName)) throw new Error('无效的音频文件名。')
  const finalPath = path.join(directory, fileName)
  const partialPath = `${finalPath}.partial`
  // A hard link publishes the existing bytes atomically and never replaces a file.
  // If metadata persistence failed after publication, the final file is reusable.
  let published = false
  try {
    await fs.link(partialPath, finalPath)
    published = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENOENT') throw error
  }
  const stat = await fs.stat(finalPath)
  if (!stat.isFile() || stat.size === 0) throw new Error(`${fileName} 没有有效的音频数据，已保留原文件。`)
  if (published) await fs.unlink(partialPath)
  // An independently existing final file wins; any conflicting partial is retained.
  return stat
}

export async function recoverUnindexedRecordingChunks(
  directory: string,
  metadata: Pick<SessionMetadata, 'chunks' | 'createdAt'>,
  segmentDurationMs: number
): Promise<{ chunks: RecordingChunk[]; errors: string[] }> {
  const files = await fs.readdir(directory)
  const candidates = new Set(files.map((file) => file.replace(/\.partial$/, '')).filter((file) => parseAudioFileName(file)))
  const chunks: RecordingChunk[] = []
  const errors: string[] = []
  for (const fileName of candidates) {
    const match = parseAudioFileName(fileName)!
    const track = match[1] as RecordingChunk['track']
    const index = Number(match[2])
    const existing = metadata.chunks.find((chunk) => chunk.track === track && chunk.index === index)
    if (existing && existing.size > 0) continue
    try {
      const stat = await finalizeAudioChunkFile(directory, fileName)
      const startedAtMs = existing?.startedAtMs ?? index * segmentDurationMs
      const elapsedByMtime = Math.max(1_000, stat.mtimeMs - new Date(metadata.createdAt).getTime() - startedAtMs)
      const durationMs = existing?.durationMs ?? Math.min(segmentDurationMs, elapsedByMtime)
      chunks.push({
        track,
        index,
        fileName,
        mimeType: match[3] === 'ogg' ? 'audio/ogg' : match[3] === 'm4a' ? 'audio/mp4' : 'audio/webm',
        size: stat.size,
        startedAtMs,
        durationMs
      })
    } catch (error) {
      errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { chunks, errors }
}
