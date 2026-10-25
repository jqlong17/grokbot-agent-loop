/**
 * Regression: Cordis include patches cannot rename an existing row's `name`.
 * The shipped bundle must disable stock `agent-loop` and insert a new id.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readPatch(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('cordis.patch.yml shape', () => {
  for (const path of ['cordis.patch.yml', 'examples/cordis.patch.yml'] as const) {
    it(`${path}: disables stock agent-loop without renaming name`, () => {
      const text = readPatch(path)

      // Stock row: disabled only — omitting name avoids "name mismatch … skipping".
      const stockBlock = text.match(/-\s+id:\s+agent-loop\n(?:[ \t]+.+\n)*/)?.[0] ?? ''
      expect(stockBlock).toMatch(/disabled:\s+true\b/)
      expect(stockBlock).not.toMatch(/\bname:\s*/)

      // New row: own id + this package name (under insert).
      expect(text).toMatch(/-\s+insert:/)
      expect(text).toMatch(/id:\s+grokbot-agent-loop/)
      expect(text).toMatch(/name:\s+'@harness-plugins\/grokbot-agent-loop'/)
      expect(text).toMatch(/interruptOnSteer:\s+true/)
    })
  }
})
