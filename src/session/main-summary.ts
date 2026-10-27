/** Dual-session stubs — Ideal Topology v1.1 layout. */
export {
  dualSessionPair,
  StubSummarySession,
  type DualSessionHandle,
  type DualSessionPair,
  type SessionRole,
  type SummarySession,
} from '../sessions.ts'

/** Alias: MainSession is the live inference half. */
export interface MainSession {
  readonly sessionId: string
  readonly role: 'main'
}

export function asMainSession(sessionId: string): MainSession {
  return { sessionId, role: 'main' }
}
