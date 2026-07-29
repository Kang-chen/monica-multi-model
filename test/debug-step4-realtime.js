// Re-inject interceptor + listen for console in real-time
// Run this BEFORE sending a message in Monica
const { chromium } = require('./playwright-runtime');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();

  let monicaPage = null;
  for (const p of pages) {
    if (p.url().includes('monica.im')) {
      monicaPage = p;
      break;
    }
  }

  if (!monicaPage) {
    console.error('Monica page not found!');
    await browser.close();
    return;
  }

  console.log('Found Monica page:', monicaPage.url());

  // Start listening for ALL console messages immediately
  const allMessages = [];
  monicaPage.on('console', msg => {
    const text = msg.text();
    allMessages.push({ time: new Date().toISOString(), type: msg.type(), text });
    // Print monica-mm messages in real-time
    if (text.includes('monica-mm') || text.includes('MONICA_MM') || text.includes('CAPTURE') || text.includes('Replay') || text.includes('replay') || text.includes('SSE')) {
      console.log(`[${msg.type()}] ${text}`);
    }
  });

  // Re-inject the fetch interceptor to capture requests
  await monicaPage.evaluate(() => {
    window.__capturedRequests = [];
    window.__capturedResponses = [];

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

        let bodyParsed = null;
        try { bodyParsed = JSON.parse(bodyStr); } catch(e) {}

        const entry = {
          timestamp: new Date().toISOString(),
          url,
          bodyParsed
        };
        window.__capturedRequests.push(entry);

        console.log(`%c[CAPTURE] Request #${window.__capturedRequests.length}: trigger_by=${bodyParsed?.data?.trigger_by || '?'} | model=${bodyParsed?.data?.use_model || '?'} | pre_reply_id=${bodyParsed?.data?.pre_generated_reply_id || '?'}`, 'color:#f38ba8;font-weight:bold');
      }

      // Call original fetch and capture response
      const response = await origFetch.apply(this, args);

      // For chat API responses, read the SSE stream and log model identity
      if (method.toUpperCase() === 'POST' && url.includes('/api/custom_bot/chat') && response.ok) {
        const clonedResponse = response.clone();
        // Read the SSE stream in background
        (async () => {
          try {
            const reader = clonedResponse.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              fullText += decoder.decode(value, { stream: true });
            }
            // Extract content from SSE data lines
            let content = '';
            for (const line of fullText.split('\n')) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const parsed = JSON.parse(line.substring(6));
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (delta) content += delta;
                } catch(e) {}
              }
            }
            const preview = content.substring(0, 200);
            window.__capturedResponses.push({ preview, fullLength: content.length });
            console.log(`%c[CAPTURE] Response #${window.__capturedResponses.length} (${content.length} chars): ${preview}`, 'color:#a6e3a1;font-weight:bold');
          } catch(e) {
            console.log('[CAPTURE] Response read error:', e.message);
          }
        })();
      }

      return response;
    };

    console.log('%c[CAPTURE] Fetch interceptor v2 installed (captures requests + responses)', 'color:#cba6f7;font-weight:bold');
  });

  console.log('\nInterceptor injected. Listening for 60 seconds...');
  console.log('>>> Send your message in Monica now! <<<\n');

  // Listen for 60 seconds
  await monicaPage.waitForTimeout(60000);

  // Print summary
  console.log('\n=== SUMMARY ===');
  const captured = await monicaPage.evaluate(() => ({
    requests: (window.__capturedRequests || []).map(r => ({
      trigger_by: r.bodyParsed?.data?.trigger_by,
      use_model: r.bodyParsed?.data?.use_model,
      pre_generated_reply_id: r.bodyParsed?.data?.pre_generated_reply_id,
      pre_parent_item_id: r.bodyParsed?.data?.pre_parent_item_id,
      items_count: r.bodyParsed?.data?.items?.length,
      items: (r.bodyParsed?.data?.items || []).map(i => ({
        item_id: i.item_id,
        item_type: i.item_type,
        chat_model: i.data?.chat_model,
        content_preview: (i.data?.content || '').substring(0, 50)
      }))
    })),
    responses: window.__capturedResponses || []
  }));

  console.log(`\nCaptured ${captured.requests.length} request(s), ${captured.responses.length} response(s)`);
  for (let i = 0; i < captured.requests.length; i++) {
    const r = captured.requests[i];
    console.log(`\n--- Request #${i+1} ---`);
    console.log(JSON.stringify(r, null, 2));
  }
  for (let i = 0; i < captured.responses.length; i++) {
    console.log(`\n--- Response #${i+1} (${captured.responses[i].fullLength} chars) ---`);
    console.log(captured.responses[i].preview);
  }

  // Count monica-mm specific messages
  const mmMsgs = allMessages.filter(m => m.text.includes('monica-mm'));
  console.log(`\n${mmMsgs.length} monica-mm log messages captured`);

  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
