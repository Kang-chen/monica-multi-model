const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'monica-mm-build-'))

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(tempRoot, 'version.json'), 'utf8'))
}

function readSource() {
  return fs.readFileSync(path.join(tempRoot, 'monica-multi-model.user.js'), 'utf8')
}

function runBuild(...args) {
  return execFileSync(process.execPath, ['build.js', ...args], {
    cwd: tempRoot,
    encoding: 'utf8',
  })
}

function runGit(...args) {
  return execFileSync('git', args, {
    cwd: tempRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

try {
  fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(tempRoot, 'build.js'))
  fs.copyFileSync(
    path.join(ROOT, 'monica-multi-model.user.js'),
    path.join(tempRoot, 'monica-multi-model.user.js'),
  )
  fs.writeFileSync(
    path.join(tempRoot, 'version.json'),
    `${JSON.stringify({ major: 2, minor: 3, patch: 4, build: 9 }, null, 2)}\n`,
  )

  const firstOutput = runBuild()
  assert(firstOutput.includes('2.3.4-b10 (incremented)'), 'default build reports one increment')
  assert.strictEqual(readVersion().build, 10, 'default build increments version.json once')
  assert(readSource().includes('// @version      2.3.4-b10'), 'default build updates source header')
  assert(
    readSource().includes("const SCRIPT_VERSION = '2.3.4-b10'"),
    'default build updates runtime version',
  )
  assert.strictEqual(
    fs.readFileSync(path.join(tempRoot, 'dist', 'monica-multi-model.user.js'), 'utf8'),
    readSource(),
    'dist output matches the versioned source',
  )

  const secondOutput = runBuild('--no-bump')
  assert(secondOutput.includes('2.3.4-b10 (unchanged)'), 'no-bump build reports unchanged version')
  assert.strictEqual(readVersion().build, 10, 'no-bump build does not increment version.json')

  runGit('init')
  runGit('config', 'user.name', 'Build Test')
  runGit('config', 'user.email', 'build-test@example.invalid')
  runGit('add', 'build.js', 'monica-multi-model.user.js', 'version.json')
  runGit('commit', '-m', 'initial')

  const hookOutput = runBuild('--bump-if-needed')
  assert(hookOutput.includes('2.3.4-b11 (incremented)'), 'pre-commit mode increments once')
  assert.strictEqual(readVersion().build, 11, 'pre-commit mode advances beyond HEAD')

  const retryOutput = runBuild('--bump-if-needed')
  assert(retryOutput.includes('2.3.4-b11 (unchanged)'), 'pre-commit retry is idempotent')
  assert.strictEqual(readVersion().build, 11, 'pre-commit retry does not increment again')

  console.log('build tests passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
