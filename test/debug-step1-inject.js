// Phase 1: Connect to debug Chrome via CDP, navigate to Monica, inject request capture
const { chromium } = require('C:/Users/Kang/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  console.log('Connected to Chrome via CDP');

  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} context(s)`);

  const context = contexts[0];
  const pages = context.pages();
  console.log(`Found ${pages.length} page(s):`);
  for (const p of pages) {
    console.log(`  - ${p.url()}`);
  }

  // Use the first page (newtab) and navigate to Monica
  const page = pages[0];
  await page.goto('https://monica.im/home/chat/Monica/monica', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Navigated to Monica chat');

  // Wait for the page to fully load
  await page.waitForTimeout(3000);
  console.log('Page URL:', page.url());
  console.log('Page title:', await page.title());

  // Inject fetch interceptor to capture ALL /api/custom_bot/chat POST requests
  await page.evaluate(() => {
    window.__capturedRequests = [];
    const origFetch = window.__origFetchForCapture || window.fetch;
    window.__origFetchForCapture = origFetch;

    window.fetch = async function(...args) {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      const method = init?.method || (input instanceof Request ? input.method : 'GET');

      if (method.toUpperCase() === 'POST' && url.includes('/api/custom_bot/chat')) {
        let bodyStr = '';
        const body = init?.body;
        if (typeof body === 'string') bodyStr = body;
        else if (body instanceof Blob) bodyStr = await body.text();
        else if (body) try { bodyStr = JSON.stringify(body); } catch(e) {}

        const headers = {};
        const src = init?.headers;
        if (src instanceof Headers) src.forEach((v, k) => { headers[k] = v; });
        else if (src && typeof src === 'object') Object.assign(headers, src);

        const entry = {
          timestamp: new Date().toISOString(),
          url,
          headers,
          body: bodyStr,
          bodyParsed: null
        };
        try { entry.bodyParsed = JSON.parse(bodyStr); } catch(e) {}

        window.__capturedRequests.push(entry);
        console.log(`%c[CAPTURE] Request #${window.__capturedRequests.length}: ${entry.bodyParsed?.data?.trigger_by || 'chat'} | model: ${entry.bodyParsed?.data?.use_model || '?'}`, 'color:#f38ba8;font-weight:bold');
      }

      return origFetch.apply(this, args);
    };

    console.log('%c[CAPTURE] Fetch interceptor installed - will capture /api/custom_bot/chat requests', 'color:#a6e3a1;font-weight:bold');
  });

  console.log('Fetch interceptor injected successfully');
  console.log('\n=== READY ===');
  console.log('Now manually:');
  console.log('1. Send a message in Monica chat: "你是什么模型？请告诉我你的确切模型名称"');
  console.log('2. After getting a response, use Monica\'s native retry/regenerate with a different model');
  console.log('3. Run the next script to extract captured requests');

  // Keep connection alive - don't disconnect
  // The browser stays open and the interceptor stays active
  await browser.close();  // This only closes the CDP connection, not the browser itself
  console.log('CDP connection closed (browser stays open, interceptor remains active)');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
