import { Context, Effect } from "effect"

import type { OperationalError } from "../domain/Errors.js"

export interface HeartbeatSnapshot {
  readonly appUp: boolean
  readonly timestamp: string
  readonly hostname: string
  readonly networkOnline: boolean
  readonly localIps: readonly string[]
  readonly cupsReachable: boolean
  readonly printerAttached: boolean
  readonly queueDepth: number
  readonly nonterminalJobCount: number
  readonly lastSuccessfulHeartbeatAt: string | null
}

export class Heartbeat extends Context.Tag("@ipp/agent/Heartbeat")<
  Heartbeat,
  {
    readonly snapshot: () => Effect.Effect<HeartbeatSnapshot, OperationalError>
    readonly beat: () => Effect.Effect<HeartbeatSnapshot, OperationalError>
    readonly lastSuccess: () => Effect.Effect<string | null>
  }
>() {}
