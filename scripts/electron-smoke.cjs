const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { _electron: electron } = require('playwright')
const packageMetadata = require('../package.json')
const { waitForAppReady } = require('./electron-startup.cjs')

function isolatedSmokePaths(runDirectory) {
  const profileDirectory = path.join(runDirectory, 'electron-profile')
  return { profileDirectory, sessionRoot: path.join(profileDirectory, 'smoke-recordings') }
}

async function checkSecondLaunch(executablePath, args, cwd, env) {
  const child = spawn(executablePath, args, { cwd, env, windowsHide: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Second launch did not exit; single-instance ownership failed.'))
    }, 15_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`Second launch exited with code ${code}.`))
    })
  })
}

async function deferMicrophonePermission(page) {
  await page.evaluate(() => {
    const devices = navigator.mediaDevices
    const original = devices.getUserMedia.bind(devices)
    devices.getUserMedia = (constraints) => new Promise((resolve, reject) => {
      window.smokeMicrophonePermissionPending = true
      window.smokeResolveMicrophonePermission = async (allowed) => {
        devices.getUserMedia = original
        window.smokeMicrophonePermissionPending = false
        if (!allowed) {
          reject(new DOMException('Synthetic permission cancellation', 'NotAllowedError'))
          return
        }
        try { resolve(await original(constraints)) } catch (error) { reject(error) }
      }
    })
  })
}

async function checkStartingNavigationLock(page) {
  await page.waitForFunction(() => window.smokeMicrophonePermissionPending === true)
  for (const name of ['公式居中', '录音记录', '设置']) {
    const button = page.getByRole('button', { name, exact: true })
    assert.equal(await button.isDisabled(), true, `${name} must be locked while device permission is pending`)
    await button.click({ force: true })
    assert.equal(await page.getByRole('heading', { name: '记录一场面试' }).count(), 1)
  }
}

async function checkExternalNavigation(application, page) {
  await page.getByRole('button', { name: '公式居中', exact: true }).click()
  await page.getByRole('button', { name: 'Markdown 导入（可选）' }).click()
  await page.getByLabel('Markdown 原文').fill('[导航检查](https://example.com/clarity-smoke)')
  const rendererUrl = page.url()
  await application.evaluate(({ shell }) => {
    globalThis.smokeExternalUrls = []
    shell.openExternal = async (url) => { globalThis.smokeExternalUrls.push(url) }
  })
  await page.getByRole('link', { name: '导航检查' }).click({ noWaitAfter: true })
  await page.waitForTimeout(250)
  assert.equal(page.url(), rendererUrl)
  assert.deepEqual(await application.evaluate(() => globalThis.smokeExternalUrls), ['https://example.com/clarity-smoke'])
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const artifactRoot = path.join(root, 'output', 'playwright')
  const packaged = process.argv.includes('--packaged')
  const prefix = packaged ? 'packaged' : 'iteration'
  await fs.mkdir(artifactRoot, { recursive: true })
  const runDirectory = await fs.mkdtemp(path.join(artifactRoot, 'smoke-'))
  const { profileDirectory, sessionRoot } = isolatedSmokePaths(runDirectory)
  const messages = []
  const executablePath = packaged ? path.join(root, 'release', 'win-unpacked', 'Clarity Desk.exe') : require('electron')
  const commonArgs = [`--user-data-dir=${profileDirectory}`, '--clarity-smoke-test']
  const args = packaged
    ? commonArgs
    : [...commonArgs, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '.']
  const env = { ...process.env }
  // Both modes must exercise the built renderer, not an inherited dev server.
  delete env.ELECTRON_RENDERER_URL
  const application = await electron.launch({
    cwd: root,
    executablePath,
    args,
    env
  })

  try {
    const appPath = await application.evaluate(({ app }) => app.getAppPath())
    const expectedUrl = pathToFileURL(path.join(appPath, 'out', 'renderer', 'index.html')).href
    const page = await application.firstWindow()
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') messages.push(`${message.type()}: ${message.text()}`)
    })
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))
    const appInfo = await waitForAppReady(page, expectedUrl)
    assert.equal(path.resolve(appInfo.recordingsDirectory).toLowerCase(), path.resolve(sessionRoot).toLowerCase(),
      'Smoke recordings must use the isolated profile before startup recovery runs')

    const initialResources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
    assert.ok(!initialResources.some((name) => /FormulaImport|KaTeX/.test(name)), 'Optional formula renderer must not load at startup')
    await page.screenshot({ path: path.join(artifactRoot, `${prefix}-formula.png`), fullPage: true })
    await page.getByRole('button', { name: 'Markdown 导入（可选）' }).click()
    await page.getByLabel('Markdown 原文').waitFor()
    await page.locator('.katex').first().waitFor()

    await page.getByRole('button', { name: '设置' }).click()
    await page.getByText(`v${packageMetadata.version} · win32`).waitFor()

    if (packaged) {
      await checkSecondLaunch(executablePath, args, root, env)
      await checkExternalNavigation(application, page)
      assert.equal(messages.length, 0, messages.join('\n'))
      process.stdout.write('PACKAGED_SMOKE_OK\n')
      return
    }

    await page.getByRole('button', { name: '面试录音' }).click()
    await page.getByText('同时录制系统声音').click()
    await page.getByLabel('本场面试名称').fill('自动化录音完整性检查')
    await page.getByText('我已明确告知对方并取得录音同意').click()
    await page.screenshot({ path: path.join(artifactRoot, 'iteration-interview.png'), fullPage: true })
    await deferMicrophonePermission(page)
    await page.getByRole('button', { name: '开始录音', exact: true }).click()
    await checkStartingNavigationLock(page)
    await page.evaluate(() => window.smokeResolveMicrophonePermission(false))
    await page.waitForFunction(() => ![...document.querySelectorAll('.compact-navigation button')].some((button) => button.disabled))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByText(`v${packageMetadata.version} · win32`).waitFor()
    // Returning after cancellation must provide a clean recorder that can start.
    await page.getByRole('button', { name: '面试录音', exact: true }).click()
    await page.getByText('同时录制系统声音').click()
    await page.getByLabel('本场面试名称').fill('自动化录音完整性检查')
    await page.getByText('我已明确告知对方并取得录音同意').click()
    await deferMicrophonePermission(page)
    await page.getByRole('button', { name: '开始录音', exact: true }).click()
    await checkStartingNavigationLock(page)
    await page.evaluate(() => window.smokeResolveMicrophonePermission(true))
    await page.getByRole('button', { name: '结束并保存录音' }).waitFor({ timeout: 15_000 })
    await page.getByText(/请检查声音|声源检查通过/).waitFor({ timeout: 8_000 })
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: path.join(artifactRoot, 'iteration-recording-health.png'), fullPage: true })
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false)
    const confirm = page.getByRole('button', { name: '确认声音并最小化' })
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认声音并最小化'))
      return button && !button.disabled
    }, undefined, { timeout: 15_000 })
    await confirm.click()
    await page.waitForTimeout(300)
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true)
    const recordingDirectories = (await fs.readdir(sessionRoot)).filter((name) => name.startsWith('session-'))
    assert.equal(recordingDirectories.length, 1, 'Cancelled startup must not create a recording session')
    const activeDirectory = path.join(sessionRoot, recordingDirectories[0])
    const beforeSecondLaunch = JSON.parse(await fs.readFile(path.join(activeDirectory, 'metadata.json'), 'utf8'))
    assert.equal(beforeSecondLaunch.status, 'recording')
    assert.equal(beforeSecondLaunch.chunks.length, 0)
    await checkSecondLaunch(executablePath, args, root, env)
    await page.waitForFunction(() => document.querySelector('.recording-page'))
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false)
    const afterSecondLaunch = JSON.parse(await fs.readFile(path.join(activeDirectory, 'metadata.json'), 'utf8'))
    assert.equal(afterSecondLaunch.status, 'recording', 'Second launch must not recover an active session')
    assert.equal(afterSecondLaunch.chunks.length, 0, 'Second launch must not publish active recording chunks')
    const activeFiles = await fs.readdir(activeDirectory)
    assert.equal(activeFiles.filter((name) => name.endsWith('.partial')).length, 2)
    assert.equal(activeFiles.filter((name) => /\.(webm|ogg|m4a)$/.test(name)).length, 0)
    await page.getByRole('button', { name: '结束并保存录音' }).click()
    await page.getByText('自动化录音完整性检查').waitFor({ timeout: 15_000 })
    await page.getByText('待转写').waitFor()
    const directories = (await fs.readdir(sessionRoot)).filter((name) => name.startsWith('session-'))
    const metadata = JSON.parse(await fs.readFile(path.join(sessionRoot, directories[0], 'metadata.json'), 'utf8'))
    assert.equal(metadata.status, 'ready')
    assert.deepEqual(metadata.chunks.map((chunk) => chunk.track).sort(), ['microphone', 'mixed'])
    assert.ok(metadata.chunks.every((chunk) => chunk.size > 0))
    await checkExternalNavigation(application, page)

    if (messages.length > 0) throw new Error(`renderer diagnostics:\n${messages.join('\n')}`)
    process.stdout.write(`ELECTRON_SMOKE_OK\nsession_root=${sessionRoot}\n`)
  } finally {
    await application.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
