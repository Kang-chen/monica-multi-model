// Dedicated development browser. Never connects to an existing browser or
// copies account state. Run: node test/dev-browser.js [--fixture] [--headless]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const readline = require('readline')
const { chromium } = require('./playwright-runtime')
const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'monica-multi-model.user.js')
const devRoot = path.join(root, '.dev')
const fixture = process.argv.includes('--fixture')
const headless = process.argv.includes('--headless')
const origin = fixture ? 'https://monica.test' : 'https://monica.im'

async function dependencies() {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const libraries = []
  for (const [, spec] of source.matchAll(/^\/\/ @require\s+(\S+)/gm)) {
    const [url, integrity] = spec.split('#')
    const [, algorithm, expected] = integrity.match(/^(sha256|sha384|sha512)-(.+)$/) || []
    if (!algorithm) throw new Error('Missing dependency integrity')
    const cache = path.join(devRoot, 'deps', crypto.createHash('sha256').update(spec).digest('hex') + '.js')
    let bytes
    if (fs.existsSync(cache)) bytes = fs.readFileSync(cache)
    else {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Dependency HTTP ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
    }
    if (crypto.createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error(`Dependency integrity failed: ${url}`)
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    fs.writeFileSync(cache, bytes)
    libraries.push(bytes.toString('utf8'))
  }
  return libraries.join('\n;\n')
}

function bootstrap(libraries) {
  return `if (location.origin === ${JSON.stringify(origin)}) {
    window.__mmDevDiagnostics = { captured: 0, replay: 0, stream: 0 };
    window.addEventListener('message', event => {
      const type = event.data?.type;
      const counts = window.__mmDevDiagnostics;
      if (type === 'MONICA_MM_CAPTURED_REQUEST') {
        counts.captured++; counts.origin = event.origin; counts.sameWindow = event.source === window;
        const url = new URL(event.data.payload.url, location.href);
        counts.request = url.origin + url.pathname;
        counts.bodyType = typeof event.data.payload.body;
      }
      if (type === 'MONICA_MM_REPLAY_REQUEST') counts.replay++;
      if (type === 'MONICA_MM_STREAM_CHUNK') counts.stream++;
    });
    (function() {
      const key = '__monica_mm_dev_settings';
      let settings = {};
      try { settings = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
      window.GM_getValue = (name, fallback) => name in settings ? settings[name] : (name === 'monica-mm-enabled' ? true : fallback);
      window.GM_setValue = (name, value) => { settings[name] = value; localStorage.setItem(key, JSON.stringify(settings)); };
      window.GM_registerMenuCommand = () => {};
    })();
    ${libraries}
    ${fs.readFileSync(sourcePath, 'utf8')}
  }`
}

async function main() {
  const libraries = await dependencies()
  const bundled = chromium.executablePath()
  const executablePath = process.env.DEV_CHROME_PATH || (fs.existsSync(bundled) ? bundled : 'C:/Program Files/Google/Chrome/Application/chrome.exe')
  // A dedicated profile and a newly launched instance, never connectOverCDP.
  const context = await chromium.launchPersistentContext(path.join(devRoot, fixture ? 'fixture-profile' : 'monica-profile'), {
    executablePath, headless, viewport: { width: 1280, height: 850 },
    args: ['--disable-extensions'],
  })
  const page = context.pages()[0] || await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.enable')
  let registration
  let testing = false
  let closing = false
  let pending = false
  let timer
  let captured = 0
  let responses = 0
  // Only status counts: never print headers, cookies, bodies, or chat content.
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/custom_bot/chat') captured++ })
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/custom_bot/chat') {
      responses++
      console.log(`[chat] HTTP ${response.status()}`)
    }
  })
  page.on('pageerror', error => console.log(`[page error] ${error.name}: ${error.message.slice(0, 250)}`))
  page.on('console', message => {
    const text = message.text()
    if (/Content Security Policy|TrustedScript|TrustedHTML|Hook error|Failed to inject/.test(text)) console.log(`[browser] ${text.slice(0, 400)}`)
    else if (/\[monica-mm\].*(Initialized|DISABLED|Enabled|Disabled|Failed to parse|Model discovery failed)/.test(text)) console.log(`[plugin] ${text.slice(0, 300)}`)
  })
  if (fixture) {
    await context.route(/^https:\/\/(?:monica\.test|api\.monica\.im)\//, async route => {
      if (new URL(route.request().url()).pathname === '/api/custom_bot/chat') {
        const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
        const body = route.request().postDataJSON()
        const prompt = body.data.items.find(item => item.item_type === 'question')?.data.content || ''
        const answer = prompt.includes('You are Fusion') ? 'Fusion fixture completed' : 'Model fixture completed'
        return route.fulfill({ headers, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ text: answer })}\n\ndata: [DONE]\n\n` })
      }
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Monica development fixture</title><h1>Isolated fixture — not the Monica service</h1>' })
    })
  }
  async function install() {
    if (registration) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: registration })
    registration = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap(libraries) })).identifier
  }
  async function status() {
    const result = await page.evaluate(() => {
      const root = document.getElementById('monica-mm-host')?.shadowRoot
      return {
        page: location.origin + location.pathname,
        editors: [...document.querySelectorAll('textarea, [role="textbox"], [contenteditable="true"]')].map(el => ({
          tag: el.tagName, role: el.getAttribute('role'), placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
          label: el.getAttribute('aria-label'), visible: !!el.getClientRects().length,
        })),
        title: root?.querySelector('.mm-title')?.textContent || 'not loaded',
        hookInstalled: !!window.__monica_mm_fetch_hook_installed,
        bridge: window.__mmDevDiagnostics,
        toggle: document.getElementById('monica-mm-toggle')?.getAttribute('aria-pressed'),
        ready: document.readyState,
        models: [...(root?.querySelectorAll('.mm-models-list .mm-model-row') || [])].map(row => ({
          label: row.querySelector('label')?.textContent, enabled: row.querySelector('input')?.checked,
        })),
        panels: [...(root?.querySelectorAll('.mm-panel') || [])].map(panel => ({
          model: panel.dataset.modelId, status: panel.querySelector('.mm-panel-status')?.textContent,
          characters: panel.querySelector('.mm-panel-content')?.textContent?.length || 0,
        })),
      }
    })
    console.log(JSON.stringify({ ...result, captured, responses }, null, 2))
    return result
  }
  async function reload() {
    await install()
    await page.reload({ waitUntil: 'domcontentloaded' })
    console.log('Loaded latest local source; no Tampermonkey installation required.')
  }
  async function smoke() {
    testing = true
    try {
      await status()
      const toggle = page.locator('#monica-mm-toggle')
      await toggle.waitFor({ state: 'visible', timeout: 15000 })
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
      if (fixture) {
        await page.evaluate(() => fetch('https://api.monica.im/api/custom_bot/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { use_model: 'claude-sonnet-5', pre_parent_item_id: 'test-question', items: [
            { item_id: 'test-question', item_type: 'question', data: { content: 'Only reply OK', chat_model: 'claude_5_sonnet' } },
          ] } }),
        }))
      } else {
        const editor = page.locator('textarea[placeholder]:visible, [contenteditable="true"][role="textbox"]:visible')
        if (await editor.count() !== 1) throw new Error('Expected one visible chat editor; see status output for locale-independent diagnostics.')
        await editor.fill('插件开发环境联调：请只回复 OK，不要解释。')
        await editor.press('Enter')
      }
      await page.waitForFunction(() => document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-panel'), null, { timeout: 10000 })
      await page.waitForFunction(() => {
        const root = document.getElementById('monica-mm-host')?.shadowRoot
        return root?.querySelector('.mm-fusion-panel .mm-panel-status')?.textContent === 'done'
      }, null, { timeout: fixture ? 15000 : 180000 })
      const result = await status()
      if (result.panels.length < 2 || result.panels.some(panel => panel.status !== 'done')) throw new Error('Not all model/Fusion panels completed')
      console.log(fixture ? 'PASS: automatic injection + fixture concurrency + Fusion (not live acceptance)' : 'PASS: live concurrency + Fusion')
      const host = page.locator('#monica-mm-host')
      await host.locator('.mm-fusion-tab').click()
      const fusion = host.locator('.mm-fusion-panel')
      const select = fusion.getByRole('combobox', { name: 'Fusion model', exact: true })
      const previous = await select.inputValue()
      const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(value => value !== 'auto'))
      const rerunModel = options.includes('gpt-5.5') ? 'gpt-5.5' : options[0]
      if (!rerunModel) throw new Error('No model is available for manual Fusion rerun')
      await select.selectOption(rerunModel)
      const rerunResponse = page.waitForResponse(response => {
        if (new URL(response.url()).pathname !== '/api/custom_bot/chat') return false
        return response.request().postDataJSON()?.data?.use_model === rerunModel
      }, { timeout: 60000 })
      await fusion.getByRole('button', { name: 'Run', exact: true }).click()
      const response = await rerunResponse
      if (!response.ok()) throw new Error(`Fusion rerun HTTP ${response.status()}`)
      await page.waitForFunction(() => document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-fusion-panel .mm-panel-status')?.textContent === 'done', null, { timeout: 180000 })
      await select.selectOption(previous)
      console.log(`PASS: manual Fusion rerun sent to the selected ${rerunModel} model and completed`)

      // Exercise deletion with a temporary entry; no real model preference is lost.
      await host.locator('button[title="Settings"]').click()
      await host.getByPlaceholder('model-id:chat_model_key:Display Name').fill('mm-dev-test:mm_dev_test:Development deletion test')
      await host.locator('.mm-btn-add').click()
      await host.getByRole('button', { name: '删除 Development deletion test', exact: true }).click()
      if (await host.locator('#mm-fusion-model option[value="mm-dev-test"]').count()) throw new Error('Deleted model still appears in Fusion')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await host.locator('.mm-title').waitFor({ timeout: 15000 })
      if (await host.getByRole('button', { name: '删除 Development deletion test', exact: true }).count()) throw new Error('Deleted entry reappeared after reload')
      await page.waitForFunction(() => document.getElementById('monica-mm-host')?.shadowRoot?.querySelector('.mm-fusion-panel .mm-panel-status')?.textContent === 'done', null, { timeout: 15000 })
      console.log('PASS: deletion, Fusion option synchronization, and result restoration after refresh')
    } catch (error) {
      await status()
      throw error
    } finally {
      testing = false
      if (pending) { pending = false; await reload() }
    }
  }
  await install()
  await page.goto(`${origin}/home/chat/Monica/monica`, { waitUntil: 'domcontentloaded' })
  if (fixture) {
    try { await smoke() } finally { await context.close() }
    return
  }
  console.log('Independent development Chrome opened. Sign in once; no account data is copied from your usual browser.')
  console.log('Commands: status | test (uses current model selections/credits) | reload | quit')
  const watcher = fs.watch(sourcePath, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (testing) { pending = true; return }
      reload().catch(error => console.error(error.message))
    }, 600)
  })
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  terminal.on('line', async line => {
    if (line.trim() === 'status') { await status().catch(error => console.error(error.message)); return }
    if (testing) { console.log('Test in progress.'); return }
    try {
      if (line.trim() === 'test') await smoke()
      else if (line.trim() === 'reload') await reload()
      else if (line.trim() === 'status') await status()
      else if (line.trim() === 'quit') { closing = true; await context.close() }
    } catch (error) { console.error(error.message); await status().catch(() => {}) }
  })
  await new Promise(resolve => context.on('close', resolve))
  clearTimeout(timer)
  watcher.close()
  terminal.close()
  if (!closing) console.log('Development browser closed.')
}
main().catch(error => { console.error(error); process.exit(1) })
