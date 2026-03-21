import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import type { OperationalError } from "../domain/Errors.js"

export interface HeartbeatSnapshot {
  readonly appUp: boolean
  readonly timestamp: string
  readonly hostname: string
  readonly networkOnline: boolean
  readonly localIps: readonly string[]
  readonly cupsReachable: boolean
  readonly printerAttached: boolean
  readonly printerQueueAvailable: boolean
  readonly printerState: string | null
  readonly printerReasons: readonly string[]
  readonly printerMessage: string | null
  readonly queueDepth: number
  readonly nonterminalJobCount: number
  readonly lastSuccessfulHeartbeatAt: string | null
}

export class Heartbeat extends ServiceMap.Service<
  Heartbeat,
  {
    readonly snapshot: () => Effect.Effect<HeartbeatSnapshot, OperationalError>
    readonly beat: () => Effect.Effect<HeartbeatSnapshot, OperationalError>
    readonly lastSuccess: () => Effect.Effect<string | null>
  }
>()("@ipp/agent/Heartbeat") {}
