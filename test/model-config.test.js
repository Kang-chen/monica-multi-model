const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'monica-multi-model.user.js'), 'utf8')
const e2eSource = fs.readFileSync(path.join(__dirname, 'test-all.js'), 'utf8')
const defaultModelsBlock = source.match(/const DEFAULT_MODELS = \[([\s\S]*?)\n  \]/)?.[1] || ''
const targetModelsBlock = e2eSource.match(/const TARGET_MODELS = \[([\s\S]*?)\n\]/)?.[1] || ''
const defaultModelIds = Array.from(defaultModelsBlock.matchAll(/id:\s*'([^']+)'/g), match => match[1])
const targetModelIds = Array.from(targetModelsBlock.matchAll(/id:\s*'([^']+)'/g), match => match[1])

const invalidIds = [
  'gemini-3.5-flash',
  'claude-sonnet-4-6',
]

const requiredCanonicalIds = [
  'gemini-3.5-flash-thinking',
  'gpt-5.5',
  'claude-sonnet-5',
]

for (const invalidId of invalidIds) {
  assert(!defaultModelIds.includes(invalidId), `DEFAULT_MODELS should not use invalid model id ${invalidId}`)
  assert(!targetModelIds.includes(invalidId), `TARGET_MODELS should not expect invalid model id ${invalidId}`)
}

for (const canonicalId of requiredCanonicalIds) {
  assert(source.includes(canonicalId), `userscript should include canonical model id ${canonicalId}`)
  assert(e2eSource.includes(canonicalId), `E2E test should include canonical model id ${canonicalId}`)
}

assert(source.includes('MODEL_ALIASES'), 'userscript should migrate old stored model ids')
assert(source.includes('normalizeModels'), 'userscript should normalize stored model config')
assert(source.includes("'claude-sonnet-4-6'"), 'userscript should migrate Claude 4.6 Sonnet to Claude 5 Sonnet')
assert(source.includes('mergeDefaultModels'), 'userscript should merge newly added default models into stored config')
assert(source.includes('mergeDefaultModels(storedModels)'), 'loadModels should add missing defaults when stored config exists')

console.log('model-config tests passed')
