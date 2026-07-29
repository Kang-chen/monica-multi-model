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

function loadPlaywright() {
  const direct = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '@playwright/test',
  ]

  for (const candidate of direct) {
    const loaded = tryRequire(candidate)
    if (loaded?.chromium) return loaded
  }

  const globalRoots = new Set()
  if (process.env.APPDATA) {
    globalRoots.add(path.join(process.env.APPDATA, 'npm', 'node_modules'))
  }
  if (process.env.npm_config_prefix) {
    globalRoots.add(path.join(process.env.npm_config_prefix, 'node_modules'))
  }
  for (const entry of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    globalRoots.add(entry)
  }

  try {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    globalRoots.add(execFileSync(npmCommand, ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    }).trim())
  } catch {}

  for (const globalRoot of globalRoots) {
    const globalCandidates = [
      path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright'),
      path.join(globalRoot, 'playwright'),
      path.join(globalRoot, '@playwright', 'test'),
    ]
    for (const candidate of globalCandidates) {
      const loaded = tryRequire(candidate)
      if (loaded?.chromium) return loaded
    }
  }

  throw new Error(
    'Playwright was not found. Install playwright or set PLAYWRIGHT_MODULE to its module path.',
  )
}

module.exports = loadPlaywright()
