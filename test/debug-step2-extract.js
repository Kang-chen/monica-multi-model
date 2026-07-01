// Phase 1.5: Extract captured requests from the debug Chrome
const { chromium } = require('C:/Users/Kang/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const pages = context.pages();

  // Find the Monica page
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

  // Extract captured requests
  const captured = await monicaPage.evaluate(() => {
    return (window.__capturedRequests || []).map(r => ({
      timestamp: r.timestamp,
      url: r.url,
      body: r.bodyParsed
    }));
  });

  console.log(`\nCaptured ${captured.length} request(s)\n`);

  if (captured.length === 0) {
    console.log('No requests captured. Make sure you sent a message in the chat.');
    await browser.close();
    return;
  }

  // Save full data to file for analysis
  fs.writeFileSync('captured-requests.json', JSON.stringify(captured, null, 2));
  console.log('Full data saved to captured-requests.json\n');

  // Print summary of each request
  for (let i = 0; i < captured.length; i++) {
    const r = captured[i];
    const body = r.body;
    console.log(`=== Request #${i + 1} ===`);
    console.log(`  timestamp: ${r.timestamp}`);
    console.log(`  trigger_by: ${body?.data?.trigger_by || '(not set)'}`);
    console.log(`  use_model: ${body?.data?.use_model || '(not set)'}`);
    console.log(`  task_uid: ${body?.task_uid || '(not set)'}`);
    console.log(`  pre_generated_reply_id: ${body?.data?.pre_generated_reply_id || '(not set)'}`);
    console.log(`  pre_parent_item_id: ${body?.data?.pre_parent_item_id || '(not set)'}`);

    // Items summary
    const items = body?.data?.items || [];
    console.log(`  items count: ${items.length}`);
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      console.log(`    item[${j}].item_id: ${item?.item_id || '(not set)'}`);
      console.log(`    item[${j}].data.chat_model: ${item?.data?.chat_model || '(not set)'}`);
      console.log(`    item[${j}].data.type: ${item?.data?.type || '(not set)'}`);
      console.log(`    item[${j}].data.content: ${(item?.data?.content || '').substring(0, 50)}`);
    }
    console.log('');
  }

  // Diff analysis between requests
  if (captured.length >= 2) {
    console.log('\n=== DIFF ANALYSIS: Request #1 vs Request #2 ===\n');
    const r1 = captured[0].body;
    const r2 = captured[1].body;

    const fields = [
      ['task_uid', r1?.task_uid, r2?.task_uid],
      ['data.trigger_by', r1?.data?.trigger_by, r2?.data?.trigger_by],
      ['data.use_model', r1?.data?.use_model, r2?.data?.use_model],
      ['data.pre_generated_reply_id', r1?.data?.pre_generated_reply_id, r2?.data?.pre_generated_reply_id],
      ['data.pre_parent_item_id', r1?.data?.pre_parent_item_id, r2?.data?.pre_parent_item_id],
      ['data.items.length', r1?.data?.items?.length, r2?.data?.items?.length],
      ['data.items[0].item_id', r1?.data?.items?.[0]?.item_id, r2?.data?.items?.[0]?.item_id],
      ['data.items[0].data.chat_model', r1?.data?.items?.[0]?.data?.chat_model, r2?.data?.items?.[0]?.data?.chat_model],
    ];

    // Check if r2 has more items
    if (r2?.data?.items?.length > 1) {
      fields.push(['data.items[1].item_id', r1?.data?.items?.[1]?.item_id, r2?.data?.items?.[1]?.item_id]);
      fields.push(['data.items[1].data.chat_model', r1?.data?.items?.[1]?.data?.chat_model, r2?.data?.items?.[1]?.data?.chat_model]);
      fields.push(['data.items[1].data.type', r1?.data?.items?.[1]?.data?.type, r2?.data?.items?.[1]?.data?.type]);
    }

    for (const [field, v1, v2] of fields) {
      const same = v1 === v2;
      const marker = same ? '  SAME' : '  DIFF <<<';
      console.log(`${field}:`);
      console.log(`  #1: ${v1}`);
      console.log(`  #2: ${v2}${marker}`);
    }

    // Find ALL keys that differ at the top level of data
    console.log('\n=== ALL TOP-LEVEL data.* KEYS ===');
    const allKeys = new Set([...Object.keys(r1?.data || {}), ...Object.keys(r2?.data || {})]);
    for (const key of allKeys) {
      if (key === 'items') continue; // handled above
      const v1 = JSON.stringify(r1?.data?.[key]);
      const v2 = JSON.stringify(r2?.data?.[key]);
      const marker = v1 === v2 ? '' : ' <<< DIFF';
      console.log(`  data.${key}: ${v1 === v2 ? 'SAME' : `#1=${v1?.substring(0,60)} | #2=${v2?.substring(0,60)}`}${marker}`);
    }
  }

  if (captured.length >= 3) {
    console.log('\n=== DIFF ANALYSIS: Request #2 vs Request #3 ===\n');
    const r2 = captured[1].body;
    const r3 = captured[2].body;

    const fields = [
      ['task_uid', r2?.task_uid, r3?.task_uid],
      ['data.trigger_by', r2?.data?.trigger_by, r3?.data?.trigger_by],
      ['data.use_model', r2?.data?.use_model, r3?.data?.use_model],
      ['data.pre_generated_reply_id', r2?.data?.pre_generated_reply_id, r3?.data?.pre_generated_reply_id],
      ['data.pre_parent_item_id', r2?.data?.pre_parent_item_id, r3?.data?.pre_parent_item_id],
      ['data.items.length', r2?.data?.items?.length, r3?.data?.items?.length],
      ['data.items[0].item_id', r2?.data?.items?.[0]?.item_id, r3?.data?.items?.[0]?.item_id],
      ['data.items[0].data.chat_model', r2?.data?.items?.[0]?.data?.chat_model, r3?.data?.items?.[0]?.data?.chat_model],
    ];

    for (const [field, v1, v2] of fields) {
      const same = v1 === v2;
      const marker = same ? '  SAME' : '  DIFF <<<';
      console.log(`${field}:`);
      console.log(`  #2: ${v1}`);
      console.log(`  #3: ${v2}${marker}`);
    }
  }

  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
