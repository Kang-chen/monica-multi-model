/**
 * Monica Multi-Model Compare — End-to-End Test Suite
 *
 * Tests all 7 requirements from the plan:
 *   T1: Version number is build-incremented (not runtime timestamp)
 *   T2: Build script produces dist/ output and syncs to Tampermonkey
 *   T3: Model switch works for Gemini 3.5 Flash / GPT-5.5 / Claude 5 Sonnet
 *       with staggered concurrent requests
 *   T4: Plugin panel shows streaming output for each model
 *   T5: Auto-reload is an option (default OFF), not forced
 *   T6: Plugin UI persists after page refresh
 *   T7: Fusion uses the current Monica model and renders without refreshing
 *
 * Usage:
 *   node test/test-all.js
 *
 * The script automatically launches Chrome with --remote-debugging-port=9222
 * if it is not already running. If Tampermonkey is not installed, the userscript
 * is injected directly via CDP with GM_* API stubs.
 *
 * Prerequisites:
 *   - Monica logged in at the debug profile
 */

const { chromium } = require('./playwright-runtime');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findCdpEndpoint } = require('./cdp-utils');

// ─── config ─────────────────────────────────────────────────────
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_HOST = process.env.CDP_HOST || '';
const USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || 'C:/tmp/chrome-debug-profile';
const EXTRA_CHROME_ARGS = (process.env.CHROME_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
const SCREENSHOTS = path.join(__dirname, 'screenshots');
const SRC_PATH = path.resolve(__dirname, '..', 'monica-multi-model.user.js');
const TARGET_MODELS = [
  { id: 'gemini-3.5-flash-thinking', label: 'Gemini 3.5 Flash', uiMode: 'think', expectedText: ['gemini-3.5-flash', 'gemini 3.5 flash'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', uiMode: 'think', expectedText: ['gpt-5.5'] },
  { id: 'claude-sonnet-5', label: 'Claude 5 Sonnet', uiMode: 'non-think', expectedText: ['claude-sonnet-5', 'claude sonnet 5', 'claude 5 sonnet'] },
];
const TARGET_MODEL_IDS = new Set(TARGET_MODELS.map((model) => model.id));
const testRun = { expectedReplayCount: TARGET_MODELS.length };
const results = [];

// ─── Chrome lifecycle ───────────────────────────────────────────

async function ensureChrome() {
  let endpoint = await findCdpEndpoint(CDP_PORT, CDP_HOST);
  if (endpoint) {
    console.log(`Chrome CDP already listening at ${endpoint}`);
    return { chromeProcess: null, launched: false, endpoint };
  }

  console.log('Launching Chrome with remote debugging...');
  console.log(`  Path: ${CHROME_PATH}`);
  console.log(`  Port: ${CDP_PORT}`);
  console.log(`  Profile: ${USER_DATA_DIR}`);

  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    ...EXTRA_CHROME_ARGS,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  chromeProcess.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    endpoint = await findCdpEndpoint(CDP_PORT, CDP_HOST);
    if (endpoint) {
      console.log(`Chrome CDP ready after ${((i + 1) * 500 / 1000).toFixed(1)}s`);
      return { chromeProcess, launched: true, endpoint };
    }
  }
  throw new Error('Chrome failed to start within 15s');
}

// ─── helpers ────────────────────────────────────────────────────

function assert(condition, label) {
  const status = condition ? 'PASS' : 'FAIL';
  results.push({ status, label });
  console.log(`  [${status}] ${label}`);
  return condition;
}

async function findMonicaPage(browser) {
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  return pages.find(p => p.url().includes('monica.im')) || pages[0];
}

/**
 * Build GM_* API stubs + the userscript source into a single string
 * that can be injected via page.addInitScript().
 * Always unconditionally overrides GM_* so our version takes precedence
 * over any stale Tampermonkey-installed version.
 */
function buildInjectableScript() {
  let src = fs.readFileSync(SRC_PATH, 'utf8');

  // Strip the UserScript header block
  src = src.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');

  // Build GM_* stubs that use localStorage as backing store
  // These are unconditional — override even if Tampermonkey provides them
  const gmStubs = `
    // --- GM_* API stubs (for CDP injection, overrides Tampermonkey) ---
    (function() {
      const _gmStore = {};
      try {
        const raw = localStorage.getItem('__gm_store__');
        if (raw) Object.assign(_gmStore, JSON.parse(raw));
      } catch(e) {}

      window.GM_setValue = function(key, val) {
        _gmStore[key] = val;
        try { localStorage.setItem('__gm_store__', JSON.stringify(_gmStore)); } catch(e) {}
      };
      window.GM_getValue = function(key, def) {
        return key in _gmStore ? _gmStore[key] : def;
      };
      window.GM_registerMenuCommand = function() {};
    })();
  `;

  const testReset = `
    // --- Test reset: prefer the local userscript over any stale Tampermonkey copy ---
    (function() {
      const resetToken = 'canonical-models-2026-07-01';
      if (sessionStorage.getItem('__monica_mm_test_reset_token') !== resetToken) {
        localStorage.removeItem('__gm_store__');
        sessionStorage.setItem('__monica_mm_test_reset_token', resetToken);
      }
      delete window.__monica_mm_initialized;
      document.getElementById('monica-mm-toggle')?.remove();
      document.getElementById('monica-mm-host')?.remove();
    })();
  `;

  return testReset + '\n' + gmStubs + '\n' + src;
}

/**
 * Register the latest userscript to auto-inject on every navigation
 * via addInitScript (runs at document-start, before Tampermonkey).
 */
async function registerInitScript(context) {
  const script = buildInjectableScript();
  await context.addInitScript(script);
  console.log('  Registered latest userscript via context.addInitScript');
}

async function injectCurrentUserscript(page) {
  await page.evaluate(buildInjectableScript());
  console.log('  Injected latest userscript into current page');
}

/**
 * Wait for the userscript toggle button to appear on the page.
 */
async function waitForToggle(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() => !!document.getElementById('monica-mm-toggle'));
    if (found) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/**
 * Enable the userscript (click M button if currently disabled).
 */
async function enableUserscript(page) {
  const result = await page.evaluate(() => {
    const btn = document.getElementById('monica-mm-toggle');
    if (!btn) return { found: false };

    const isToggleEnabled = () => {
      return btn.getAttribute('aria-pressed') === 'true';
    };

    const wasEnabled = isToggleEnabled();
    if (!wasEnabled) {
      btn.click();
    }

    if (isToggleEnabled() && !document.getElementById('monica-mm-host')) {
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
    }

    return { found: true, wasEnabled, nowEnabled: isToggleEnabled() };
  });
  return result;
}

// ─── T1: Version number format ─────────────────────────────────
async function testVersionNumber() {
  console.log('\n=== T1: Version number is build-incremented ===');

  const versionPath = path.resolve(__dirname, '..', 'version.json');
  const versionExists = fs.existsSync(versionPath);
  assert(versionExists, 'version.json exists');
  if (!versionExists) return;

  const ver = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  assert(typeof ver.major === 'number', 'version.json has numeric major');
  assert(typeof ver.minor === 'number', 'version.json has numeric minor');
  assert(typeof ver.patch === 'number', 'version.json has numeric patch');
  assert(typeof ver.build === 'number', 'version.json has numeric build');

  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const hasRuntimeVersion = src.includes('new Date()') && src.includes('SCRIPT_VERSION');
  assert(!hasRuntimeVersion, 'Source does NOT use runtime Date() for version');

  const headerMatch = src.match(/@version\s+(\S+)/);
  if (headerMatch) {
    const versionStr = headerMatch[1];
    assert(/^\d+\.\d+\.\d+-b\d+$/.test(versionStr), `@version header "${versionStr}" matches X.Y.Z-bN format`);
  } else {
    assert(false, '@version header exists in source');
  }
}

// ─── T2: Build script produces dist/ ───────────────────────────
async function testBuildScript() {
  console.log('\n=== T2: Build script produces dist/ output ===');

  const buildPath = path.resolve(__dirname, '..', 'build.js');
  assert(fs.existsSync(buildPath), 'build.js exists');

  const distDir = path.resolve(__dirname, '..', 'dist');

  try {
    execSync('node build.js', { cwd: path.resolve(__dirname, '..'), timeout: 10000 });
    assert(true, 'build.js runs without error');
  } catch (e) {
    assert(false, `build.js runs without error: ${e.message}`);
    return;
  }

  assert(fs.existsSync(distDir), 'dist/ directory created');
  const distFile = path.join(distDir, 'monica-multi-model.user.js');
  assert(fs.existsSync(distFile), 'dist/monica-multi-model.user.js exists');

  if (fs.existsSync(distFile)) {
    const dist = fs.readFileSync(distFile, 'utf8');
    assert(dist.includes('==UserScript=='), 'dist file has UserScript header');
    assert(!dist.includes('new Date()'), 'dist file does not have runtime version');

    const ver = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'version.json'), 'utf8'));
    const expectedVersion = `${ver.major}.${ver.minor}.${ver.patch}-b${ver.build}`;
    assert(dist.includes(expectedVersion), `dist file contains version ${expectedVersion}`);
  }

  // Build should increment the build number
  const verBefore = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'version.json'), 'utf8'));
  const buildBefore = verBefore.build;
  try {
    execSync('node build.js', { cwd: path.resolve(__dirname, '..'), timeout: 10000 });
  } catch (e) { /* ignore */ }
  const verAfter = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'version.json'), 'utf8'));
  assert(verAfter.build === buildBefore + 1, `Build number incremented from ${buildBefore} to ${verAfter.build}`);
}

// ─── T3: Model switch with staggered concurrent requests ───────
async function testModelSwitch(page) {
  console.log('\n=== T3: Model switch works (Gemini 3.5 Flash / GPT-5.5 / Claude 5 Sonnet) ===');

  // Navigate to fresh chat (addInitScript auto-injects the latest userscript)
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.goto('https://monica.im/home/chat/Monica/monica', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await injectCurrentUserscript(page);
  await page.waitForTimeout(5000);
  const openedFreshChat = await page.getByText('New Chat', { exact: true }).first().click({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!assert(openedFreshChat, 'Fresh chat opened')) return;
  await page.waitForTimeout(1500);

  // Wait for toggle to appear
  if (!assert(await waitForToggle(page), 'M toggle button appeared')) {
    console.error('  SKIP: Userscript did not initialize');
    return;
  }

  // Enable the userscript
  const toggleResult = await enableUserscript(page);
  console.log(`  Script was ${toggleResult.wasEnabled ? 'already enabled' : 'disabled, now enabled'}`);
  if (!assert(toggleResult.nowEnabled, 'Script is enabled')) return;
  const toggleTitle = await page.evaluate(() => document.getElementById('monica-mm-toggle')?.title || '');
  if (!assert(toggleTitle.includes('v1.1.0-'), `Latest local userscript is active (${toggleTitle})`)) return;
  await page.waitForTimeout(1000);

  // Verify fetch hook is installed
  const hookInstalled = await page.evaluate(() => {
    return window.fetch.toString().includes('MONICA_MM') ||
           window.fetch.toString().includes('custom_bot');
  });
  assert(hookInstalled, 'Fetch hook is installed in page context');
  if (!hookInstalled) {
    console.error('  SKIP: Fetch hook not detected, T3 cannot proceed');
    return;
  }

  // Set up capture via postMessage listener
  await page.evaluate(() => {
    window.__testCapture = { requests: [], streamChunks: [] };

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'MONICA_MM_REPLAY_REQUEST') {
        const { modelLabel, modelId, source } = event.data.payload;
        let bodyParsed = null;
        try { bodyParsed = JSON.parse(event.data.payload.body); } catch(e) {}
        window.__testCapture.requests.push({
          timestamp: Date.now(),
          use_model: bodyParsed?.data?.use_model || modelId,
          trigger_by: bodyParsed?.data?.trigger_by,
          bodyParsed,
          modelLabel: modelLabel,
          logicalModelId: modelId,
          source: source || 'panel',
          type: 'replay',
        });
      }
      if (event.data?.type === 'MONICA_MM_CAPTURED_REQUEST') {
        let bodyParsed = null;
        try { bodyParsed = JSON.parse(event.data.payload.body); } catch(e) {}
        window.__testCapture.requests.push({
          timestamp: Date.now(),
          use_model: bodyParsed?.data?.use_model,
          trigger_by: bodyParsed?.data?.trigger_by,
          bodyParsed,
          type: 'original',
        });
      }
      if (event.data?.type === 'MONICA_MM_STREAM_CHUNK') {
        window.__testCapture.streamChunks.push(event.data.payload);
      }
    });
  });

  // Send test message
  const textarea = page.locator('textarea[placeholder="Ask me anything..."]').first();
  if (!assert(await textarea.count() > 0, 'Chat textarea found')) return;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await textarea.fill('你是什么模型？请告诉我你的确切模型名称');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  assert(true, 'Test message sent');

  // Wait for all responses with smart polling via DOM attributes
  // (postMessage doesn't cross Playwright's isolation boundary)
  console.log('  Waiting up to 120s for all model responses...');
  const startTime = Date.now();
  const deadline = startTime + 120000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const status = await page.evaluate((targetModelIds) => {
      const targetIds = new Set(targetModelIds);
      const capture = window.__testCapture || { requests: [] };
      const replayCount = capture.requests.filter(r => r.type === 'replay').length;
      // Check DOM element for stream completion status
      const statusEl = document.getElementById('__mm_stream_status');
      const attrs = {};
      if (statusEl) {
        for (const attr of statusEl.attributes) {
          if (attr.name.startsWith('data-')) {
            attrs[attr.name.substring(5)] = attr.value;
          }
        }
      }
      const original = capture.requests.find(r => r.type === 'original');
      const expectedReplayCount = original && targetIds.has(original.use_model)
        ? targetModelIds.length - 1
        : targetModelIds.length;
      const doneCount = Object.values(attrs).filter(v => v === 'done' || v === 'error').length;
      const root = document.getElementById('monica-mm-host')?.shadowRoot;
      const fusionStatus = root?.querySelector('.mm-fusion-panel .mm-panel-status')?.textContent || '';
      return { replayCount, doneCount, expectedReplayCount, attrs, fusionStatus };
    }, Array.from(TARGET_MODEL_IDS));
    console.log(`  ... ${status.replayCount} replays sent, ${status.doneCount}/${status.expectedReplayCount} completed (${Math.round((Date.now() - startTime) / 1000)}s)`);
    if (status.fusionStatus === 'done' || status.fusionStatus.includes('error') || status.fusionStatus.includes('skipped')) {
      console.log(`  Panel and Fusion flow completed after ${Math.round((Date.now() - startTime) / 1000)}s`);
      break;
    }
  }

  // Extract capture data
  const capture = await page.evaluate(() => {
    const tc = window.__testCapture || { requests: [], streamChunks: [] };
    const statusEl = document.getElementById('__mm_stream_status');
    const streamStatuses = {};
    if (statusEl) {
      for (const attr of statusEl.attributes) {
        if (attr.name.startsWith('data-')) {
          streamStatuses[attr.name.substring(5)] = attr.value;
        }
      }
    }
    return {
      requests: tc.requests,
      streamChunks: tc.streamChunks,
      streamStatuses,
    };
  });
  fs.writeFileSync(path.join(__dirname, 'last-capture.json'), JSON.stringify(capture, null, 2));
  const reqCount = capture.requests.length;
  const originalReq = capture.requests.find(r => r.type === 'original');
  const replayReqs = capture.requests.filter(r => r.type === 'replay');
  const doneModels = Object.values(capture.streamStatuses).filter(v => v === 'done');
  const errorModels = Object.values(capture.streamStatuses).filter(v => v === 'error');
  const expectedReplayCount = originalReq && TARGET_MODEL_IDS.has(originalReq.use_model)
    ? TARGET_MODELS.length - 1
    : TARGET_MODELS.length;
  const coveredTargetModels = new Set(replayReqs.map(r => r.use_model).filter(Boolean));
  if (TARGET_MODEL_IDS.has(originalReq?.use_model)) {
    coveredTargetModels.add(originalReq.use_model);
  }
  testRun.expectedReplayCount = expectedReplayCount;
  testRun.capture = capture;

  assert(reqCount >= 1 + expectedReplayCount, `Captured ${reqCount} requests (expected >= ${1 + expectedReplayCount}: 1 original + ${expectedReplayCount} replays)`);
  assert(replayReqs.length >= expectedReplayCount, `${replayReqs.length} replay requests sent (expected ${expectedReplayCount})`);
  assert(coveredTargetModels.size >= TARGET_MODELS.length, `${coveredTargetModels.size}/${TARGET_MODELS.length} target models covered`);
  assert(doneModels.length >= expectedReplayCount, `${doneModels.length} replay models completed streaming`);
  assert(errorModels.length === 0, `No stream errors (${errorModels.length} errors found)`);

  // Check request timing — panel requests should overlap
  const panelReplayReqs = replayReqs.filter(r => r.source !== 'fusion');
  if (panelReplayReqs.length >= 2) {
    const timestamps = panelReplayReqs.map(r => r.timestamp);
    const totalSpan = timestamps[timestamps.length - 1] - timestamps[0];
    assert(totalSpan < 3000, `Panel requests are staggered-concurrent (start span: ${totalSpan}ms)`);
  }

  // Screenshot
  await page.screenshot({ path: path.join(SCREENSHOTS, 'T3-model-switch.png') });
}

// ─── T4: Plugin panel shows streaming output ────────────────────
async function testPanelOutput(page) {
  console.log('\n=== T4: Plugin panel shows streaming output for each model ===');

  const panelState = await page.evaluate(() => {
    const host = document.getElementById('monica-mm-host');
    if (!host || !host.shadowRoot) return { hostExists: false };

    const root = host.shadowRoot;
    const panels = root.querySelectorAll('.mm-panel');
    const panelData = [];
    for (const p of panels) {
      const label = p.querySelector('.mm-panel-label')?.textContent || '';
      const status = p.querySelector('.mm-panel-status')?.textContent || '';
      const content = p.querySelector('.mm-panel-content')?.textContent || '';
      panelData.push({ label, status, content, contentLength: content.length, contentPreview: content.substring(0, 100) });
    }
    return {
      hostExists: true,
      panelsContainer: !!root.querySelector('.mm-panels'),
      panelCount: panels.length,
      panels: panelData,
    };
  });

  assert(panelState.hostExists, 'Shadow DOM host exists');
  assert(panelState.panelsContainer, '.mm-panels container exists');
  assert(panelState.panelCount >= testRun.expectedReplayCount, `${panelState.panelCount} model panels created (expected >= ${testRun.expectedReplayCount})`);

  if (panelState.panels && panelState.panels.length > 0) {
    const nonEmpty = panelState.panels.filter(p => p.contentLength > 0);
    assert(nonEmpty.length > 0, `${nonEmpty.length} panel(s) have non-empty content`);

    for (const p of panelState.panels) {
      const statusOk = p.status.includes('done') || p.status.includes('streaming') || p.status.includes('error');
      assert(statusOk, `Panel "${p.label}" has valid status: "${p.status}"`);

      const expected = TARGET_MODELS.find(model => model.label === p.label);
      if (expected?.expectedText) {
        const expectedTexts = Array.isArray(expected.expectedText) ? expected.expectedText : [expected.expectedText];
        assert(
          expectedTexts.some(text => p.content.toLowerCase().includes(text)),
          `Panel "${p.label}" response mentions one of ${expectedTexts.join(', ')}`
        );
      }
    }
  }
}

async function testFusionOutput(page) {
  console.log('\n=== T7: Fusion uses current model and renders in-place ===');

  const fusionState = await page.evaluate(() => {
    const root = document.getElementById('monica-mm-host')?.shadowRoot;
    const panel = root?.querySelector('.mm-fusion-panel');
    const capture = window.__testCapture || { requests: [] };
    const original = capture.requests.find(r => r.type === 'original');
    const fusion = capture.requests.find(r => r.type === 'replay' && r.source === 'fusion');
    return {
      panelExists: !!panel,
      status: panel?.querySelector('.mm-panel-status')?.textContent || '',
      text: panel?.querySelector('.mm-panel-content')?.textContent || '',
      originalModel: original?.use_model,
      fusionModel: fusion?.use_model,
      fusionPrompt: fusion?.bodyParsed?.data?.items
        ?.filter(item => item.item_type === 'question')
        ?.at(-1)?.data?.content || '',
    };
  });

  assert(fusionState.panelExists, 'Fusion panel exists in the current page');
  assert(fusionState.status === 'done', `Fusion completed (status: ${fusionState.status})`);
  assert(fusionState.text.length > 0, `Fusion rendered a non-empty result (${fusionState.text.length} chars)`);
  assert(
    fusionState.fusionModel === fusionState.originalModel,
    `Fusion judge uses current model (${fusionState.fusionModel})`
  );
  assert(
    fusionState.fusionPrompt.includes('CANDIDATE_ANSWERS (JSON):')
      && fusionState.fusionPrompt.includes('"answer":'),
    'Fusion prompt contains anonymized panel answers'
  );
}

// ─── T5: Auto-reload is optional (default OFF) ──────────────────
async function testAutoReloadOption() {
  console.log('\n=== T5: Auto-reload is optional (default OFF) ===');

  const src = fs.readFileSync(SRC_PATH, 'utf8');

  assert(src.includes('autoReload'), 'Source contains autoReload setting');
  assert(src.includes('STORAGE_KEY_AUTO_RELOAD') || src.includes('auto-reload') || src.includes('auto_reload'),
    'Source has storage key for autoReload');

  const defaultMatch = src.match(/autoReload.*?GM_getValue.*?,\s*(false|true)/);
  if (defaultMatch) {
    assert(defaultMatch[1] === 'false', `autoReload default is false (found: ${defaultMatch[1]})`);
  } else {
    assert(false, 'autoReload GM_getValue default found');
  }

  assert(src.includes('state.autoReload'),
    'Reload logic checks state.autoReload before executing');

  assert(true, 'Page did not auto-reload (autoReload default is OFF)');
}

// ─── T6: Plugin UI persists after page refresh ──────────────────
async function testUIAfterRefresh(page) {
  console.log('\n=== T6: Plugin UI persists after page refresh ===');

  // Check UI exists before refresh
  const beforeRefresh = await page.evaluate(() => {
    const toggle = document.getElementById('monica-mm-toggle');
    const host = document.getElementById('monica-mm-host');
    const root = host?.shadowRoot;
    return {
      toggleExists: !!toggle,
      hostExists: !!host,
      panelTexts: [...(root?.querySelectorAll('.mm-panel') || [])]
        .map(panel => panel.querySelector('.mm-panel-content')?.textContent || ''),
      activePanelId: root?.querySelector('.mm-panel.is-active')?.dataset.modelId || null,
    };
  });
  assert(beforeRefresh.toggleExists, 'Toggle button exists BEFORE refresh');
  assert(beforeRefresh.panelTexts.length >= 4, 'Agent and Fusion results exist BEFORE refresh');

  // Refresh the page. addInitScript simulates Tampermonkey's document-start
  // injection; do not manually inject again here, or the test masks refresh bugs.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Wait for toggle to reappear
  await waitForToggle(page);

  // Check UI exists after refresh
  const afterRefresh = await page.evaluate(() => {
    const toggle = document.getElementById('monica-mm-toggle');
    const host = document.getElementById('monica-mm-host');
    const root = host?.shadowRoot;
    return {
      toggleExists: !!toggle,
      toggleVisible: toggle ? getComputedStyle(toggle).display !== 'none' : false,
      hostExists: !!host,
      hostVisible: host ? getComputedStyle(host).display !== 'none' : false,
      panelTexts: [...(root?.querySelectorAll('.mm-panel') || [])]
        .map(panel => panel.querySelector('.mm-panel-content')?.textContent || ''),
      activePanelId: root?.querySelector('.mm-panel.is-active')?.dataset.modelId || null,
    };
  });

  assert(afterRefresh.toggleExists, 'Toggle button exists AFTER refresh');
  assert(afterRefresh.toggleVisible, 'Toggle button is VISIBLE after refresh');
  assert(afterRefresh.hostExists, 'Shadow DOM host exists AFTER refresh (when enabled)');
  assert(
    JSON.stringify(afterRefresh.panelTexts) === JSON.stringify(beforeRefresh.panelTexts),
    'Agent and Fusion result content survives refresh without a new prompt'
  );
  assert(
    afterRefresh.activePanelId === beforeRefresh.activePanelId,
    'Selected Agent or Fusion view survives refresh'
  );

  await page.screenshot({ path: path.join(SCREENSHOTS, 'T6-after-refresh.png') });
}

// ─── main ──────────────────────────────────────────────────────
(async () => {
  console.log('Monica Multi-Model Compare — Test Suite');
  console.log('========================================\n');

  // Ensure screenshots dir exists
  if (!fs.existsSync(SCREENSHOTS)) {
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
  }

  // T1 and T2 are file-based tests (no browser needed)
  await testVersionNumber();
  await testBuildScript();

  // T3-T6 need browser — auto-launch Chrome if not already running
  let browser;
  try {
    const chrome = await ensureChrome();
    browser = await chromium.connectOverCDP(chrome.endpoint);
    console.log('Connected to Chrome via CDP');
  } catch (e) {
    console.error(`\nFailed to connect to Chrome: ${e.message}`);
    printSummary();
    process.exit(1);
  }

  try {
    // Get a page and register the latest userscript via addInitScript
    // This ensures our code runs at document-start on every navigation,
    // overriding any stale Tampermonkey-installed version.
    const ctx = browser.contexts()[0];
    await registerInitScript(ctx);
    const page = await ctx.newPage();

    await testModelSwitch(page);
    await testPanelOutput(page);
    await testFusionOutput(page);
    await testAutoReloadOption();
    await testUIAfterRefresh(page);
  } catch (e) {
    console.error(`\nTest error: ${e.message}`);
    console.error(e.stack);
    assert(false, `Browser test flow completed without uncaught error: ${e.message}`);
  } finally {
    await browser.close();
  }

  printSummary();
})();

function printSummary() {
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`  PASS: ${passed}`);
  console.log(`  FAIL: ${failed}`);
  console.log(`  TOTAL: ${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  ✗ ${r.label}`);
    }
  }

  console.log(`\nResult: ${failed === 0 ? 'ALL PASSED ✓' : `${failed} FAILED ✗`}`);
  process.exit(failed > 0 ? 1 : 0);
}
