#!/usr/bin/env node

/**
 * Build script for Monica Multi-Model Compare.
 *
 * Default:
 *   node build.js
 *   Increment the build number once, sync the source version, and write dist/.
 *
 * Pre-commit:
 *   node build.js --bump-if-needed
 *   Increment only when version.json has not already advanced beyond HEAD.
 *
 * Verification/build without a bump:
 *   node build.js --no-bump
 *   Keep the current version and synchronize the source and dist output.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const SRC = path.join(ROOT, 'monica-multi-model.user.js')
const DIST_DIR = path.join(ROOT, 'dist')
const DIST = path.join(DIST_DIR, 'monica-multi-model.user.js')
const VERSION_FILE = path.join(ROOT, 'version.json')

function readVersion(filePath = VERSION_FILE) {
  const version = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  for (const key of ['major', 'minor', 'patch', 'build']) {
    if (!Number.isInteger(version[key]) || version[key] < 0) {
      throw new Error(`version.json field "${key}" must be a non-negative integer`)
    }
  }
  return version
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}-b${version.build}`
}

function readHeadBuild() {
  try {
    const raw = execFileSync(
      'git',
      ['show', 'HEAD:version.json'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return readVersionFromText(raw).build
  } catch {
    return null
  }
}

function readVersionFromText(raw) {
  const version = JSON.parse(raw)
  for (const key of ['major', 'minor', 'patch', 'build']) {
    if (!Number.isInteger(version[key]) || version[key] < 0) {
      throw new Error(`version.json field "${key}" must be a non-negative integer`)
    }
  }
  return version
}

function synchronizeSourceVersion(source, versionString) {
  const headerPattern = /(@version\s+)\S+/
  const runtimePattern = /const SCRIPT_VERSION = ['"][^'"]*['"]/
  if (!headerPattern.test(source)) throw new Error('Unable to find the UserScript @version header')
  if (!runtimePattern.test(source)) throw new Error('Unable to find SCRIPT_VERSION')
  return source
    .replace(headerPattern, `$1${versionString}`)
    .replace(runtimePattern, `const SCRIPT_VERSION = '${versionString}'`)
}

function shouldBump(mode, version) {
  if (mode === 'no-bump') return false
  if (mode !== 'bump-if-needed') return true
  const headBuild = readHeadBuild()
  return headBuild === null || version.build <= headBuild
}

const mode = process.argv.includes('--no-bump')
  ? 'no-bump'
  : process.argv.includes('--bump-if-needed')
    ? 'bump-if-needed'
    : 'bump'

const version = readVersion()
const bumped = shouldBump(mode, version)
if (bumped) version.build += 1
const versionString = formatVersion(version)
const source = synchronizeSourceVersion(fs.readFileSync(SRC, 'utf8'), versionString)

fs.writeFileSync(SRC, source, 'utf8')
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true })
fs.writeFileSync(DIST, source, 'utf8')
fs.writeFileSync(VERSION_FILE, `${JSON.stringify(version, null, 2)}\n`, 'utf8')

console.log(`[build] Version: ${versionString}${bumped ? ' (incremented)' : ' (unchanged)'}`)
console.log(`[build] Source: ${SRC}`)
console.log(`[build] Output: ${DIST}`)
