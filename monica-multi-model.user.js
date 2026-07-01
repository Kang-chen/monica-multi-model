// ==UserScript==
// @name         Monica Multi-Model Compare
// @namespace    https://monica.im/
// @version      1.1.0-b0
// @description  同一问题同时发送给多个模型，并排显示回答。复用 Monica Web 端 session，零额外成本。
// @author       Kang
// @match        https://monica.im/*
// @match        https://*.monica.im/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @connect      monica.im
// @connect      *.monica.im
// ==/UserScript==

; (function () {
  'use strict'

  // Prevent duplicate initialization (when both Tampermonkey and CDP injection run)
  if (window.__monica_mm_initialized) return
  window.__monica_mm_initialized = true

  // ============================================================
  // 1. Constants & Default Config
  // ============================================================

  const SCRIPT_ID = 'monica-mm'
  const SCRIPT_VERSION = '1.1.0-b0'
  const STORAGE_KEY_ENABLED = `${SCRIPT_ID}-enabled`
  const STORAGE_KEY_MODELS = `${SCRIPT_ID}-models`
  const STORAGE_KEY_ENDPOINT = `${SCRIPT_ID}-endpoint`
  const STORAGE_KEY_STAGGER = `${SCRIPT_ID}-stagger`
  const STORAGE_KEY_AUTO_RELOAD = `${SCRIPT_ID}-auto-reload`

  /**
   * Default models — configured with Monica's internal model IDs.
   * Each model needs both `id` (use_model value) and `chatModel` (chat_model value).
   * Discovered via API packet capture and Monica Web assets.
   */
  const DEFAULT_MODELS = [
    { id: 'gemini-3.5-flash-thinking', chatModel: 'gemini_3_5_flash', label: 'Gemini 3.5 Flash', enabled: true },
    { id: 'gpt-5.5', chatModel: 'gpt_5_5', label: 'GPT-5.5', enabled: true },
    { id: 'claude-sonnet-5', chatModel: 'claude_5_sonnet', label: 'Claude 5 Sonnet', enabled: true },
    { id: 'gemini-2.5-pro', chatModel: 'gemini_2_5_pro', label: 'Gemini 2.5 Pro', enabled: false },
    { id: 'gpt-4.1-nano', chatModel: 'gpt_4_1_nano', label: 'GPT-4.1 Nano', enabled: false },
    { id: 'claude-haiku-4-5', chatModel: 'claude_4_5_haiku', label: 'Claude 4.5 Haiku', enabled: false },
    { id: 'claude-opus-4-6', chatModel: 'claude_4_6_opus', label: 'Claude 4.6 Opus', enabled: false },
    { id: 'gpt-5.2', chatModel: 'gpt_5_2', label: 'GPT-5.2', enabled: false },
    { id: 'gemini-3-pro', chatModel: 'gemini_3_pro', label: 'Gemini 3 Pro', enabled: false },
    { id: 'deepseek-r1', chatModel: 'deepseek_r1', label: 'DeepSeek R1', enabled: false },
    { id: 'gpt-4o', chatModel: 'gpt_4o', label: 'GPT-4o', enabled: false },
  ]

  const DEFAULT_STAGGER_MS = 200

  const MODEL_ALIASES = {
    'gemini-3.5-flash': { id: 'gemini-3.5-flash-thinking', chatModel: 'gemini_3_5_flash', label: 'Gemini 3.5 Flash' },
    'claude-sonnet-4-6': { id: 'claude-sonnet-5', chatModel: 'claude_5_sonnet', label: 'Claude 5 Sonnet' },
  }

  function normalizeModel(model) {
    const alias = MODEL_ALIASES[model?.id]
    const normalized = alias ? { ...model, ...alias, enabled: model.enabled } : model
    return {
      id: normalized.id,
      chatModel: normalized.chatModel || normalized.id.replace(/[.-]/g, '_'),
      label: normalized.label || normalized.id,
      enabled: !!normalized.enabled,
    }
  }

  function normalizeModels(models) {
    const input = Array.isArray(models) ? models : DEFAULT_MODELS
    const normalized = []
    const seen = new Map()

    for (const model of input) {
      if (!model?.id) continue
      const next = normalizeModel(model)
      const existing = seen.get(next.id)
      if (existing) {
        existing.enabled = existing.enabled || next.enabled
        continue
      }
      seen.set(next.id, next)
      normalized.push(next)
    }

    return normalized.length ? normalized : DEFAULT_MODELS
  }

  function mergeDefaultModels(storedModels) {
    const normalized = normalizeModels(storedModels)
    const defaults = normalizeModels(DEFAULT_MODELS)
    const defaultById = new Map(defaults.map((model) => [model.id, model]))
    const seen = new Set()
    const merged = []

    for (const model of normalized) {
      const canonical = defaultById.get(model.id)
      const next = canonical ? { ...canonical, enabled: model.enabled } : model
      if (seen.has(next.id)) continue
      seen.add(next.id)
      merged.push(next)
    }

    for (const model of defaults) {
      if (seen.has(model.id)) continue
      seen.add(model.id)
      merged.push(model)
    }

    return merged
  }

  function loadModels() {
    const storedModels = GM_getValue(STORAGE_KEY_MODELS, null)
    const normalized = storedModels ? mergeDefaultModels(storedModels) : normalizeModels(DEFAULT_MODELS)
    if (storedModels) {
      GM_setValue(STORAGE_KEY_MODELS, normalized)
    }
    return normalized
  }

  // ============================================================
  // 2. State
  // ============================================================

  const state = {
    enabled: GM_getValue(STORAGE_KEY_ENABLED, false),
    models: loadModels(),
    endpointPattern: GM_getValue(STORAGE_KEY_ENDPOINT, '/api/custom_bot/chat'),
    staggerMs: GM_getValue(STORAGE_KEY_STAGGER, DEFAULT_STAGGER_MS),
    autoReload: GM_getValue(STORAGE_KEY_AUTO_RELOAD, false),
    panelVisible: false,
    panels: new Map(), // model id → { container, content, status }
    lastCapturedRequest: null, // { url, headers, body }
  }

  function persistState() {
    GM_setValue(STORAGE_KEY_ENABLED, state.enabled)
    GM_setValue(STORAGE_KEY_MODELS, state.models)
    GM_setValue(STORAGE_KEY_ENDPOINT, state.endpointPattern)
    GM_setValue(STORAGE_KEY_STAGGER, state.staggerMs)
    GM_setValue(STORAGE_KEY_AUTO_RELOAD, state.autoReload)
  }

  function getEnabledExtraModels() {
    return state.models.filter((m) => m.enabled)
  }

  // ============================================================
  // 3. Fetch Hook — inject into PAGE context via <script> tag
  //    Tampermonkey sandbox cannot directly override page's fetch,
  //    so we inject the hook into the page and use postMessage
  //    to relay captured requests back to the userscript context.
  // ============================================================

  /**
   * Inject a fetch interceptor into the page's own JavaScript context.
   * This runs as a <script> element, not in the Tampermonkey sandbox.
   */
  function injectPageFetchHook() {
    const script = document.createElement('script')
    script.textContent = `
      ;(function() {
        const SCRIPT_ID = 'monica-mm';
        const originalFetch = window.fetch;

        // Helper: extract body string from various sources
        async function extractBody(fetchInput, fetchInit) {
          // Try init.body first (most common: fetch(url, {body: ...}))
          let body = fetchInit?.body;
          // If no init.body, try Request object body
          if (!body && fetchInput instanceof Request) {
            try {
              const cloned = fetchInput.clone();
              return await cloned.text();
            } catch(e) { return ''; }
          }
          if (!body) return '';
          if (typeof body === 'string') return body;
          if (body instanceof Blob) return await body.text();
          if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
          if (body instanceof URLSearchParams) return body.toString();
          try { return JSON.stringify(body); } catch(e) { return ''; }
        }

        // Helper: extract headers from various sources
        function extractHeaders(fetchInput, fetchInit) {
          const headers = {};
          // Try init.headers first
          const src = fetchInit?.headers || (fetchInput instanceof Request ? fetchInput.headers : null);
          if (src) {
            if (src instanceof Headers) {
              src.forEach((v, k) => { headers[k] = v; });
            } else if (typeof src === 'object') {
              Object.assign(headers, src);
            }
          }
          return headers;
        }

        window.fetch = async function(input, init) {
          try {
            const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
            const method = init?.method || (input instanceof Request ? input.method : 'GET');
            const hasBody = !!(init?.body || (input instanceof Request && input.body));

            if (method.toUpperCase() === 'POST' && url.includes('/api/custom_bot/chat') && hasBody) {
              const bodyStr = await extractBody(input, init);

              if (bodyStr) {
                const headers = extractHeaders(input, init);

                // Send captured data to Tampermonkey context
                window.postMessage({
                  type: 'MONICA_MM_CAPTURED_REQUEST',
                  payload: {
                    url: url,
                    headers: headers,
                    body: bodyStr
                  }
                }, '*');

                console.log('%c[' + SCRIPT_ID + '] ✅ Intercepted chat request', 'color:#a6e3a1;font-weight:bold', url);
              }
            }
          } catch (err) {
            console.error('[' + SCRIPT_ID + '] Hook error:', err);
          }

          // Always allow original request through
          return originalFetch.apply(this, arguments);
        };

        // Listen for replay requests from Tampermonkey to trigger native multi-model fetch
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'MONICA_MM_REPLAY_REQUEST') {
            if (!event.data.payload) return;
            const { url, headers, body, modelLabel, modelId } = event.data.payload;
            console.log('%c[' + SCRIPT_ID + '] 🔄 Replaying request for: ' + (modelLabel || 'unknown'), 'color:#89b4fa;font-weight:bold');

            // Initialize shared stream status via DOM (accessible from both page and Tampermonkey contexts)
            let statusEl = document.getElementById('__mm_stream_status');
            if (!statusEl) {
              statusEl = document.createElement('div');
              statusEl.id = '__mm_stream_status';
              statusEl.style.display = 'none';
              document.body.appendChild(statusEl);
            }
            statusEl.setAttribute('data-' + modelId, 'streaming');

            // Replay using the original fetch with credentials to send cross-origin cookies
            originalFetch(url, {
              method: 'POST',
              headers: headers,
              body: body,
              credentials: 'include',
              mode: 'cors'
            }).then(response => {
              console.log('%c[' + SCRIPT_ID + '] 📬 Replay response status: ' + response.status + ' for ' + (modelLabel || ''), 'color:#f9e2af');
              if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let sseBuffer = '';
                function pump() {
                  return reader.read().then(({ done, value }) => {
                    if (done) {
                      statusEl.setAttribute('data-' + modelId, 'done');
                      window.postMessage({ type: 'MONICA_MM_STREAM_CHUNK', payload: { modelId: modelId, modelLabel: modelLabel, chunk: '', done: true, error: null } }, '*');
                      return;
                    }
                    const text = decoder.decode(value, { stream: true });
                    sseBuffer += text;
                    // Parse SSE lines from buffer
                    const lines = sseBuffer.split('\\n');
                    sseBuffer = lines.pop(); // keep incomplete line
                    for (const line of lines) {
                      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                        try {
                          const d = JSON.parse(line.substring(6));
                          if (d.text) {
                            window.postMessage({ type: 'MONICA_MM_STREAM_CHUNK', payload: { modelId: modelId, modelLabel: modelLabel, chunk: d.text, done: false, error: null } }, '*');
                          }
                          if (d.error) {
                            statusEl.setAttribute('data-' + modelId, 'error');
                            window.postMessage({ type: 'MONICA_MM_STREAM_CHUNK', payload: { modelId: modelId, modelLabel: modelLabel, chunk: '', done: false, error: String(d.error) } }, '*');
                          }
                        } catch(e) {}
                      }
                    }
                    return pump();
                  });
                }
                return pump();
              } else {
                statusEl.setAttribute('data-' + modelId, 'done');
              }
            }).catch(e => {
              console.error('[' + SCRIPT_ID + '] ❌ Replay error:', e);
              statusEl.setAttribute('data-' + modelId, 'error');
              window.postMessage({ type: 'MONICA_MM_STREAM_CHUNK', payload: { modelId: modelId, modelLabel: modelLabel, chunk: '', done: true, error: e.message } }, '*');
            });
          }
        });

        console.log('%c[' + SCRIPT_ID + '] 🚀 Page-context fetch hook installed', 'color:#cba6f7;font-weight:bold');
      })();
    `
      // Insert at document-start for earliest possible interception
      ; (document.head || document.documentElement).appendChild(script)
    script.remove() // Clean up the script tag, code still runs
    console.log(`[${SCRIPT_ID}] Injected fetch hook into page context`)
  }

  // Listen for captured requests from the page context
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'MONICA_MM_CAPTURED_REQUEST') return
    if (!state.enabled) {
      console.log(`[${SCRIPT_ID}] ⏸ Request captured but script is DISABLED (click M button to enable)`)
      return
    }

    const { url, headers, body: bodyStr } = event.data.payload
    try {
      const body = JSON.parse(bodyStr)
      const currentModel = body?.data?.use_model || body?.model || 'unknown'
      state.lastCapturedRequest = { url, headers, body }
      const extraModels = getEnabledExtraModels().filter((m) => m.id !== currentModel)
      console.group(`[${SCRIPT_ID}] 📥 Captured request`)
      console.log('URL:', url)
      console.log('Current model:', currentModel)
      console.log('Extra models to query:', extraModels.map(m => m.label).join(', ') || '(none)')
      console.groupEnd()
      queryOtherModels(url, headers, body)
    } catch (err) {
      console.error(`[${SCRIPT_ID}] ❌ Failed to parse captured request body:`, err)
    }
  })

  // Inject the hook immediately (script runs at document-start)
  injectPageFetchHook()

  // ============================================================
  // 4. Multi-Model Concurrent Requests
  // ============================================================

  /**
   * Build a modified request body for a different model.
   *
   * From browser API capture, the key to making <1/N> work is:
   *   - trigger_by: "auto"
   *   - Generate a FRESH current question item_id for each model
   *   - Point pre_parent_item_id at that fresh question item_id
   *   - Generate a FRESH pre_generated_reply_id (each model gets its own reply slot)
   *   - Change use_model + chat_model to the target model
   *   - Generate a fresh task_uid
   *
   * @param {object} originalBody - The intercepted original request body
   * @param {object} model - Target model { id, chatModel, label }
   */
  function buildModifiedBody(originalBody, model) {
    const modified = JSON.parse(JSON.stringify(originalBody)) // deep clone

    // --- 1. Set top-level fields ---
    modified.data.use_model = model.id
    modified.task_uid = `task:${crypto.randomUUID()}`
    modified.data.trigger_by = 'auto'

    // --- 2. Freshen the current question so Monica does not reuse the first model binding ---
    const items = modified.data?.items || []
    const currentQuestion = items.find((item) =>
      item.item_type === 'question' && item.item_id === originalBody?.data?.pre_parent_item_id
    ) || [...items].reverse().find((item) => item.item_type === 'question')

    if (currentQuestion?.data) {
      const freshQuestionId = `msg:${crypto.randomUUID()}`
      currentQuestion.item_id = freshQuestionId
      currentQuestion.data.chat_model = model.chatModel || model.id.replace(/[.-]/g, '_')
      modified.data.pre_parent_item_id = freshQuestionId
    }

    // --- 3. Generate a fresh reply slot ---
    modified.data.pre_generated_reply_id = `msg:${crypto.randomUUID()}`

    console.log(`[${SCRIPT_ID}] Built model-switch body for ${model.label}:`, {
      use_model: modified.data.use_model,
      chat_model: model.chatModel,
      trigger_by: modified.data.trigger_by,
      pre_parent_item_id: modified.data.pre_parent_item_id,
      pre_generated_reply_id: modified.data.pre_generated_reply_id,
      question_item_id: currentQuestion?.item_id,
      task_uid: modified.task_uid,
    })

    return modified
  }

  async function queryOtherModels(url, originalHeaders, originalBody) {
    const extraModels = getEnabledExtraModels()
    // Filter out the model that is already being used by the original request
    const currentModel = originalBody?.data?.use_model
    const modelsToQuery = extraModels.filter((m) => m.id !== currentModel)
    if (modelsToQuery.length === 0) return

    // Clear and create panels for each model
    clearPanels()
    ensurePanelsContainer()
    for (const model of modelsToQuery) {
      getOrCreateModelPanel(model.id, model.label)
    }

    // Wait for original response to finish before sending replays
    await new Promise((r) => setTimeout(r, 3000))

    // Serial: send one model at a time, wait for SSE completion before next
    for (const model of modelsToQuery) {
      const modifiedBody = buildModifiedBody(originalBody, model)
      console.log(`[${SCRIPT_ID}] Instructing page to replay request for ${model.label}`)

      // Send a message to the page context to replay this request using native fetch
      window.postMessage({
        type: 'MONICA_MM_REPLAY_REQUEST',
        payload: {
          url: url,
          headers: originalHeaders,
          body: JSON.stringify(modifiedBody),
          modelLabel: model.label,
          modelId: model.id,
        }
      }, '*')

      // Poll DOM attribute (set by page-context script) for completion
      // DOM is shared across Tampermonkey sandbox ↔ page context boundary
      const pollStart = Date.now()
      while (Date.now() - pollStart < 30000) {
        await new Promise((r) => setTimeout(r, 500))
        try {
          const statusEl = document.getElementById('__mm_stream_status')
          const status = statusEl?.getAttribute('data-' + model.id)
          if (status === 'done' || status === 'error') {
            console.log(`[${SCRIPT_ID}] ${model.label} stream ${status}`)
            break
          }
        } catch (e) { /* ignore */ }
      }
      if (Date.now() - pollStart >= 30000) {
        console.log(`[${SCRIPT_ID}] Timeout waiting for ${model.label}, moving on`)
      }

      // Small gap between models
      await new Promise((r) => setTimeout(r, 500))
    }

    // Auto Soft-Reload (only if enabled)
    if (!state.autoReload) {
      console.log(`[${SCRIPT_ID}] Auto-reload disabled. Click sidebar conversation to refresh <1/N>.`)
      return
    }

    console.log(`[${SCRIPT_ID}] Triggering UI Soft Reload to display <1/N> native UI...`)

    // Strategy 1: Find convId from URL query params
    let convId = new URLSearchParams(window.location.search).get('convId')

    // Strategy 2: If no convId in URL yet, try to extract from the current URL path
    if (!convId) {
      const urlMatch = window.location.href.match(/convId=([^&]+)/)
      if (urlMatch) convId = decodeURIComponent(urlMatch[1])
    }

    if (convId) {
      const activeLink = document.querySelector(`a[href*="${encodeURIComponent(convId)}"], a[href*="${convId}"]`)
      if (activeLink) {
        activeLink.click()
        console.log(`[${SCRIPT_ID}] Clicked active conversation to refresh UI`)
        return
      }
    }

    // Strategy 3: Fallback — reload the current page to force UI refresh
    console.log(`[${SCRIPT_ID}] Sidebar link not found, reloading page to show <1/N>...`)
    window.location.reload()
  }



  // ============================================================
  // 5. Panel Management — streaming output display
  // ============================================================

  function ensurePanelsContainer() {
    if (!shadowRoot) ensurePanelVisible()
    if (!shadowRoot) return null
    let container = shadowRoot.querySelector('.mm-panels')
    if (!container) {
      container = document.createElement('div')
      container.className = 'mm-panels'
      mainContainer.appendChild(container)
    }
    return container
  }

  function getOrCreateModelPanel(modelId, modelLabel) {
    if (state.panels.has(modelId)) return state.panels.get(modelId)

    const container = ensurePanelsContainer()
    if (!container) return null

    const panel = document.createElement('div')
    panel.className = 'mm-panel'

    const header = document.createElement('div')
    header.className = 'mm-panel-header'

    const label = document.createElement('span')
    label.className = 'mm-panel-label'
    label.textContent = modelLabel

    const status = document.createElement('span')
    status.className = 'mm-panel-status'
    status.textContent = 'waiting...'

    header.appendChild(label)
    header.appendChild(status)

    const content = document.createElement('div')
    content.className = 'mm-panel-content'

    panel.appendChild(header)
    panel.appendChild(content)
    container.appendChild(panel)

    const panelRef = { container: panel, content, status }
    state.panels.set(modelId, panelRef)
    return panelRef
  }

  function clearPanels() {
    if (shadowRoot) {
      const container = shadowRoot.querySelector('.mm-panels')
      if (container) container.remove()
    }
    state.panels = new Map()
  }

  // Listen for stream chunks from page context
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'MONICA_MM_STREAM_CHUNK') return
    const { modelId, modelLabel, chunk, done, error } = event.data.payload

    const panel = getOrCreateModelPanel(modelId, modelLabel)
    if (!panel) return

    if (error) {
      panel.status.textContent = `error: ${error}`
      return
    }
    if (done) {
      panel.status.textContent = 'done'
      return
    }
    if (chunk) {
      panel.status.textContent = 'streaming...'
      panel.content.textContent += chunk
    }
  })

  // ============================================================
  // 6. UI — Shadow DOM Compare Panel
  // ============================================================

  let shadowHost = null
  let shadowRoot = null
  let mainContainer = null

  function ensurePanelVisible() {
    if (shadowHost) {
      mainContainer.style.display = 'flex'
      state.panelVisible = true
      return
    }

    shadowHost = document.createElement('div')
    shadowHost.id = `${SCRIPT_ID}-host`
    shadowHost.style.cssText = 'position:fixed;top:0;right:0;bottom:0;z-index:999999;pointer-events:none;'
    document.body.appendChild(shadowHost)

    shadowRoot = shadowHost.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = getStyles()
    shadowRoot.appendChild(style)

    mainContainer = document.createElement('div')
    mainContainer.className = 'mm-main'
    shadowRoot.appendChild(mainContainer)

    // Header bar
    const header = document.createElement('div')
    header.className = 'mm-header'

    const title = document.createElement('span')
    title.className = 'mm-title'
    title.textContent = `Multi-Model Compare v${SCRIPT_VERSION}`

    const btnGroup = document.createElement('div')
    btnGroup.className = 'mm-btn-group'

    const settingsBtn = document.createElement('button')
    settingsBtn.textContent = '⚙'
    settingsBtn.title = 'Settings'
    settingsBtn.className = 'mm-btn'
    settingsBtn.addEventListener('click', toggleSettings)

    const collapseBtn = document.createElement('button')
    collapseBtn.textContent = '▶'
    collapseBtn.title = 'Collapse'
    collapseBtn.className = 'mm-btn'
    collapseBtn.addEventListener('click', () => {
      mainContainer.style.display = 'none'
      state.panelVisible = false
    })

    btnGroup.appendChild(settingsBtn)
    btnGroup.appendChild(collapseBtn)

    header.appendChild(title)
    header.appendChild(btnGroup)
    mainContainer.appendChild(header)

    // Settings panel (hidden by default)
    const settingsPanel = createSettingsPanel()
    mainContainer.appendChild(settingsPanel)

    state.panelVisible = true
  }



  // ============================================================
  // 7. Settings Panel
  // ============================================================

  function createSettingsPanel() {
    const panel = document.createElement('div')
    panel.className = 'mm-settings'
    panel.style.display = 'none'

    const heading = document.createElement('div')
    heading.className = 'mm-settings-heading'
    heading.textContent = 'Settings'
    panel.appendChild(heading)

    // Endpoint pattern
    const endpointGroup = document.createElement('div')
    endpointGroup.className = 'mm-setting-group'

    const endpointLabel = document.createElement('label')
    endpointLabel.textContent = 'API Endpoint Pattern:'
    endpointLabel.className = 'mm-label'

    const endpointInput = document.createElement('input')
    endpointInput.type = 'text'
    endpointInput.value = state.endpointPattern
    endpointInput.className = 'mm-input'
    endpointInput.addEventListener('change', (e) => {
      state.endpointPattern = e.target.value
      persistState()
    })

    endpointGroup.appendChild(endpointLabel)
    endpointGroup.appendChild(endpointInput)
    panel.appendChild(endpointGroup)

    // Stagger delay
    const staggerGroup = document.createElement('div')
    staggerGroup.className = 'mm-setting-group'

    const staggerLabel = document.createElement('label')
    staggerLabel.textContent = 'Request Stagger (ms):'
    staggerLabel.className = 'mm-label'

    const staggerInput = document.createElement('input')
    staggerInput.type = 'number'
    staggerInput.value = state.staggerMs
    staggerInput.min = 0
    staggerInput.max = 5000
    staggerInput.step = 100
    staggerInput.className = 'mm-input'
    staggerInput.addEventListener('change', (e) => {
      state.staggerMs = parseInt(e.target.value, 10) || DEFAULT_STAGGER_MS
      persistState()
    })

    staggerGroup.appendChild(staggerLabel)
    staggerGroup.appendChild(staggerInput)
    panel.appendChild(staggerGroup)

    // Auto-reload checkbox
    const reloadGroup = document.createElement('div')
    reloadGroup.className = 'mm-setting-group'

    const reloadRow = document.createElement('div')
    reloadRow.className = 'mm-model-row'

    const reloadCheckbox = document.createElement('input')
    reloadCheckbox.type = 'checkbox'
    reloadCheckbox.checked = state.autoReload
    reloadCheckbox.id = 'mm-auto-reload'
    reloadCheckbox.addEventListener('change', (e) => {
      state.autoReload = e.target.checked
      persistState()
    })

    const reloadLabel = document.createElement('label')
    reloadLabel.htmlFor = 'mm-auto-reload'
    reloadLabel.textContent = 'Auto-reload after responses (show <1/N> native UI)'
    reloadLabel.className = 'mm-model-label'

    reloadRow.appendChild(reloadCheckbox)
    reloadRow.appendChild(reloadLabel)
    reloadGroup.appendChild(reloadRow)
    panel.appendChild(reloadGroup)

    // Model checkboxes
    const modelsHeading = document.createElement('div')
    modelsHeading.className = 'mm-settings-heading'
    modelsHeading.textContent = 'Extra Models'
    modelsHeading.style.marginTop = '8px'
    panel.appendChild(modelsHeading)

    const modelsList = document.createElement('div')
    modelsList.className = 'mm-models-list'

    state.models.forEach((model, index) => {
      const row = document.createElement('div')
      row.className = 'mm-model-row'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = model.enabled
      checkbox.id = `mm-model-${index}`
      checkbox.addEventListener('change', (e) => {
        state.models[index] = { ...state.models[index], enabled: e.target.checked }
        persistState()
      })

      const label = document.createElement('label')
      label.htmlFor = `mm-model-${index}`
      label.textContent = `${model.label} (${model.id})`
      label.className = 'mm-model-label'

      row.appendChild(checkbox)
      row.appendChild(label)
      modelsList.appendChild(row)
    })

    panel.appendChild(modelsList)

    // Custom model input
    const customGroup = document.createElement('div')
    customGroup.className = 'mm-setting-group'
    customGroup.style.marginTop = '8px'

    const customLabel = document.createElement('label')
    customLabel.textContent = 'Add Custom Model (use_model:chat_model:label):'
    customLabel.className = 'mm-label'

    const customRow = document.createElement('div')
    customRow.style.display = 'flex'
    customRow.style.gap = '4px'

    const customInput = document.createElement('input')
    customInput.type = 'text'
    customInput.placeholder = 'model-id:chat_model_key:Display Name'
    customInput.className = 'mm-input'
    customInput.style.flex = '1'

    const addBtn = document.createElement('button')
    addBtn.textContent = '+'
    addBtn.className = 'mm-btn mm-btn-add'
    addBtn.addEventListener('click', () => {
      const val = customInput.value.trim()
      if (!val) return
      const parts = val.split(':')
      const id = parts[0]?.trim()
      const chatModel = parts[1]?.trim() || id.replace(/-/g, '_')
      const label = parts.slice(2).join(':').trim() || id
      state.models = [...state.models, { id, chatModel, label, enabled: true }]
      persistState()
      // Rebuild settings panel
      rebuildSettingsModels(modelsList)
      customInput.value = ''
    })

    customRow.appendChild(customInput)
    customRow.appendChild(addBtn)
    customGroup.appendChild(customLabel)
    customGroup.appendChild(customRow)
    panel.appendChild(customGroup)

    // Debug: show last captured request
    const debugBtn = document.createElement('button')
    debugBtn.textContent = 'Show Last Captured Request'
    debugBtn.className = 'mm-btn'
    debugBtn.style.marginTop = '8px'
    debugBtn.addEventListener('click', () => {
      const req = state.lastCapturedRequest
      if (req) {
        const model = req.body?.data?.use_model || req.body?.model || 'unknown'
        console.log(`[${SCRIPT_ID}] Last captured request:`, JSON.stringify(req, null, 2))
        alert(`Captured endpoint: ${req.url}\nModel: ${model}\nSee console for full details.`)
      } else {
        alert('No request captured yet. Send a message in Monica chat first.')
      }
    })
    panel.appendChild(debugBtn)

    return panel
  }

  function rebuildSettingsModels(modelsList) {
    modelsList.innerHTML = ''
    state.models.forEach((model, index) => {
      const row = document.createElement('div')
      row.className = 'mm-model-row'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = model.enabled
      checkbox.id = `mm-model-${index}`
      checkbox.addEventListener('change', (e) => {
        state.models[index] = { ...state.models[index], enabled: e.target.checked }
        persistState()
      })

      const label = document.createElement('label')
      label.htmlFor = `mm-model-${index}`
      label.textContent = `${model.label} (${model.id})`
      label.className = 'mm-model-label'

      const removeBtn = document.createElement('button')
      removeBtn.textContent = '×'
      removeBtn.className = 'mm-btn-remove'
      removeBtn.addEventListener('click', () => {
        state.models = state.models.filter((_, i) => i !== index)
        persistState()
        rebuildSettingsModels(modelsList)
      })

      row.appendChild(checkbox)
      row.appendChild(label)
      row.appendChild(removeBtn)
      modelsList.appendChild(row)
    })
  }

  function toggleSettings() {
    if (!shadowRoot) return
    const settingsEl = shadowRoot.querySelector('.mm-settings')
    if (settingsEl) {
      settingsEl.style.display = settingsEl.style.display === 'none' ? 'block' : 'none'
    }
  }

  // ============================================================
  // 8. Styles
  // ============================================================

  function getStyles() {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .mm-main {
        position: fixed;
        top: 60px;
        right: 12px;
        width: 420px;
        max-height: calc(100vh - 80px);
        background: #1e1e2e;
        color: #cdd6f4;
        border: 1px solid #45475a;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        pointer-events: auto;
        overflow: hidden;
        resize: horizontal;
      }

      .mm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #181825;
        border-bottom: 1px solid #45475a;
        cursor: move;
      }

      .mm-title {
        font-weight: 600;
        font-size: 14px;
        color: #cba6f7;
      }

      .mm-btn-group {
        display: flex;
        gap: 6px;
      }

      .mm-btn {
        background: #313244;
        color: #cdd6f4;
        border: 1px solid #45475a;
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 13px;
        transition: background 0.15s;
      }
      .mm-btn:hover { background: #45475a; }

      .mm-btn-add {
        font-weight: bold;
        font-size: 16px;
        padding: 4px 12px;
      }

      .mm-btn-remove {
        background: none;
        border: none;
        color: #f38ba8;
        cursor: pointer;
        font-size: 16px;
        padding: 0 4px;
        margin-left: auto;
      }
      .mm-btn-remove:hover { color: #eba0ac; }

      .mm-settings {
        padding: 10px 14px;
        border-bottom: 1px solid #45475a;
        background: #1e1e2e;
        max-height: 350px;
        overflow-y: auto;
      }

      .mm-settings-heading {
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #a6adc8;
        margin-bottom: 6px;
      }

      .mm-setting-group {
        margin-bottom: 8px;
      }

      .mm-label {
        display: block;
        font-size: 12px;
        color: #a6adc8;
        margin-bottom: 3px;
      }

      .mm-input {
        width: 100%;
        background: #313244;
        color: #cdd6f4;
        border: 1px solid #45475a;
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 13px;
        outline: none;
      }
      .mm-input:focus { border-color: #cba6f7; }

      .mm-models-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .mm-model-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 0;
      }

      .mm-model-label {
        font-size: 12px;
        cursor: pointer;
        flex: 1;
      }

      .mm-panels {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1px;
        background: #11111b;
      }

      .mm-panel {
        background: #1e1e2e;
        display: flex;
        flex-direction: column;
      }

      .mm-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 14px;
        background: #181825;
        border-bottom: 1px solid #313244;
      }

      .mm-panel-label {
        font-weight: 600;
        font-size: 13px;
        color: #89b4fa;
      }

      .mm-panel-status {
        font-size: 11px;
        color: #a6adc8;
      }

      .mm-panel-content {
        padding: 10px 14px;
        max-height: 300px;
        overflow-y: auto;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .mm-panel-content h1 { font-size: 18px; margin: 8px 0 4px; color: #cba6f7; }
      .mm-panel-content h2 { font-size: 16px; margin: 6px 0 4px; color: #cba6f7; }
      .mm-panel-content h3 { font-size: 14px; margin: 4px 0 2px; color: #cba6f7; }
      .mm-panel-content h4 { font-size: 13px; margin: 4px 0 2px; color: #cba6f7; }

      .mm-panel-content code {
        background: #313244;
        padding: 1px 5px;
        border-radius: 4px;
        font-family: 'Cascadia Code', 'Fira Code', monospace;
        font-size: 12px;
      }

      .mm-panel-content pre {
        background: #11111b;
        padding: 10px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 6px 0;
      }

      .mm-panel-content pre code {
        background: none;
        padding: 0;
      }

      .mm-panel-content strong { color: #f5e0dc; }
      .mm-panel-content em { color: #f2cdcd; }

      .mm-panel-content ul, .mm-panel-content ol {
        padding-left: 18px;
        margin: 4px 0;
      }

      .mm-panel-content li {
        margin: 2px 0;
      }

      /* Scrollbar */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #45475a; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #585b70; }
    `
  }

  // ============================================================
  // 9. Toggle Button (floating)
  // ============================================================

  function createToggleButton() {
    const btn = document.createElement('div')
    btn.id = `${SCRIPT_ID}-toggle`
    btn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 999998;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: ${state.enabled ? '#cba6f7' : '#45475a'};
      color: ${state.enabled ? '#1e1e2e' : '#cdd6f4'};
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 18px;
      font-weight: bold;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.2s;
      user-select: none;
    `
    btn.textContent = 'M'
    btn.title = `Multi-Model Compare v${SCRIPT_VERSION}: ${state.enabled ? 'ON' : 'OFF'}`

    btn.addEventListener('click', () => {
      state.enabled = !state.enabled
      persistState()
      btn.style.background = state.enabled ? '#cba6f7' : '#45475a'
      btn.style.color = state.enabled ? '#1e1e2e' : '#cdd6f4'
      btn.title = `Multi-Model Compare v${SCRIPT_VERSION}: ${state.enabled ? 'ON' : 'OFF'}`

      if (state.enabled && !state.panelVisible) {
        ensurePanelVisible()
      }
      if (!state.enabled && mainContainer) {
        mainContainer.style.display = 'none'
        state.panelVisible = false
      }

      console.log(`[${SCRIPT_ID}] ${state.enabled ? 'Enabled' : 'Disabled'}`)
    })

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (state.panelVisible && mainContainer) {
        mainContainer.style.display = 'none'
        state.panelVisible = false
      } else if (state.enabled) {
        ensurePanelVisible()
      }
    })

    document.body.appendChild(btn)
  }

  // ============================================================
  // 10. Tampermonkey Menu Commands
  // ============================================================

  GM_registerMenuCommand('Toggle Multi-Model Compare', () => {
    state.enabled = !state.enabled
    persistState()
    const toggleBtn = document.getElementById(`${SCRIPT_ID}-toggle`)
    if (toggleBtn) {
      toggleBtn.style.background = state.enabled ? '#cba6f7' : '#45475a'
      toggleBtn.style.color = state.enabled ? '#1e1e2e' : '#cdd6f4'
      toggleBtn.title = `Multi-Model Compare v${SCRIPT_VERSION}: ${state.enabled ? 'ON' : 'OFF'}`
    }
    console.log(`[${SCRIPT_ID}] ${state.enabled ? 'Enabled' : 'Disabled'} via menu`)
  })

  GM_registerMenuCommand('Reset Settings', () => {
    state.models = normalizeModels(DEFAULT_MODELS)
    state.endpointPattern = '/api/custom_bot/chat'
    state.staggerMs = DEFAULT_STAGGER_MS
    persistState()
    console.log(`[${SCRIPT_ID}] Settings reset to defaults`)
    location.reload()
  })

  // ============================================================
  // 11. Drag Support
  // ============================================================

  function enableDrag() {
    if (!shadowRoot) return
    const header = shadowRoot.querySelector('.mm-header')
    if (!header) return

    let isDragging = false
    let startX, startY, origRight, origTop

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return
      isDragging = true
      startX = e.clientX
      startY = e.clientY
      const rect = mainContainer.getBoundingClientRect()
      origRight = window.innerWidth - rect.right
      origTop = rect.top
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      mainContainer.style.right = `${Math.max(0, origRight - dx)}px`
      mainContainer.style.top = `${Math.max(0, origTop + dy)}px`
    })

    document.addEventListener('mouseup', () => {
      isDragging = false
    })
  }

  // ============================================================
  // 12. Init
  // ============================================================

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady)
    } else {
      onReady()
    }
  }

  function onReady() {
    // Reset Shadow DOM refs — after page refresh, old refs point to destroyed nodes
    shadowHost = null
    shadowRoot = null
    mainContainer = null
    state.panels = new Map()

    createToggleButton()
    if (state.enabled) {
      ensurePanelVisible()
    }
    // Defer drag setup until panel exists
    const observer = new MutationObserver(() => {
      if (shadowRoot) {
        enableDrag()
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true })

    console.log(`[${SCRIPT_ID}] Initialized. Enabled: ${state.enabled}`)
  }

  // The fetch hook is installed at document-start (above).
  // UI elements wait for DOM ready.
  init()
})()
