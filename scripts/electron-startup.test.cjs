const assert = require('node:assert/strict')
const { test } = require('node:test')
const { waitForAppReady } = require('./electron-startup.cjs')

const expectedUrl = 'file:///C:/Clarity%20Desk/resources/app.asar/out/renderer/index.html'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('does not read app info until both exact navigation and the real heading are ready', async () => {
  const navigation = deferred()
  const heading = deferred()
  const headingWaitStarted = deferred()
  const calls = []
  const appInfo = { recordingsDirectory: 'isolated/smoke-recordings' }
  const page = {
    waitForURL: async (_predicate, options) => {
      assert.deepEqual(options, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      calls.push('navigation')
      await navigation.promise
    },
    getByRole: (role, options) => {
      assert.equal(role, 'heading')
      assert.deepEqual(options, { name: '飞书文档里的公式，一键居中', exact: true })
      return { waitFor: async (waitOptions) => {
        assert.deepEqual(waitOptions, { timeout: 30_000 })
        calls.push('heading')
        headingWaitStarted.resolve()
        await heading.promise
      } }
    },
    evaluate: async () => { calls.push('appInfo'); return appInfo }
  }
  const ready = waitForAppReady(page, expectedUrl)
  assert.deepEqual(calls, ['navigation'])
  navigation.resolve()
  await headingWaitStarted.promise
  assert.deepEqual(calls, ['navigation', 'heading'])
  heading.resolve()
  assert.equal(await ready, appInfo)
  assert.deepEqual(calls, ['navigation', 'heading', 'appInfo'])
})

test('requires the full encoded renderer URL, not an empty page or similar filename', async () => {
  await waitForAppReady({
    waitForURL: async (predicate) => {
      assert.equal(predicate(new URL(expectedUrl)), true)
      for (const url of ['about:blank', `${expectedUrl}.backup`, `${expectedUrl}?other=1`, expectedUrl.replace('/app.asar/', '/other.asar/')]) {
        assert.equal(predicate(new URL(url)), false)
      }
    },
    getByRole: () => ({ waitFor: async () => {} }),
    evaluate: async () => ({})
  }, expectedUrl)
})

test('propagates navigation timeout without inspecting a wrong page or calling IPC', async () => {
  const timeoutError = new Error('Navigation timed out')
  await assert.rejects(waitForAppReady({
    waitForURL: async (_predicate, options) => { assert.equal(options.timeout, 25); throw timeoutError },
    getByRole: () => assert.fail('Must not inspect the wrong page'),
    evaluate: () => assert.fail('Must not call IPC')
  }, expectedUrl, 25), (error) => error === timeoutError)
})

test('propagates missing-heading timeout without calling IPC', async () => {
  const timeoutError = new Error('Heading timed out')
  await assert.rejects(waitForAppReady({
    waitForURL: async () => {},
    getByRole: () => ({ waitFor: async (options) => { assert.equal(options.timeout, 25); throw timeoutError } }),
    evaluate: () => assert.fail('Must not call IPC')
  }, expectedUrl, 25), (error) => error === timeoutError)
})
