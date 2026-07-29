const path = require('path')
const { execFileSync } = require('child_process')

function tryRequire(modulePath) {
  if (!modulePath) return null
  try {
    return require(modulePath)
  } catch {
    return null
  }
}

function getGlobalNpmRoot() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return execFileSync(npmCommand, ['root', '-g'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  }).trim()
}

function loadPlaywright(options = {}) {
  const env = options.env || process.env
  const requireCandidate = options.tryRequire || tryRequire
  const resolveGlobalNpmRoot = options.getGlobalNpmRoot || getGlobalNpmRoot
  const direct = [
    env.PLAYWRIGHT_MODULE,
    'playwright',
    '@playwright/test',
  ]

  for (const candidate of direct) {
    const loaded = requireCandidate(candidate)
    if (loaded?.chromium) return loaded
  }

  const globalRoots = new Set()
  if (env.APPDATA) {
    globalRoots.add(path.join(env.APPDATA, 'npm', 'node_modules'))
  }
  if (env.npm_config_prefix) {
    globalRoots.add(path.join(env.npm_config_prefix, 'node_modules'))
  }
  for (const entry of (env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    globalRoots.add(entry)
  }

  try {
    const globalNpmRoot = resolveGlobalNpmRoot()
    if (globalNpmRoot) globalRoots.add(globalNpmRoot)
  } catch {}

  for (const globalRoot of globalRoots) {
    const globalCandidates = [
      path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright'),
      path.join(globalRoot, 'playwright'),
      path.join(globalRoot, '@playwright', 'test'),
    ]
    for (const candidate of globalCandidates) {
      const loaded = requireCandidate(candidate)
      if (loaded?.chromium) return loaded
    }
  }

  throw new Error(
    'Playwright was not found. Install playwright or set PLAYWRIGHT_MODULE to its module path.',
  )
}

module.exports = loadPlaywright()
module.exports.loadPlaywright = loadPlaywright
module.exports.tryRequire = tryRequire
