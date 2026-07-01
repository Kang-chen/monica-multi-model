#!/usr/bin/env node

/**
 * Build script for Monica Multi-Model Compare
 *
 * - Reads version.json and increments the build number
 * - Replaces @version header and SCRIPT_VERSION constant in source
 * - Outputs to dist/monica-multi-model.user.js
 * - Writes back updated version.json
 */

const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const SRC = path.join(ROOT, 'monica-multi-model.user.js')
const DIST_DIR = path.join(ROOT, 'dist')
const DIST = path.join(DIST_DIR, 'monica-multi-model.user.js')
const VERSION_FILE = path.join(ROOT, 'version.json')

// 1. Read version.json
const ver = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'))
ver.build += 1
const versionStr = `${ver.major}.${ver.minor}.${ver.patch}-b${ver.build}`

console.log(`[build] Version: ${versionStr}`)

// 2. Read source
let src = fs.readFileSync(SRC, 'utf8')

// 3. Replace @version in UserScript header
src = src.replace(/(@version\s+)\S+/, `$1${versionStr}`)

// 4. Replace SCRIPT_VERSION constant
src = src.replace(
  /const SCRIPT_VERSION = ['"][^'"]*['"]/,
  `const SCRIPT_VERSION = '${versionStr}'`
)

// 5. Ensure dist/ exists and write output
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true })
}
fs.writeFileSync(DIST, src, 'utf8')

// 6. Write back version.json
fs.writeFileSync(VERSION_FILE, JSON.stringify(ver, null, 2) + '\n', 'utf8')

console.log(`[build] Output: ${DIST}`)
console.log(`[build] Build ${ver.build} complete.`)
