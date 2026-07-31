const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('./playwright-runtime')

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SRC_PATH = path.resolve(__dirname, '..', 'monica-multi-model.user.js')
const APP_URL = 'http://monica.test/chat'

function buildScript() {
  const src = fs
    .readFileSync(SRC_PATH, 'utf8')
    .replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '')

  return `
    window.GM_getValue = (key, fallback) => {
      const stored = localStorage.getItem('gm:' + key);
      return stored === null ? fallback : JSON.parse(stored);
    };
    window.GM_setValue = (key, value) => {
      localStorage.setItem('gm:' + key, JSON.stringify(value));
    };
    window.__gmMenuCommands = new Map();
    window.GM_registerMenuCommand = (label, handler) => {
      window.__gmMenuCommands.set(label, handler);
    };
  ` + src
}

async function panelState(page) {
  return page.evaluate(() => {
    const toggle = document.getElementById('monica-mm-toggle')
    const host = document.getElementById('monica-mm-host')
    const root = host?.shadowRoot
    const main = root?.querySelector('.mm-main')
    const rect = main?.getBoundingClientRect()
    const eastHandle = root?.querySelector('.mm-resize-e')
    const southeastHandle = root?.querySelector('.mm-resize-se')
    return {
      hasToggle: !!toggle?.isConnected,
      toggleText: toggle?.textContent,
      toggleTitle: toggle?.title,
      toggleAriaLabel: toggle?.getAttribute('aria-label'),
      hasHost: !!host?.isConnected,
      display: main ? getComputedStyle(main).display : null,
      left: rect?.left,
      top: rect?.top,
      right: rect?.right,
      bottom: rect?.bottom,
      width: rect?.width,
      height: rect?.height,
      opacity: main ? getComputedStyle(main).getPropertyValue('--mm-opacity').trim() : null,
      contentFontSize: main
        ? getComputedStyle(main).getPropertyValue('--mm-content-font-size').trim()
        : null,
      sliderValue: root?.querySelector('#mm-panel-opacity')?.value,
      fontSizeSliderValue: root?.querySelector('#mm-content-font-size')?.value,
      resizeDirections: root
        ? [...root.querySelectorAll('.mm-resize-handle')].map((handle) => handle.dataset.direction).sort()
        : [],
      eastHandleWidth: eastHandle ? eastHandle.getBoundingClientRect().width : null,
      southeastHandleWidth: southeastHandle ? southeastHandle.getBoundingClientRect().width : null,
      southeastGrip: southeastHandle ? getComputedStyle(southeastHandle, '::after').content : null,
      storedEnabled: JSON.parse(localStorage.getItem('gm:monica-mm-enabled') || 'false'),
      storedOpacity: JSON.parse(localStorage.getItem('gm:monica-mm-panel-opacity') || 'null'),
      storedContentFontSize: JSON.parse(
        localStorage.getItem('gm:monica-mm-content-font-size') || 'null',
      ),
      storedPosition: JSON.parse(localStorage.getItem('gm:monica-mm-panel-position') || 'null'),
      storedSize: JSON.parse(localStorage.getItem('gm:monica-mm-panel-size') || 'null'),
    }
  })
}

async function dragPanel(page, dx, dy) {
  const header = page.locator('#monica-mm-host').locator('.mm-header')
  const box = await header.boundingBox()
  assert(box, 'drag header is visible')
  const startX = box.x + Math.min(120, box.width / 3)
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY + dy, { steps: 6 })
  await page.mouse.up()
}

async function resizePanel(page, direction, dx, dy) {
  const handle = page.locator('#monica-mm-host').locator(`.mm-resize-${direction}`)
  const box = await handle.boundingBox()
  assert(box, `${direction} resize handle is visible`)
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY + dy, { steps: 6 })
  await page.mouse.up()
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

  try {
    await page.route('http://monica.test/**', (route) => {
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
          <html>
            <body style="margin:0;background:#f8fafc">
              <main style="padding:72px 48px;color:#172033">
                <h1>Monica chat</h1>
                <p>Underlying page content remains available beneath the reader.</p>
                <textarea aria-label="Message Monica" style="position:fixed;bottom:20px;left:280px;width:720px;height:56px"></textarea>
              </main>
            </body>
          </html>`,
      })
    })
    await page.addInitScript({ content: buildScript() })
    await page.goto(APP_URL)
    await page.waitForFunction(() => document.getElementById('monica-mm-toggle'))

    let state = await panelState(page)
    assert(state.hasToggle, 'M floating button starts on page load')
    assert.strictEqual(state.toggleText.trim(), '多模型', 'floating entry clearly names the multi-model feature')
    assert(state.toggleAriaLabel.includes('左键启停') && state.toggleAriaLabel.includes('右键显示或隐藏'), 'floating entry explains both actions')
    assert(!state.hasHost, 'disabled state does not create the reader')

    await page.click('#monica-mm-toggle')
    await page.waitForFunction(() => document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-main'))
    state = await panelState(page)
    assert(state.storedEnabled, 'M left click enables and persists the userscript')
    assert.strictEqual(state.display, 'grid', 'M left click opens the G2 reader')
    assert.strictEqual(state.opacity, '0.42', 'G2 reader starts at the readable translucent default')
    assert.strictEqual(state.contentFontSize, '13px', 'answer text starts at the readable default')
    assert.deepStrictEqual(
      state.resizeDirections,
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'],
      'reader exposes four edge and four corner resize handles',
    )
    assert(state.eastHandleWidth >= 9, 'edge resize handle has a practical pointer target')
    assert(state.southeastHandleWidth >= 16, 'corner resize handle has a practical pointer target')
    assert.notStrictEqual(state.southeastGrip, 'none', 'bottom-right corner exposes a visible resize grip')

    await page.locator('#monica-mm-host').locator('button[title="Settings"]').click()
    const slider = page.locator('#monica-mm-host').locator('#mm-panel-opacity')
    const fontSizeSlider = page.locator('#monica-mm-host').locator('#mm-content-font-size')
    await slider.evaluate((input) => {
      input.value = '57'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await fontSizeSlider.evaluate((input) => {
      input.value = '18'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.locator('#monica-mm-host').locator('button[title="Settings"]').click()
    state = await panelState(page)
    assert.strictEqual(state.opacity, '0.57', 'opacity slider updates the live CSS variable')
    assert.strictEqual(state.storedOpacity, 57, 'opacity slider persists through GM storage')
    assert.strictEqual(state.contentFontSize, '18px', 'font size slider updates the live CSS variable')
    assert.strictEqual(state.storedContentFontSize, 18, 'font size slider persists through GM storage')
    const computedAnswerFontSize = await page.evaluate(() => {
      const main = document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-main')
      const probe = document.createElement('div')
      probe.className = 'mm-panel-content'
      main.appendChild(probe)
      const fontSize = getComputedStyle(probe).fontSize
      probe.remove()
      return fontSize
    })
    assert.strictEqual(computedAnswerFontSize, '18px', 'answer content inherits the selected font size')

    const beforeDrag = state
    await dragPanel(page, -180, 90)
    state = await panelState(page)
    assert(state.left < beforeDrag.left - 100, 'header drag moves the whole reader horizontally')
    assert(state.top > beforeDrag.top + 50, 'header drag moves the whole reader vertically')
    assert(state.left >= 0 && state.top >= 0 && state.right <= 1280 && state.bottom <= 720, 'drag stays inside the viewport')
    assert(state.storedPosition && state.storedPosition.left === Math.round(state.left), 'dragged position persists')

    const beforeEastResize = state
    await resizePanel(page, 'e', 100, 0)
    state = await panelState(page)
    assert(state.width > beforeEastResize.width + 70, 'right edge expands the reader width')
    assert(Math.abs(state.left - beforeEastResize.left) <= 1, 'right edge keeps the left edge fixed')

    const beforeSouthResize = state
    await resizePanel(page, 's', 0, 80)
    state = await panelState(page)
    assert(state.height > beforeSouthResize.height + 50, 'bottom edge expands the reader height')
    assert(Math.abs(state.top - beforeSouthResize.top) <= 1, 'bottom edge keeps the top edge fixed')

    const beforeWestResize = state
    await resizePanel(page, 'w', 40, 0)
    state = await panelState(page)
    assert(state.width < beforeWestResize.width - 20, 'left edge contracts the reader width')
    assert(state.left > beforeWestResize.left + 20, 'left edge moves with the pointer')

    const beforeNorthResize = state
    await resizePanel(page, 'n', 0, 30)
    state = await panelState(page)
    assert(state.height < beforeNorthResize.height - 15, 'top edge contracts the reader height')
    assert(state.top > beforeNorthResize.top + 15, 'top edge moves with the pointer')

    const beforeCornerResize = state
    await resizePanel(page, 'se', 35, 35)
    state = await panelState(page)
    assert(state.width > beforeCornerResize.width + 20 && state.height > beforeCornerResize.height + 20, 'corner resizes width and height together')

    await resizePanel(page, 'se', 1000, 1000)
    state = await panelState(page)
    assert(state.right <= 1280 && state.bottom <= 720, 'resizing is constrained to the viewport')
    assert(
      state.storedSize
        && state.storedSize.width === Math.round(state.width)
        && state.storedSize.height === Math.round(state.height),
      'resized dimensions persist',
    )

    await page.locator('#monica-mm-host').locator('button[title="Collapse"]').click()
    state = await panelState(page)
    assert.strictEqual(state.display, 'none', 'collapse hides the reader without disabling it')
    await page.click('#monica-mm-toggle', { button: 'right' })
    state = await panelState(page)
    assert.strictEqual(state.display, 'grid', 'M right click restores a collapsed reader')

    await page.click('#monica-mm-toggle')
    state = await panelState(page)
    assert(!state.storedEnabled && state.display === 'none', 'M left click disables and hides the reader')
    await page.click('#monica-mm-toggle')
    state = await panelState(page)
    assert(state.storedEnabled && state.display === 'grid', 'M left click re-enables and reopens the reader')

    const beforeReload = state
    await page.reload()
    await page.waitForFunction(() =>
      document.getElementById('monica-mm-toggle') &&
      document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-main')
    )
    state = await panelState(page)
    assert(state.storedEnabled && state.display === 'grid', 'refresh restores the enabled reader')
    assert.strictEqual(state.sliderValue, '57', 'refresh restores the saved opacity slider')
    assert.strictEqual(state.opacity, '0.57', 'refresh reapplies opacity to all surfaces')
    assert.strictEqual(state.fontSizeSliderValue, '18', 'refresh restores the saved font size slider')
    assert.strictEqual(state.contentFontSize, '18px', 'refresh reapplies the answer font size')
    assert(Math.abs(state.left - beforeReload.left) <= 1 && Math.abs(state.top - beforeReload.top) <= 1, 'refresh restores reader position')
    assert(Math.abs(state.width - beforeReload.width) <= 1 && Math.abs(state.height - beforeReload.height) <= 1, 'refresh restores reader dimensions')

    await page.evaluate(() => {
      document.getElementById('monica-mm-toggle')?.remove()
      document.getElementById('monica-mm-host')?.remove()
      history.pushState({}, '', '/chat/new')
    })
    await page.waitForFunction(() => {
      const toggle = document.getElementById('monica-mm-toggle')
      const host = document.getElementById('monica-mm-host')
      return !!toggle?.isConnected && !!host?.isConnected && !!host.shadowRoot?.querySelector('.mm-main')
    }, null, { timeout: 4000 })
    state = await panelState(page)
    assert.strictEqual(state.display, 'grid', 'watchdog restores the visible reader after an SPA remount')
    assert.strictEqual(state.opacity, '0.57', 'SPA remount keeps the saved opacity')
    assert.strictEqual(state.contentFontSize, '18px', 'SPA remount keeps the saved answer font size')
    assert(Math.abs(state.left - beforeReload.left) <= 1 && Math.abs(state.top - beforeReload.top) <= 1, 'SPA remount keeps the saved position')
    assert(Math.abs(state.width - beforeReload.width) <= 1 && Math.abs(state.height - beforeReload.height) <= 1, 'SPA remount keeps the saved dimensions')

    const beforeRemountDrag = state
    await dragPanel(page, -70, -45)
    state = await panelState(page)
    assert(state.left < beforeRemountDrag.left - 40, 'reader remains draggable after an SPA remount')
    assert(state.top < beforeRemountDrag.top - 20, 'remounted drag updates the vertical position')

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate(() => window.__gmMenuCommands.get('Reset Settings')?.()),
    ])
    await page.waitForFunction(() => {
      const main = document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-main')
      return !!main
        && getComputedStyle(main).getPropertyValue('--mm-content-font-size').trim() === '13px'
    })
    state = await panelState(page)
    assert.strictEqual(state.contentFontSize, '13px', 'Reset Settings restores the default answer font size')
    assert.strictEqual(state.storedContentFontSize, 13, 'Reset Settings persists the default answer font size')

    console.log('ui-lifecycle tests passed')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
