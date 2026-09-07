export function createTranscriptionJobRunner<T>() {
  const activeJobs = new Map<string, Promise<T>>()

  return (sessionId: string, operation: () => T | Promise<T>): Promise<T> => {
    const active = activeJobs.get(sessionId)
    if (active) return active

    // Register before operation starts, including credential reads and disk locks.
    // Promise.then also turns synchronous failures into retryable rejections.
    const job = Promise.resolve().then(operation).finally(() => {
      if (activeJobs.get(sessionId) === job) activeJobs.delete(sessionId)
    })
    activeJobs.set(sessionId, job)
    return job
  }
}
