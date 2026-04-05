import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import type { OperationalError } from "../domain/Errors.js"

export interface HeartbeatSnapshot {
  readonly timestamp: string
  readonly hostname: string
  readonly appUp: boolean
  readonly lastSuccessfulHeartbeatAt: string | null
}

export class Heartbeat extends ServiceMap.Service<
  Heartbeat,
  {
    readonly beat: () => Effect.Effect<HeartbeatSnapshot, OperationalError>
    readonly lastSuccess: () => Effect.Effect<string | null>
  }
>()("@ipp/agent/Heartbeat") {}
