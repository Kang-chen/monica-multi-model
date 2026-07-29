const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('./playwright-runtime')

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SRC_PATH = path.resolve(__dirname, '..', 'monica-multi-model.user.js')

function buildScript() {
  const src = fs
    .readFileSync(SRC_PATH, 'utf8')
    .replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '')

  return `
    window.GM_getValue = (key, fallback) => key === 'monica-mm-enabled' ? true : fallback;
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
  ` + src
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })
  const page = await browser.newPage()

  try {
    await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>')
    await page.evaluate(buildScript())

    await page.waitForFunction(() =>
      document.getElementById('monica-mm-toggle') &&
      document.getElementById('monica-mm-host')
    )

    await page.evaluate(() => {
      document.getElementById('monica-mm-toggle')?.remove()
      document.getElementById('monica-mm-host')?.remove()
    })

    await page.waitForFunction(() => {
      const toggle = document.getElementById('monica-mm-toggle')
      const host = document.getElementById('monica-mm-host')
      return !!toggle && toggle.isConnected && !!host && host.isConnected
    }, null, { timeout: 3000 })

    console.log('ui-lifecycle tests passed')
  } finally {
    await browser.close()
  }
})().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
