const assert = require('assert')
const path = require('path')
const { loadPlaywright } = require('./playwright-runtime')

function emptyEnv(overrides = {}) {
  return {
    APPDATA: '',
    NODE_PATH: '',
    npm_config_prefix: '',
    ...overrides,
  }
}

function testEnvironmentOverrideWins() {
  const requested = []
  const expected = { chromium: { source: 'environment' } }
  const actual = loadPlaywright({
    env: emptyEnv({ PLAYWRIGHT_MODULE: 'custom-playwright' }),
    tryRequire(moduleId) {
      requested.push(moduleId)
      if (moduleId === 'custom-playwright') return expected
      return { chromium: { source: 'fallback' } }
    },
    getGlobalNpmRoot: () => '',
  })

  assert.strictEqual(actual, expected)
  assert.deepStrictEqual(requested, ['custom-playwright'])
}

function testLocalResolutionOrder() {
  const requested = []
  const expected = { chromium: { source: 'local' } }
  const actual = loadPlaywright({
    env: emptyEnv(),
    tryRequire(moduleId) {
      requested.push(moduleId)
      return moduleId === 'playwright' ? expected : null
    },
    getGlobalNpmRoot: () => '',
  })

  assert.strictEqual(actual, expected)
  assert.deepStrictEqual(requested, [undefined, 'playwright'])
}

function testGlobalFallback() {
  const requested = []
  const globalRoot = path.join('test-root', 'node_modules')
  const expectedPath = path.join(globalRoot, 'playwright')
  const expected = { chromium: { source: 'global' } }
  const actual = loadPlaywright({
    env: emptyEnv(),
    tryRequire(moduleId) {
      requested.push(moduleId)
      return moduleId === expectedPath ? expected : null
    },
    getGlobalNpmRoot: () => globalRoot,
  })

  assert.strictEqual(actual, expected)
  assert(requested.indexOf(expectedPath) > requested.indexOf('@playwright/test'))
}

function testThrowsWhenNoRuntimeExists() {
  assert.throws(
    () => loadPlaywright({
      env: emptyEnv(),
      tryRequire: () => null,
      getGlobalNpmRoot: () => '',
    }),
    /Playwright was not found/,
  )
}

testEnvironmentOverrideWins()
testLocalResolutionOrder()
testGlobalFallback()
testThrowsWhenNoRuntimeExists()
console.log('playwright-runtime tests passed')
