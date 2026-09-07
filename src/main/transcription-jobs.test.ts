import { describe, expect, it, vi } from 'vitest'
import { createTranscriptionJobRunner } from './transcription-jobs'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('transcription job deduplication', () => {
  it('registers before starting work and shares one job while credentials are pending', async () => {
    const run = createTranscriptionJobRunner<string>()
    const credentials = deferred<string>()
    const transcribe = vi.fn(async () => 'transcript')
    const operation = vi.fn(async () => {
      await credentials.promise
      return transcribe()
    })
    const first = run('session-a', operation)
    const immediateDuplicate = run('session-a', operation)
    expect(operation).not.toHaveBeenCalled()
    expect(immediateDuplicate).toBe(first)
    await Promise.resolve()
    expect(operation).toHaveBeenCalledOnce()
    const pendingDuplicate = run('session-a', operation)
    expect(pendingDuplicate).toBe(first)

    credentials.resolve('synthetic credential, never sent')
    await expect(Promise.all([first, immediateDuplicate, pendingDuplicate])).resolves.toEqual([
      'transcript', 'transcript', 'transcript'
    ])
    expect(transcribe).toHaveBeenCalledOnce()
  })

  it('allows different sessions to run independently', async () => {
    const run = createTranscriptionJobRunner<string>()
    const pendingA = deferred<string>()
    const pendingB = deferred<string>()
    const operationA = vi.fn(() => pendingA.promise)
    const operationB = vi.fn(() => pendingB.promise)
    const first = run('session-a', operationA)
    const second = run('session-b', operationB)
    await Promise.resolve()
    expect(operationA).toHaveBeenCalledOnce()
    expect(operationB).toHaveBeenCalledOnce()
    pendingB.resolve('B')
    await expect(second).resolves.toBe('B')
    expect(run('session-a', operationA)).toBe(first)
    pendingA.resolve('A')
    await expect(first).resolves.toBe('A')
  })

  it('clears a successful job without permanently caching its result', async () => {
    const run = createTranscriptionJobRunner<string>()
    const operation = vi.fn(async () => 'transcript')
    const first = run('session-a', operation)
    await first
    const next = run('session-a', operation)
    expect(next).not.toBe(first)
    await expect(next).resolves.toBe('transcript')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('shares a failure, clears the job, and permits an explicit retry', async () => {
    const run = createTranscriptionJobRunner<string>()
    const pending = deferred<string>()
    const operation = vi.fn(() => pending.promise)
    const first = run('session-a', operation)
    const duplicate = run('session-a', operation)
    expect(duplicate).toBe(first)
    const rejected = expect(Promise.all([first, duplicate])).rejects.toThrow('network interrupted')
    pending.reject(new Error('network interrupted'))
    await rejected
    expect(operation).toHaveBeenCalledOnce()

    const retry = vi.fn(async () => 'resumed transcript')
    await expect(run('session-a', retry)).resolves.toBe('resumed transcript')
    expect(retry).toHaveBeenCalledOnce()
  })

  it('cleans up synchronous exceptions without leaving a rejected background promise', async () => {
    const run = createTranscriptionJobRunner<string>()
    const operation = vi.fn(() => { throw new Error('synchronous failure') })
    const first = run('session-a', operation)
    expect(run('session-a', operation)).toBe(first)
    await expect(first).rejects.toThrow('synchronous failure')
    expect(operation).toHaveBeenCalledOnce()
    await expect(run('session-a', () => 'retry')).resolves.toBe('retry')
  })
})
