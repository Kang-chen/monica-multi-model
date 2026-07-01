// Step 1: Navigate to fresh Monica chat, inject monitor, send test message
const { chromium } = require('C:/Users/Kang/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright');

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
    monicaPage = pages[0];
  }

  console.log('Current page:', monicaPage.url());

  // Navigate to fresh Monica chat (no convId = new conversation)
  await monicaPage.goto('https://monica.im/home/chat/Monica/monica', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Navigated to fresh Monica chat');
  await monicaPage.waitForTimeout(3000);
  console.log('Page loaded:', monicaPage.url());

  // Start collecting console messages
  const consoleMsgs = [];
  monicaPage.on('console', msg => {
    const text = msg.text();
    consoleMsgs.push({ time: Date.now(), type: msg.type(), text });
    if (text.includes('monica-mm') || text.includes('CAPTURE')) {
      console.log(`  [console:${msg.type()}] ${text.substring(0, 200)}`);
    }
  });

  // Check if Tampermonkey script is loaded by looking for the toggle button
  await monicaPage.waitForTimeout(2000);
  const scriptLoaded = await monicaPage.evaluate(() => {
    // The toggle button has id like mm-toggle or class containing monica-mm
    const allElements = document.querySelectorAll('*');
    let found = false;
    for (const el of allElements) {
      if (el.shadowRoot) {
        found = true;
        break;
      }
    }
    // Also check if the script's state is accessible via console logs
    return {
      hasShadowElements: found,
      pageUrl: window.location.href
    };
  });
  console.log('Script check:', JSON.stringify(scriptLoaded));

  // Find the chat input textbox and type the test message
  const inputSelector = 'textarea, [contenteditable="true"], input[type="text"], div[role="textbox"]';

  // Try to find the input
  const inputFound = await monicaPage.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) return { tag: el.tagName, placeholder: el.getAttribute('placeholder') || '', role: el.getAttribute('role') || '' };
    return null;
  }, inputSelector);
  console.log('Input element found:', JSON.stringify(inputFound));

  if (!inputFound) {
    console.log('Trying alternative selectors...');
    // Take a snapshot of the page structure to find the input
    const snapshot = await monicaPage.evaluate(() => {
      const inputs = document.querySelectorAll('textarea, [contenteditable], [role="textbox"], input');
      return Array.from(inputs).map(el => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        placeholder: el.getAttribute('placeholder'),
        role: el.getAttribute('role'),
        contentEditable: el.contentEditable,
        className: el.className?.substring?.(0, 50)
      }));
    });
    console.log('All input-like elements:', JSON.stringify(snapshot, null, 2));
  }

  // Type the message using Playwright's fill/type
  try {
    // Try textarea first (Monica typically uses textarea)
    const textarea = await monicaPage.$('textarea');
    if (textarea) {
      await textarea.click();
      await monicaPage.waitForTimeout(500);
      await textarea.fill('你是什么模型？请告诉我你的确切模型名称');
      console.log('Message typed into textarea');

      await monicaPage.waitForTimeout(500);

      // Press Enter to send
      await monicaPage.keyboard.press('Enter');
      console.log('Enter pressed - message sent!');
    } else {
      console.log('No textarea found, trying contenteditable...');
      const editable = await monicaPage.$('[contenteditable="true"]');
      if (editable) {
        await editable.click();
        await monicaPage.waitForTimeout(500);
        await monicaPage.keyboard.type('你是什么模型？请告诉我你的确切模型名称');
        await monicaPage.waitForTimeout(500);
        await monicaPage.keyboard.press('Enter');
        console.log('Message sent via contenteditable');
      } else {
        console.log('ERROR: Could not find input element!');
      }
    }
  } catch (err) {
    console.log('Error typing message:', err.message);
  }

  // Wait for responses (original + staggered replays)
  // Original response: ~5s, then 3s base delay + 200ms stagger per model
  console.log('\nWaiting 45 seconds for all responses...\n');
  await monicaPage.waitForTimeout(45000);

  // Print all monica-mm related console messages
  const mmMsgs = consoleMsgs.filter(m =>
    m.text.includes('monica-mm') || m.text.includes('MONICA_MM') ||
    m.text.includes('Replay') || m.text.includes('replay') ||
    m.text.includes('SSE response') || m.text.includes('model-switch')
  );

  console.log(`\n=== ${mmMsgs.length} monica-mm related console messages ===\n`);
  for (const m of mmMsgs) {
    console.log(`[${m.type}] ${m.text.substring(0, 300)}`);
  }

  // Check if ALL console messages contain any errors
  const errors = consoleMsgs.filter(m => m.type === 'error' && m.text.includes('monica-mm'));
  if (errors.length > 0) {
    console.log(`\n=== ${errors.length} ERROR(s) ===`);
    for (const e of errors) {
      console.log(`[ERROR] ${e.text}`);
    }
  }

  await browser.close();
  console.log('\nDone.');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
