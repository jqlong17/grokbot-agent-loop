#!/usr/bin/env node
/**
 * Optional live parallel smoke (slice B).
 *
 * Skips unless GROKBOT_LIVE_PARALLEL=1. Does not require credentials for the
 * skip path; a real dsh profile with `@deepseek-ai/dsh-subagent` mounted is
 * needed only when the flag is set. CI stays on deterministic vitest gold
 * (`tests/parallel-gold.spec.ts`).
 *
 * Usage:
 *   GROKBOT_LIVE_PARALLEL=1 node scripts/live-parallel.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

if (process.env.GROKBOT_LIVE_PARALLEL !== '1') {
  console.log(
    '[live-parallel] skip — set GROKBOT_LIVE_PARALLEL=1 to run against a live dsh+subagent profile',
  )
  process.exit(0)
}

const pkg = require(join(root, 'package.json'))
const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)

if (typeof mod.ActivationManager !== 'function') {
  console.error('[live-parallel] ActivationManager export missing')
  process.exit(1)
}
if (typeof mod.resolveSubagentsRuntime !== 'function') {
  console.error('[live-parallel] resolveSubagentsRuntime export missing')
  process.exit(1)
}

console.log(`[live-parallel] package ${pkg.name}@${pkg.version}`)
console.log(
  '[live-parallel] flag set — mount a dsh profile with dsh-subagent and assert',
)
console.log(
  '  parent Session keeps running while startActivation yields a distinct child Session id.',
)
console.log(
  '[live-parallel] no embedded live host in this script yet; use vitest parallel-gold for CI.',
)
console.log('[live-parallel] ok (scaffold)')
process.exit(0)
