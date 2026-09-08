const { spawnSync } = require('child_process')
const path = require('path')

const cases = [
  ['request-bridge.test.js'], ['model-config.test.js'], ['build.test.js'],
  ['ui-lifecycle.test.js'], ['model-discovery.test.js'], ['fusion.test.js'],
  ['model-discovery.test.js', '1'], ['fusion.test.js', '1'],
]
for (const [file, wrapped = '0'] of cases) {
  console.log(`Running ${file} (wrapped window: ${wrapped})`)
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    env: { ...process.env, WRAPPED_WINDOW: wrapped }, stdio: 'inherit',
  })
  if (result.error) console.error(result.error)
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('All regression suites passed (fixtures; live Tampermonkey acceptance is separate)')
