#!/usr/bin/env node
/**
 * Guard: no source file may address Mothership's device-wide price endpoint.
 *
 *   FORBIDDEN   /api/v1/devices/{device_id}/price          (whole device price map)
 *   ALLOWED     /api/v1/devices/{device_id}/prices         (read)
 *   ALLOWED     /api/v1/devices/{device_id}/prices/reset   (reset)
 *   ALLOWED     /api/v1/devices/{device_id}/games/{game_id}/price
 *   ALLOWED     /api/v1/games/{game_id}/metadata           (fleet default)
 *
 * The device-wide write replaces every price on the machine in one body, cannot be scoped to
 * a single game, and a malformed body can blank the device's prices. Per-kiosk changes belong
 * on the per-game endpoint so the change is attributable and verifiable on the launcher feed.
 *
 * Usage: node audits/pricing-endpoint-guard/check.cjs
 * Exit code 1 when a forbidden reference is found, so it can gate a commit or CI step.
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOTS = ['apps/api/src', 'apps/web/next-monorepo/apps/web']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'generated', '.turbo'])
const SKIP_PATHS = ['audits/pricing-endpoint-guard']
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs'])

/** `/devices/<anything>/price` where the path does not go through /games/ and is not /prices. */
const DEVICE_PRICE = /\/devices\/[^"'`\s]*?\/price(?!s)/g

function walk(dir, files) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, files)
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full)
    }
  }
}

const files = []
for (const root of ROOTS) walk(root, files)

const findings = []
for (const file of files) {
  const normalised = file.split(path.sep).join('/')
  if (SKIP_PATHS.some((skip) => normalised.startsWith(skip))) continue
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!line.includes('/devices/')) return
    // Documentation may name the endpoint it forbids; only real code addresses are findings.
    const trimmed = line.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
    const matches = line.match(DEVICE_PRICE)
    if (!matches) return
    for (const match of matches) {
      if (match.includes('/games/')) continue
      findings.push({ file: normalised, line: index + 1, match, source: line.trim().slice(0, 160) })
    }
  })
}

if (findings.length === 0) {
  console.log(`pricing-endpoint guard: clean (${files.length} files scanned)`)
  process.exit(0)
}

console.error(`pricing-endpoint guard: ${findings.length} forbidden reference(s) to /devices/{id}/price\n`)
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.match}`)
  console.error(`      ${finding.source}`)
}
console.error('\nUse /devices/{id}/games/{game_id}/price for one kiosk, or /games/{game_id}/metadata for the fleet.')
process.exit(1)