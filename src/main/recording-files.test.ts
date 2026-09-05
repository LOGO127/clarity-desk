import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finalizeAudioChunkFile, recoverUnindexedRecordingChunks } from './recording-files'
import { recoveredRecordingDisposition, recordingIntegrityError } from './recording-integrity'

describe('recording file recovery', () => {
  let directory: string
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clarity-recording-files-'))
  })
  afterEach(async () => {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('clarity-recording-files-')) {
      throw new Error('Unexpected temporary test directory')
    }
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('retries finalization after publication succeeded but metadata persistence failed', async () => {
    const fileName = 'mixed-0000.webm'
    await fs.writeFile(path.join(directory, `${fileName}.partial`), 'recorded-audio')
    await expect((async () => {
      await finalizeAudioChunkFile(directory, fileName)
      throw new Error('metadata write failed')
    })()).rejects.toThrow('metadata write failed')
    await expect(fs.stat(path.join(directory, `${fileName}.partial`))).rejects.toMatchObject({ code: 'ENOENT' })

    const retried = await finalizeAudioChunkFile(directory, fileName)
    expect(retried.size).toBe(Buffer.byteLength('recorded-audio'))
    expect(await fs.readFile(path.join(directory, fileName), 'utf8')).toBe('recorded-audio')
  })

  it('never replaces an existing final file and retains a conflicting partial', async () => {
    await fs.writeFile(path.join(directory, 'mixed-0000.webm'), 'original-audio')
    await fs.writeFile(path.join(directory, 'mixed-0000.webm.partial'), 'other-audio')
    await finalizeAudioChunkFile(directory, 'mixed-0000.webm')
    expect(await fs.readFile(path.join(directory, 'mixed-0000.webm'), 'utf8')).toBe('original-audio')
    expect(await fs.readFile(path.join(directory, 'mixed-0000.webm.partial'), 'utf8')).toBe('other-audio')
  })

  it('finds orphaned final files and partial files together without upgrading a failed session', async () => {
    await fs.writeFile(path.join(directory, 'microphone-0000.webm'), 'microphone')
    await fs.writeFile(path.join(directory, 'mixed-0000.webm.partial'), 'mixed')
    await fs.writeFile(path.join(directory, 'notes.txt'), 'ignored')
    const recovered = await recoverUnindexedRecordingChunks(directory, {
      chunks: [], createdAt: new Date(Date.now() - 2_000).toISOString()
    }, 600_000)
    expect(recovered.chunks.map((chunk) => chunk.track).sort()).toEqual(['microphone', 'mixed'])
    expect(recovered.errors).toEqual([])
    expect(recordingIntegrityError(recovered.chunks, false)).toBeNull()
    expect(recoveredRecordingDisposition('failed', 'metadata write failed', null).status).toBe('failed')
    expect(await fs.readFile(path.join(directory, 'mixed-0000.webm'), 'utf8')).toBe('mixed')
    const repeated = await recoverUnindexedRecordingChunks(directory, {
      chunks: recovered.chunks, createdAt: new Date().toISOString()
    }, 600_000)
    expect(repeated.chunks).toEqual([])
  })

  it('still recovers healthy files if another orphaned file is empty', async () => {
    await fs.writeFile(path.join(directory, 'microphone-0000.webm'), '')
    await fs.writeFile(path.join(directory, 'mixed-0000.webm'), 'mixed')
    const recovered = await recoverUnindexedRecordingChunks(directory, {
      chunks: [], createdAt: new Date().toISOString()
    }, 600_000)
    expect(recovered.chunks.map((chunk) => chunk.track)).toEqual(['mixed'])
    expect(recovered.errors).toHaveLength(1)
    expect(recordingIntegrityError(recovered.chunks, false)).toContain('麦克风')
    expect((await fs.stat(path.join(directory, 'microphone-0000.webm'))).size).toBe(0)
  })

  it('rejects paths outside the recording naming convention', async () => {
    await expect(finalizeAudioChunkFile(directory, '../outside.webm')).rejects.toThrow('无效的音频文件名')
    await expect(finalizeAudioChunkFile(directory, 'mixed-10001.webm')).rejects.toThrow('无效的音频文件名')
  })
})
