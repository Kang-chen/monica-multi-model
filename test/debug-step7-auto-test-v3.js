// Auto-test v3: fresh chat, send message, wait, screenshot
const { chromium } = require('./playwright-runtime');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();

  let monicaPage = pages.find(p => p.url().includes('monica.im')) || pages[0];
  console.log('Current page:', monicaPage.url());

  // Navigate to fresh Monica chat
  await monicaPage.goto('https://monica.im/home/chat/Monica/monica', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await monicaPage.waitForTimeout(3000);
  console.log('Fresh chat loaded:', monicaPage.url());

  // Collect console messages
  const consoleMsgs = [];
  monicaPage.on('console', msg => {
    const text = msg.text();
    consoleMsgs.push({ type: msg.type(), text });
    if (text.includes('monica-mm') || text.includes('CAPTURE')) {
      console.log(`  [${msg.type()}] ${text.substring(0, 250)}`);
    }
  });

  // Send message
  const textarea = await monicaPage.$('textarea');
  if (textarea) {
    await textarea.click();
    await monicaPage.waitForTimeout(500);
    await textarea.fill('你是什么模型？请告诉我你的确切模型名称');
    await monicaPage.waitForTimeout(500);
    await monicaPage.keyboard.press('Enter');
    console.log('\nMessage sent! Waiting 50 seconds for all responses...\n');
  } else {
    console.error('Cannot find textarea!');
    await browser.close();
    return;
  }

  // Wait for original + staggered replays + soft-reload
  await monicaPage.waitForTimeout(50000);

  // Screenshot
  await monicaPage.screenshot({ path: 'D:/kownledgeBase/knowledge/tools/monica-multi-model/test-result-v3.png', fullPage: false });
  console.log('Screenshot saved: test-result-v3.png');

  // Check for <1/N> navigation and response content
  const uiCheck = await monicaPage.evaluate(() => {
    const bodyText = document.body.innerText;
    // Find N/M patterns
    const navMatches = bodyText.match(/\d+\s*\/\s*\d+/g) || [];
    // Find model identity mentions
    const modelMentions = [];
    const patterns = ['gpt', 'GPT', 'claude', 'Claude', 'gemini', 'Gemini', 'gemini-3', 'gpt-5', 'sonnet'];
    for (const p of patterns) {
      const idx = bodyText.indexOf(p);
      if (idx >= 0) {
        modelMentions.push(bodyText.substring(Math.max(0, idx - 20), idx + 50).trim());
      }
    }
    return { navMatches, modelMentions, title: document.title };
  });

  console.log('\nUI check:', JSON.stringify(uiCheck, null, 2));

  // Summary of console messages
  const mmMsgs = consoleMsgs.filter(m => m.text.includes('monica-mm'));
  const errors = consoleMsgs.filter(m => m.type === 'error' && (m.text.includes('monica-mm') || m.text.includes('Replay')));
  console.log(`\nmonica-mm messages: ${mmMsgs.length}, errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log('ERRORS:');
    for (const e of errors) console.log(`  ${e.text.substring(0, 200)}`);
  }

  // Print SSE response summaries
  const sseMsgs = consoleMsgs.filter(m => m.text.includes('SSE response') || m.text.includes('Total bytes') || m.text.includes('Preview:'));
  if (sseMsgs.length > 0) {
    console.log('\nSSE Response logs:');
    for (const m of sseMsgs) console.log(`  ${m.text.substring(0, 300)}`);
  }

  await browser.close();
  console.log('\nDone.');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
