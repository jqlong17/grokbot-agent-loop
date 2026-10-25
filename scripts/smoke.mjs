#!/usr/bin/env node
/**
 * Dry-run smoke: verify the package entry loads and exports the factory + scheduler,
 * and that cordis.patch.yml uses disable+insert (not same-id rename).
 * Does not boot a full dsh profile (no peer host required beyond Node resolution).
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const pkg = require(join(root, 'package.json'))
if (pkg.name !== '@harness-plugins/grokbot-agent-loop') {
  console.error('unexpected package name', pkg.name)
  process.exit(1)
}
if (!pkg.dsh?.bundle?.patch) {
  console.error('missing dsh.bundle.patch — package would not activate as a dsh bundle')
  process.exit(1)
}

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const stockBlock = patch.match(/-\s+id:\s+agent-loop\n(?:[ \t]+.+\n)*/)?.[0] ?? ''
if (!/disabled:\s+true\b/.test(stockBlock) || /\bname:\s*/.test(stockBlock)) {
  console.error('cordis.patch.yml must disable stock agent-loop without setting name')
  process.exit(1)
}
if (!/id:\s+grokbot-agent-loop/.test(patch) || !/name:\s+'@harness-plugins\/grokbot-agent-loop'/.test(patch)) {
  console.error('cordis.patch.yml must insert grokbot-agent-loop with this package name')
  process.exit(1)
}

const mod = await import(pathToFileURL(join(root, 'lib/index.js')).href)
if (typeof mod.default !== 'function' && typeof mod.default !== 'object') {
  // Cordis Service classes are functions
  console.error('default export missing (AgentLoop service)')
  process.exit(1)
}
if (typeof mod.decideAdmission !== 'function') {
  console.error('decideAdmission export missing')
  process.exit(1)
}

const decision = mod.decideAdmission('steer', {
  busy: true,
  aborting: false,
  userLanePending: false,
  interruptOnSteer: true,
})
if (!decision.preempt || decision.target !== 'next-step') {
  console.error('scheduler smoke failed', decision)
  process.exit(1)
}

console.log('smoke ok:', pkg.name, pkg.version)
