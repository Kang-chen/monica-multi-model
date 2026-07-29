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
    window.__gmValues = new Map([['monica-mm-enabled', true]]);
    window.GM_getValue = (key, fallback) =>
      window.__gmValues.has(key) ? window.__gmValues.get(key) : fallback;
    window.GM_setValue = (key, value) => window.__gmValues.set(key, value);
    window.GM_registerMenuCommand = () => {};
  ` + src
}

async function readUiState(page) {
  return page.evaluate(() => {
    const toggle = document.getElementById('monica-mm-toggle')
    const host = document.getElementById('monica-mm-host')
    const main = host?.shadowRoot?.querySelector('.mm-main')
    return {
      toggleConnected: !!toggle?.isConnected,
      hostConnected: !!host?.isConnected,
      enabled: toggle?.title.includes(': ON') || false,
      panelVisible: !!main && getComputedStyle(main).display !== 'none',
      persistedEnabled: window.__gmValues.get('monica-mm-enabled'),
    }
  })
}

async function waitForRemount(page, expectedState, label, timeout = 6000) {
  await page.waitForFunction(() => {
    const toggle = document.getElementById('monica-mm-toggle')
    const host = document.getElementById('monica-mm-host')
    return !!toggle?.isConnected
      && !!host?.isConnected
      && !!host.shadowRoot?.querySelector('.mm-main')
  }, null, { timeout })

  const state = await readUiState(page)
  assert(state.toggleConnected && state.hostConnected, `${label}: both UI roots are connected`)
  assert.strictEqual(state.enabled, expectedState.enabled, `${label}: enabled state is preserved`)
  assert.strictEqual(
    state.persistedEnabled,
    expectedState.persistedEnabled,
    `${label}: persisted enabled state is preserved`,
  )
  assert.strictEqual(
    state.panelVisible,
    expectedState.panelVisible,
    `${label}: panel visibility is preserved`,
  )
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })
  const page = await browser.newPage()

  try {
    await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>')
    await page.evaluate(buildScript())

    await page.waitForFunction(() => {
      const host = document.getElementById('monica-mm-host')
      return document.getElementById('monica-mm-toggle')
        && host?.shadowRoot?.querySelector('.mm-main')
    })

    const initialState = await readUiState(page)
    assert(initialState.enabled, 'initial UI is enabled')
    assert(initialState.panelVisible, 'initial panel is visible')

    await page.evaluate(() => {
      document.getElementById('monica-mm-toggle')?.remove()
      document.getElementById('monica-mm-host')?.remove()
    })
    await waitForRemount(page, initialState, 'full removal')

    await page.evaluate(() => {
      document.getElementById('monica-mm-host')?.remove()
    })
    await waitForRemount(page, initialState, 'host-only removal')

    await page.evaluate(() => {
      document.getElementById('monica-mm-toggle')?.remove()
    })
    await waitForRemount(page, initialState, 'toggle-only removal')

    await page.evaluate(() => document.getElementById('monica-mm-toggle')?.click())
    const toggledState = await readUiState(page)
    assert.strictEqual(toggledState.enabled, false, 'remounted toggle remains wired')
    assert.strictEqual(toggledState.persistedEnabled, false, 'remounted toggle persists disabled state')
    await page.evaluate(() => {
      document.getElementById('monica-mm-host')?.remove()
    })
    await page.waitForTimeout(150)
    assert.strictEqual(
      await page.locator('#monica-mm-host').count(),
      0,
      'watchdog does not rebuild a hidden panel while the script is disabled',
    )
    await page.evaluate(() => document.getElementById('monica-mm-toggle')?.click())
    await waitForRemount(page, initialState, 're-enable after disabled host removal')

    await page.evaluate(() => {
      document.body.innerHTML = '<main id="root"></main>'
    })
    await waitForRemount(page, initialState, 'body content replacement')

    console.log('ui-lifecycle tests passed')
  } finally {
    await browser.close()
  }
})().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
