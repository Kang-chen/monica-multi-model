const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.resolve(__dirname, '../monica-multi-model.user.js'), 'utf8')
const start = source.indexOf('  // Listen for captured requests from the page context')
const end = source.indexOf('  // Inject the hook immediately', start)
assert(start >= 0 && end > start)

function run({ origin = 'https://monica.im', url = '/api/custom_bot/chat',
  enabled = true, discoveryThrows = false, body = '{"data":{"use_model":"test-model"}}', payloadMissing = false } = {}) {
  let handler
  let dispatched = 0
  let learned = 0
  const nativeWindow = {}
  const wrapper = new Proxy(nativeWindow, {})
  wrapper.addEventListener = (_, callback) => { handler = callback }
  const context = {
    window: wrapper, location: { origin: 'https://monica.im', href: 'https://monica.im/home/chat' }, URL,
    SCRIPT_ID: 'monica-mm', state: { enabled },
    learnModelFromRequest: () => { learned++; if (discoveryThrows) throw new Error('discovery failed') },
    getEnabledExtraModels: () => [], queryOtherModels: () => { dispatched++ },
    console: { log() {}, warn() {}, error() {}, group() {}, groupEnd() {} },
  }
  vm.runInNewContext(source.slice(start, end), context)
  handler({ source: nativeWindow, origin, data: { type: 'MONICA_MM_CAPTURED_REQUEST',
    payload: payloadMissing ? null : { url, body, headers: {}, runId: 'regression' } } })
  return { dispatched, learned }
}

assert.strictEqual(run().dispatched, 1, 'wrapped window must not block native capture')
assert.strictEqual(run({ discoveryThrows: true }).dispatched, 1, 'discovery failure must not block dispatch')
assert.deepStrictEqual(run({ enabled: false }), { dispatched: 0, learned: 1 }, 'disabled concurrency still calibrates')
for (const input of [
  { origin: 'https://attacker.test' }, { origin: '' },
  { url: 'https://attacker.test/api/custom_bot/chat' }, { url: '/unrelated' }, { payloadMissing: true },
]) assert.deepStrictEqual(run(input), { dispatched: 0, learned: 0 }, 'reject foreign or malformed messages')
assert.strictEqual(run({ body: 'not json' }).dispatched, 0, 'invalid JSON never dispatches')
console.log('request-bridge tests passed')
