async function waitForAppReady(page, expectedUrl, timeout = 30_000) {
  // firstWindow() can still be about:blank, whose DOMContentLoaded already fired.
  await page.waitForURL((url) => url.href === expectedUrl, { waitUntil: 'domcontentloaded', timeout })
  await page.getByRole('heading', { name: '飞书文档里的公式，一键居中', exact: true }).waitFor({ timeout })
  return page.evaluate(() => window.clarity.getAppInfo())
}

module.exports = { waitForAppReady }
