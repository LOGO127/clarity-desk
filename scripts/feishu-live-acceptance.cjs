const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')

// This is an opt-in live write test, not a CI smoke test. Only point it at a
// disposable, authorized test document with at least one uncentered formula.
function authorizedDocumentUrl() {
  if (process.env.CLARITY_ALLOW_TEST_DOCUMENT_WRITE !== '1') {
    throw new Error('Refusing live test: set CLARITY_ALLOW_TEST_DOCUMENT_WRITE=1 only after authorizing the test document.')
  }
  let documentUrl
  try {
    documentUrl = new URL(process.env.FEISHU_TEST_DOC_URL || '')
  } catch {
    throw new Error('FEISHU_TEST_DOC_URL must contain an authorized HTTPS Feishu docx test document URL.')
  }
  const allowedHost = ['feishu.cn', 'larksuite.com'].some((domain) =>
    documentUrl.hostname === domain || documentUrl.hostname.endsWith(`.${domain}`))
  if (documentUrl.protocol !== 'https:' || !allowedHost || documentUrl.port
    || documentUrl.username || documentUrl.password
    || !/^\/docx\/[a-zA-Z0-9]+\/?$/.test(documentUrl.pathname)) {
    throw new Error('Refusing target: only HTTPS Feishu/Lark docx URLs without credentials or a custom port are accepted.')
  }
  // Tracking parameters and fragments are not needed for document operations.
  documentUrl.search = ''
  documentUrl.hash = ''
  return documentUrl.toString()
}

function redactDiagnostic(value) {
  return String(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_token|refresh_token|client_secret|app_secret|device_code|api_key)["'\s]*[:=]["'\s]*)[^\s,"'}]+/gi, '$1[REDACTED]')
}

async function readUiResult(page) {
  return page.locator('.center-result').evaluate((element) => {
    const metrics = Object.fromEntries([...element.querySelectorAll('.result-metrics > div')].map((metric) => [
      metric.querySelector('span')?.textContent?.trim(),
      Number(metric.querySelector('strong')?.textContent?.trim())
    ]))
    return {
      status: ['completed', 'partial', 'failed'].find((status) => element.classList.contains(status)) || 'unknown',
      heading: element.querySelector('.result-heading strong')?.textContent?.trim() || '',
      message: element.querySelector('.result-heading span')?.textContent?.trim() || '',
      totalFormulaCount: metrics['独立公式'],
      submittedFormulaCount: metrics['已提交更新'],
      updatedFormulaCount: metrics['本次确认居中'],
      verifiedCenteredCount: metrics['共确认居中']
    }
  })
}

async function clickAndCapture(page, documentUrl, runDirectory, label) {
  const input = page.getByLabel('飞书文档链接', { exact: true })
  // Clear the previous result through the real onChange handler so the second
  // pass cannot accidentally capture the first pass's result panel.
  await input.fill('')
  await input.fill(documentUrl)
  await page.locator('.center-result').waitFor({ state: 'hidden' })
  const button = page.getByRole('button', { name: '一键居中', exact: true })
  await button.click()
  await page.waitForFunction(() => {
    const input = document.getElementById('existing-document-url')
    const result = document.querySelector('.center-result')
    const errorToast = document.querySelector('.toast-error')
    return input && !input.disabled && (result || errorToast)
  }, undefined, { timeout: 180_000 })

  if (await page.locator('.center-result').count() === 0) {
    const message = redactDiagnostic(await page.locator('.toast-error').allTextContents())
    await fs.writeFile(path.join(runDirectory, `${label}-error.txt`), message, 'utf8')
    // Error screenshots can include CLI diagnostics, so do not save them.
    throw new Error(`${label}: the real UI reported an error; see the redacted local error artifact.`)
  }

  const result = await readUiResult(page)
  result.message = redactDiagnostic(result.message)
  await fs.writeFile(path.join(runDirectory, `${label}-result.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  await page.screenshot({
    path: path.join(runDirectory, `${label}.png`),
    fullPage: true,
    // The sanitized message is in JSON. Raw CLI diagnostics never enter images.
    mask: [page.locator('.toast-stack'), page.locator('.result-heading span')]
  })
  return result
}

function verifyFirstPass(result) {
  assert.equal(result.status, 'completed', 'First pass did not complete; inspect its local result before retrying.')
  assert.ok(Number.isInteger(result.totalFormulaCount) && result.totalFormulaCount > 0, 'Test document must contain recognizable formulas.')
  assert.ok(Number.isInteger(result.submittedFormulaCount) && result.submittedFormulaCount > 0,
    'At least one formula must start uncentered: an already-centered document does not prove a live update.')
  assert.equal(result.updatedFormulaCount, result.submittedFormulaCount, 'Not every submitted formula was confirmed by application readback.')
  assert.equal(result.verifiedCenteredCount, result.totalFormulaCount, 'Application readback did not confirm all detected formulas.')
}

async function main() {
  // Keep this before loading Playwright, creating artifacts, or starting Electron.
  const documentUrl = authorizedDocumentUrl()
  const { _electron: electron } = require('playwright')
  const root = path.resolve(__dirname, '..')
  const artifactRoot = path.join(root, 'output', 'playwright')
  await fs.mkdir(artifactRoot, { recursive: true })
  const runDirectory = await fs.mkdtemp(path.join(artifactRoot, 'feishu-live-'))
  const profileDirectory = path.join(runDirectory, 'electron-profile')
  const diagnostics = []
  let application
  try {
    application = await electron.launch({
      cwd: root,
      args: [`--user-data-dir=${profileDirectory}`, '.'],
      env: {
        ...process.env,
        CLARITY_DESK_RECORDINGS_DIR: path.join(runDirectory, 'unused-recordings')
      }
    })
    const actualProfile = await application.evaluate(({ app }) => app.getPath('userData'))
    assert.equal(path.resolve(actualProfile).toLowerCase(), path.resolve(profileDirectory).toLowerCase(),
      'Electron did not use the isolated profile; refusing to interact with the document.')
    const page = await application.firstWindow()
    page.on('pageerror', () => diagnostics.push('renderer page error (details omitted to avoid exposing credentials)'))
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('heading', { name: '飞书文档里的公式，一键居中' }).waitFor()
    await page.waitForFunction(() => {
      const connection = document.querySelector('.integration-state')
      return connection && !connection.textContent.includes('正在连接')
    }, undefined, { timeout: 60_000 })
    assert.equal((await page.locator('.integration-state').innerText()).trim(), '已连接',
      'Feishu is not connected; this test does not log in, request authorization, or change account configuration.')

    const first = await clickAndCapture(page, documentUrl, runDirectory, '01-first-center')
    verifyFirstPass(first)
    const second = await clickAndCapture(page, documentUrl, runDirectory, '02-idempotent-center')
    assert.equal(second.status, 'completed', 'Second pass did not complete.')
    assert.equal(second.totalFormulaCount, first.totalFormulaCount, 'The detected formula count changed between passes.')
    assert.equal(second.submittedFormulaCount, 0, 'Idempotence failed: the second pass submitted updates.')
    assert.equal(second.updatedFormulaCount, 0, 'Idempotence failed: the second pass claimed new changes.')
    assert.equal(second.verifiedCenteredCount, first.totalFormulaCount, 'Second readback did not retain centered alignment.')
    assert.equal(diagnostics.length, 0, 'The renderer reported an error during acceptance.')
    await fs.writeFile(path.join(runDirectory, 'acceptance-summary.json'), `${JSON.stringify({
      result: 'passed',
      evidenceScope: 'Real application UI and real CLI writes/readback on the authorized synthetic document; independent content-preservation and Feishu-browser rendering checks remain separate.',
      first,
      second
    }, null, 2)}\n`, 'utf8')
    process.stdout.write(`FEISHU_LIVE_UI_ACCEPTANCE_OK\nartifacts=${runDirectory}\n`)
  } catch (error) {
    await fs.writeFile(path.join(runDirectory, 'acceptance-failure.json'), `${JSON.stringify({
      result: 'failed',
      message: redactDiagnostic(error instanceof Error ? error.message : String(error)),
      diagnostics
    }, null, 2)}\n`, 'utf8')
    process.stderr.write(`FEISHU_LIVE_UI_ACCEPTANCE_FAILED\nartifacts=${runDirectory}\n`)
    process.exitCode = 1
  } finally {
    if (application) await application.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${redactDiagnostic(error instanceof Error ? error.message : String(error))}\n`)
  process.exitCode = 1
})
