// Check current UI state: take screenshot + read SSE response content
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

  console.log('Monica page:', monicaPage.url());

  // Take a screenshot
  await monicaPage.screenshot({ path: 'D:/kownledgeBase/knowledge/tools/monica-multi-model/test-result.png', fullPage: false });
  console.log('Screenshot saved to test-result.png');

  // Check the page for <1/N> navigation and response content
  const uiState = await monicaPage.evaluate(() => {
    // Find all text that looks like model identity responses
    const allText = document.body.innerText;

    // Find <X/N> navigation elements
    const navMatches = allText.match(/\d+\s*\/\s*\d+/g) || [];

    // Find message bubbles - look for reply content
    const results = {
      navIndicators: navMatches,
      pageTitle: document.title,
      url: window.location.href,
    };

    return results;
  });

  console.log('\nUI State:', JSON.stringify(uiState, null, 2));

  // Read the SSE response logs from console (check if they contain model identity)
  // Re-read the page console history by evaluating
  const consoleCheck = await monicaPage.evaluate(() => {
    // Check for any visible response text on the page
    const messageElements = document.querySelectorAll('[class*="message"], [class*="content"], [class*="markdown"]');
    const texts = [];
    for (const el of messageElements) {
      const text = el.innerText?.trim();
      if (text && text.length > 5 && text.length < 500 &&
          (text.includes('模型') || text.includes('GPT') || text.includes('Claude') ||
           text.includes('Gemini') || text.includes('gpt') || text.includes('gemini'))) {
        texts.push(text.substring(0, 200));
      }
    }
    return texts;
  });

  console.log('\nModel identity texts found on page:');
  for (const t of consoleCheck) {
    console.log(`  - ${t}`);
  }

  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
