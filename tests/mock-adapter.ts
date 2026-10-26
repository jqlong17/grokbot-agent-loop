/**
 * Minimal mock LLM adapter for interruptible-loop contract tests.
 * Adapted from DeepSeek Harness agent-loop test helpers (MIT).
 */
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export class MockAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  private hangWaiters: Array<{
    resolve: (chunks: StreamChunk[] | undefined) => void
    reject: (err: Error) => void
  }> = []

  constructor(
    private script: (StreamChunk[] | 'hang')[],
  ) {
    super()
  }

  /**
   * Complete a live `'hang'` stream without aborting (P1.5 parallel: parent
   * keeps flying while a child Session handles OTHER).
   */
  resolveHang(chunks?: StreamChunk[]): void {
    const waiter = this.hangWaiters.shift()
    if (!waiter) throw new Error('MockAdapter: no pending hang to resolve')
    waiter.resolve(chunks)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('MockAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial-streamed-' }
      yield { type: 'text-delta', index: 0, text: 'prefix' }
      let chunks: StreamChunk[] | undefined
      try {
        chunks = await new Promise<StreamChunk[] | undefined>((resolve, reject) => {
          const waiter = { resolve, reject }
          this.hangWaiters.push(waiter)
          const drop = () => {
            const idx = this.hangWaiters.indexOf(waiter)
            if (idx >= 0) this.hangWaiters.splice(idx, 1)
          }
          if (options.signal?.aborted) {
            drop()
            reject(new Error('aborted'))
            return
          }
          options.signal?.addEventListener('abort', () => {
            drop()
            reject(new Error('aborted'))
          }, { once: true })
        })
      } catch (err) {
        // Cooperative cancel path (0.1.x preempt) — stop the hung stream.
        throw err
      }
      if (chunks) {
        for (const chunk of chunks) yield chunk
      }
      return
    }
    for (const chunk of entry) yield chunk
  }
}
