const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('./playwright-runtime')

// Structure observed on Monica's sidebar on 2026-09-08. No account data.
const sidebar = `<aside>
  <div class="bot-item--Juhis"><span class="bot-title--yPuEN">Monica</span></div>
  <div class="bot-item--Juhis active--cZ1ht"><span class="bot-title--yPuEN">Gemini 3.8 Flash</span><div class="pinned--H2MUw"></div></div>
  <div class="bot-item--Juhis"><span class="bot-title--yPuEN">GPT-6 Astra</span><div class="pinned--H2MUw"></div></div>
  <div class="bot-item--Juhis"><span class="bot-title--yPuEN">Claude Opus 4.6</span><div class="pinned--H2MUw"></div></div>
  <div class="bot-item--Juhis"><span class="bot-title--yPuEN">GLM 5.3 Flash</span></div>
  <div class="bot-item--Juhis"><span class="bot-title--yPuEN">GPT-5.2</span></div>
  <div class="bot-item--Juhis"><span class="bot-title--yPuEN">Explore Bot</span></div>
</aside>`
const source = fs.readFileSync(path.resolve(__dirname, '../monica-multi-model.user.js'), 'utf8')
const boot = `
window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
window.GM_setValue = (key, value) => localStorage.setItem(key, JSON.stringify(value));
window.GM_registerMenuCommand = () => {};
if (!crypto.randomUUID) crypto.randomUUID = () => '00000000-0000-4000-8000-000000000001';
window.fetch = async () => new Response('data: [DONE]\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
` + source

async function models(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('monica-mm-models')) || [])
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', msg => { if (process.env.DEBUG_DISCOVERY) console.log(msg.text()) })
    await page.route('http://discovery.test/**', route => route.fulfill({
      contentType: 'text/html', body: `<html><body>${sidebar}<p>GPT-99 Fake chat answer</p></body></html>`,
    }))
    await page.addInitScript({ content: boot })
    await page.goto('http://discovery.test/chat')
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('monica-mm-models') || '[]').some(m => m.id === 'gemini-3.8-flash'))
    let saved = await models(page)
    const gemini = saved.find(m => m.id === 'gemini-3.8-flash')
    assert(gemini.pinned && !gemini.enabled && !gemini.verified)
    assert.strictEqual(saved.filter(m => /claude.*opus/.test(m.id)).length, 1, 'alternate name ordering reuses existing model')
    assert(saved.some(m => m.id === 'claude-opus-4-6' && m.pinned), 'reuse the known API mapping')
    assert(!saved.some(m => m.id === 'glm-5.3-flash'), 'automatic import is pinned-only')
    assert(!saved.some(m => /99|monica|explore/i.test(m.id)), 'ignore prose and non-model rows')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[class*="bot-item--"]')].find(r => r.textContent === 'GLM 5.3 Flash')
      const pin = document.createElement('div')
      pin.className = 'pinned--H2MUw'
      row.appendChild(pin)
    })
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('monica-mm-models')).some(m => m.id === 'glm-5.3-flash'))
    saved = await models(page)
    assert(saved.some(m => m.id === 'glm-5.3-flash' && m.pinned), 'DOM observer imports newly pinned models')

    await page.click('#monica-mm-toggle')
    const root = page.locator('#monica-mm-host')
    await root.locator('button[title="Settings"]').click()
    assert.strictEqual(await root.locator('.mm-btn-remove').count(), saved.length, 'delete is available on initial render')
    await root.getByRole('button', { name: '删除 GPT-5.2', exact: true }).click()
    await page.reload()
    await page.waitForFunction(() => !!document.getElementById('monica-mm-host')?.shadowRoot)
    assert(!(await models(page)).some(m => m.id === 'gpt-5.2'), 'deleted default stays deleted after reload')
    await root.locator('button[title="Settings"]').click()
    await root.getByRole('button', { name: '扫描全部模型', exact: true }).click()
    saved = await models(page)
    assert(saved.some(m => m.id === 'glm-5.3-flash' && !m.enabled))
    assert(!saved.some(m => m.id === 'gpt-5.2'), 'scan respects deleted models')
    await root.getByRole('button', { name: '扫描全部模型', exact: true }).click()
    assert.strictEqual((await models(page)).length, saved.length, 'scanning is idempotent')

    // Exercise the actual injected fetch hook; calibration works while disabled.
    await page.click('#monica-mm-toggle')
    await page.evaluate(() => fetch('/api/custom_bot/chat', {
      method: 'POST', body: JSON.stringify({ data: {
        use_model: 'gemini-3.8-flash-thinking',
        items: [{ item_type: 'question', data: { chat_model: 'gemini_3_8_flash' } }],
      } }),
    }))
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('monica-mm-models')).some(m => m.id === 'gemini-3.8-flash-thinking'))
    saved = await models(page)
    assert(!saved.some(m => m.id === 'gemini-3.8-flash'), 'replace inferred ID without duplication')
    assert(saved.some(m => m.id === 'gemini-3.8-flash-thinking' && m.verified && m.chatModel === 'gemini_3_8_flash'))
    await page.reload()
    await page.waitForFunction(() => !!document.getElementById('monica-mm-toggle'))
    await page.click('#monica-mm-toggle')
    await root.locator('button[title="Settings"]').click()
    await root.getByRole('button', { name: '扫描置顶模型', exact: true }).click()
    assert(!(await models(page)).some(m => m.id === 'gemini-3.8-flash'), 'reload preserves calibrated ID')
    await root.getByRole('button', { name: '删除 Gemini 3.8 Flash', exact: true }).click()
    await root.getByRole('button', { name: '扫描置顶模型', exact: true }).click()
    assert(!(await models(page)).some(m => m.label === 'Gemini 3.8 Flash'), 'deleted calibrated model stays deleted')

    await root.locator('#mm-auto-discover').uncheck()
    await page.evaluate(() => {
      const row = document.createElement('div')
      row.className = 'bot-item--Juhis'
      row.innerHTML = '<span class="bot-title--yPuEN">Grok 4.3</span><div class="pinned--H2MUw"></div>'
      document.querySelector('aside').append(row)
    })
    await page.waitForTimeout(700)
    assert(!(await models(page)).some(m => m.id === 'grok-4.3'), 'disabled discovery ignores new rows')
    await root.locator('#mm-auto-discover').check()
    assert((await models(page)).some(m => m.id === 'grok-4.3'), 'enabling discovery scans current sidebar')
    await root.locator('#mm-auto-discover').uncheck()
    while (await root.locator('.mm-btn-remove').count()) await root.locator('.mm-btn-remove').first().click()
    await page.reload()
    assert.deepStrictEqual(await models(page), [], 'empty list survives reload')
    assert.deepStrictEqual(errors, [], 'no runtime errors')
    console.log('model-discovery tests passed')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
