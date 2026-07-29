// Check console logs and captured requests after the fix
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
    console.error('Monica page not found! Pages:', pages.map(p => p.url()));
    await browser.close();
    return;
  }

  console.log('Found Monica page:', monicaPage.url());

  // Collect console messages for 5 seconds
  const messages = [];
  const handler = msg => {
    const text = msg.text();
    if (text.includes('monica-mm') || text.includes('MONICA_MM') || text.includes('CAPTURE')) {
      messages.push({ type: msg.type(), text });
    }
  };
  monicaPage.on('console', handler);

  console.log('\nListening for console messages for 8 seconds...\n');
  await monicaPage.waitForTimeout(8000);
  monicaPage.off('console', handler);

  if (messages.length === 0) {
    console.log('No monica-mm console messages detected in the last 8 seconds.');
    console.log('Checking if the script is loaded...');

    // Check if the userscript state is accessible
    const scriptState = await monicaPage.evaluate(() => {
      // Try to find evidence of the script
      const logs = [];
      // Check if there are any monica-mm elements in the DOM
      const mmElements = document.querySelectorAll('[class*="monica-mm"], [class*="mm-"]');
      logs.push(`MM DOM elements: ${mmElements.length}`);
      return logs;
    });
    console.log('Script check:', scriptState);
  } else {
    console.log(`Found ${messages.length} monica-mm console message(s):\n`);
    for (const m of messages) {
      console.log(`[${m.type}] ${m.text}`);
    }
  }

  // Also check if there are any recent network requests to the chat API
  console.log('\n--- Checking recent network activity ---');

  // Try to get console history by evaluating
  const recentLogs = await monicaPage.evaluate(() => {
    // Check if window.__capturedRequests exists (from our previous inject)
    const captured = window.__capturedRequests;
    if (captured && captured.length > 0) {
      return `Found ${captured.length} captured requests from previous session`;
    }
    return 'No __capturedRequests found (page was refreshed, interceptor gone)';
  });
  console.log(recentLogs);

  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
